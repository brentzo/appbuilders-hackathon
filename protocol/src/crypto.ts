import { randomUUID } from "node:crypto";
import sodium from "libsodium-wrappers";
import {
  APPROVAL_REQUEST_EXPIRY_SECONDS,
  COMMAND_EXPIRY_SECONDS,
  EVENT_EXPIRY_SECONDS,
  PROTOCOL_VERSION,
  RESULT_EXPIRY_SECONDS,
  type Envelope,
  type EnvelopeType,
} from "../generated/ts/index.ts";
import { validate } from "./index.ts";

/**
 * The reference implementation of the bridge crypto in protocol/docs/crypto.md.
 * The Swift and Kotlin clients must produce the same bytes; vectors/bridge-crypto-v1.json proves it.
 */

await sodium.ready;

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** A device's own keys. The secret keys never leave the device. */
export interface DeviceKeys {
  deviceId: string;
  /** Ed25519, for envelope signatures and relay authentication. */
  signing: KeyPair;
  /** X25519, for the crypto_kx session keys that encrypt payloads. */
  kx: KeyPair;
}

/** What a device stores about a paired device. */
export interface PeerKeys {
  deviceId: string;
  signingPublicKey: Uint8Array;
  kxPublicKey: Uint8Array;
}

export type ExpiryKind = "command" | "approvalRequest" | "result" | "event";

export type OpenFailure =
  | "invalidEnvelope"
  | "wrongRecipient"
  | "wrongSender"
  | "badSignature"
  | "expired"
  | "badExpiry"
  | "cannotDecrypt";

export type OpenResult = { ok: true; envelope: Envelope; payload: unknown } | { ok: false; reason: OpenFailure };

export interface SealInput {
  sender: DeviceKeys;
  recipient: PeerKeys;
  type: EnvelopeType;
  /** From `expiresAt(kind, now)`. */
  expiresAt: string;
  /** Any JSON value. The message kinds are defined in OBJ-25. */
  payload: unknown;
  /** Defaults to a new random UUID. */
  id?: string;
  /** Required for a result: the id of the command it answers. */
  replyTo?: string;
}

// Every signed or tagged byte string starts with its own domain, so one can never be replayed as another.
const ENVELOPE_DOMAIN = "yumi-envelope-v1";
const RELAY_AUTH_DOMAIN = "yumi-relay-auth-v1";
const PAIR_REQUEST_DOMAIN = "yumi-pair-request-v1";
const PAIR_ACCEPT_DOMAIN = "yumi-pair-accept-v1";
const NONCE_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
const BASE64 = sodium.base64_variants.ORIGINAL;
const EXPIRY_SECONDS: Record<ExpiryKind, number> = {
  command: COMMAND_EXPIRY_SECONDS,
  approvalRequest: APPROVAL_REQUEST_EXPIRY_SECONDS,
  result: RESULT_EXPIRY_SECONDS,
  event: EVENT_EXPIRY_SECONDS,
};
/** How far ahead an expiry may be: the longest expiry plus a minute for clocks that disagree. */
const MAX_EXPIRY_AHEAD_MS = (Math.max(...Object.values(EXPIRY_SECONDS)) + 60) * 1000;

/** The expiry for a message of this kind sent now, as an ISO 8601 UTC timestamp. */
export function expiresAt(kind: ExpiryKind, now: Date = new Date()): string {
  return new Date(now.getTime() + EXPIRY_SECONDS[kind] * 1000).toISOString();
}

/** New random device keys. */
export function generateDeviceKeys(): DeviceKeys {
  return deviceKeysFromSeeds(sodium.randombytes_buf(32), sodium.randombytes_buf(32));
}

