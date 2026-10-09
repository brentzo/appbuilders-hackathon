import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge-client/client.ts";
import { FakeRelay } from "./support/fake-relay.ts";
import { openMacRpcPair } from "./support/mac-rpc.ts";

describe("bridge client non-functional behavior", () => {
  it("reconnects after a dropped authenticated socket and restores authenticated state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yumi-bridge-reconnect-"));
    const relay = new FakeRelay(); await relay.listen();
    const mac = await openMacRpcPair();
    const client = new BridgeClient({ bridgeUrl: "wss://relay.test", relayUrl: relay.url, allowLoopbackWs: true, deviceName: "Test Mac", databasePath: join(dir, "bridge.sqlite"), rpcSocket: mac.socket });
    try {
      await client.start(); await client.waitForState("connected");
      const { qrPayload } = await mac.app.request("startPairing", {}) as { qrPayload: string };
      const deviceId = (JSON.parse(qrPayload) as { deviceId: string }).deviceId;
      relay.clients.get(deviceId)!.socket.terminate();
      await client.waitForState("reconnecting");
      await client.waitForState("connected", 5000);
    } finally {
      client.stop(); await mac.close(); await relay.close(); await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-TLS remote bridge endpoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yumi-bridge-url-"));
    const mac = await openMacRpcPair();
    try {
      expect(() => new BridgeClient({ bridgeUrl: "ws://relay.example", deviceName: "Test", databasePath: join(dir, "x.sqlite"), rpcSocket: mac.socket })).toThrow("must use wss://");
    } finally { await mac.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
