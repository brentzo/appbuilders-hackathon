---
id: OBJ-02
title: Bridge envelope and end-to-end crypto
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-08]
status: todo
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

- [ ] **OBJ-02.1** Write the `Envelope` JSON Schema: `id`, `from`, `to`, `type` (`command`, `result`, `event`), `replyTo`, `expiresAt`, `protocolVersion`, `signature`, `payload` (ciphertext). Only `id`, `from`, `to`, `type`, `expiresAt`, and `protocolVersion` are readable by the bridge. The bridge needs `type` to reject commands for an offline device while holding results and events ([SPEC-08](../specs/08-device-bridge.md) r3 and r7).
- [ ] **OBJ-02.2** Write the bridge-level event schemas the relay itself sends: `targetOffline` (a command's target is offline) and `expired` (a message expired before delivery). Every other payload kind is in [OBJ-25](OBJ-25-cross-device-messages.md).
- [ ] **OBJ-02.3** Define expiry as constants per message kind, from the table in [docs/device-bridge.md](../docs/device-bridge.md): 2 minutes for every command, except approval requests, which wait 5 minutes ([SPEC-09](../specs/09-cross-device-routing.md) r10).
- [ ] **OBJ-02.4** Write the pairing design in `protocol/docs/pairing.md`: the Mac shows a QR code with its device id, public keys, a one-time pairing code, and the bridge URL; the phone scans it and completes the exchange through the bridge; both register with the bridge. Cover unpairing and key revocation.
- [ ] **OBJ-02.5** Choose and document the crypto: libsodium, X25519 for key exchange, XChaCha20-Poly1305 for payload encryption, Ed25519 for signatures over the envelope's routing fields plus ciphertext. Plain `crypto_box` uses XSalsa20, not XChaCha20, so use the `crypto_box_curve25519xchacha20poly1305` functions or a key exchange plus the XChaCha20-Poly1305 AEAD. Before deciding, check that libsodium-wrappers, swift-sodium, and lazysodium all expose the exact functions chosen.
- [ ] **OBJ-02.6** Write the reference TypeScript implementation with libsodium-wrappers: generate device keys, seal and open a payload, sign and verify an envelope.
- [ ] **OBJ-02.7** Write cross-language test vectors (fixed keys, fixed nonce, plaintext, expected ciphertext and signature) so the Swift and Kotlin clients can prove they match. The nonce must be fixed in the vectors, or the expected ciphertext can never match.
- [ ] **OBJ-02.8** Write tests: wrong key cannot open, tampered routing field fails verification, expired envelope is detectable.

## Expectations

- [ ] A payload sealed by device A opens only with device B's keys.
- [ ] Changing any routing field or byte of ciphertext makes signature verification fail.
- [ ] The test vectors are documented and pass in TypeScript.
- [ ] Nothing in the envelope's readable fields reveals what the message says (supports SPEC-08 scenario "VPS cannot read messages").
- [ ] The pairing doc is clear enough that the Mac, Android, and bridge objectives can implement it without further design.

## Expected outcomes

- `protocol/schemas/` envelope and payload schemas, with generated types.
- `protocol/docs/pairing.md`.
- Reference TypeScript crypto module, test vectors, and tests.

## Out of scope

- The relay server: [OBJ-13](OBJ-13-bridge-relay-server.md).
- Client connections: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Mac), [OBJ-23](OBJ-23-android-bridge-client.md) (Android).
- Payload kinds for SPEC-09 (tool calls, delegated goals, progress, approvals, pause, tool lists): [OBJ-25](OBJ-25-cross-device-messages.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
