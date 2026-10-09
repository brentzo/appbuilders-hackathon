---
id: OBJ-04
title: Task store and history
product: harness
assignee: Brent
touches: []
specs: [SPEC-02]
status: in-progress
priority: p0
depends-on: [OBJ-01, OBJ-03]
integrates-with: []
tags: [objective, p0, harness]
---

# OBJ-04 Task store and history

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-02](../specs/02-task-lifecycle.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The task store is the single source of truth for long-running work.
Because every step is written to disk before and after it runs, Yumi can survive crashes and reboots, and any worker can pick up the next step without sharing a conversation.
Everything is kept forever, including screenshots, as a demo-phase decision.

## Read first

- [SPEC-02](../specs/02-task-lifecycle.md), especially requirements 1-3, 10, 11, and the "Revisit after the hackathon" note.
- [docs/task-record-schema.md](../docs/task-record-schema.md), sections "Shape" and "Checkpointing".
- Types from [OBJ-01](OBJ-01-task-record-schemas.md).

## Tasks

- [ ] **OBJ-04.1** Create the SQLite database in the user's Application Support folder, with tables for tasks, subtasks, steps, window locks, app capabilities, and the action log. Add migrations.
- [ ] **OBJ-04.2** Write a typed repository layer using the protocol types. No raw SQL outside it.
- [ ] **OBJ-04.3** Enforce allowed status transitions for tasks and subtasks. An illegal transition is a bug and is logged, not silently applied.
- [ ] **OBJ-04.4** Implement the step checkpoint rule: insert the step row before its action runs, update outcome and duration after.
- [ ] **OBJ-04.5** Store step screenshots as files next to the database and keep their paths on the step. Nothing is deleted automatically.
- [ ] **OBJ-04.6** Write an action log entry for every executed action: time, device, lane, and a plain-language description.
- [ ] **OBJ-04.7** Add history queries: list past tasks newest first, and search by text across goals, subtask titles, and summaries. Expose them over the local RPC (`listTasks`, `searchTasks`, `getTask`).
- [ ] **OBJ-04.8** Emit a `taskStatusChanged` event on every status change.
- [ ] **OBJ-04.9** Tests for transitions, checkpointing, search, and that records survive closing and reopening the database.

## Expectations

- [ ] SPEC-02 scenario "Finished tasks are kept" passes: a task finished long ago is found by searching "invoices", with its steps and action log.
- [ ] Killing the process between the step insert and the outcome update leaves a step with no outcome, which [OBJ-06](OBJ-06-resume-and-limits.md) relies on.
- [ ] Every status change produces exactly one event.
- [ ] No code path deletes tasks, steps, logs, or screenshots.

## Expected outcomes

- The task store module, database migrations, and history RPC methods.
- A documented on-disk layout in `harness/README.md`.

## Out of scope

- Creating subtasks from a goal: [OBJ-05](OBJ-05-planner-and-scheduler.md).
- Resume behavior: [OBJ-06](OBJ-06-resume-and-limits.md).
- The past-tasks screen in the Mac and phone apps. This objective only provides the queries.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
