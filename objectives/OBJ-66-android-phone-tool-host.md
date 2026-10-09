---
id: OBJ-66
title: Phone runs the Mac's tool calls
product: android
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-10]
status: todo
priority: p0
depends-on: [OBJ-23, OBJ-25]
integrates-with: [OBJ-65]
tags: [objective, p0, android, bridge, phone]
---

# OBJ-66 Phone runs the Mac's tool calls

**Product:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md), [SPEC-10](../specs/10-android-companion.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

In p0 the phone is a tool host: it offers `set_alarm`, `set_timer`, and `open_app` to the Mac and runs them through intents, never the GUI (SPEC-10 r2, r3).
The same intent runners are reused by the phone's own goals in [OBJ-67](OBJ-67-android-goal-routing.md).
Until the harness lane ([OBJ-65](OBJ-65-harness-phone-tool-lane.md)) lands, test with a scripted Mac on the relay stand-in.

## Read first

- [SPEC-10](../specs/10-android-companion.md), Part A requirements 2, 3, and 6, and the "Android tool host" scenarios.
- [SPEC-09](../specs/09-cross-device-routing.md), requirements 1 and 2.
- [protocol/schemas/messages.json](../protocol/schemas/messages.json) and [protocol/schemas/tools.json](../protocol/schemas/tools.json) (`SetAlarmCall`, `SetTimerCall`, `PhoneOpenAppCall`).
- [android/README.md](../android/README.md), `android/app/src/main/java/ai/yumi/android/permissions/`, `android/app/src/main/java/ai/yumi/android/tools/`.
- [OBJ-23](OBJ-23-android-bridge-client.md) Outcome.

## Tasks

- [ ] **OBJ-66.1** Intent runners for `set_alarm` (`AlarmClock.ACTION_SET_ALARM`), `set_timer` (`AlarmClock.ACTION_SET_TIMER`), and `open_app` (the app's launch intent), taking the generated protocol types.
- [ ] **OBJ-66.2** Send `toolList` with the three tools each time the bridge connects.
- [ ] **OBJ-66.3** Handle `toolCall`: run the tool and answer `toolResult` with success or a structured failure; do not run an expired command.
- [ ] **OBJ-66.4** Ask for each tool's Android permission the first time it is needed, with a reason (SPEC-10 r6).
- [ ] **OBJ-66.5** Unit tests for argument mapping, and a check on the demo phone with the app in the background and the screen off.

## Expectations

- [ ] SPEC-10 scenarios pass: "Alarm uses an intent, not the GUI", "Stays connected in the background with the screen off".
- [ ] The phone side of SPEC-09 "Set an alarm on the phone from the Mac" passes against a scripted Mac.

## Expected outcomes

- Phone tool runners and a tool call handler in `android/app/src/main/java/ai/yumi/android/tools/`, with tests.

## Out of scope

- The phone's own goals using these runners: [OBJ-67](OBJ-67-android-goal-routing.md).
- p1 phone tools: SPEC-10 Part B.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
