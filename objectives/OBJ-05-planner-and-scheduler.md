---
id: OBJ-05
title: Planner, scheduler, and task summary
product: harness
assignee: Brent
touches: []
specs: [SPEC-02]
status: todo
priority: p0
depends-on: [OBJ-03, OBJ-04]
integrates-with: []
tags: [objective, p0, harness]
---

# OBJ-05 Planner, scheduler, and task summary

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

A confirmed goal becomes a plan of subtasks with dependencies.
Independent subtasks run at the same time as separate requests to the one loaded model, which is where Yumi's parallel speed comes from.
When everything is done, Yumi speaks a short summary.

## Read first

- [SPEC-02](../specs/02-task-lifecycle.md), requirements 1, 5, 7, 9.
- [docs/task-record-schema.md](../docs/task-record-schema.md), Subtask shape and "What a worker receives".
- [OBJ-03](OBJ-03-harness-skeleton.md) and [OBJ-04](OBJ-04-task-store.md) Outcome.

## Tasks

- [ ] **OBJ-05.1** Write the planner prompt: given the confirmed goal and the available tools, return a list of subtasks with title, instruction, `dependsOn`, and `proposedLane`. Validate it against a `Plan` schema (add it to protocol if missing).
- [ ] **OBJ-05.2** Reject plans with dependency cycles, unknown dependency ids, or more than a set number of subtasks, and ask the planner once to fix them.
- [ ] **OBJ-05.3** Save the plan through the task store and move the task from `planning` to `running`.
- [ ] **OBJ-05.4** Write the scheduler: mark subtasks `ready` when their dependencies are `done`, and run ready subtasks concurrently up to the model server's parallel slot count (from config).
- [ ] **OBJ-05.5** Build each worker's input exactly as SPEC-02 requirement 5 says: confirmed goal, subtask instruction, last 3-5 steps, fresh observation, lane tools. Nothing else.
- [ ] **OBJ-05.6** Store each subtask's short structured `result` for the planner. Never pass full transcripts between workers.
- [ ] **OBJ-05.7** When all subtasks are done, generate a one or two sentence summary, save it, set the task to `done`, and emit an event telling the app to speak it on the device the user spoke to.
- [ ] **OBJ-05.8** Until the lane router exists ([OBJ-07](OBJ-07-lane-router-core.md)), run every subtask as a helper with non-GUI test tools.
- [ ] **OBJ-05.9** Tests with a mocked model: a plan with dependencies runs in the right order, independent subtasks overlap in time, and the summary is produced.

## Expectations

- [ ] SPEC-02 scenario "Planner splits a goal into subtasks" passes for "summarize the 5 PDFs in Downloads into one note", using helper tools for reading and writing files.
- [ ] SPEC-02 scenario "Task finishes and reports back" passes.
- [ ] A measured run shows independent subtasks overlapping in time, not running one after another.
- [ ] A broken plan never reaches the scheduler.

## Expected outcomes

- Planner, plan validation, scheduler, worker input builder, and summary step.
- Basic helper tools for files (read, write, list) used for testing.

## Out of scope

- Lane choice and GUI work: [OBJ-07](OBJ-07-lane-router-core.md) and SPEC-05.
- Step and attempt limits, resume: [OBJ-06](OBJ-06-resume-and-limits.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
