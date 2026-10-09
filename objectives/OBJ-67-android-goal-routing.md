---
id: OBJ-67
title: Phone repeats back a goal and runs it or sends it to the Mac
product: android
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-10]
status: blocked
priority: p0
depends-on: [OBJ-24, OBJ-66]
integrates-with: [OBJ-68]
tags: [objective, p0, android, bridge, voice, ux]
---

# OBJ-67 Phone repeats back a goal and runs it or sends it to the Mac

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

[OBJ-24](OBJ-24-android-voice-intake.md) hands every transcript to `GoalSink.onGoal(text)` and only shows it; it left the repeat-back and the phone-or-Mac decision to "the Part A routing objective", which is this one.
In p0 the phone has no model: a fixed rule runs alarms, timers, and opening apps on the phone, and sends every other goal to the Mac as text after the user confirms (SPEC-09 r4, SPEC-10 r8).
Until the harness side ([OBJ-68](OBJ-68-harness-delegated-goals.md)) lands, test delegation with a scripted Mac.

## Read first

- [SPEC-10](../specs/10-android-companion.md), requirement 8 and its scenarios.
- [SPEC-09](../specs/09-cross-device-routing.md), requirements 4 to 6.
- `android/app/src/main/java/ai/yumi/android/voice/VoiceInput.kt` (`GoalSink`), `android/app/src/main/java/ai/yumi/android/ui/home/`, and the runners from [OBJ-66](OBJ-66-android-phone-tool-host.md).
- [protocol/schemas/messages.json](../protocol/schemas/messages.json) `delegateGoal`.

## Tasks

- [ ] **OBJ-67.1** The p0 rule: parse alarm, timer, and open app from English transcripts; anything else, or details that do not parse, is a delegated goal.
- [x] **OBJ-67.2** Repeat back with the fixed templates from SPEC-10 r8, spoken and on screen, with the transcript editable for delegated goals.
- [x] **OBJ-67.3** Match replies against the fixed confirm and cancel lists; anything else is a correction, repeated back again. The buttons always work.
- [x] **OBJ-67.4** On confirm, run a phone-only goal through the [OBJ-66](OBJ-66-android-phone-tool-host.md) runners and say the result, or send a delegated goal as `delegateGoal` and open the delegated-goal screen ([OBJ-69](OBJ-69-android-delegated-goal-screen.md)).
- [x] **OBJ-67.5** Replace `LastGoal` as the `GoalSink`, add unit tests for the rule, templates, and reply lists, and update [android/README.md](../android/README.md).

## Expectations

- [ ] SPEC-10 scenarios pass: "Phone-only goal is repeated back with a template", "Delegated goal echoes the transcript".
- [ ] SPEC-09 scenario passes: "Phone-only goal runs on the phone".
- [x] Nothing runs and nothing is sent to the Mac before the user confirms.

## Expected outcomes

- The p0 rule, templates, and confirmation flow in `android/app/src/main/java/ai/yumi/android/`, with tests.

## Out of scope

- Which other phone-only goals belong in the rule: SPEC-09 open question, for Brent.
- The Mac offline when delegating (SPEC-09 r15, "Mac is offline", "Queued goal waited too long"): [OBJ-78](OBJ-78-android-cross-device-edge-cases.md).

## Outcome

- **Result:** Demo slice delivered; the objective is not done. It is blocked on [OBJ-66](OBJ-66-android-phone-tool-host.md) for the p0 phone-only rule (OBJ-67.1) and the phone-only scenarios, which Brent cut for the demo so every goal is delegated.
- **Blocked on:** [OBJ-66](OBJ-66-android-phone-tool-host.md) (the phone-run tools) for OBJ-67.1, and OBJ-67.1 for the two phone-only expectation halves. Unblock by finishing OBJ-66 and OBJ-67.1, or by Brent accepting a delegated-only objective and dropping the phone-only scenarios.
- **Delivered:** `android/app/src/main/java/ai/yumi/android/routing/GoalRouter.kt` (the repeat-back, confirm/cancel, and `delegateGoal` send), `routing/RepeatBack.kt` (the SPEC-10 r8 templates and reply lists), and `voice/Speaker.kt` (Android TTS behind a `speak` interface). `AppGraph` now wires `GoalRouter` where `LastGoal` was, and the deleted `LastGoal` is gone. Tests in `app/src/test/java/ai/yumi/android/routing/`.
- **Commits:** `9b36c6c feat(android): delegate a confirmed goal and show it working on the Mac`.
- **Expectations:** "Nothing runs and nothing is sent to the Mac before the user confirms" passes in `GoalRouterTest.a delegated goal is repeated back and sent only after confirm` (the transcript is asserted, the ledger is empty before confirm, then the `delegateGoal` payload is decrypted). The delegated half of "Delegated goal echoes the transcript" passes in the same test and in `RepeatBackTest`.
- **Not verified:** The phone-only halves of the SPEC-10 and SPEC-09 scenarios need OBJ-67.1, which is cut, so their boxes stay unchecked. The live relay ran on 2026-10-10 with a paired Android phone (Brent's A56): a confirmed goal was delegated to the Mac and run (`Q3 Report.pdf` exported), and Stop, Resume, and the summary were seen. The demo phone (serial MVW4QOY5IFLJEM6P) itself was not used.
- **Decisions and deviations:** The demo delegates every goal, so the three phone-only templates are present and tested but not reached at runtime; they are ready for OBJ-67.1. A confirm while the Mac is not paired shows the "Unpaired device" error and stays on the repeat-back rather than pretending the goal went out.
- **For the next objectives:** [OBJ-69](OBJ-69-android-delegated-goal-screen.md) consumes `GoalRouter.state` and its `confirm`, `stop`, `resume`, and `cancel` methods. When OBJ-66 lands, add the p0 rule ahead of `GoalRouter.repeatBack` and route a matched phone-only goal to the runners instead of confirming a delegate.
