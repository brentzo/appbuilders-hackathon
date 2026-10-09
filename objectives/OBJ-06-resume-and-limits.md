---
id: OBJ-06
title: Resume and limits
product: harness
touches: []
specs: [SPEC-02]
status: todo
priority: p0
depends-on: [OBJ-04, OBJ-05]
tags: [objective, p0, harness]
---

# OBJ-06 Resume and limits

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-02](../specs/02-task-lifecycle.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Small models loop, stall, and produce bad output.
Limits stop runaway work, and resume lets Yumi pick up after a crash or reboot without redoing or skipping steps.
Resume never starts on its own: the user is always asked first.

## Read first

- [SPEC-02](../specs/02-task-lifecycle.md), requirements 4 and 8, and scenarios "Resume after the app crashes", "Resume after a reboot", "Step limit is reached".
- [docs/task-record-schema.md](../docs/task-record-schema.md), sections "Limits" and "Checkpointing".
- [SPEC-11](../specs/11-user-facing-errors.md), "Task took too long".

## Tasks

- [ ] **OBJ-06.1** On startup, find tasks that were `running` and mark them as interrupted. Find steps with no outcome and set them to `noEffect`.
- [ ] **OBJ-06.2** Emit an `interruptedTaskFound` event so the app can ask "I was interrupted while working on your task. Want me to pick up where I left off?"
- [ ] **OBJ-06.3** Add RPC methods `resumeTask` and `cancelTask`. Resume always captures a fresh observation before the next step.
- [ ] **OBJ-06.4** Tasks that were `paused` before a restart stay paused and are listed with a "Resume" action. Nothing runs until the user resumes.
- [ ] **OBJ-06.5** Enforce limits from config with these defaults: 25 steps per subtask, 3 attempts per subtask, subtask depth 1.
- [ ] **OBJ-06.6** When the step limit is hit, mark the subtask `failed` and emit a user-facing error event of kind `taskTookTooLong`, carrying what was finished so far. The app turns the kind into the SPEC-11 copy.
- [ ] **OBJ-06.7** Reject any attempt to create a subtask from inside a subtask (depth limit).
- [ ] **OBJ-06.8** Tests: crash simulated between step insert and outcome, reboot with a paused task, each limit.

## Expectations

- [ ] SPEC-02 scenarios "Resume after the app crashes", "Resume after a reboot", and "Step limit is reached" pass.
- [ ] Resuming never repeats an action whose outcome was already recorded.
- [ ] No task resumes without an explicit user action.
- [ ] Error events carry a structured kind, never raw error text.

## Outcomes

- Startup recovery, resume and cancel RPC methods, and limit enforcement with configurable defaults.

## Out of scope

- The "Resume" prompt UI on the Mac: built with the app's task UI, using these events.
- Ghost-specific failure counting and handoff: [OBJ-09](OBJ-09-ghost-handoff.md).
- User "stop" and mouse takeover: SPEC-06, not reviewed yet.

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
