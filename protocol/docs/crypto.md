# Bridge crypto

How every message between two paired devices is encrypted and signed, so the relay on our VPS only ever sees routing fields and ciphertext ([SPEC-08](../../specs/08-device-bridge.md) r2 and r3).
Pairing and the relay connection are in [pairing.md](pairing.md).

The reference implementation is [`src/crypto.ts`](../src/crypto.ts), imported as `@yumi/protocol/crypto`.
The Swift and Kotlin clients must produce the same bytes, which [`vectors/bridge-crypto-v2.json`](../vectors/bridge-crypto-v2.json) proves.

## Choices

| What | Choice |
|---|---|
| Library | libsodium in every language |
| Signatures | Ed25519, detached (`crypto_sign_detached`) |
| Key exchange | X25519 with BLAKE2b session keys (`crypto_kx`) |
| Payload encryption | XChaCha20-Poly1305 IETF AEAD (`crypto_aead_xchacha20poly1305_ietf`), with a random 24-byte nonce per message |
| Device id | First 16 bytes of BLAKE2b (`crypto_generichash`) of the Ed25519 public key, as 32 lowercase hex characters |
| Binary on the wire | Standard base64 with padding (RFC 4648 section 4) |

We do not use `crypto_box_curve25519xchacha20poly1305_*`.
It is missing from the standard libsodium-wrappers build (checked in 0.8.4), and swift-sodium's `Box` only wraps the XSalsa20 variant.
`crypto_kx` plus the XChaCha20-Poly1305 AEAD gives the same security from functions all three libraries expose.

| Function | TypeScript: libsodium-wrappers 0.8.4 | Swift: swift-sodium 0.11.0 | Kotlin: lazysodium-android 5.2.0 |
|---|---|---|---|
| Ed25519 key pair from seed | `crypto_sign_seed_keypair` | `sign.keyPair(seed:)` | `cryptoSignSeedKeypair` |
| Sign, verify | `crypto_sign_detached`, `crypto_sign_verify_detached` | `sign.signature(message:secretKey:)`, `sign.verify(message:publicKey:signature:)` | `cryptoSignDetached`, `cryptoSignVerifyDetached` |
| X25519 key pair from seed | `crypto_kx_seed_keypair` | `keyExchange.keyPair(seed:)` | `cryptoKxSeedKeypair` |
| Session keys | `crypto_kx_client_session_keys`, `crypto_kx_server_session_keys` | `keyExchange.sessionKeyPair(publicKey:secretKey:otherPublicKey:side:)` | `cryptoKxClientSessionKeys`, `cryptoKxServerSessionKeys` |
| Encrypt, decrypt | `crypto_aead_xchacha20poly1305_ietf_encrypt`, `_decrypt` | `aead.xchacha20poly1305ietf.encrypt`, `.decrypt` | `cryptoAeadXChaCha20Poly1305IetfEncrypt`, `Decrypt` |
| Hash (device id) | `crypto_generichash` | `genericHash.hash(message:outputLength:)` | `cryptoGenericHash` |

The versions are the latest releases on 2026-10-09.
The function names were checked in each library's source; Swift and Kotlin argument labels may differ slightly, so follow the library's own docs.
swift-sodium's `encrypt` always picks its own nonce, so to reproduce a vector's ciphertext in Swift, call the C function `crypto_aead_xchacha20poly1305_ietf_encrypt` from the bundled libsodium, or check the vector by decrypting it with `decrypt(authenticatedCipherText:secretKey:nonce:additionalData:)`.

## Keys

Each device creates two key pairs on first run: Ed25519 for signing and X25519 for key exchange.
The secret keys never leave the device: the Mac keeps them in the Keychain ([OBJ-21](../../objectives/OBJ-21-mac-bridge-client-and-pairing.md)), and Android in storage backed by the Android Keystore ([OBJ-23](../../objectives/OBJ-23-android-bridge-client.md)).
The public keys are exchanged once, in person, during pairing.

The device id is derived from the Ed25519 public key, so no device can claim another's id at the relay.

## Session keys

Two paired devices derive a pair of session keys with `crypto_kx`.
The device whose X25519 public key sorts first takes the client role, comparing bytes as unsigned numbers from the first byte; the other takes the server role.
Each device encrypts what it sends with its `tx` key and decrypts what it receives with its `rx` key.
One device's `tx` is the other's `rx`.

Do not use libsodium's `sodium_compare` for the ordering: it compares numbers in little-endian order, which is the opposite end.

## Canonical bytes

Everything that is signed or used as additional data is a list of fields in a fixed order.
Each field is written as its byte length as a 4-byte big-endian unsigned integer, followed by its bytes.
Text is UTF-8.
The first field is always a domain string, so bytes signed for one purpose can never be replayed as another:

| Domain | Used for |
|---|---|
| `yumi-envelope-v2` | Envelope additional data and signature |
| `yumi-relay-auth-v1` | The answer to the relay's challenge |
| `yumi-pair-request-v1` | The pairing request's additional data |
| `yumi-pair-accept-v1` | The pairing accept signature |
| `yumi-unpair-v1` | The unpair signature |

## Envelope

The envelope schema is `Envelope` in [`schemas/bridge.json`](../schemas/bridge.json).

**Routing fields**, in this order: the domain `yumi-envelope-v2`, `id`, `from`, `to`, `type`, `expiresAt` (the exact text sent), and `protocolVersion` (as decimal text).

To seal:

