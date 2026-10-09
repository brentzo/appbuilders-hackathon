---
id: OBJ-02
title: Bridge envelope and end-to-end crypto
product: protocol
touches: []
specs: [SPEC-08]
status: todo
priority: p0
depends-on: []
tags: [objective, p0, protocol, bridge, safety]
---

# OBJ-02 Bridge envelope and end-to-end crypto

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), Qwen3.5-4B on the Android demo phone (12 GB), Whisper and native on-device speech recognition for voice.
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

- [ ] **OBJ-02.1** Write the `Envelope` JSON Schema: `id`, `from`, `to`, `type` (`command`, `result`, `event`), `replyTo`, `expiresAt`, `protocolVersion`, `signature`, `payload` (ciphertext). Only `id`, `from`, `to`, `expiresAt`, and `protocolVersion` are readable by the bridge.
- [ ] **OBJ-02.2** Write the decrypted payload schemas: `Command` (tool name and arguments), `Result` (success or a structured failure kind, never raw error text), and `Event` (connection, expiry notice, tool list announcement).
- [ ] **OBJ-02.3** Define expiry defaults as constants: 2 minutes for UI actions, 1 hour for data requests.
- [ ] **OBJ-02.4** Write the pairing design in `protocol/docs/pairing.md`: the Mac shows a QR code with its device id, public keys, a one-time pairing code, and the bridge URL; the phone scans it and completes the exchange through the bridge; both register with the bridge. Cover unpairing and key revocation.
- [ ] **OBJ-02.5** Choose and document the crypto: libsodium, X25519 for key exchange, XChaCha20-Poly1305 for payload encryption, Ed25519 for signatures over the envelope's routing fields plus ciphertext.
- [ ] **OBJ-02.6** Write the reference TypeScript implementation with libsodium-wrappers: generate device keys, seal and open a payload, sign and verify an envelope.
- [ ] **OBJ-02.7** Write cross-language test vectors (fixed keys, plaintext, expected ciphertext and signature) so the Swift and Kotlin clients can prove they match.
- [ ] **OBJ-02.8** Write tests: wrong key cannot open, tampered routing field fails verification, expired envelope is detectable.

## Expectations

- [ ] A payload sealed by device A opens only with device B's keys.
- [ ] Changing any routing field or byte of ciphertext makes signature verification fail.
- [ ] The test vectors are documented and pass in TypeScript.
- [ ] Nothing in the envelope's readable fields reveals what the message says (supports SPEC-08 scenario "VPS cannot read messages").
- [ ] The pairing doc is clear enough that the Mac, Android, and bridge objectives can implement it without further design.

## Outcomes

- `protocol/schemas/` envelope and payload schemas, with generated types.
- `protocol/docs/pairing.md`.
- Reference TypeScript crypto module, test vectors, and tests.

## Out of scope

- The relay server: [OBJ-13](OBJ-13-bridge-relay-server.md).
- Client connections: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Mac), [OBJ-23](OBJ-23-android-bridge-client.md) (Android).
- Which tools each device offers: SPEC-09 and SPEC-10, not finalized.

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
