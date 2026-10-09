---
id: OBJ-69
title: Phone shows a goal working on the Mac, with Stop
product: android
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-10, SPEC-06]
status: todo
priority: p0
depends-on: [OBJ-67]
integrates-with: [OBJ-68, OBJ-70]
tags: [objective, p0, android, bridge, control, ux]
---

# OBJ-69 Phone shows a goal working on the Mac, with Stop

**Product:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md), [SPEC-10](../specs/10-android-companion.md), [SPEC-06](../specs/06-user-control.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The phone is the origin device for a goal it sent, so it shows the progress, speaks the result, and owns Stop (SPEC-09 r7, r9, r11, r12).
Stop from the phone pausing the Mac is the third demo moment.
Until the harness sides ([OBJ-68](OBJ-68-harness-delegated-goals.md), [OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md)) land, drive it with a scripted Mac.

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 7, 9, 11, and 12, and the scenarios "Phone goal is delegated to the Mac" and "Stop from the phone pauses the Mac".
- [protocol/schemas/messages.json](../protocol/schemas/messages.json): `progress`, `goalFinished`, `pause`, `resume`, `cancel`, `pauseConfirmed`.
- `android/app/src/main/java/ai/yumi/android/ui/home/`, `android/app/src/main/java/ai/yumi/android/notifications/YumiNotifications.kt`.

## Tasks

- [ ] **OBJ-69.1** A "Working on your Mac" state on the home screen and in the service notification, with the current subtask title from `progress` and a **Stop** button.
- [ ] **OBJ-69.2** On `goalFinished`, speak and show the summary on the phone and clear the working state.
- [ ] **OBJ-69.3** Stop sends `pause` and keeps the working state until `pauseConfirmed`, then shows "Paused" with "Resume" and "Cancel".
- [ ] **OBJ-69.4** Keep the working state when the app goes to the background.
- [ ] **OBJ-69.5** Tests with a scripted Mac for each path.

## Expectations

- [ ] SPEC-09 scenarios pass from the phone side with a scripted Mac: "Phone goal is delegated to the Mac", "Stop from the phone pauses the Mac".
- [ ] The phone never shows "Paused" before `pauseConfirmed`.

## Expected outcomes

- The delegated-goal screen, notification state, and Stop flow in `android/app/src/main/java/ai/yumi/android/`, with tests.

## Out of scope

- Approvals on the phone: [OBJ-71](OBJ-71-android-approvals.md).
- Edge cases not planned yet: Mac busy, no reply for 2 minutes, and Stop when the Mac cannot be reached (SPEC-09 r13, r14, r17).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
