---
id: OBJ-60
title: Contract for changing the goal mid-task
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-06, SPEC-02]
status: in-progress
priority: p1
depends-on: [OBJ-01]
integrates-with: [OBJ-61, OBJ-62]
tags: [objective, p1, protocol, voice, ux]
---

# OBJ-60 Contract for changing the goal mid-task

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-06](../specs/06-user-control.md), [SPEC-02](../specs/02-task-lifecycle.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-06 "Changing the goal mid-task" lets the user interrupt a running task by voice on the Mac and turn what they say into one revised goal.
The Mac already pauses the UI lanes with `pause` and `scope: uiLanes` ([OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md)), and the harness already repeats goals back with `goalRestated` and `replyToConfirmation`.
What is missing is a way to hand the harness what the user said for a task that is already running, and a place in the task record for each revision (SPEC-02 requirement 12).
This objective adds both, so [OBJ-61](OBJ-61-harness-goal-revision.md) and [OBJ-62](OBJ-62-mac-voice-interruption.md) can be built against the same contract.

## Read first

- [SPEC-06](../specs/06-user-control.md) requirements 14 to 21, the "Changing the goal mid-task" scenarios, and the decision.
- [SPEC-02](../specs/02-task-lifecycle.md) requirement 12, and [SPEC-01](../specs/01-voice-intake.md) requirements 4 to 7 and 14.
- `SubmitGoalParams`, `ReplyToConfirmationParams`, `GoalRestated`, `PauseParams`, and `AnswerQuestionParams` in [protocol/schemas/rpc.json](../protocol/schemas/rpc.json), the task record in [protocol/schemas/task.json](../protocol/schemas/task.json), and `ActionLogEntry` in [protocol/schemas/action-log.json](../protocol/schemas/action-log.json).
- [CONTEXT.md](../CONTEXT.md), for the words interruption and revised goal.

## Tasks

- [x] **OBJ-60.1** Add an app-to-harness method, for example `reviseGoal`, taking the task id, what the user said, and the Mac's Auto mode setting, as `submitGoal` does. The harness answers with the existing `goalRestated` for the same task, or, in Auto mode, with `speak` and the task resuming.
- [x] **OBJ-60.2** Decide whether `goalRestated` needs to say that it is a revision, or whether the Mac can tell from the task already running, and record the choice in the schema description. Auto mode is signaled by optional `autoMode: true`.
- [x] **OBJ-60.3** Add the revisions to the task record: each with what the user said, the revised goal, and when, in order, with `confirmedGoal` always the latest (SPEC-02 requirement 12). Expose them in `TaskDetail`.
- [x] **OBJ-60.4** Decide how the action log shows a revision: plain text in the existing `ActionLogEntry`, or its own kind, so "Show what I did" can say "Goal changed to …". The implementation uses the existing entry with plain text.
- [x] **OBJ-60.5** Write down in `protocol/README.md` how the existing calls cover the rest: `pause` with `scope: uiLanes` when the interruption starts, `resumeTask` for silence or "continue", `cancelTask` for "cancel", and the approval card's decline before `reviseGoal`.
- [x] **OBJ-60.6** Regenerate the types, add examples, and test that each new shape validates and a revision without what the user said does not.
- [ ] **OBJ-60.7** Check that nothing on the Mac stops building: its method switch has a `default`, and no new event is added. If an event turns out to be needed, add its Mac decoder case in the same push, as for `modelStateChanged`.
- [x] **OBJ-60.8** Add `cancelled` to `SubtaskStatus`, since SPEC-06 requirement 19 requires obsolete queued subtasks to be cancelled and the current contract has only `failed` as a terminal non-success state.

## Expectations

- [x] Every SPEC-06 requirement from 14 to 21 that crosses between the Mac and the harness maps to a method, an event, or a field, listed in `protocol/README.md`.
- [x] The SPEC-06 "Changing the goal mid-task" scenarios can be written as message sequences using only these.
- [ ] The Mac app and the harness still build against the regenerated types.

## Expected outcomes

- The revision method and the task record's revisions in `protocol/schemas/`, with generated types, examples, and tests.

## Out of scope

- The harness writing and applying the revised goal: [OBJ-61](OBJ-61-harness-goal-revision.md).
- Listening and pausing on the Mac: [OBJ-62](OBJ-62-mac-voice-interruption.md).
- Revising a task from the phone: later, SPEC-06 requirement 21.

## Outcome

Added and generated `reviseGoal`, `GoalRevision`, `Task.goalRevisions`, Auto-mode signaling, and the `cancelled` subtask status.
Documented the message sequence and action-log representation, added examples, and validated the contract through protocol tests and generated Swift/Kotlin type checks.
The Mac app target still needs a build on macOS with Xcode to verify the regenerated types in its full build.
