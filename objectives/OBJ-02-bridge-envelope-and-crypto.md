---
id: OBJ-02
title: Bridge envelope and end-to-end crypto
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-08]
status: done
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, protocol, bridge, safety]
---

# OBJ-02 Bridge envelope and end-to-end crypto

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The Mac and phone talk through our VPS, and the "local AI" promise only holds if the VPS can never read those messages.
This objective defines the message envelope, the pairing flow, and the crypto rules once, with a reference TypeScript implementation that the harness and bridge use directly and that the Swift and Kotlin clients must match.

## Read first

- [SPEC-08 Device bridge](../specs/08-device-bridge.md), including its Decisions section.
- [docs/device-bridge.md](../docs/device-bridge.md): the envelope draft and bridge rules.
- [protocol/README.md](../protocol/README.md).

## Tasks

- [x] **OBJ-02.1** Write the `Envelope` JSON Schema: `id`, `from`, `to`, `type` (`command`, `result`, `event`), `replyTo`, `expiresAt`, `protocolVersion`, `signature`, `payload` (ciphertext). Only `id`, `from`, `to`, `type`, `expiresAt`, and `protocolVersion` are readable by the bridge. The bridge needs `type` to reject commands for an offline device while holding results and events ([SPEC-08](../specs/08-device-bridge.md) r3 and r7).
- [x] **OBJ-02.2** Write the bridge-level event schemas the relay itself sends: `targetOffline` (a command's target is offline) and `expired` (a message expired before delivery). Every other payload kind is in [OBJ-25](OBJ-25-cross-device-messages.md).
- [x] **OBJ-02.3** Define expiry as constants per message kind, from the table in [docs/device-bridge.md](../docs/device-bridge.md): 2 minutes for every command, except approval requests, which wait 5 minutes ([SPEC-09](../specs/09-cross-device-routing.md) r10).
- [x] **OBJ-02.4** Write the pairing design in `protocol/docs/pairing.md`: the Mac shows a QR code with its device id, public keys, a one-time pairing code, and the bridge URL; the phone scans it and completes the exchange through the bridge; both register with the bridge. Cover unpairing and key revocation.
- [x] **OBJ-02.5** Choose and document the crypto: libsodium, X25519 for key exchange, XChaCha20-Poly1305 for payload encryption, Ed25519 for signatures over the envelope's routing fields plus ciphertext. Plain `crypto_box` uses XSalsa20, not XChaCha20, so use the `crypto_box_curve25519xchacha20poly1305` functions or a key exchange plus the XChaCha20-Poly1305 AEAD. Before deciding, check that libsodium-wrappers, swift-sodium, and lazysodium all expose the exact functions chosen.
- [x] **OBJ-02.6** Write the reference TypeScript implementation with libsodium-wrappers: generate device keys, seal and open a payload, sign and verify an envelope.
- [x] **OBJ-02.7** Write cross-language test vectors (fixed keys, fixed nonce, plaintext, expected ciphertext and signature) so the Swift and Kotlin clients can prove they match. The nonce must be fixed in the vectors, or the expected ciphertext can never match.
- [x] **OBJ-02.8** Write tests: wrong key cannot open, tampered routing field fails verification, expired envelope is detectable.
- [x] **OBJ-02.9** Write the schemas for the WebSocket frames between a device and the relay, and describe them in the pairing doc: the signed challenge that authenticates a device, envelope delivery, the acknowledgement that lets the relay delete a held message ([OBJ-13](OBJ-13-bridge-relay-server.md) task 5), the relay notices from OBJ-02.2, the pairing exchange, and unpairing. Without them, OBJ-13, OBJ-21, and OBJ-23 would each have to invent the same frames.

## Expectations

- [x] A payload sealed by device A opens only with device B's keys.
- [x] Changing any routing field or byte of ciphertext makes signature verification fail.
- [x] The test vectors are documented and pass in TypeScript.
- [x] Nothing in the envelope's readable fields reveals what the message says (supports SPEC-08 scenario "VPS cannot read messages").
- [x] The pairing doc is clear enough that the Mac, Android, and bridge objectives can implement it without further design.

## Expected outcomes

- `protocol/schemas/` envelope and payload schemas, with generated types.
- `protocol/docs/pairing.md`.
- Reference TypeScript crypto module, test vectors, and tests.

## Out of scope

- The relay server: [OBJ-13](OBJ-13-bridge-relay-server.md).
- Client connections: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Mac), [OBJ-23](OBJ-23-android-bridge-client.md) (Android).
- Payload kinds for SPEC-09 (tool calls, delegated goals, progress, approvals, pause, tool lists): [OBJ-25](OBJ-25-cross-device-messages.md).

## Outcome

- **Result:** Done.
- **Delivered:**
  - `protocol/schemas/bridge.json`: `Envelope`, the expiry constants, `PairingOffer`, `PairRequest`, `PairAccept`, and `BridgeFrame` with one frame type per message between a device and the relay.
  - `protocol/src/crypto.ts` (`@yumi/protocol/crypto`): device keys, `sealEnvelope` and `openEnvelope`, `expiresAt`, `sealPairRequest` and `openPairRequest`, and the signing-bytes builders for relay authentication, pairing accept, and unpair.
  - `protocol/docs/crypto.md`: the crypto, the library function for each step in TypeScript, Swift, and Kotlin, the open checks and what to do for each failure, and the test vectors.
  - `protocol/docs/pairing.md`: the relay connection, pairing, delivery and acks, unpairing, and lost devices.
  - `protocol/vectors/bridge-crypto-v1.json` and `protocol/scripts/vectors.ts` (`npm run vectors`).
  - 17 new examples, and tests in `test/bridge.test.ts`, `test/crypto.test.ts`, and `test/vectors.test.ts`.
