---
id: OBJ-69
title: Phone shows a goal working on the Mac, with Stop
product: android
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-10, SPEC-06]
status: blocked
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

- [x] **OBJ-69.1** A "Working on your Mac" state on the home screen and in the service notification, with the current subtask title from `progress` and a **Stop** button.
- [x] **OBJ-69.2** On `goalFinished`, speak and show the summary on the phone and clear the working state.
- [x] **OBJ-69.3** Stop sends `pause` and keeps the working state until `pauseConfirmed`, then shows "Paused" with "Resume" and "Cancel".
- [x] **OBJ-69.4** Keep the working state when the app goes to the background.
- [x] **OBJ-69.5** Tests with a scripted Mac for each path.

## Expectations

- [x] SPEC-09 scenarios pass from the phone side with a scripted Mac: "Phone goal is delegated to the Mac", "Stop from the phone pauses the Mac".
- [x] The phone never shows "Paused" before `pauseConfirmed`.

## Expected outcomes

- The delegated-goal screen, notification state, and Stop flow in `android/app/src/main/java/ai/yumi/android/`, with tests.

## Out of scope

- Approvals on the phone: [OBJ-71](OBJ-71-android-approvals.md).
- Edge cases not planned yet: Mac busy, no reply for 2 minutes, and Stop when the Mac cannot be reached (SPEC-09 r13, r14, r17).

## Outcome

- **Result:** Demo slice delivered; every task and expectation in this objective is done, but the objective is not marked done because its hard dependency [OBJ-67](OBJ-67-android-goal-routing.md) is blocked, not done.
- **Blocked on:** [OBJ-67](OBJ-67-android-goal-routing.md), which is itself blocked on [OBJ-66](OBJ-66-android-phone-tool-host.md) for the cut phone-only rule. Unblock by clearing OBJ-67, or by Brent accepting it and flipping this objective to done.
- **Delivered:** `ui/home/GoalCard.kt` (the working, pausing, paused, and finished cards, and the repeat-back card), `notifications/YumiNotifications.kt` (the "Working on your Mac" title, subtask text, and Stop action), `service/YumiService.kt` (the notification Stop sends `pause`), and `service/YumiStatus.kt` (the goal fields). The state machine is `routing/GoalRouter.kt`; the summary is spoken through `voice/Speaker.kt` (Android TTS). Tests in `app/src/test/java/ai/yumi/android/routing/GoalRouterTest.kt`.
- **Commits:** `9b36c6c feat(android): delegate a confirmed goal and show it working on the Mac`.
- **Expectations:** "Phone goal is delegated to the Mac" and "Stop from the phone pauses the Mac" pass from the phone side in `GoalRouterTest` (`...sent only after confirm`, `progress updates the subtask and goalFinished speaks the summary`, `stop shows paused only after the Mac confirms`, `resume restarts and cancel waits for the Mac`). "The phone never shows Paused before pauseConfirmed" passes in `stop shows paused only after the Mac confirms`, which sends a `progress` with status `paused` and asserts the state is still Pausing.
- **Not verified:** The live-relay run (a real Mac over the deployed VPS) was not done, and the scripted-Mac tests do not run the real harness ([OBJ-68](OBJ-68-harness-delegated-goals.md), [OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md) are not landed). A person can run it on the demo phone (serial MVW4QOY5IFLJEM6P) with a paired Mac: confirm a delegated goal, watch the subtask update, tap Stop, and check the phone shows "Paused" only after the Mac's `pauseConfirmed`. Keeping the working state while backgrounded (OBJ-69.4) is by design, not by test: the state lives in the application-scoped `GoalRouter` and its bridge subscription, not in a composable; a manual check is to confirm a goal, open another app, and reopen Yumi.
- **Decisions and deviations:** The delegated-goal screen is the home screen's working state, not a separate route, so the repeat-back, working, paused, and finished cards replace the old last-goal row in place. The service notification's one Stop action pauses a running goal and stops Yumi otherwise, so SPEC-09 r9 and SPEC-10 r4 both hold with a single Stop. While a goal is paused the notification shows the service Stop. Cancel leaves the state Paused until the Mac confirms (`cancelConfirmed` or `goalFinished`), so the phone never claims a goal stopped early.
- **For the next objectives:** [OBJ-71](OBJ-71-android-approvals.md) can reuse `GoalRouter`'s active-goal id and the same incoming subscription. The paused, resumed, and cancelled paths expect the harness side ([OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md)) to send `pauseConfirmed` and `cancelConfirmed`.
