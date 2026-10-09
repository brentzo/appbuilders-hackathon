import { describe, expect, it } from "vitest";
import {
  envelopeSigningBytes,
  expiresAt,
  fromBase64,
  generateDeviceKeys,
  openEnvelope,
  publicKeysOf,
  sealEnvelope,
  verify,
} from "../src/crypto.ts";
import { validate } from "../src/index.ts";

const mac = generateDeviceKeys();
const phone = generateDeviceKeys();
const stranger = generateDeviceKeys();
const now = new Date("2026-10-09T07:42:00Z");
const alarm = { kind: "toolCall", call: { tool: "set_alarm", time: "06:30" } };

function sealAlarm() {
  return sealEnvelope({
    sender: mac,
    recipient: publicKeysOf(phone),
    type: "command",
    expiresAt: expiresAt("command", now),
    payload: alarm,
  });
}

describe("sealEnvelope and openEnvelope", () => {
  it("seals a valid envelope that the recipient opens", () => {
    const envelope = sealAlarm();
    expect(validate("Envelope", envelope).errors).toEqual([]);
    expect(envelope.from).toBe(mac.deviceId);
    expect(envelope.to).toBe(phone.deviceId);
    expect(openEnvelope(envelope, phone, publicKeysOf(mac), now)).toEqual({ ok: true, envelope, payload: alarm });
  });

  it("keeps the message out of every readable field (SPEC-08 'VPS cannot read messages')", () => {
    const readable = JSON.stringify({ ...sealAlarm(), payload: undefined, signature: undefined });
    expect(readable).not.toMatch(/alarm|06:30|toolCall/);
  });

  it("opens only with the recipient's keys", () => {
    const impostor = { ...stranger, deviceId: phone.deviceId };
    expect(openEnvelope(sealAlarm(), impostor, publicKeysOf(mac), now)).toEqual({ ok: false, reason: "cannotDecrypt" });
  });

  it("refuses an envelope addressed to another device", () => {
    expect(openEnvelope(sealAlarm(), stranger, publicKeysOf(mac), now)).toEqual({ ok: false, reason: "wrongRecipient" });
  });

  it("refuses an envelope from a device other than the expected sender", () => {
    expect(openEnvelope(sealAlarm(), phone, publicKeysOf(stranger), now)).toEqual({ ok: false, reason: "wrongSender" });
  });

  it("refuses an envelope signed by a key other than the paired sender's", () => {
    const forged = sealEnvelope({
      sender: { ...stranger, deviceId: mac.deviceId },
      recipient: publicKeysOf(phone),
      type: "command",
      expiresAt: expiresAt("command", now),
      payload: alarm,
    });
    expect(openEnvelope(forged, phone, publicKeysOf(mac), now)).toEqual({ ok: false, reason: "badSignature" });
  });

  it("fails verification when any routing field or ciphertext byte changes", () => {
    const envelope = sealAlarm();
    const flipped = Buffer.from(envelope.payload, "base64");
    flipped[30] = flipped[30]! ^ 1;
    const tampered = [
      { ...envelope, id: "0e9a3f5c-6b1d-4e2f-8a7b-9c0d1e2f3a4b" },
      { ...envelope, type: "event" as const },
      { ...envelope, replyTo: "0e9a3f5c-6b1d-4e2f-8a7b-9c0d1e2f3a4b" },
      { ...envelope, expiresAt: "2026-10-09T07:50:00.000Z" },
      { ...envelope, payload: flipped.toString("base64") },
    ];
    for (const t of tampered) expect(openEnvelope(t, phone, publicKeysOf(mac), now), JSON.stringify(t)).toEqual({ ok: false, reason: "badSignature" });
  });

  it("signs every routing field, so changing from, to, or the version breaks the signature too", () => {
    const envelope = sealAlarm();
    const signature = fromBase64(envelope.signature);
    expect(verify(signature, envelopeSigningBytes(envelope), mac.signing.publicKey)).toBe(true);
    const changes = [
      { from: stranger.deviceId },
      { to: stranger.deviceId },
      { protocolVersion: 2 as 1 },
      { id: "0e9a3f5c-6b1d-4e2f-8a7b-9c0d1e2f3a4b" },
      { type: "result" as const },
      { replyTo: envelope.id },
      { expiresAt: "2026-10-09T07:43:00.000Z" },
      { payload: sealAlarm().payload },
    ];
    for (const change of changes) {
      expect(verify(signature, envelopeSigningBytes({ ...envelope, ...change }), mac.signing.publicKey), JSON.stringify(change)).toBe(false);
    }
  });

  it("refuses a value that is not an envelope", () => {
    expect(openEnvelope({ ...sealAlarm(), payload: "plain text" }, phone, publicKeysOf(mac), now)).toEqual({
      ok: false,
      reason: "invalidEnvelope",
    });
  });
});

describe("expiry", () => {
  it("gives every command 2 minutes and an approval request 5 minutes (SPEC-08 r6, SPEC-09 r10)", () => {
    expect(expiresAt("command", now)).toBe("2026-10-09T07:44:00.000Z");
    expect(expiresAt("approvalRequest", now)).toBe("2026-10-09T07:47:00.000Z");
    expect(expiresAt("result", now)).toBe("2026-10-09T07:44:00.000Z");
    expect(expiresAt("event", now)).toBe("2026-10-09T07:44:00.000Z");
  });

  it("refuses an expired envelope (SPEC-08 'Expired command is not run')", () => {
    const envelope = sealAlarm();
    const later = new Date("2026-10-09T07:44:00Z");
    expect(openEnvelope(envelope, phone, publicKeysOf(mac), later)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses an expiry further ahead than any message kind allows, so a sender cannot make a command live forever", () => {
    const envelope = sealEnvelope({
      sender: mac,
      recipient: publicKeysOf(phone),
      type: "command",
      expiresAt: "2026-10-10T07:42:00.000Z",
      payload: alarm,
    });
    expect(openEnvelope(envelope, phone, publicKeysOf(mac), now)).toEqual({ ok: false, reason: "badExpiry" });
  });
});