- **Commits:**
  - `5fb7353 docs(objectives): start OBJ-02 and add the relay frame task`
  - `44b3c92 build(protocol): add libsodium-wrappers and update ajv and the test tooling to clear npm audit`
  - `f06cf17 feat(protocol): add the bridge envelope, relay frames, pairing, and reference crypto`
  - `13f7a98 fix(protocol): seal pairing requests, sign unpair frames, and never throw from openEnvelope`
  - `39f4afe docs(objectives): align OBJ-13, OBJ-21, OBJ-23, and OBJ-25 with the pairing design`
  - `b43e871 docs(spec-08): raise replyTo readability and pairing failure copy as open questions`
- **Expectations:**
  - Sealed by A, opens only with B's keys: `test/crypto.test.ts` "opens only with the recipient's keys".
  - Any changed routing field or ciphertext byte fails: "fails verification when any routing field or ciphertext byte changes" and "signs every routing field, so changing from, to, or the version breaks the signature too".
  - Test vectors are documented in `docs/crypto.md` and pass in TypeScript: `test/vectors.test.ts`, including RFC 8032 section 7.1 and draft-irtf-cfrg-xchacha-03 A.3.1 known answers. The suite fails if the vector file and the code disagree.
  - Nothing readable reveals what a message says: "keeps the message out of every readable field (SPEC-08 'VPS cannot read messages')", and pairing requests are sealed too ("keeps the phone's name and keys away from the relay (SPEC-08 r3)").
  - The pairing doc is complete enough to build from: OBJ-13 tasks 2, 3, 4, and 7 were rewritten to follow it, and OBJ-21 and OBJ-23 point to it.
  - `npm run verify` passes (223 tests). `npm run compile:swift` and `npm run compile:kotlin` pass, with all 118 examples round-tripped.
- **Not verified:**
  - The CI workflow has not run on this branch yet; it runs once the branch is pushed.
  - The Swift and Kotlin crypto have not been written, so the vectors are proven in TypeScript only. OBJ-23 task 2 proves Kotlin against them. The Mac's bridge client is TypeScript in the harness (OBJ-21) and uses `src/crypto.ts` directly. Swift needs them only for the iPhone (SPEC-12).
- **Decisions and deviations:**
  - **`replyTo` stays readable by the relay**, as in SPEC-08 r4, although OBJ-02.1 and SPEC-08 r3 leave it out of the readable fields. The specs disagree, so it is raised as an open question in SPEC-08 with a recommendation to move it inside the payload. Changing it later is a breaking change while no client exists.
  - Crypto: `crypto_kx` session keys plus the XChaCha20-Poly1305 AEAD, not `crypto_box_curve25519xchacha20poly1305`, which the standard libsodium-wrappers 0.8.4 build lacks. The function names were checked in libsodium-wrappers 0.8.4, swift-sodium 0.11.0, and lazysodium 5.2.0.
  - Each device has two key pairs, Ed25519 and X25519; SPEC-08 r2 says "a key pair per device". The device id is derived from the Ed25519 key, so the relay registers devices on first use and nobody can claim another's id.
  - The pairing request is sealed with the QR code's one-time secret instead of tagged, so the relay cannot read the phone's name (SPEC-08 r3) or swap its keys.
  - Pairings are between two devices, made only when the phone's request and the Mac's accept both pass the relay. OBJ-13 used to say "pair group" and "revoked flag".
  - `unpair` is signed by the device and held by the relay until acked, so the relay cannot unpair two devices on its own and an offline device still learns. `notPaired` never deletes keys.
  - A receiver refuses an expiry more than 6 minutes ahead (the 5-minute approval expiry plus a minute for clock drift), so a command cannot be made to live forever. Devices rely on the system's network-synced clock.
  - A pairing offer lasts 5 minutes. Envelope payloads are at most 1 MiB of base64 text.
  - Dependencies: ajv 8.17.1 had a moderate advisory (GHSA-2g4f-4pwh-qvx6, only with `$data`, which we do not use), and the test tooling had critical ones. Updated to ajv 8.20.0, vitest 4.1.11, tsx 4.23.15, TypeScript 5.9.3, and @types/node 22.20.5. `npm audit` reports 0 vulnerabilities. npm 10.9.8 crashes resolving vitest 4's peers, so the lock file was written with npm 11; `npm ci` on npm 10 installs it fine.
- **For the next objectives:**
  - OBJ-13 (relay), OBJ-21 (Mac client), and OBJ-23 (Android client) follow `protocol/docs/pairing.md` and validate every frame as `BridgeFrame`.
  - TypeScript imports the crypto from `@yumi/protocol/crypto`. `openEnvelope` never throws; an `expired` failure carries the envelope so the receiver can resend a stored result for a duplicate.
  - Kotlin must reproduce every entry in `vectors/bridge-crypto-v1.json` in a test (OBJ-23 task 2).
  - OBJ-25 defines the payload kinds inside `Envelope.payload`, maps them to the expiry constants, and adds the receiver's "command expired" reply and a `ping` (OBJ-25 tasks 9 to 11).
  - The relay frames map to `ErrorKind` as in `pairing.md`: `targetOffline` to `otherDeviceOffline`, `expired` to `commandExpired`, `notPaired` to `unpairedDevice`, and no connection to `bridgeDown`.
