---
id: OBJ-67
title: Phone repeats back a goal and runs it or sends it to the Mac
product: android
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-10]
status: todo
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
- [ ] **OBJ-67.2** Repeat back with the fixed templates from SPEC-10 r8, spoken and on screen, with the transcript editable for delegated goals.
- [ ] **OBJ-67.3** Match replies against the fixed confirm and cancel lists; anything else is a correction, repeated back again. The buttons always work.
- [ ] **OBJ-67.4** On confirm, run a phone-only goal through the [OBJ-66](OBJ-66-android-phone-tool-host.md) runners and say the result, or send a delegated goal as `delegateGoal` and open the delegated-goal screen ([OBJ-69](OBJ-69-android-delegated-goal-screen.md)).
- [ ] **OBJ-67.5** Replace `LastGoal` as the `GoalSink`, add unit tests for the rule, templates, and reply lists, and update [android/README.md](../android/README.md).

## Expectations

- [ ] SPEC-10 scenarios pass: "Phone-only goal is repeated back with a template", "Delegated goal echoes the transcript".
- [ ] SPEC-09 scenario passes: "Phone-only goal runs on the phone".
- [ ] Nothing runs and nothing is sent to the Mac before the user confirms.

## Expected outcomes

- The p0 rule, templates, and confirmation flow in `android/app/src/main/java/ai/yumi/android/`, with tests.

## Out of scope

- Which other phone-only goals belong in the rule: SPEC-09 open question, for Brent.
- Edge cases not planned yet: the Mac offline when delegating (SPEC-09 r15, "Mac is offline", "Queued goal waited too long").

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