/** Device keys from two 32-byte seeds. Used by the test vectors; real devices call generateDeviceKeys. */
export function deviceKeysFromSeeds(signingSeed: Uint8Array, kxSeed: Uint8Array): DeviceKeys {
  const signing = sodium.crypto_sign_seed_keypair(signingSeed);
  const kx = sodium.crypto_kx_seed_keypair(kxSeed);
  return {
    deviceId: deviceIdFor(signing.publicKey),
    signing: { publicKey: signing.publicKey, secretKey: signing.privateKey },
    kx: { publicKey: kx.publicKey, secretKey: kx.privateKey },
  };
}

export function publicKeysOf(keys: DeviceKeys): PeerKeys {
  return { deviceId: keys.deviceId, signingPublicKey: keys.signing.publicKey, kxPublicKey: keys.kx.publicKey };
}

/** A device id is the lowercase hex of the 16-byte BLAKE2b hash of its signing public key, so nobody can claim another device's id. */
export function deviceIdFor(signingPublicKey: Uint8Array): string {
  return sodium.crypto_generichash(16, signingPublicKey, null, "hex");
}

/**
 * The crypto_kx session keys between two devices. The device whose X25519 public key sorts first,
 * comparing bytes as unsigned numbers from the first byte, takes the client role.
 * `tx` encrypts what this device sends; `rx` decrypts what it receives.
 */
export function sessionKeys(me: DeviceKeys, peer: PeerKeys): { rx: Uint8Array; tx: Uint8Array } {
  const order = compareBytes(me.kx.publicKey, peer.kxPublicKey);
  if (order === 0) throw new Error("A device cannot pair with itself");
  const keys =
    order < 0
      ? sodium.crypto_kx_client_session_keys(me.kx.publicKey, me.kx.secretKey, peer.kxPublicKey)
      : sodium.crypto_kx_server_session_keys(me.kx.publicKey, me.kx.secretKey, peer.kxPublicKey);
  return { rx: keys.sharedRx, tx: keys.sharedTx };
}

/** Length-prefixed fields: each is a 4-byte big-endian byte length followed by its bytes (UTF-8 for text). */
export function canonicalBytes(fields: readonly (string | Uint8Array)[]): Uint8Array {
  const parts = fields.map((f) => (typeof f === "string" ? new TextEncoder().encode(f) : f));
  const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const part of parts) {
    view.setUint32(at, part.length);
    out.set(part, at + 4);
    at += 4 + part.length;
  }
  return out;
}

type Routing = Pick<Envelope, "id" | "from" | "to" | "type" | "replyTo" | "expiresAt" | "protocolVersion">;

function routingFields(e: Routing): string[] {
  return [ENVELOPE_DOMAIN, e.id, e.from, e.to, e.type, e.replyTo ?? "", e.expiresAt, String(e.protocolVersion)];
}

/** The additional data bound into the payload encryption: the routing fields. */
export function envelopeAdditionalData(e: Routing): Uint8Array {
  return canonicalBytes(routingFields(e));
}

/** The bytes the sender signs: the routing fields and the payload's base64 text as sent. */
export function envelopeSigningBytes(e: Routing & Pick<Envelope, "payload">): Uint8Array {
  return canonicalBytes([...routingFields(e), e.payload]);
}

/** The bytes a device signs to answer the relay's challenge. */
export function relayAuthSigningBytes(nonce: Uint8Array, deviceId: string): Uint8Array {
  return canonicalBytes([RELAY_AUTH_DOMAIN, nonce, deviceId]);
}

/** The pairing request fields the tag covers. `from` is the phone, `to` is the Mac. */
export interface PairRequestFields {
  from: string;
  to: string;
  deviceName: string;
  platform: string;
  signingPublicKey: Uint8Array;
  kxPublicKey: Uint8Array;
}

export function pairRequestTagBytes(r: PairRequestFields): Uint8Array {
  return canonicalBytes([PAIR_REQUEST_DOMAIN, r.from, r.to, r.deviceName, r.platform, r.signingPublicKey, r.kxPublicKey]);
}

