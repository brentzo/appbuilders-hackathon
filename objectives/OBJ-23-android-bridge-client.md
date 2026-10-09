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
- [ ] **OBJ-23.3** Pairing: scan the Mac's QR code with CameraX and an on-device barcode scanner, then complete the pairing steps from `pairing.md`. Show "Paired with <device name>".
- [ ] **OBJ-23.4** Run the WebSocket connection (OkHttp) inside the foreground service: authenticate, reconnect with backoff, and survive network changes (Wi-Fi to mobile data).
- [ ] **OBJ-23.5** Verify signatures and drop messages from unpaired or revoked devices, recording them in the local log.
- [ ] **OBJ-23.6** At-most-once execution: remember processed message ids and their results; on a duplicate, resend the stored result.
- [ ] **OBJ-23.7** Never run an expired command. Treat a `targetOffline` event as a structured error for the command that caused it.
- [ ] **OBJ-23.8** Show connection state (connected, reconnecting, offline) on the home screen and in the notification. Use the SPEC-11 "Bridge down" and "Unpaired device" copy.
- [ ] **OBJ-23.9** Unpair from settings, which revokes the device at the bridge.
- [ ] **OBJ-23.10** End-to-end test with the Mac from [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (or a test client until it is ready): a test `ping` command each way, with the phone app in the background.

## Expectations

- [ ] SPEC-08 scenarios pass from the phone side: "Pair the phone with the Mac", "Unpair a device", "Message from an unknown device is dropped", "Result survives a short reconnect", "Expired command is not run", "Duplicate delivery runs once".
- [ ] A command from the Mac reaches the backgrounded phone within 2 seconds on a normal connection.
- [ ] Keys never appear in files or logs.

## Expected outcomes

- The bridge client in the foreground service, QR pairing, connection state, and unpairing.

## Out of scope

- Phone tools the Mac can call and phone-or-laptop routing: [SPEC-09](../specs/09-cross-device-routing.md) and [SPEC-10](../specs/10-android-companion.md), with the message kinds in [OBJ-25](OBJ-25-cross-device-messages.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
