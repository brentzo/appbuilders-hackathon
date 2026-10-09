---
id: OBJ-60
title: Harness turns an interruption into a revised goal
product: harness
assignee: Brent
touches: []
specs: [SPEC-06, SPEC-02, SPEC-01]
status: todo
priority: p1
depends-on: [OBJ-17, OBJ-38, OBJ-59]
integrates-with: [OBJ-61]
tags: [objective, p1, harness, voice, ux]
---

# OBJ-60 Harness turns an interruption into a revised goal

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-06](../specs/06-user-control.md), [SPEC-02](../specs/02-task-lifecycle.md), [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-06 "Changing the goal mid-task" turns whatever the user says during a running task into one revised goal.
The Mac pauses the UI lanes and hands over what was said ([OBJ-61](OBJ-61-mac-voice-interruption.md)); the harness writes the revised goal, repeats it back, and redoes the plan from it without undoing anything.
It builds on the repeat-back from [OBJ-17](OBJ-17-goal-confirmation.md) and the pause, cancel, and approval handling from [OBJ-38](OBJ-38-approvals-pause-and-action-log.md).

## Read first

- [SPEC-06](../specs/06-user-control.md) requirements 14 to 21, the "Changing the goal mid-task" scenarios, and the decision.
- [SPEC-02](../specs/02-task-lifecycle.md) requirements 6 to 12, and [SPEC-01](../specs/01-voice-intake.md) requirements 4 to 7 and 14.
- The [OBJ-59](OBJ-59-goal-revision-contract.md) contract, and the Outcomes of OBJ-05, OBJ-06, OBJ-17, and OBJ-38.
- [CONTEXT.md](../CONTEXT.md), for interruption, revised goal, UI lane, and helper.

## Tasks

- [ ] **OBJ-60.1** Serve the OBJ-59 revision method for a running or paused task: keep the UI lanes paused, and let helpers keep running.
- [ ] **OBJ-60.2** Ask the model for one revised goal from the original goal, the finished and running subtasks, and what the user said, whether they replaced the goal, added to it, or asked for something separate.
- [ ] **OBJ-60.3** Repeat it back with `goalRestated`, naming anything already done that the revised goal no longer needs ("I already opened a new note with some text in it. I'll leave it there."). In Auto mode, send a short acknowledgement with `speak` and carry on instead.
- [ ] **OBJ-60.4** Handle the reply as for a new goal: "Change it" revises again, "Cancel" cancels the whole task as SPEC-06 requirement 8 does, and "Go ahead" applies the revision.
- [ ] **OBJ-60.5** Apply a confirmed revision: redo the plan from the revised goal, starting from the screen as it is; keep running helpers and queued subtasks the new plan still needs, cancel the others, and undo nothing.
- [ ] **OBJ-60.6** Record each confirmed revision on the task, with `confirmedGoal` the latest, and write an action log line for it (SPEC-02 requirement 12). Drop a revision that was cancelled or never confirmed.
- [ ] **OBJ-60.7** Treat an answer to a model question as an interruption only when it says "stop", "cancel", or clearly changes the goal (SPEC-06 requirement 20).
- [ ] **OBJ-60.8** Tests with a mocked model and the mock Mac app: each SPEC-06 "Changing the goal mid-task" scenario, Auto mode, a revision cancelled at the repeat-back, a helper kept and a helper cancelled, and the action log line.

## Expectations

- [ ] The SPEC-06 scenarios pass in the harness against the mock Mac app: "User replaces the goal while Yumi works", "User adds to the goal", "User cancels after interrupting", and "Interrupting an approval card".
- [ ] No action runs between the interruption and the user's yes, except in Auto mode.
- [ ] Nothing already done is undone, and the repeat-back says what was left behind.

## Expected outcomes

- Goal revision in the harness, with tests, and the revisions in the task record and action log.

## Out of scope

- Listening, pausing, and the 5-second silence on the Mac: [OBJ-61](OBJ-61-mac-voice-interruption.md).
- The contract: [OBJ-59](OBJ-59-goal-revision-contract.md).
- Revising from the phone: later, SPEC-06 requirement 21.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
