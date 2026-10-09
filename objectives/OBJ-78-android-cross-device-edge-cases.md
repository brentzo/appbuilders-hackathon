---
id: OBJ-78
title: Android edge cases for goals sent to the Mac
product: android
assignee: Brent
touches: []
specs: [SPEC-09]
status: todo
priority: p0
depends-on: [OBJ-76]
integrates-with: [OBJ-67, OBJ-69, OBJ-71, OBJ-77]
tags: [objective, p0, android, bridge, ux]
---

# OBJ-78 Android edge cases for goals sent to the Mac

**Product:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The phone is the origin device, so it is the one that must say when the Mac is away, busy, or silent, and never claim a pause it did not get.
A goal for an offline Mac becomes a queued goal held on the phone, not on the relay, and is sent when the Mac comes back (SPEC-09 r15).

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 10 and 13 to 17, and the scenarios "No answer to an approval", "Stop when the Mac cannot be reached", "Mac is busy", "Mac is offline", and "Queued goal waited too long".
- [SPEC-11](../specs/11-user-facing-errors.md), the rows "Other device offline", "Other device busy", and "No reply".
- [OBJ-76](OBJ-76-cross-device-edge-case-contracts.md) Outcome and `protocol/README.md`, the edge case sequences.
- [OBJ-67](OBJ-67-android-goal-routing.md) and [OBJ-69](OBJ-69-android-delegated-goal-screen.md) Outcomes.

## Tasks

- [ ] **OBJ-78.1** When delegating to an offline Mac, say the "Other device offline" copy with "Run it when my Mac is back" and "Cancel"; on "Run it", keep one queued goal on the phone, and ask before replacing an older one.
- [ ] **OBJ-78.2** Send the queued goal when the Mac is back (its `toolList`, or a `ping` that is no longer answered `targetOffline`); if it waited more than 30 minutes, ask "Your Mac is back. Still want me to …?" first and send nothing until the user says yes.
- [ ] **OBJ-78.3** On `goalAccepted` with status `queued`, say the "Other device busy" copy.
- [ ] **OBJ-78.4** With no `progress` for 2 minutes while a delegated goal runs, show the "No reply" copy with "Wait" and "Cancel".
- [ ] **OBJ-78.5** Stop with the Mac unreachable says "I can't reach your Mac to pause it. Use the stop shortcut on your Mac." and never shows "Paused".
- [ ] **OBJ-78.6** When an approval is cancelled and `progress` says `paused`, close the card and show "Resume" and "Cancel".
- [ ] **OBJ-78.7** Unit tests for each case with a scripted Mac, and an update to [android/README.md](../android/README.md).

## Expectations

- [ ] The phone side passes with a scripted Mac: "No answer to an approval", "Stop when the Mac cannot be reached", "Mac is busy", "Mac is offline", "Queued goal waited too long".
- [ ] A queued goal is held on the phone only, and nothing is sent before the user confirms a goal that waited more than 30 minutes.

## Expected outcomes

- Queued goal, busy, no reply, and unreachable Stop handling in `android/app/src/main/java/ai/yumi/android/`, with tests.

## Out of scope

- Waking the Mac: [OBJ-79](OBJ-79-android-wake-the-mac.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
