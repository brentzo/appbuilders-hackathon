import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeClient } from "../src/bridge-client/client.ts";
import { FakeRelay } from "./support/fake-relay.ts";
import { openMacRpcPair } from "./support/mac-rpc.ts";
import { deviceKeysFromSeeds, fromBase64, relayAuthSigningBytes, sealPairRequest, sign, toBase64, verify, pairAcceptSigningBytes, unpairSigningBytes } from "@yumi/protocol/crypto";
import { PROTOCOL_VERSION, type BridgeFrame, type PairingOffer } from "@yumi/protocol/types";

describe("bridge client end-to-end", () => {
  it("pairs a phone, authenticates it, and exchanges an encrypted command and result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yumi-bridge-e2e-"));
    const relay = new FakeRelay(); await relay.listen();
    const macRpc = await openMacRpcPair();
    let ran = 0;
    const logs: string[] = [];
    const client = new BridgeClient({ bridgeUrl: "wss://relay.test", relayUrl: relay.url, allowLoopbackWs: true, deviceName: "Test Mac", databasePath: join(dir, "mac.sqlite"), rpcSocket: macRpc.socket,
      onMessage: async (value) => { expect(value).toEqual({ action: "ping" }); ran++; await wait(40); return { ran }; }, onLog: (event) => logs.push(event) });
    const phoneKeys = deviceKeysFromSeeds(randomBytes(32), randomBytes(32));
    const phone = new WebSocket(relay.url);
    const challengePromise = nextFrame(phone);
    try {
      await client.start(); await client.waitForState("connected");
      const { qrPayload } = await macRpc.app.request("startPairing", {}) as { qrPayload: string };
      const offer = JSON.parse(qrPayload) as PairingOffer;
      const challenge = await challengePromise;
      if (challenge.frame !== "challenge") throw new Error("relay did not challenge phone");
      phone.send(JSON.stringify({ frame: "authenticate", deviceId: phoneKeys.deviceId, signingPublicKey: toBase64(phoneKeys.signing.publicKey), protocolVersion: PROTOCOL_VERSION,
        signature: toBase64(sign(relayAuthSigningBytes(fromBase64(challenge.nonce), phoneKeys.deviceId), phoneKeys.signing.secretKey)) }));
      expect((await nextFrame(phone)).frame).toBe("ready");
      const request = { deviceName: "Test Phone", platform: "android" as const, signingPublicKey: toBase64(phoneKeys.signing.publicKey), kxPublicKey: toBase64(phoneKeys.kx.publicKey) };
      phone.send(JSON.stringify({ frame: "pairRequest", from: phoneKeys.deviceId, to: offer.deviceId,
        sealed: sealPairRequest(request, { from: phoneKeys.deviceId, to: offer.deviceId }, fromBase64(offer.pairingSecret)) }));
      const accepted = await nextFrame(phone);
      if (accepted.frame !== "pairAccept") throw new Error(`expected pairAccept, got ${accepted.frame}`);
      expect(verify(fromBase64(accepted.accept.signature), pairAcceptSigningBytes({ from: accepted.from, to: accepted.to,
        signingPublicKey: phoneKeys.signing.publicKey, kxPublicKey: phoneKeys.kx.publicKey }), fromBase64(offer.signingPublicKey))).toBe(true);
      expect((await macRpc.app.request("listPairedDevices", {}) as { devices: unknown[] }).devices).toHaveLength(1);

      const command = await import("@yumi/protocol/crypto").then(({ sealEnvelope, expiresAt }) => sealEnvelope({ sender: phoneKeys,
        recipient: { deviceId: offer.deviceId, signingPublicKey: fromBase64(offer.signingPublicKey), kxPublicKey: fromBase64(offer.kxPublicKey) },
        type: "command", expiresAt: expiresAt("command"), payload: { action: "ping" } }));
      phone.send(JSON.stringify({ frame: "envelope", envelope: command }));
      phone.send(JSON.stringify({ frame: "envelope", envelope: command }));
      let resultFrame = await nextFrame(phone);
      while (resultFrame.frame !== "envelope") resultFrame = await nextFrame(phone);
      expect(resultFrame.frame).toBe("envelope");
      if (resultFrame.frame !== "envelope") throw new Error("missing result envelope");
      const { openEnvelope } = await import("@yumi/protocol/crypto");
      const opened = openEnvelope(resultFrame.envelope, phoneKeys, { deviceId: offer.deviceId, signingPublicKey: fromBase64(offer.signingPublicKey), kxPublicKey: fromBase64(offer.kxPublicKey) });
      expect(opened.ok && opened.replyTo).toBe(command.id);
      expect(ran).toBe(1);

      relay.inject(offer.deviceId, { frame: "ack", messageId: "invalid" } as unknown as BridgeFrame);
      await wait(20);
      expect(logs).toContain("invalid-frame");
      relay.inject(offer.deviceId, { frame: "envelope", envelope: { ...command, from: "00000000000000000000000000000000", to: offer.deviceId } } as BridgeFrame);
      await wait(20);
      expect(logs).toContain("dropped-unpaired-envelope");
      expect(ran).toBe(1);

      const phoneRelayConnection = relay.clients.get(phoneKeys.deviceId)!;
      relay.clients.delete(phoneKeys.deviceId);
      const taskId = randomUUID();
      await client.sendMessage(phoneKeys.deviceId, "command", { action: "offline-check" }, undefined, taskId);
      await until(() => macRpc.events.some(({ event, payload }) => event === "userError" && (payload as { taskId?: string }).taskId === taskId));
      expect(macRpc.events.find(({ event, payload }) => event === "userError" && (payload as { taskId?: string }).taskId === taskId)?.payload)
        .toMatchObject({ kind: "otherDeviceOffline", taskId });
      relay.clients.set(phoneKeys.deviceId, phoneRelayConnection);
      const expiredTaskId = randomUUID();
      relay.nextNotice = "expired";
      await client.sendMessage(phoneKeys.deviceId, "command", { action: "expiry-check" }, undefined, expiredTaskId);
      await until(() => macRpc.events.some(({ event, payload }) => event === "userError" && (payload as { taskId?: string }).taskId === expiredTaskId));
      expect(macRpc.events.find(({ event, payload }) => event === "userError" && (payload as { taskId?: string }).taskId === expiredTaskId)?.payload)
        .toMatchObject({ kind: "commandExpired", taskId: expiredTaskId });

      relay.inject(offer.deviceId, { frame: "envelope", envelope: command });
      relay.inject(offer.deviceId, { frame: "envelope", envelope: command });
      const duplicateFrames: BridgeFrame[] = [];
      while (!duplicateFrames.some((frame) => frame.frame === "envelope")) duplicateFrames.push(await nextFrame(phone));
      expect(ran).toBe(1);

      relay.paired.delete([offer.deviceId, phoneKeys.deviceId].sort().join(":"));
      const unpairedTaskId = randomUUID();
      await client.sendMessage(phoneKeys.deviceId, "command", { action: "unpaired-check" }, undefined, unpairedTaskId);
      await until(() => macRpc.events.some(({ event, payload }) => event === "userError" && (payload as { taskId?: string }).taskId === unpairedTaskId));
      expect(macRpc.events.find(({ event, payload }) => event === "userError" && (payload as { taskId?: string }).taskId === unpairedTaskId)?.payload)
        .toMatchObject({ kind: "unpairedDevice", taskId: unpairedTaskId });
      relay.pair(offer.deviceId, phoneKeys.deviceId);

      await macRpc.app.request("unpair", { deviceId: phoneKeys.deviceId });
      let unpairFrame: Extract<BridgeFrame, { frame: "unpair" }> | undefined;
      while (!unpairFrame) {
        const frame = await nextFrame(phone);
        if (frame.frame === "unpair") unpairFrame = frame;
      }
      expect(verify(fromBase64(unpairFrame.signature), unpairSigningBytes(unpairFrame), fromBase64(offer.signingPublicKey))).toBe(true);
      expect((await macRpc.app.request("listPairedDevices", {}) as { devices: unknown[] }).devices).toEqual([]);
    } finally {
      phone.close(); client.stop(); await macRpc.close(); await relay.close(); await rm(dir, { recursive: true, force: true });
    }
  });
});

let frameWait = 0;
function nextFrame(socket: WebSocket, timeout = 3000): Promise<BridgeFrame> {
  const current = ++frameWait;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for relay frame ${current}`)), timeout);
    socket.once("message", (data) => { clearTimeout(timer); resolve(JSON.parse(data.toString()) as BridgeFrame); });
  });
}

function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) await wait(5);
  if (!predicate()) throw new Error("condition timed out");
}
