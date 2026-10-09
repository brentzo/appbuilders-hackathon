import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deviceKeysFromSeeds, pairAcceptSigningBytes, publicKeysOf, sealEnvelope, sealPairRequest, sign, toBase64, unpairSigningBytes } from "@yumi/protocol/crypto";
import { RelayDevice } from "./support/device.ts";
import { openRelayFixture } from "./support/relay-fixture.ts";

describe("bridge relay end to end", () => {
  it("pairs two authenticated devices and routes an encrypted command", async () => {
    const fixture = await openRelayFixture();
    const mac = await RelayDevice.connect(fixture.relay.url());
    const phone = await RelayDevice.connect(fixture.relay.url());
    try {
      phone.send(makePairRequest(phone, mac));
      expect((await mac.next("pairRequest")).frame).toBe("pairRequest");
      mac.send(makePairAccept(mac, phone));
      expect((await phone.next("pairAccept")).frame).toBe("pairAccept");

      const command = makeEnvelope(mac, phone, "command", { title: "plaintext-marker" });
      mac.send({ frame: "envelope", envelope: command });
      expect(await phone.next("envelope")).toEqual({ frame: "envelope", envelope: command });
      expect(await mac.next("ack")).toEqual({ frame: "ack", messageId: command.id });
      expect(JSON.stringify(fixture.logs)).not.toContain("plaintext-marker");
    } finally {
      await mac.close();
      await phone.close();
      await fixture.close();
    }
  });

  it("does not retain a pairing request when the QR-code device is offline", async () => {
    const fixture = await openRelayFixture();
    const phone = await RelayDevice.connect(fixture.relay.url());
    const macKeys = deviceKeysFromSeeds(randomBytes(32), randomBytes(32));
    try {
      const request = makePairRequest(phone, { keys: macKeys });
      phone.send(request);
      await until(() => fixture.logs.some(({ event }) => event === "pairing.targetOffline"));
      expect(fixture.relay.store.isPendingPair(phone.keys.deviceId, macKeys.deviceId)).toBe(false);
      const mac = await RelayDevice.connect(fixture.relay.url(), macKeys);
      try {
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(mac.frames).toEqual([]);
      } finally {
        await mac.close();
      }
    } finally {
      await phone.close();
      await fixture.close();
    }
  });

  it("rejects cross-pair routing and immediately rejects a command to an offline peer", async () => {
    const fixture = await openRelayFixture();
    const sender = await RelayDevice.connect(fixture.relay.url());
    const peer = await RelayDevice.connect(fixture.relay.url());
    const stranger = await RelayDevice.connect(fixture.relay.url());
    try {
      await pair(sender, peer);
      const refused = makeEnvelope(sender, stranger, "event", { n: 1 });
      sender.send({ frame: "envelope", envelope: refused });
      expect(await sender.next("notPaired")).toMatchObject({ frame: "notPaired", messageId: refused.id, to: stranger.keys.deviceId });

      await peer.close();
      const command = makeEnvelope(sender, peer, "command", { n: 2 });
      sender.send({ frame: "envelope", envelope: command });
      expect(await sender.next("targetOffline")).toMatchObject({ frame: "targetOffline", messageId: command.id, to: peer.keys.deviceId });
      expect(fixture.relay.store.queuedCount()).toBe(0);
    } finally {
      await sender.close();
      await stranger.close();
      await peer.close();
      await fixture.close();
    }
  });

  it("rejects an envelope claiming a different sender than the authenticated connection", async () => {
    const fixture = await openRelayFixture();
    const sender = await RelayDevice.connect(fixture.relay.url());
    const recipient = await RelayDevice.connect(fixture.relay.url());
    const claimedSender = await RelayDevice.connect(fixture.relay.url());
    try {
      await pair(sender, recipient);
      await pair(claimedSender, recipient);
      const forged = makeEnvelope(claimedSender, recipient, "event", { action: "forged" });
      sender.send({ frame: "envelope", envelope: forged });

      await until(() => fixture.logs.some(({ event, fields }) => event === "frame.senderMismatch" && fields.from === claimedSender.keys.deviceId));
      expect(recipient.frames.some((frame) => frame.frame === "envelope" && frame.envelope.id === forged.id)).toBe(false);
      expect(fixture.relay.store.findEnvelopeDelivery(recipient.keys.deviceId, forged.id)).toBeUndefined();
    } finally {
      await sender.close();
      await recipient.close();
      await claimedSender.close();
      await fixture.close();
    }
  });

  it("holds results for reconnect, then deletes them when the receiver acks", async () => {
    const fixture = await openRelayFixture();
    const sender = await RelayDevice.connect(fixture.relay.url());
    let receiver = await RelayDevice.connect(fixture.relay.url());
    try {
      await pair(sender, receiver);
      await receiver.close();
      const result = makeEnvelope(sender, receiver, "result", { replyTo: "9e070c87-48b0-4c19-a13d-199f418c7c10", value: "encrypted" });
      sender.send({ frame: "envelope", envelope: result });
      expect(await sender.next("ack")).toMatchObject({ frame: "ack", messageId: result.id });
      expect(fixture.relay.store.queuedCount()).toBe(1);

      receiver = await RelayDevice.connect(fixture.relay.url(), receiver.keys);
      expect(await receiver.next("envelope")).toEqual({ frame: "envelope", envelope: result });
      receiver.send({ frame: "ack", messageId: result.id });
      await until(() => fixture.relay.store.queuedCount() === 0);
    } finally {
      await sender.close();
      await receiver.close();
      await fixture.close();
    }
  });

  it("notifies senders about already-expired messages and unknown peers", async () => {
    const fixture = await openRelayFixture();
    const sender = await RelayDevice.connect(fixture.relay.url());
    const receiver = await RelayDevice.connect(fixture.relay.url());
    try {
      await pair(sender, receiver);
      const expired = makeEnvelope(sender, receiver, "command", {}, new Date(Date.now() - 1000).toISOString());
      sender.send({ frame: "envelope", envelope: expired });
      expect(await sender.next("expired")).toMatchObject({ frame: "expired", messageId: expired.id });
    } finally {
      await sender.close();
      await receiver.close();
      await fixture.close();
    }
  });

  it("revokes a pairing immediately and retains the signed unpair frame for the offline peer", async () => {
    const fixture = await openRelayFixture();
    const mac = await RelayDevice.connect(fixture.relay.url());
    const phone = await RelayDevice.connect(fixture.relay.url());
    try {
      await pair(mac, phone);
      const at = new Date(Date.now() + 1000).toISOString();
      const unpair = {
        frame: "unpair",
        from: phone.keys.deviceId,
        to: mac.keys.deviceId,
        at,
        signature: toBase64(sign(unpairSigningBytes({ from: phone.keys.deviceId, to: mac.keys.deviceId, at }), phone.keys.signing.secretKey)),
      };
      await mac.close();
      phone.send(unpair);
      await until(() => !fixture.relay.store.isPaired(phone.keys.deviceId, mac.keys.deviceId));
      expect(fixture.relay.store.isPaired(phone.keys.deviceId, mac.keys.deviceId)).toBe(false);
      expect(fixture.relay.store.pendingUnpairs(mac.keys.deviceId)).toHaveLength(1);
      const denied = makeEnvelope(phone, mac, "command", { action: "blocked" });
      phone.send({ frame: "envelope", envelope: denied });
      expect(await phone.next("notPaired")).toMatchObject({ frame: "notPaired", messageId: denied.id });

      const reconnected = await RelayDevice.connect(fixture.relay.url(), mac.keys);
      try {
        expect(await reconnected.next("unpair")).toEqual(unpair);
      } finally {
        await reconnected.close();
      }
    } finally {
      await mac.close();
      await phone.close();
      await fixture.close();
    }
  });

  it("deletes expired queued results and tells the sender", async () => {
    let now = new Date("2026-10-09T00:00:00.000Z");
    const fixture = await openRelayFixture(undefined, () => now);
    const sender = await RelayDevice.connect(fixture.relay.url());
    const receiver = await RelayDevice.connect(fixture.relay.url());
    try {
      await pair(sender, receiver);
      await receiver.close();
      const result = makeEnvelope(sender, receiver, "event", { kind: "test" }, new Date(now.getTime() + 1000).toISOString());
      sender.send({ frame: "envelope", envelope: result });
      await sender.next("ack");
      expect(fixture.relay.store.queuedCount()).toBe(1);
      now = new Date(now.getTime() + 2000);
      fixture.relay.sweepExpired();
      expect(await sender.next("expired")).toMatchObject({ frame: "expired", messageId: result.id });
      expect(fixture.relay.store.queuedCount()).toBe(0);
    } finally {
      await sender.close();
      await receiver.close();
      await fixture.close();
    }
  });
});

