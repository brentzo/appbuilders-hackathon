// Writes vectors/bridge-crypto-v1.json, the cross-language test vectors for protocol/docs/crypto.md.
// With --check, fails instead if the file differs from what the reference implementation produces.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROTOCOL_VERSION, type Envelope, type PairAccept, type PairRequest } from "../generated/ts/index.ts";
import {
  canonicalBytes,
  deviceKeysFromSeeds,
  encryptPayload,
  envelopeAdditionalData,
  envelopeSigningBytes,
  pairAcceptSigningBytes,
  pairRequestTag,
  pairRequestTagBytes,
  publicKeysOf,
  relayAuthSigningBytes,
  sessionKeys,
  sign,
  toBase64,
  type DeviceKeys,
} from "../src/crypto.ts";

export const VECTORS_PATH = fileURLToPath(new URL("../vectors/bridge-crypto-v1.json", import.meta.url));

interface DeviceVector {
  signingSeed: string;
  kxSeed: string;
  signingPublicKey: string;
  kxPublicKey: string;
  deviceId: string;
}

interface EnvelopeVector {
  sender: "mac" | "phone";
  plaintext: string;
  nonce: string;
  additionalData: string;
  signingBytes: string;
  openAt: string;
  envelope: Envelope;
}

export interface CryptoVectors {
  description: string;
  rfc8032: { seed: string; publicKey: string; message: string; signature: string }[];
  xchacha20poly1305: { key: string; nonce: string; aad: string; plaintext: string; ciphertext: string; tag: string };
  devices: { mac: DeviceVector; phone: DeviceVector };
  sessionKeys: { mac: { rx: string; tx: string }; phone: { rx: string; tx: string } };
  canonical: { fields: string[]; bytes: string };
  envelopes: EnvelopeVector[];
  relayAuth: { nonce: string; signingBytes: string; signature: string };
  pairRequest: { pairingSecret: string; tagBytes: string; request: PairRequest };
  pairAccept: { signingBytes: string; accept: PairAccept };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
/** count bytes counting up from start, so every fixed input is easy to type in any language. */
const run = (start: number, count: number) => Uint8Array.from({ length: count }, (_, i) => (start + i) & 0xff);

function deviceVector(signingSeed: Uint8Array, kxSeed: Uint8Array): [DeviceKeys, DeviceVector] {
  const keys = deviceKeysFromSeeds(signingSeed, kxSeed);
  return [
    keys,
    {
      signingSeed: hex(signingSeed),
      kxSeed: hex(kxSeed),
      signingPublicKey: hex(keys.signing.publicKey),
      kxPublicKey: hex(keys.kx.publicKey),
      deviceId: keys.deviceId,
    },
  ];
}

function envelopeVector(
  sender: DeviceKeys,
  senderName: "mac" | "phone",
  recipient: DeviceKeys,
  routing: Pick<Envelope, "id" | "type" | "replyTo" | "expiresAt">,
  plaintext: string,
  nonce: Uint8Array,
  openAt: string,
): EnvelopeVector {
  const fields: Omit<Envelope, "signature" | "payload"> = { ...routing, from: sender.deviceId, to: recipient.deviceId, protocolVersion: PROTOCOL_VERSION };
  const additionalData = envelopeAdditionalData(fields);
  const ciphertext = encryptPayload(new TextEncoder().encode(plaintext), additionalData, nonce, sessionKeys(sender, publicKeysOf(recipient)).tx);
  const payload = toBase64(Uint8Array.from([...nonce, ...ciphertext]));
  const signingBytes = envelopeSigningBytes({ ...fields, payload });
  const envelope: Envelope = { ...fields, signature: toBase64(sign(signingBytes, sender.signing.secretKey)), payload };
  return { sender: senderName, plaintext, nonce: hex(nonce), additionalData: hex(additionalData), signingBytes: hex(signingBytes), openAt, envelope };
}

export function buildVectors(): CryptoVectors {
  const [mac, macVector] = deviceVector(run(0x00, 32), run(0x20, 32));
  const [phone, phoneVector] = deviceVector(run(0x40, 32), run(0x60, 32));
  const macSession = sessionKeys(mac, publicKeysOf(phone));
  const phoneSession = sessionKeys(phone, publicKeysOf(mac));

  const commandId = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
  const envelopes = [
    envelopeVector(mac, "mac", phone, { id: commandId, type: "command", expiresAt: "2026-10-09T07:44:00.000Z" }, '{"tool":"set_alarm","time":"06:30"}', run(0x80, 24), "2026-10-09T07:42:00.000Z"),
    envelopeVector(
      phone,
      "phone",
      mac,
      { id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", type: "result", replyTo: commandId, expiresAt: "2026-10-09T07:44:01.000Z" },
      '{"ok":true}',
      run(0xa0, 24),
      "2026-10-09T07:42:01.000Z",
    ),
  ];

  const relayNonce = run(0xc0, 32);
  const relayBytes = relayAuthSigningBytes(relayNonce, mac.deviceId);

  const pairingSecret = run(0xe0, 32);
  const requestFields = {
    from: phone.deviceId,
    to: mac.deviceId,
    deviceName: "Pixel 9",
    platform: "android" as const,
    signingPublicKey: phone.signing.publicKey,
    kxPublicKey: phone.kx.publicKey,
  };
  const acceptBytes = pairAcceptSigningBytes({ from: mac.deviceId, to: phone.deviceId, signingPublicKey: phone.signing.publicKey, kxPublicKey: phone.kx.publicKey });

  return {
    description:
      "Test vectors for protocol/docs/crypto.md. Binary values are lowercase hex unless the wire format uses base64. Generated by protocol/scripts/vectors.ts; do not edit by hand.",
    // RFC 8032 section 7.1, tests 1 and 2. The seed is the RFC's 32-byte "SECRET KEY".
    rfc8032: [
      {
        seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
        publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        message: "",
        signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
      },
      {
        seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
        publicKey: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
        message: "72",
        signature: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
      },
    ],
    // draft-irtf-cfrg-xchacha-03, appendix A.3.1.
    xchacha20poly1305: {
      key: "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f",
      nonce: "404142434445464748494a4b4c4d4e4f5051525354555657",
      aad: "50515253c0c1c2c3c4c5c6c7",
      plaintext: "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
      ciphertext:
        "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e",
      tag: "c0875924c1c7987947deafd8780acf49",
    },
    devices: { mac: macVector, phone: phoneVector },
    sessionKeys: {
      mac: { rx: hex(macSession.rx), tx: hex(macSession.tx) },
      phone: { rx: hex(phoneSession.rx), tx: hex(phoneSession.tx) },
    },
    canonical: { fields: ["yumi", "", "Taglish é"], bytes: hex(canonicalBytes(["yumi", "", "Taglish é"])) },
    envelopes,
    relayAuth: { nonce: toBase64(relayNonce), signingBytes: hex(relayBytes), signature: toBase64(sign(relayBytes, mac.signing.secretKey)) },
    pairRequest: {
      pairingSecret: toBase64(pairingSecret),
      tagBytes: hex(pairRequestTagBytes(requestFields)),
      request: {
        deviceName: requestFields.deviceName,
        platform: requestFields.platform,
        signingPublicKey: toBase64(phone.signing.publicKey),
        kxPublicKey: toBase64(phone.kx.publicKey),
        tag: toBase64(pairRequestTag(requestFields, pairingSecret)),
      },
    },
    pairAccept: { signingBytes: hex(acceptBytes), accept: { signature: toBase64(sign(acceptBytes, mac.signing.secretKey)) } },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const content = `${JSON.stringify(buildVectors(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    let current: string | undefined;
    try {
      current = readFileSync(VECTORS_PATH, "utf8");
    } catch {
      current = undefined;
    }
    if (current !== content) {
      console.error("vectors/bridge-crypto-v1.json is out of date. Run npm run vectors.");
      process.exit(1);
    }
  } else {
    writeFileSync(VECTORS_PATH, content);
    console.log("wrote vectors/bridge-crypto-v1.json");
  }
}
