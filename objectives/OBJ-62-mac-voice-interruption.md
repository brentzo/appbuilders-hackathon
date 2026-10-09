---
id: OBJ-62
title: Mac listens for interruptions during a task
product: mac
assignee: Patrick
touches: []
specs: [SPEC-06, SPEC-01]
status: todo
priority: p1
depends-on: [OBJ-16, OBJ-35, OBJ-60]
integrates-with: [OBJ-40, OBJ-61]
tags: [objective, p1, mac, voice, ux]
---

# OBJ-62 Mac listens for interruptions during a task

**Product:** [Yumi Mac](../mac/README.md) · **Specs:** [SPEC-06](../specs/06-user-control.md), [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-06 "Changing the goal mid-task" lets the user say "Hey Yumi, sorry, not Notes, put it in Keynote" while a cursor is working.
The Mac hears it, freezes the cursors the moment the user starts talking, stops speaking, and hands what was said to the harness ([OBJ-61](OBJ-61-harness-goal-revision.md)) through the [OBJ-60](OBJ-60-goal-revision-contract.md) contract.
It reuses the local stop and the `uiLanes` pause from [OBJ-35](OBJ-35-mac-stop-and-take-over.md), and the wake word from [OBJ-16](OBJ-16-mac-wake-word.md).

## Read first

- [SPEC-06](../specs/06-user-control.md) requirements 2, 4 to 8, and 14 to 21, the "Changing the goal mid-task" scenarios, and the decision.
- [SPEC-01](../specs/01-voice-intake.md) requirements 4 to 6, 8, and 14, and the false-trigger test under "Wake word detector".
- The [OBJ-60](OBJ-60-goal-revision-contract.md) contract, and the Outcomes of OBJ-16, OBJ-17, and OBJ-35.
- [CONTEXT.md](../CONTEXT.md), for interruption, revised goal, take-over, UI lane, and helper.

## Tasks

- [ ] **OBJ-62.1** Keep the wake word and push-to-talk live while a task runs and while Yumi is talking.
- [ ] **OBJ-62.2** The moment an interruption starts, run the local stop from OBJ-35, call `pause` with `scope: uiLanes`, and stop any speech mid-sentence.
- [ ] **OBJ-62.3** If no speech starts within 5 seconds, call `resumeTask` and say nothing. If speech starts but cannot be understood, show and say the SPEC-11 "Didn't catch speech" copy and keep the task paused.
- [ ] **OBJ-62.4** Map "stop", "cancel", and "continue" to the existing pause, cancel, and resume paths; send anything else to the harness with the OBJ-60 revision method, with the Auto mode setting.
- [ ] **OBJ-62.5** Show the revised goal's repeat-back with the same panel and buttons as a new goal, and in Auto mode show the revised goal on screen with the harness's acknowledgement.
- [ ] **OBJ-62.6** While a card is open (OBJ-40): on a send card, anything other than its own answers declines the card first and then becomes an interruption; on a delete card, voice never approves. While Yumi waits on a model question, send the answer as today; the harness decides whether it is an interruption.
- [ ] **OBJ-62.7** Add Yumi's own spoken copy, played through the Mac's speakers, to the wake word false-trigger check (SPEC-01 "Wake word detector").
- [ ] **OBJ-62.8** Tests against the mock harness, and a hand check on the Mac of each SPEC-06 "Changing the goal mid-task" scenario.

## Expectations

- [ ] The SPEC-06 scenarios pass on the Mac: "User replaces the goal while Yumi works", "User adds to the goal", "Wake word heard by mistake", "User cancels after interrupting", and "Interrupting an approval card".
- [ ] No cursor acts after the user starts talking until the task resumes or the revision is confirmed.
- [ ] Yumi's own speech never wakes it.

## Expected outcomes

- Interruptions on the Mac: listening during a task, the pause, the silence rule, and the hand-off to the harness, with tests.

## Out of scope

- Writing and applying the revised goal: [OBJ-61](OBJ-61-harness-goal-revision.md).
- The contract: [OBJ-60](OBJ-60-goal-revision-contract.md).
- The phone: later, SPEC-06 requirement 21.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
