import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validate } from "@yumi/protocol";
import { deviceKeysFromSeeds, expiresAt, fromBase64, openEnvelope, sealEnvelope, toBase64 } from "@yumi/protocol/crypto";

describe("bridge protocol gray-box checks", () => {
  it("rejects altered routing/signature data and never opens expired commands", () => {
    const sender = deviceKeysFromSeeds(randomBytes(32), randomBytes(32));
    const receiver = deviceKeysFromSeeds(randomBytes(32), randomBytes(32));
    const senderPeer = { deviceId: sender.deviceId, signingPublicKey: sender.signing.publicKey, kxPublicKey: sender.kx.publicKey };
    const envelope = sealEnvelope({ sender, recipient: { deviceId: receiver.deviceId, signingPublicKey: receiver.signing.publicKey, kxPublicKey: receiver.kx.publicKey },
      type: "command", expiresAt: expiresAt("command"), payload: { secret: "not in routing" } });
    const altered = { ...envelope, to: sender.deviceId };
    expect(validate("Envelope", altered).valid).toBe(true);
    expect(openEnvelope(altered, receiver, senderPeer)).toMatchObject({ ok: false, reason: "wrongRecipient" });
    const forged = { ...envelope, signature: toBase64(new Uint8Array(64)) };
    expect(openEnvelope(forged, receiver, senderPeer)).toMatchObject({ ok: false, reason: "badSignature" });
    const expired = sealEnvelope({ sender, recipient: { deviceId: receiver.deviceId, signingPublicKey: receiver.signing.publicKey, kxPublicKey: receiver.kx.publicKey },
      type: "command", expiresAt: new Date(Date.now() - 1000).toISOString(), payload: { action: "must not run" } });
    expect(openEnvelope(expired, receiver, senderPeer)).toMatchObject({ ok: false, reason: "expired" });
    expect(fromBase64(envelope.payload).length).toBeGreaterThan(40);
  });
});
