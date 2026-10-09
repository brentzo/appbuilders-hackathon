import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deviceKeysFromSeeds, pairAcceptSigningBytes, publicKeysOf, sealEnvelope, sealPairRequest, sign, toBase64, unpairSigningBytes } from "@yumi/protocol/crypto";
import { PROTOCOL_VERSION } from "@yumi/protocol/types";
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
      const id = randomUUID();
      const unpair = {
        frame: "unpair",
        id,
        from: phone.keys.deviceId,
        to: mac.keys.deviceId,
        at,
        signature: toBase64(sign(unpairSigningBytes({ id, from: phone.keys.deviceId, to: mac.keys.deviceId, at }), phone.keys.signing.secretKey)),
      };
      await mac.close();
      phone.send(unpair);
      expect(await phone.next("ack")).toMatchObject({ frame: "ack", messageId: id });
      await until(() => !fixture.relay.store.isPaired(phone.keys.deviceId, mac.keys.deviceId));
      expect(fixture.relay.store.isPaired(phone.keys.deviceId, mac.keys.deviceId)).toBe(false);
      expect(fixture.relay.store.pendingUnpairs(mac.keys.deviceId)).toHaveLength(1);
      const denied = makeEnvelope(phone, mac, "command", { action: "blocked" });
      phone.send({ frame: "envelope", envelope: denied });
      expect(await phone.next("notPaired")).toMatchObject({ frame: "notPaired", messageId: denied.id });

      const reconnected = await RelayDevice.connect(fixture.relay.url(), mac.keys);
      try {
        expect(await reconnected.next("unpair")).toEqual(unpair);
        phone.send({ frame: "ack", messageId: id });
        expect(fixture.relay.store.pendingUnpairs(mac.keys.deviceId)).toHaveLength(1);
        reconnected.send({ frame: "ack", messageId: id });
        await until(() => fixture.relay.store.pendingUnpairs(mac.keys.deviceId).length === 0);
        phone.send(unpair);
        expect(await phone.next("ack")).toMatchObject({ frame: "ack", messageId: id });
        expect(fixture.relay.store.pendingUnpairs(mac.keys.deviceId)).toHaveLength(0);
        while (Date.now() <= Date.parse(at) + 10) await new Promise((resolve) => setTimeout(resolve, 5));
        await pair(reconnected, phone);
        phone.send(unpair);
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(fixture.relay.store.isPaired(phone.keys.deviceId, mac.keys.deviceId)).toBe(true);
        expect(reconnected.frames.some((frame) => frame.frame === "ack" && frame.messageId === id)).toBe(false);
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

describe("pairing answer window (OBJ-33)", () => {
  const start = new Date("2026-10-09T00:00:00.000Z");
  const seconds = (n: number) => new Date(start.getTime() + n * 1000);

  async function setup() {
    let now = start;
    const fixture = await openRelayFixture(undefined, () => now);
    const mac = await RelayDevice.connect(fixture.relay.url());
    const phone = await RelayDevice.connect(fixture.relay.url());
    return {
      fixture,
      mac,
      phone,
      at: (n: number) => {
        now = seconds(n);
      },
      close: async () => {
        await mac.close();
        await phone.close();
        await fixture.close();
      },
    };
  }

  it("pairs when the Mac answers within 30 seconds, and tells the Mac it counted", async () => {
    const { fixture, mac, phone, at, close } = await setup();
    try {
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      at(29);
      const accept = makePairAccept(mac, phone);
      mac.send(accept);
      expect(await phone.next("pairAccept")).toEqual(accept);
      expect(await mac.next("paired", "pairExpired")).toEqual({ frame: "paired", device: phone.keys.deviceId });
      expect(fixture.relay.store.isPaired(mac.keys.deviceId, phone.keys.deviceId)).toBe(true);
    } finally {
      await close();
    }
  });

  it("closes an unanswered request after 30 seconds and refuses the Mac's late answer (SPEC-08 'Mac does not answer pairing', 'Mac answers pairing too late')", async () => {
    const { fixture, mac, phone, at, close } = await setup();
    try {
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      at(29);
      fixture.relay.sweepExpired();
      at(30);
      fixture.relay.sweepExpired();
      expect(await phone.next("pairExpired", "pairAccept")).toEqual({ frame: "pairExpired", device: mac.keys.deviceId });
      expect(await mac.next("pairExpired", "paired")).toEqual({ frame: "pairExpired", device: phone.keys.deviceId });

      at(31);
      mac.send(makePairAccept(mac, phone));
      expect(await mac.next("pairExpired", "paired")).toEqual({ frame: "pairExpired", device: phone.keys.deviceId });
      await quiet();
      expect(phone.frames.filter(({ frame }) => frame === "pairAccept")).toEqual([]);
      expect(fixture.relay.store.isPaired(mac.keys.deviceId, phone.keys.deviceId)).toBe(false);
    } finally {
      await close();
    }
  });

  it("lets the phone cancel, so a later answer from the Mac pairs nothing", async () => {
    const { fixture, mac, phone, close } = await setup();
    try {
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      phone.send({ frame: "pairCancel", from: phone.keys.deviceId, to: mac.keys.deviceId });
      expect(await mac.next("pairExpired", "paired")).toEqual({ frame: "pairExpired", device: phone.keys.deviceId });

      mac.send(makePairAccept(mac, phone));
      expect(await mac.next("pairExpired", "paired")).toEqual({ frame: "pairExpired", device: phone.keys.deviceId });
      await quiet();
      expect(phone.frames).toEqual([]);
      expect(fixture.relay.store.isPaired(mac.keys.deviceId, phone.keys.deviceId)).toBe(false);
    } finally {
      await close();
    }
  });

  it("ignores a cancel from a device other than the requester", async () => {
    const { fixture, mac, phone, close } = await setup();
    const stranger = await RelayDevice.connect(fixture.relay.url());
    try {
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      stranger.send({ frame: "pairCancel", from: stranger.keys.deviceId, to: mac.keys.deviceId });
      stranger.send({ frame: "pairCancel", from: phone.keys.deviceId, to: mac.keys.deviceId });
      await quiet();
      mac.send(makePairAccept(mac, phone));
      expect(await mac.next("paired", "pairExpired")).toEqual({ frame: "paired", device: phone.keys.deviceId });
    } finally {
      await stranger.close();
      await close();
    }
  });

  it("holds the request for a Mac that reconnects within the window", async () => {
    let now = start;
    const fixture = await openRelayFixture(undefined, () => now);
    const phone = await RelayDevice.connect(fixture.relay.url());
    const macKeys = deviceKeysFromSeeds(randomBytes(32), randomBytes(32));
    try {
      const request = makePairRequest(phone, { keys: macKeys });
      phone.send(request);
      await until(() => fixture.relay.store.isPendingPair(phone.keys.deviceId, macKeys.deviceId));
      now = seconds(20);
      const mac = await RelayDevice.connect(fixture.relay.url(), macKeys);
      try {
        expect(await mac.next("pairRequest")).toEqual(request);
        mac.send(makePairAccept(mac, phone));
        expect(await phone.next("pairAccept", "pairExpired")).toMatchObject({ frame: "pairAccept" });
        expect(await mac.next("paired", "pairExpired")).toEqual({ frame: "paired", device: phone.keys.deviceId });
      } finally {
        await mac.close();
      }
    } finally {
      await phone.close();
      await fixture.close();
    }
  });

  it("tells the phone after 30 seconds when the Mac never came online", async () => {
    let now = start;
    const fixture = await openRelayFixture(undefined, () => now);
    const phone = await RelayDevice.connect(fixture.relay.url());
    const macKeys = deviceKeysFromSeeds(randomBytes(32), randomBytes(32));
    try {
      phone.send(makePairRequest(phone, { keys: macKeys }));
      await until(() => fixture.relay.store.isPendingPair(phone.keys.deviceId, macKeys.deviceId));
      now = seconds(30);
      fixture.relay.sweepExpired();
      expect(await phone.next("pairExpired")).toEqual({ frame: "pairExpired", device: macKeys.deviceId });
      const mac = await RelayDevice.connect(fixture.relay.url(), macKeys);
      try {
        await quiet();
        expect(mac.frames.filter(({ frame }) => frame === "pairRequest")).toEqual([]);
      } finally {
        await mac.close();
      }
    } finally {
      await phone.close();
      await fixture.close();
    }
  });

  it("refuses an answer that finds the phone offline, and tells the phone when it reconnects", async () => {
    const { fixture, mac, phone, at, close } = await setup();
    try {
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      await phone.close();
      at(10);
      mac.send(makePairAccept(mac, phone));
      expect(await mac.next("pairExpired", "paired")).toEqual({ frame: "pairExpired", device: phone.keys.deviceId });
      expect(fixture.relay.store.isPaired(mac.keys.deviceId, phone.keys.deviceId)).toBe(false);

      const back = await RelayDevice.connect(fixture.relay.url(), phone.keys);
      try {
        expect(await back.next("pairExpired", "pairAccept")).toEqual({ frame: "pairExpired", device: mac.keys.deviceId });
      } finally {
        await back.close();
      }
    } finally {
      await close();
    }
  });

  it("holds the verdict for a Mac that dropped off before the window closed", async () => {
    const { fixture, mac, phone, at, close } = await setup();
    try {
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      await mac.close();
      at(30);
      fixture.relay.sweepExpired();
      await phone.next("pairExpired");
      const back = await RelayDevice.connect(fixture.relay.url(), mac.keys);
      try {
        expect(await back.next("pairExpired", "pairRequest")).toEqual({ frame: "pairExpired", device: phone.keys.deviceId });
      } finally {
        await back.close();
      }
    } finally {
      await close();
    }
  });

  it("tells the Mac a request closed when the phone unpairs while it is open", async () => {
    const { mac, phone, close } = await setup();
    try {
      await pair(mac, phone);
      await mac.next("paired");
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      phone.send(makeUnpair(phone, mac, new Date(Date.now() + 1000).toISOString()));
      expect(await mac.next("pairExpired", "paired")).toEqual({ frame: "pairExpired", device: phone.keys.deviceId });
    } finally {
      await close();
    }
  });

  it("keeps a held paired verdict when the phone sends another request, so the Mac still learns it paired", async () => {
    const { fixture, mac, phone, close } = await setup();
    try {
      const store = fixture.relay.store;
      store.queuePairingNotice(mac.keys.deviceId, { frame: "paired", device: phone.keys.deviceId }, seconds(120).toISOString(), start.toISOString());
      store.queuePairingNotice(phone.keys.deviceId, { frame: "pairExpired", device: mac.keys.deviceId }, seconds(120).toISOString(), start.toISOString());
      store.clearPairingNotices(phone.keys.deviceId, mac.keys.deviceId);
      expect(store.queued(mac.keys.deviceId).map(({ frame }) => JSON.parse(frame))).toEqual([{ frame: "paired", device: phone.keys.deviceId }]);
      expect(store.queued(phone.keys.deviceId)).toEqual([]);
    } finally {
      await close();
    }
  });

  it("forgets an earlier verdict when the phone tries again, so an old pairExpired cannot cancel the new attempt", async () => {
    const { fixture, mac, phone, at, close } = await setup();
    try {
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      await mac.close();
      at(30);
      fixture.relay.sweepExpired();
      await phone.next("pairExpired");

      at(40);
      const retry = makePairRequest(phone, mac);
      phone.send(retry);
      await until(() => fixture.relay.store.isPendingPair(phone.keys.deviceId, mac.keys.deviceId));
      const back = await RelayDevice.connect(fixture.relay.url(), mac.keys);
      try {
        expect(await back.next("pairRequest", "pairExpired")).toEqual(retry);
        await quiet();
        expect(back.frames).toEqual([]);
      } finally {
        await back.close();
      }
    } finally {
      await close();
    }
  });
});

describe("another protocol version (OBJ-34)", () => {
  async function setup() {
    const fixture = await openRelayFixture();
    const mac = await RelayDevice.connect(fixture.relay.url());
    let phone = await RelayDevice.connect(fixture.relay.url());
    await pair(mac, phone);
    await phone.close();
    return {
      fixture,
      mac,
      reconnectPhone: async (protocolVersion: number, signature?: string) => {
        await phone.close();
        phone = await RelayDevice.connect(fixture.relay.url(), phone.keys, protocolVersion, signature);
        return phone;
      },
      close: async () => {
        await mac.close();
        await phone.close();
        await fixture.close();
      },
    };
  }

  async function commandOutcome(mac: RelayDevice, phone: RelayDevice) {
    const command = makeEnvelope(mac, phone, "command", { n: 1 });
    mac.send({ frame: "envelope", envelope: command });
    const notice = await mac.next("ack", "targetOffline", "targetNeedsUpdate");
    expect(notice).toEqual(notice.frame === "ack" ? { frame: "ack", messageId: command.id } : { frame: notice.frame, messageId: command.id, to: phone.keys.deviceId });
    return notice.frame;
  }

  it("refuses an older device with the relay's version, keeps it paired, and tells the sender it needs an update", async () => {
    const { fixture, mac, reconnectPhone, close } = await setup();
    try {
      const phone = await reconnectPhone(PROTOCOL_VERSION - 1);
      expect(phone.handshake).toEqual({ frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
      expect(fixture.relay.store.isPaired(mac.keys.deviceId, phone.keys.deviceId)).toBe(true);

      expect(await commandOutcome(mac, phone)).toBe("targetNeedsUpdate");
      expect(fixture.relay.store.queuedCount()).toBe(0);
    } finally {
      await close();
    }
  });

  it("delivers what it held once the device updates, with the same pairing and no new QR code", async () => {
    const { mac, reconnectPhone, close } = await setup();
    try {
      const old = await reconnectPhone(PROTOCOL_VERSION - 1);
      const event = makeEnvelope(mac, old, "event", { n: 2 });
      mac.send({ frame: "envelope", envelope: event });
      expect(await mac.next("ack")).toEqual({ frame: "ack", messageId: event.id });

      const phone = await reconnectPhone(PROTOCOL_VERSION);
      expect(phone.handshake).toEqual({ frame: "ready" });
      expect(await phone.next("envelope")).toEqual({ frame: "envelope", envelope: event });
      expect(await commandOutcome(mac, phone)).toBe("ack");

      await phone.close();
      await quiet();
      expect(await commandOutcome(mac, phone)).toBe("targetOffline");
    } finally {
      await close();
    }
  });

  it("refuses a device newer than the relay with the relay's version, and its sender hears only that it is offline", async () => {
    const { mac, reconnectPhone, close } = await setup();
    try {
      await reconnectPhone(PROTOCOL_VERSION - 1);
      const phone = await reconnectPhone(PROTOCOL_VERSION + 1);
      expect(phone.handshake).toEqual({ frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
      expect(await commandOutcome(mac, phone)).toBe("targetOffline");
    } finally {
      await close();
    }
  });

  it("checks who a device is before its version, so a forged old connection changes nothing", async () => {
    const { mac, reconnectPhone, close } = await setup();
    try {
      const phone = await reconnectPhone(PROTOCOL_VERSION - 1, `${"A".repeat(86)}==`);
      expect(phone.handshake).toEqual({ frame: "refused", reason: "badSignature" });
      expect(await commandOutcome(mac, phone)).toBe("targetOffline");
    } finally {
      await close();
    }
  });

  it("does not register an unknown device on another version", async () => {
    const fixture = await openRelayFixture();
    const device = await RelayDevice.connect(fixture.relay.url(), undefined, PROTOCOL_VERSION - 1);
    try {
      expect(device.handshake).toEqual({ frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
      expect(fixture.relay.store.isRegistered(device.keys.deviceId)).toBe(false);
    } finally {
      await device.close();
      await fixture.close();
    }
  });
});

async function quiet(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

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

function makeUnpair(from: RelayDevice, to: RelayDevice, at: string) {
  const id = randomUUID();
  const route = { id, from: from.keys.deviceId, to: to.keys.deviceId, at };
  return { frame: "unpair", ...route, signature: toBase64(sign(unpairSigningBytes(route), from.keys.signing.secretKey)) };
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
