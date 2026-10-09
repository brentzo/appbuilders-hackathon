import { randomBytes, randomUUID } from "node:crypto";
import { pairAcceptSigningBytes, publicKeysOf, sealEnvelope, sealPairRequest, sign, toBase64, unpairSigningBytes } from "@yumi/protocol/crypto";
import type { RelayDevice } from "./device.ts";

/** Frames a device sends, built with the protocol's reference crypto. Shared by the e2e tests and the live check. */

export async function pair(mac: RelayDevice, phone: RelayDevice): Promise<void> {
  phone.send(makePairRequest(phone, mac));
  await mac.next("pairRequest");
  mac.send(makePairAccept(mac, phone));
  await phone.next("pairAccept");
}

export function makeEnvelope(sender: RelayDevice, recipient: RelayDevice, type: "command" | "result" | "event", payload: unknown, expiry = new Date(Date.now() + 120_000).toISOString()) {
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

export function makePairRequest(phone: RelayDevice, mac: Pick<RelayDevice, "keys">) {
  const pairingSecret = randomBytes(32);
  const sealed = sealPairRequest({ deviceName: "Test Phone", platform: "android", signingPublicKey: toBase64(phone.keys.signing.publicKey), kxPublicKey: toBase64(phone.keys.kx.publicKey) }, { from: phone.keys.deviceId, to: mac.keys.deviceId }, pairingSecret);
  return { frame: "pairRequest", from: phone.keys.deviceId, to: mac.keys.deviceId, sealed };
}

export function makeUnpair(from: RelayDevice, to: RelayDevice, at: string) {
  const id = randomUUID();
  const route = { id, from: from.keys.deviceId, to: to.keys.deviceId, at };
  return { frame: "unpair", ...route, signature: toBase64(sign(unpairSigningBytes(route), from.keys.signing.secretKey)) };
}

export function makePairAccept(mac: RelayDevice, phone: RelayDevice) {
  return {
    frame: "pairAccept",
    from: mac.keys.deviceId,
    to: phone.keys.deviceId,
    accept: { signature: toBase64(sign(pairAcceptSigningBytes({ from: mac.keys.deviceId, to: phone.keys.deviceId, signingPublicKey: phone.keys.signing.publicKey, kxPublicKey: phone.keys.kx.publicKey }), mac.keys.signing.secretKey)) },
  };
}