/** Keyed BLAKE2b-256 of the request fields, keyed with the QR code's one-time pairing secret. */
export function pairRequestTag(r: PairRequestFields, pairingSecret: Uint8Array): Uint8Array {
  return sodium.crypto_generichash(32, pairRequestTagBytes(r), pairingSecret);
}

/** Compares a received tag with the expected one in constant time. */
export function tagsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && sodium.memcmp(a, b);
}

/** The bytes the Mac signs to accept a pairing request. `from` is the Mac, `to` is the phone. */
export function pairAcceptSigningBytes(a: { from: string; to: string; signingPublicKey: Uint8Array; kxPublicKey: Uint8Array }): Uint8Array {
  return canonicalBytes([PAIR_ACCEPT_DOMAIN, a.from, a.to, a.signingPublicKey, a.kxPublicKey]);
}

/** XChaCha20-Poly1305 (IETF). Returns the ciphertext with its 16-byte tag appended. */
export function encryptPayload(plaintext: Uint8Array, additionalData: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, additionalData, null, nonce, key);
}

/** Returns null when the key, nonce, additional data, or ciphertext is wrong. */
export function decryptPayload(ciphertext: Uint8Array, additionalData: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null {
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, additionalData, nonce, key);
  } catch {
    return null;
  }
}

/** A detached Ed25519 signature. */
export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return sodium.crypto_sign_detached(message, secretKey);
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, BASE64);
}

export function fromBase64(text: string): Uint8Array {
  return sodium.from_base64(text, BASE64);
}

/** Encrypts the payload for the recipient and signs the envelope. */
export function sealEnvelope(input: SealInput): Envelope {
  const routing: Routing = {
    id: input.id ?? randomUUID(),
    from: input.sender.deviceId,
    to: input.recipient.deviceId,
    type: input.type,
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    expiresAt: input.expiresAt,
    protocolVersion: PROTOCOL_VERSION,
  };
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
  const { tx } = sessionKeys(input.sender, input.recipient);
  const ciphertext = encryptPayload(plaintext, envelopeAdditionalData(routing), nonce, tx);
  const payload = toBase64(concat(nonce, ciphertext));
  const signature = toBase64(sign(envelopeSigningBytes({ ...routing, payload }), input.sender.signing.secretKey));
  return { ...routing, signature, payload };
}

/**
 * Checks and decrypts an envelope from a paired device, in this order: shape, recipient, sender,
 * signature, expiry, decryption. The caller looks up `sender` by the envelope's `from` among its
 * paired devices; an unknown `from` is the caller's "unpaired device" case (SPEC-08 r5).
 */
export function openEnvelope(value: unknown, receiver: DeviceKeys, sender: PeerKeys, now: Date = new Date()): OpenResult {
  if (!validate("Envelope", value).valid) return { ok: false, reason: "invalidEnvelope" };
  const envelope = value as Envelope;
  if (envelope.to !== receiver.deviceId) return { ok: false, reason: "wrongRecipient" };
  if (envelope.from !== sender.deviceId) return { ok: false, reason: "wrongSender" };
  if (!verify(fromBase64(envelope.signature), envelopeSigningBytes(envelope), sender.signingPublicKey)) {
    return { ok: false, reason: "badSignature" };
  }
  const expiry = Date.parse(envelope.expiresAt);
  if (now.getTime() >= expiry) return { ok: false, reason: "expired" };
  if (expiry - now.getTime() > MAX_EXPIRY_AHEAD_MS) return { ok: false, reason: "badExpiry" };
  const sealed = fromBase64(envelope.payload);
  const { rx } = sessionKeys(receiver, sender);
  const plaintext = decryptPayload(sealed.subarray(NONCE_BYTES), envelopeAdditionalData(envelope), sealed.subarray(0, NONCE_BYTES), rx);
  if (!plaintext) return { ok: false, reason: "cannotDecrypt" };
  return { ok: true, envelope, payload: JSON.parse(new TextDecoder().decode(plaintext)) as unknown };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
