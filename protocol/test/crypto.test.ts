import { describe, expect, it } from "vitest";
import {
  encryptPayload,
  envelopeAdditionalData,
  envelopeSigningBytes,
  expiresAt,
  fromBase64,
  generateDeviceKeys,
  openEnvelope,
  openPairRequest,
  publicKeysOf,
  sealEnvelope,
  sealPairRequest,
  sessionKeys,
  sign,
  toBase64,
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
      { protocolVersion: 4 as 3 },
      { id: "0e9a3f5c-6b1d-4e2f-8a7b-9c0d1e2f3a4b" },
      { type: "result" as const },
      { expiresAt: "2026-10-09T07:43:00.000Z" },
      { payload: sealAlarm().payload },
    ];
    for (const change of changes) {
      expect(verify(signature, envelopeSigningBytes({ ...envelope, ...change }), mac.signing.publicKey), JSON.stringify(change)).toBe(false);
    }
  });

  it("never throws: an authentic payload that is not JSON is refused as invalidPayload", () => {
    const { signature: _, payload: __, ...routing } = sealAlarm();
    const nonce = new Uint8Array(24);
    const ciphertext = encryptPayload(new TextEncoder().encode("set an alarm"), envelopeAdditionalData(routing), nonce, sessionKeys(mac, publicKeysOf(phone)).tx);
    const payload = toBase64(Uint8Array.from([...nonce, ...ciphertext]));
    const signature = toBase64(sign(envelopeSigningBytes({ ...routing, payload }), mac.signing.secretKey));
    expect(openEnvelope({ ...routing, signature, payload }, phone, publicKeysOf(mac), now)).toEqual({ ok: false, reason: "invalidPayload" });
  });

  it("refuses to seal a payload that is not a JSON value", () => {
    expect(() =>
      sealEnvelope({ sender: mac, recipient: publicKeysOf(phone), type: "command", expiresAt: expiresAt("command", now), payload: undefined }),
    ).toThrow(TypeError);
  });

  it("never throws: a sender claiming the receiver's own exchange key cannot be decrypted", () => {
    const mirror = { ...publicKeysOf(mac), kxPublicKey: phone.kx.publicKey };
    expect(openEnvelope(sealAlarm(), phone, mirror, now)).toEqual({ ok: false, reason: "cannotDecrypt" });
  });

  it("refuses a value that is not an envelope", () => {
    expect(openEnvelope({ ...sealAlarm(), payload: "plain text" }, phone, publicKeysOf(mac), now)).toEqual({
      ok: false,
      reason: "invalidEnvelope",
    });
  });
});

describe("sealPairRequest and openPairRequest", () => {
  const secret = new Uint8Array(32).fill(7);
  const route = { from: phone.deviceId, to: mac.deviceId };
  const request = {
    deviceName: "Pixel 9",
    platform: "android" as const,
    signingPublicKey: toBase64(phone.signing.publicKey),
    kxPublicKey: toBase64(phone.kx.publicKey),
  };

  it("opens with the QR code's secret and nothing else", () => {
    const sealed = sealPairRequest(request, route, secret);
    expect(openPairRequest(sealed, route, secret)).toEqual(request);
    expect(openPairRequest(sealed, route, new Uint8Array(32).fill(8))).toBeNull();
  });

  it("keeps the phone's name and keys away from the relay (SPEC-08 r3)", () => {
    const sealed = sealPairRequest(request, route, secret);
    expect(Buffer.from(fromBase64(sealed)).toString("latin1")).not.toContain("Pixel");
    expect(sealed).not.toContain(request.signingPublicKey);
  });

  it("is bound to its route, so the relay cannot replay it as another device's request", () => {
    const sealed = sealPairRequest(request, route, secret);
    expect(openPairRequest(sealed, { ...route, from: stranger.deviceId }, secret)).toBeNull();
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
    expect(openEnvelope(envelope, phone, publicKeysOf(mac), later)).toEqual({ ok: false, reason: "expired", envelope });
  });

  it("returns an authentic expired envelope, so a repeat of a command that already ran gets its stored result (SPEC-08 'Duplicate delivery runs once')", () => {
    const envelope = sealAlarm();
    const result = openEnvelope(envelope, phone, publicKeysOf(mac), new Date("2026-10-09T07:50:00Z"));
    expect(result.ok === false && result.reason === "expired" && result.envelope.id).toBe(envelope.id);
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
