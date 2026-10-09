---
id: OBJ-23
title: Android bridge client and pairing
product: android
assignee: Brent
touches: []
specs: [SPEC-08]
status: todo
priority: p0
depends-on: [OBJ-02, OBJ-13, OBJ-22]
integrates-with: []
tags: [objective, p0, android, bridge]
---

# OBJ-23 Android bridge client and pairing

**Product:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The phone pairs with the Mac by scanning a QR code, then keeps an encrypted, signed connection to the bridge from its foreground service.
After this objective, the phone and Mac can exchange messages in both directions, even while the app is in the background.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), all requirements, scenarios, and Decisions.
- `protocol/docs/pairing.md` and [OBJ-02](OBJ-02-bridge-envelope-and-crypto.md) Outcome, including the test vectors.
- [OBJ-13](OBJ-13-bridge-relay-server.md) and [OBJ-22](OBJ-22-android-app-shell.md) Outcome.

## Tasks

- [ ] **OBJ-23.1** Generate and store the phone's device keys in the Android Keystore (or encrypted storage backed by it), never in plain files.
- [ ] **OBJ-23.2** Implement the libsodium crypto with lazysodium and prove it matches the protocol test vectors.
- [ ] **OBJ-23.3** Pairing: scan the Mac's QR code with CameraX and an on-device barcode scanner, then complete the pairing steps from `pairing.md`.
  Show "Paired with <device name>".
  Follow the phone's rules in `pairing.md` "The answer window" ([OBJ-33](OBJ-33-pairing-response-timeout-contract.md)):
  - Show "Pairing code expired" for an expired QR code, and send nothing.
  - Show the SPEC-11 "Mac didn't answer pairing" copy on `pairExpired`, not on a local 30-second timer.
  - Send `pairCancel` when the user leaves the pairing screen.
  - Give up only after 60 seconds without a verdict.
  - Answer a `pairAccept` for a request it gave up on with a signed `unpair`.
- [ ] **OBJ-23.4** Run the WebSocket connection (OkHttp) inside the foreground service: authenticate, reconnect with backoff, and survive network changes (Wi-Fi to mobile data).
- [ ] **OBJ-23.5** Verify signatures and drop messages from unpaired or revoked devices, recording them in the local log.
- [ ] **OBJ-23.6** At-most-once execution: remember processed message ids and their results; on a duplicate, resend the stored result.
- [ ] **OBJ-23.7** Never run an expired command. Treat a `targetOffline` or `targetNeedsUpdate` event as a structured error for the command that caused it.
- [ ] **OBJ-23.8** Show connection state (connected, reconnecting, offline) on the home screen and in the notification. Use the SPEC-11 "Bridge down" and "Unpaired device" copy.
  On `refused` with `unsupportedVersion`, follow `pairing.md` "Another protocol version" ([OBJ-34](OBJ-34-protocol-version-upgrade-recovery.md)): show offline with the error for the side that needs an update (the [OBJ-42](OBJ-42-version-mismatch-copy.md) copy once it lands), keep every key and pairing, and try again every `UnsupportedVersionRetrySeconds` and when the app starts.
- [ ] **OBJ-23.9** Unpair from settings. Sign a stable UUID with the unpair fields, retry the same frame until the relay acknowledges durable receipt, and have the phone atomically record and ACK that UUID on receipt. Duplicate deliveries are idempotent; re-pairing clears receipt state.
- [ ] **OBJ-23.10** End-to-end test with the Mac from [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (or a test client until it is ready): a test `ping` command each way, with the phone app in the background.
- [ ] **OBJ-23.11** Debug-only bridge test hooks for [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md), the phone's side of the Mac's in [OBJ-49](OBJ-49-mac-bridge-test-support.md) task 3: send the last command again with the same id, hold the next incoming command before anything checks it, send one envelope signed by a throwaway key, and authenticate with another protocol version until the next restart.

## Expectations

- [ ] SPEC-08 scenarios pass from the phone side: "Pair the phone with the Mac", "Unpair a device", "Pairing code expired", "Mac does not answer pairing", "Mac answers pairing too late", "Message from an unknown device is dropped", "Result survives a short reconnect", "Expired command is not run", "Duplicate delivery runs once", "Device needs an update", "Command to a device that needs an update", "Devices reconnect after an update".
- [ ] A command from the Mac reaches the backgrounded phone within 2 seconds on a normal connection.
- [ ] Keys never appear in files or logs.

## Expected outcomes

- The bridge client in the foreground service, QR pairing, connection state, and unpairing.

## Out of scope

- Phone tools the Mac can call and phone-or-laptop routing: [SPEC-09](../specs/09-cross-device-routing.md) and [SPEC-10](../specs/10-android-companion.md), with the message kinds in [OBJ-25](OBJ-25-cross-device-messages.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
