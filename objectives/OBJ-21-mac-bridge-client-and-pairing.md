---
id: OBJ-21
title: Mac bridge client and pairing
product: harness
touches: [mac]
specs: [SPEC-08]
status: todo
priority: p0
depends-on: [OBJ-02, OBJ-13, OBJ-14]
tags: [objective, p0, harness, mac, bridge]
---

# OBJ-21 Mac bridge client and pairing

**Product:** [Yumi Harness](../harness/README.md) · **Also touches:** [mac](../mac/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), Qwen3.5-4B on the Android demo phone (12 GB), Whisper and native on-device speech recognition for voice.
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The Mac's side of the bridge lives in the harness, because the harness shares the TypeScript crypto and types with the bridge.
The Mac app only shows the pairing QR code and the connection state.
After this objective, the Mac can pair with a phone and exchange encrypted, signed messages with it.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), all requirements, scenarios, and Decisions.
- `protocol/docs/pairing.md` and [OBJ-02](OBJ-02-bridge-envelope-and-crypto.md) completion notes.
- [OBJ-13](OBJ-13-bridge-relay-server.md) completion notes (bridge URL, auth flow).

## Tasks

- [ ] **OBJ-21.1** Harness: generate and store the Mac's device keys in the macOS Keychain (through the Mac app over RPC, or a Keychain library), never in plain files.
- [ ] **OBJ-21.2** Harness: implement the Mac side of pairing from `pairing.md` and expose `startPairing`, `listPairedDevices`, and `unpair` over RPC.
- [ ] **OBJ-21.3** Mac: pairing screen that shows the QR code from `startPairing`, then "Paired with <device name>" when done. Add "Unpair" in settings.
- [ ] **OBJ-21.4** Harness: connect to the bridge over WebSocket, authenticate, and reconnect with backoff.
- [ ] **OBJ-21.5** Harness: send and receive envelopes. Verify signatures and drop messages from unpaired or revoked devices, recording them in the local log.
- [ ] **OBJ-21.6** Harness: at-most-once execution. Remember processed message ids and their results; on a duplicate, resend the stored result instead of running again.
- [ ] **OBJ-21.7** Harness: never run an expired command, and surface `expired` events from the bridge to the sender's task.
- [ ] **OBJ-21.8** Mac: show connection state (connected, reconnecting, offline) in the menu bar. Bridge failures use the SPEC-11 "Bridge down" and "Unpaired device" copy.
- [ ] **OBJ-21.9** Tests against the deployed bridge with a test phone client: pairing, round trip, unknown device dropped, duplicate delivery, expiry, unpair.

## Expectations

- [ ] SPEC-08 scenarios pass from the Mac side: "Pair the phone with the Mac", "Unpair a device", "Message from an unknown device is dropped", "Duplicate delivery runs once", "Expired command is not run".
- [ ] Keys never appear in files, logs, or the task store.
- [ ] The Mac's crypto output matches the protocol test vectors.

## Outcomes

- The bridge client in the harness, pairing RPC methods, the Mac pairing screen, and connection state in the menu bar.

## Out of scope

- Which commands the Mac sends to the phone and how goals are routed between devices: SPEC-09, not finalized.
- The phone side: [OBJ-23](OBJ-23-android-bridge-client.md).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
