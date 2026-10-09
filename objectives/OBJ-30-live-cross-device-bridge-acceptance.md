---
id: OBJ-30
title: Live cross-device bridge acceptance
product: bridge
assignee: Jepoy
touches: []
specs: [SPEC-08]
status: todo
priority: p0
depends-on: [OBJ-13, OBJ-21, OBJ-23, OBJ-27]
integrates-with: []
tags: [objective, p0, bridge, mac, android, e2e]
---

# OBJ-30 Live cross-device bridge acceptance

**Product:** [Yumi Bridge](../bridge/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

OBJ-21 validates the client against local stand-ins so development does not wait on deployment or hardware.
This follow-up runs the real Mac and Android clients against the deployed relay and closes the SPEC-08 device scenarios that local stand-ins cannot prove.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), all requirements and scenarios.
- [protocol/docs/pairing.md](../protocol/docs/pairing.md) and [protocol/docs/crypto.md](../protocol/docs/crypto.md).
- Outcomes of [OBJ-13](OBJ-13-bridge-relay-server.md), [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md), [OBJ-23](OBJ-23-android-bridge-client.md), and [OBJ-27](OBJ-27-mac-native-services.md).

## Tasks

- [ ] **OBJ-29.1** Connect the real Mac harness client and Android client to the deployed bridge using the same protocol version.
- [ ] **OBJ-29.2** Pair the phone by scanning the QR code shown by the Mac app, then verify each side lists the paired device.
- [ ] **OBJ-29.3** Exchange encrypted commands, results, and events in both directions, and confirm the relay logs and storage contain no plaintext payload.
- [ ] **OBJ-29.4** Exercise unknown-device rejection, command expiry, duplicate delivery, short reconnect delivery, offline command rejection, and unpair from either device.
- [ ] **OBJ-29.5** Record device models, OS versions, relay version, protocol version, exact steps, and results for every scenario in the bridge integration report.

## Expectations

- [ ] SPEC-08 scenarios pass on the real Mac, Android phone, and deployed relay: "Pair the phone with the Mac", "Unpair a device", "VPS cannot read messages", "Message from an unknown device is dropped", "Command to an offline device fails at once", "Result survives a short reconnect", "Expired command is not run", and "Duplicate delivery runs once".
- [ ] No secret or plaintext payload appears in relay logs, relay storage, Mac files, or Android files.
- [ ] The report identifies any scenario not run and the exact blocker.

## Expected outcomes

- A reproducible real-device bridge acceptance report with logs scrubbed of secrets and plaintext.

## Out of scope

- Changes to Mac client behavior: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md).
- Changes to Android client behavior: [OBJ-23](OBJ-23-android-bridge-client.md).
- Relay implementation and deployment: [OBJ-13](OBJ-13-bridge-relay-server.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