async function pair(mac: RelayDevice, phone: RelayDevice): Promise<void> {
  phone.send(makePairRequest(phone, mac));
  await mac.next("pairRequest");
  mac.send(makePairAccept(mac, phone));
  await phone.next("pairAccept");
}

function makeEnvelope(sender: RelayDevice, recipient: RelayDevice, type: "command" | "result" | "event", payload: unknown, expiry = new Date(Date.now() + 120_000).toISOString()) {
  return sealEnvelope({
    sender: sender.keys,
    recipient: publicKeysOf(recipient.keys),
    type,
    expiresAt: expiry,
    payload,
    id: randomUUID(),
    ...(type === "result" ? { replyTo: (payload as { replyTo: string }).replyTo } : {}),
  });
}

function makePairRequest(phone: RelayDevice, mac: Pick<RelayDevice, "keys">) {
  const pairingSecret = randomBytes(32);
  const sealed = sealPairRequest({ deviceName: "Test Phone", platform: "android", signingPublicKey: toBase64(phone.keys.signing.publicKey), kxPublicKey: toBase64(phone.keys.kx.publicKey) }, { from: phone.keys.deviceId, to: mac.keys.deviceId }, pairingSecret);
  return { frame: "pairRequest", from: phone.keys.deviceId, to: mac.keys.deviceId, sealed };
}

function makePairAccept(mac: RelayDevice, phone: RelayDevice) {
  return {
    frame: "pairAccept",
    from: mac.keys.deviceId,
    to: phone.keys.deviceId,
    accept: { signature: toBase64(sign(pairAcceptSigningBytes({ from: mac.keys.deviceId, to: phone.keys.deviceId, signingPublicKey: phone.keys.signing.publicKey, kxPublicKey: phone.keys.kx.publicKey }), mac.keys.signing.secretKey)) },
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !predicate(); tries++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(predicate()).toBe(true);
}