1. Write an object containing `payload` and, for a result, `replyTo` as UTF-8 JSON text.
   The payload kinds are defined in [OBJ-25](../../objectives/OBJ-25-cross-device-messages.md).
   `openEnvelope` returns the inner `payload` and decrypted `replyTo` separately.
2. Pick a random 24-byte nonce.
3. Encrypt with XChaCha20-Poly1305, the sender's `tx` key, and the canonical routing fields as additional data.
   `replyTo` is inside this encrypted object and is not a routing field.
4. `payload` is the base64 of the nonce followed by the ciphertext and its 16-byte tag.
5. Sign the canonical routing fields followed by one more field, the `payload` base64 text, with the sender's Ed25519 key.
6. `signature` is the base64 of that signature.

To open, check in this order and stop at the first failure:

| Check | Failure | What the receiver does |
|---|---|---|
| The value matches the `Envelope` schema | `invalidEnvelope` | Drop it and log it |
| `to` is this device | `wrongRecipient` | Drop it and log it |
| `from` is a paired device | (the caller's lookup fails) | Drop it and log it (SPEC-08 r5) |
| The signature verifies with that device's Ed25519 key | `badSignature` | Drop it and log it (SPEC-08 r5) |
| `expiresAt` is still in the future | `expired` | Never run it (SPEC-08 r6). If its id already ran, resend the stored result; otherwise tell the sender it expired ([pairing.md](pairing.md)) |
| `expiresAt` is at most 6 minutes ahead | `badExpiry` | Drop it and log it |
| The payload decrypts with this device's `rx` key | `cannotDecrypt` | Drop it and log it |
| The plaintext is UTF-8 JSON | `invalidPayload` | Drop it and log it |

`openEnvelope` never throws.
An `expired` failure still returns the envelope, because its signature was checked.

The 6-minute limit is the longest expiry, 5 minutes for an approval request, plus a minute for clocks that disagree.
Without it, a sender could make a command that never expires.
The receiver then checks the expiry for the payload's kind once it is decrypted ([OBJ-25](../../objectives/OBJ-25-cross-device-messages.md)).
Every device uses the operating system's network-synced clock.

A message that opens is run at most once: the receiver remembers its `id` and, on a repeat, resends the stored result instead of running it again (SPEC-08 r8).

## Pairing request

The phone's `PairRequest` travels to the Mac sealed with the QR code's one-time pairing secret, so the relay can neither read nor replace it ([pairing.md](pairing.md)).

1. Write the `PairRequest` as UTF-8 JSON text.
2. Pick a random 24-byte nonce.
3. Encrypt with XChaCha20-Poly1305, the 32-byte pairing secret as the key, and the canonical fields `yumi-pair-request-v1`, `from` (the phone), and `to` (the Mac) as additional data.
4. `sealed` is the base64 of the nonce followed by the ciphertext and its 16-byte tag.

The Mac opens it with the same secret and additional data, then checks it against the `PairRequest` schema.
A request that fails to open was not made by someone who saw the QR code.

## Signatures outside envelopes

| What | Signed by | Canonical fields |
|---|---|---|
| Relay authentication | The connecting device | `yumi-relay-auth-v1`, the 32 challenge bytes, the device id |
| Pairing accept | The Mac | `yumi-pair-accept-v1`, `from` (the Mac), `to` (the phone), the phone's Ed25519 public key, the phone's X25519 public key |
| Unpair | The unpairing device | `yumi-unpair-v1`, `from`, `to`, `at` (the exact text sent) |

## Expiry

The constants are generated in every language from [`schemas/bridge.json`](../schemas/bridge.json):

| Constant | Seconds | Applies to |
|---|---|---|
| `COMMAND_EXPIRY_SECONDS` | 120 | Every command except an approval request (SPEC-08 r6, SPEC-09 r16) |
| `APPROVAL_REQUEST_EXPIRY_SECONDS` | 300 | An approval request (SPEC-09 r10) |
| `RESULT_EXPIRY_SECONDS` | 120 | A result held through a short reconnect (SPEC-08 r7) |
| `EVENT_EXPIRY_SECONDS` | 120 | An event held through a short reconnect (SPEC-08 r7) |

`expiresAt(kind, now)` in TypeScript returns the expiry as an ISO 8601 UTC timestamp.

## Test vectors

[`vectors/bridge-crypto-v2.json`](../vectors/bridge-crypto-v2.json) holds fixed inputs and the exact expected outputs.
Binary values are lowercase hex, except where the wire format itself uses base64.
Our own fixed inputs count up byte by byte (`000102...`), so they are easy to type in any language.

| Entry | Proves |
|---|---|
| `rfc8032` | Ed25519 signing matches RFC 8032 section 7.1, tests 1 and 2 |
| `xchacha20poly1305` | The AEAD matches draft-irtf-cfrg-xchacha-03, appendix A.3.1 |
| `devices` | Keys and device ids from fixed seeds |
| `sessionKeys` | Both devices derive matching session keys, with the client role rule |
| `canonical` | The length-prefixed encoding, including an empty field and non-ASCII text |
| `envelopes` | A command from the Mac and its result from the phone: additional data, payload, signing bytes, and signature, with a fixed nonce |
| `relayAuth` | The signed answer to a relay challenge |
| `pairRequest` | The sealed pairing request, with a fixed nonce |
| `pairAccept` | The pairing accept signature |
| `unpair` | The unpair signature |

The Swift and Kotlin clients must reproduce every entry in a test.
`npm run vectors` rewrites the file from the reference implementation, and the test suite fails if the file and the implementation ever disagree.
Changing any output is a breaking change: bump `ProtocolVersion` and write a new `-v2` file.
