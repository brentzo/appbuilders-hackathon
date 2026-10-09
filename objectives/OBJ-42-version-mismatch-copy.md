---
id: OBJ-42
title: Add the protocol version mismatch copy
product: android
assignee: Brent
touches: [protocol]
specs: [SPEC-08, SPEC-11]
status: todo
priority: p1
depends-on: [OBJ-34]
integrates-with: [OBJ-23, OBJ-43, OBJ-44]
tags: [objective, p1, android, ux, bridge, compatibility]
---

# OBJ-42 Add the protocol version mismatch copy

**Product:** [Yumi Android](../android/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

[OBJ-34](OBJ-34-protocol-version-upgrade-recovery.md) made the relay say which side is behind when it refuses another protocol version, and tell a sender when its target needs an update.
SPEC-11 has no copy for these cases yet, so devices still show "Bridge down" and "Other device offline", which read like a network outage.
A new SPEC-11 row fails the Android and Mac copy-table tests until both apps have the copy, so the rows, the protocol error kinds, and both apps' copy have to land in one push.
This objective owns that push, with [OBJ-44](OBJ-44-mac-version-mismatch-copy.md) for the Mac's copy.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), the "Protocol versions" scenarios and the "Another protocol version" decision.
- [SPEC-11](../specs/11-user-facing-errors.md), the error copy table and requirement 7.
- [protocol/docs/pairing.md](../protocol/docs/pairing.md), "Another protocol version" and the notice-to-`ErrorKind` table.
- `ErrorKind` and `x-specRows` in [protocol/schemas/errors.json](../protocol/schemas/errors.json).
- `android/app/src/main/java/ai/yumi/android/errors/` and `ErrorCopySpecTest.kt`.

## Tasks

- [ ] **OBJ-42.1** Decide the copy with Patrick, starting from this proposal (`{device}` is the other device, as in SPEC-11 requirement 8):

  | Failure | What the user hears and sees | Buttons |
  |---|---|---|
  | This device needs an update | "I can't reach {device} because this version of Yumi is out of date. Update Yumi on this device, then open it again. Things on this device still work." | Okay |
  | Bridge needs an update | "I can't reach {device} yet because this version of Yumi is newer than the connection between your devices. I'll keep trying. Things on this device still work." | Okay |
  | Other device needs an update | "Yumi on {device} needs an update before I can reach it. Update it, and I can run this then." | Run it after the update, Cancel |

- [ ] **OBJ-42.2** Add the rows to the SPEC-11 table, with a decision, and replace the "until then" sentence in the SPEC-08 "Another protocol version" decision.
- [ ] **OBJ-42.3** Add the kinds to `ErrorKind` and `x-specRows` in `protocol/schemas/errors.json` (for example `appNeedsUpdate`, `bridgeNeedsUpdate`, `otherDeviceNeedsUpdate`), regenerate, and update the notice table and the interim mapping in `protocol/docs/pairing.md`.
  Jepoy owns the protocol and reviews this.
- [ ] **OBJ-42.4** Add the Android `ErrorKind` entries and their copy, so `ErrorCopySpecTest` passes.
- [ ] **OBJ-42.5** Push together with [OBJ-44](OBJ-44-mac-version-mismatch-copy.md), after `python3 scripts/verify.py` passes for the protocol, Android, and the Mac.

## Expectations

- [ ] SPEC-11 "Copy table matches the code" passes on Android and the Mac with the new rows.
- [ ] Each new kind maps to exactly one SPEC-11 row (`protocol/test/error-kinds.test.ts`).

## Expected outcomes

- The new SPEC-11 rows, `ErrorKind` values, and Android copy, landed in one push with the Mac copy.

## Out of scope

- When each client shows the copy: the phone in [OBJ-23](OBJ-23-android-bridge-client.md), the Mac's bridge client in [OBJ-43](OBJ-43-mac-bridge-client-version-refusal.md).
- The relay side: done in [OBJ-34](OBJ-34-protocol-version-upgrade-recovery.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
