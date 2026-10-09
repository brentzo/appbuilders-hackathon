import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pairAcceptSigningBytes, publicKeysOf, sealEnvelope, sealPairRequest, sign, toBase64 } from "@yumi/protocol/crypto";
import { RelayDevice } from "./support/device.ts";
import { openRelayFixture } from "./support/relay-fixture.ts";

describe("bridge relay non-functional behavior", () => {
  it("persists the device registry and pairings across a relay restart", async () => {
    const fixture = await openRelayFixture();
    const mac = await RelayDevice.connect(fixture.relay.url());
    const phone = await RelayDevice.connect(fixture.relay.url());
    try {
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      mac.send(makePairAccept(mac, phone));
      await phone.next("pairAccept");
      await phone.close();
      const event = sealEnvelope({ sender: mac.keys, recipient: publicKeysOf(phone.keys), type: "event", expiresAt: new Date(Date.now() + 120_000).toISOString(), payload: { sequence: 1 }, id: randomUUID() });
      mac.send({ frame: "envelope", envelope: event });
      await mac.next("ack");
      expect(fixture.relay.store.queuedCount()).toBe(1);
      await mac.close();
      await fixture.relay.close();

      const reopened = await openRelayFixture(fixture.databasePath);
      const macAgain = await RelayDevice.connect(reopened.relay.url(), mac.keys);
      const phoneAgain = await RelayDevice.connect(reopened.relay.url(), phone.keys);
      try {
        expect(reopened.relay.store.isPaired(mac.keys.deviceId, phone.keys.deviceId)).toBe(true);
        expect(await phoneAgain.next("envelope")).toEqual({ frame: "envelope", envelope: event });
        phoneAgain.send({ frame: "ack", messageId: event.id });
        await until(() => reopened.relay.store.queuedCount() === 0);
        await macAgain.close();
        await phoneAgain.close();
      } finally {
        await reopened.close();
      }
    } finally {
      await mac.close();
      await phone.close();
      await fixture.close();
    }
  });

  it("does not write a plaintext payload into SQLite or structured logs", async () => {
    const fixture = await openRelayFixture();
    const sender = await RelayDevice.connect(fixture.relay.url());
    const receiver = await RelayDevice.connect(fixture.relay.url());
    try {
      receiver.send(makePairRequest(receiver, sender));
      await sender.next("pairRequest");
      sender.send(makePairAccept(sender, receiver));
      await receiver.next("pairAccept");
      const envelope = sealEnvelope({ sender: sender.keys, recipient: publicKeysOf(receiver.keys), type: "event", expiresAt: new Date(Date.now() + 120_000).toISOString(), payload: { secret: "sensitive-plaintext-marker" }, id: randomUUID() });
      sender.send({ frame: "envelope", envelope });
      await sender.next("ack");
      const files = await readdir(fixture.directory);
      const databaseBytes = Buffer.concat(await Promise.all(files.map(async (name) => readFile(`${fixture.directory}/${name}`))));
      expect(databaseBytes.includes(Buffer.from("sensitive-plaintext-marker"))).toBe(false);
      expect(JSON.stringify(fixture.logs)).not.toContain("sensitive-plaintext-marker");
    } finally {
      await sender.close();
      await receiver.close();
      await fixture.close();
    }
  });
});

function makePairRequest(phone: RelayDevice, mac: RelayDevice) {
  const secret = randomBytes(32);
  return {
    frame: "pairRequest",
    from: phone.keys.deviceId,
    to: mac.keys.deviceId,
    sealed: sealPairRequest({ deviceName: "Test Phone", platform: "android", signingPublicKey: toBase64(phone.keys.signing.publicKey), kxPublicKey: toBase64(phone.keys.kx.publicKey) }, { from: phone.keys.deviceId, to: mac.keys.deviceId }, secret),
  };
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
