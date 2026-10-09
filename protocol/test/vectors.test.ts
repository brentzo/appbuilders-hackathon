import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalBytes,
  decryptPayload,
  deviceKeysFromSeeds,
  encryptPayload,
  envelopeAdditionalData,
  envelopeSigningBytes,
  fromBase64,
  openEnvelope,
  pairAcceptSigningBytes,
  pairRequestTag,
  pairRequestTagBytes,
  publicKeysOf,
  relayAuthSigningBytes,
  sessionKeys,
  sign,
  toBase64,
  verify,
} from "../src/crypto.ts";
import { validate } from "../src/index.ts";
import { VECTORS_PATH, buildVectors, type CryptoVectors } from "../scripts/vectors.ts";

const v = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as CryptoVectors;
const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const mac = deviceKeysFromSeeds(hex(v.devices.mac.signingSeed), hex(v.devices.mac.kxSeed));
const phone = deviceKeysFromSeeds(hex(v.devices.phone.signingSeed), hex(v.devices.phone.kxSeed));

describe("vector file", () => {
  it("is what the reference implementation writes, so it never drifts (npm run vectors)", () => {
    expect(readFileSync(VECTORS_PATH, "utf8")).toBe(`${JSON.stringify(buildVectors(), null, 2)}\n`);
  });
});

describe("published known-answer tests", () => {
  it("signs RFC 8032 section 7.1 test 1 and test 2", () => {
    for (const t of v.rfc8032) {
      const keys = deviceKeysFromSeeds(hex(t.seed), hex(v.devices.mac.kxSeed));
      expect(toHex(keys.signing.publicKey)).toBe(t.publicKey);
      expect(toHex(sign(hex(t.message), keys.signing.secretKey))).toBe(t.signature);
    }
  });

  it("encrypts the XChaCha20-Poly1305 example from draft-irtf-cfrg-xchacha-03 A.3.1", () => {
    const t = v.xchacha20poly1305;
    const sealed = encryptPayload(new TextEncoder().encode(t.plaintext), hex(t.aad), hex(t.nonce), hex(t.key));
    expect(toHex(sealed)).toBe(t.ciphertext + t.tag);
    expect(new TextDecoder().decode(decryptPayload(sealed, hex(t.aad), hex(t.nonce), hex(t.key))!)).toBe(t.plaintext);
  });
});

describe("Yumi bridge vectors", () => {
  it("derives the device keys and ids from the seeds", () => {
    for (const [keys, d] of [[mac, v.devices.mac], [phone, v.devices.phone]] as const) {
      expect(toHex(keys.signing.publicKey)).toBe(d.signingPublicKey);
      expect(toHex(keys.kx.publicKey)).toBe(d.kxPublicKey);
      expect(keys.deviceId).toBe(d.deviceId);
    }
  });

  it("derives matching session keys on both devices", () => {
    const m = sessionKeys(mac, publicKeysOf(phone));
    const p = sessionKeys(phone, publicKeysOf(mac));
    expect({ rx: toHex(m.rx), tx: toHex(m.tx) }).toEqual(v.sessionKeys.mac);
    expect({ rx: toHex(p.rx), tx: toHex(p.tx) }).toEqual(v.sessionKeys.phone);
    expect(m.tx).toEqual(p.rx);
  });

  it("encodes fields with 4-byte big-endian length prefixes", () => {
    expect(toHex(canonicalBytes(v.canonical.fields))).toBe(v.canonical.bytes);
  });

  it("has a command and a result, so replyTo is covered both absent and present", () => {
    expect(v.envelopes.map((t) => t.envelope.type)).toEqual(["command", "result"]);
  });

  for (const t of v.envelopes) {
    const [sender, recipient] = t.sender === "mac" ? [mac, phone] : [phone, mac];

    it(`seals the ${t.envelope.type} envelope byte for byte`, () => {
      const { payload, signature, ...routing } = t.envelope;
      expect(toHex(envelopeAdditionalData(routing))).toBe(t.additionalData);
      const tx = sessionKeys(sender, publicKeysOf(recipient)).tx;
      const ciphertext = encryptPayload(new TextEncoder().encode(t.plaintext), hex(t.additionalData), hex(t.nonce), tx);
      expect(payload).toBe(toBase64(Uint8Array.from([...hex(t.nonce), ...ciphertext])));
      expect(toHex(envelopeSigningBytes(t.envelope))).toBe(t.signingBytes);
      expect(signature).toBe(toBase64(sign(hex(t.signingBytes), sender.signing.secretKey)));
      expect(validate("Envelope", t.envelope).errors).toEqual([]);
    });

    it(`opens the ${t.envelope.type} envelope on the recipient`, () => {
      const result = openEnvelope(t.envelope, recipient, publicKeysOf(sender), new Date(t.openAt));
      expect(result).toEqual({ ok: true, envelope: t.envelope, payload: JSON.parse(t.plaintext) });
    });
  }

  it("signs the relay challenge", () => {
    const t = v.relayAuth;
    expect(toHex(relayAuthSigningBytes(fromBase64(t.nonce), mac.deviceId))).toBe(t.signingBytes);
    expect(t.signature).toBe(toBase64(sign(hex(t.signingBytes), mac.signing.secretKey)));
  });

  it("tags the pairing request with the QR code's secret", () => {
    const t = v.pairRequest;
    const fields = {
      from: phone.deviceId,
      to: mac.deviceId,
      deviceName: t.request.deviceName,
      platform: t.request.platform,
      signingPublicKey: fromBase64(t.request.signingPublicKey),
      kxPublicKey: fromBase64(t.request.kxPublicKey),
    };
    expect(toHex(pairRequestTagBytes(fields))).toBe(t.tagBytes);
    expect(t.request.tag).toBe(toBase64(pairRequestTag(fields, fromBase64(t.pairingSecret))));
  });

  it("signs the pairing accept over the phone's keys", () => {
    const t = v.pairAccept;
    const bytes = pairAcceptSigningBytes({ from: mac.deviceId, to: phone.deviceId, signingPublicKey: phone.signing.publicKey, kxPublicKey: phone.kx.publicKey });
    expect(toHex(bytes)).toBe(t.signingBytes);
    expect(verify(fromBase64(t.accept.signature), bytes, mac.signing.publicKey)).toBe(true);
  });
});
