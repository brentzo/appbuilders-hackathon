---
id: OBJ-44
title: Mac app shows the version mismatch copy
product: mac
assignee: Patrick
touches: []
specs: [SPEC-08, SPEC-11]
status: todo
priority: p1
depends-on: [OBJ-34]
integrates-with: [OBJ-42, OBJ-43]
tags: [objective, p1, mac, ux, compatibility]
---

# OBJ-44 Mac app shows the version mismatch copy

**Product:** [Yumi Mac](../mac/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

[OBJ-42](OBJ-42-version-mismatch-copy.md) adds SPEC-11 rows and `ErrorKind` values for a protocol version mismatch.
The Mac's copy test and its switches over `ErrorKind` fail until the Mac has copy for every new kind, so this copy lands in the same push as OBJ-42.

## Read first

- [SPEC-11](../specs/11-user-facing-errors.md), the error copy table, and [SPEC-08](../specs/08-device-bridge.md), the "Another protocol version" decision.
- [OBJ-42](OBJ-42-version-mismatch-copy.md), the proposed copy.
- `mac/Yumi/Errors/UserErrorCopy.swift` and `mac/YumiTests/UserErrorCopyTests.swift`.

## Tasks

- [ ] **OBJ-44.1** Review the proposed copy in OBJ-42.1 with Brent.
- [ ] **OBJ-44.2** Add copy for each new `ErrorKind` to `UserErrorCopy`, word for word from SPEC-11.
- [ ] **OBJ-44.3** Make "Run it after the update" keep the goal waiting for the other device, like "Run it when it's back".
- [ ] **OBJ-44.4** Push together with OBJ-42, after `python3 scripts/verify.py` passes on a Mac.

## Expectations

- [ ] SPEC-11 "Copy table matches the code" passes on the Mac with the new rows.
- [ ] SPEC-08 "Device needs an update" and "Command to a device that needs an update" show the new copy on the Mac, through the mock harness's `userError` events.

## Expected outcomes

- `UserErrorCopy` covering the new kinds, with passing `UserErrorCopyTests`.

## Out of scope

- When the harness raises these errors: [OBJ-43](OBJ-43-mac-bridge-client-version-refusal.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
