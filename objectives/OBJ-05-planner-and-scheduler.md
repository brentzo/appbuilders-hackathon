---
id: OBJ-05
title: Planner, scheduler, and task summary
product: harness
assignee: Brent
touches: []
specs: [SPEC-02]
status: done
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

- [x] **OBJ-05.1** Write the planner prompt: given the confirmed goal and the available tools, return a list of subtasks with title, instruction, `dependsOn`, and `proposedLane`. Validate it against a `Plan` schema (add it to protocol if missing).
- [x] **OBJ-05.2** Reject plans with dependency cycles, unknown dependency ids, or more than a set number of subtasks, and ask the planner once to fix them.
- [x] **OBJ-05.3** Save the plan through the task store and move the task from `planning` to `running`.
- [x] **OBJ-05.4** Write the scheduler: mark subtasks `ready` when their dependencies are `done`, and run ready subtasks concurrently up to the model server's parallel slot count (from config).
- [x] **OBJ-05.5** Build each worker's input exactly as SPEC-02 requirement 5 says: confirmed goal, subtask instruction, last 3-5 steps, fresh observation, lane tools. Nothing else.
- [x] **OBJ-05.6** Store each subtask's short structured `result` for the planner. Never pass full transcripts between workers.
- [x] **OBJ-05.7** When all subtasks are done, generate a one or two sentence summary, save it, set the task to `done`, and emit an event telling the app to speak it on the device the user spoke to.
- [x] **OBJ-05.8** Until the lane router exists ([OBJ-07](OBJ-07-lane-router-core.md)), run every subtask as a helper with non-GUI test tools.
- [x] **OBJ-05.9** Tests with a mocked model: a plan with dependencies runs in the right order, independent subtasks overlap in time, and the summary is produced.

## Expectations

- [x] SPEC-02 scenario "Planner splits a goal into subtasks" passes for "summarize the 5 PDFs in Downloads into one note", using helper tools for reading and writing files.
- [x] SPEC-02 scenario "Task finishes and reports back" passes.
- [x] A measured run shows independent subtasks overlapping in time, not running one after another.
- [x] A broken plan never reaches the scheduler.

## Expected outcomes

- Planner, plan validation, scheduler, worker input builder, and summary step.
- Basic helper tools for files (read, write, list) used for testing.

## Out of scope

- Lane choice and GUI work: [OBJ-07](OBJ-07-lane-router-core.md) and SPEC-05.
- Step and attempt limits, resume: [OBJ-06](OBJ-06-resume-and-limits.md).

## Outcome

- **Result:** Done.
- **Delivered:**
  - `protocol/schemas/plan.json`: `Plan`, `PlannedSubtask` (with the optional `needsKeyboard` from SPEC-03 r17), and `PlannedSubtaskId`, with examples, regenerated types, and validation tests. Not breaking; the protocol stays at version 3.
  - `harness/src/planner/`: the planner prompt, the plan checks (schema, repeated and unknown ids, cycles, at most 12 subtasks), `makePlan` with one retry, `subtasksFromPlan`, and the summary step.
  - `harness/src/scheduler/`: `runTask`, the scheduler, one subtask's step loop, the worker input builder, the structured result builder, the route and lane seams (`RouteSubtask`, `routeEverythingAsHelper`, `LaneRunner`, `LaneTools`), and `localVoice`.
  - `harness/src/tools/stand-in-file-tools.ts`: test-only `read_file`, `list_dir`, and `write_new_file`, kept inside a given home folder and never replacing a file.
  - `harness/src/store/task-store.ts`: `savePlan`, which adds every subtask and moves the task from planning to running in one transaction.
  - `harness/src/config.ts`: `parallelSlots` from `YUMI_MODEL_PARALLEL_SLOTS`, default 3.
  - `harness/test/mock-model-server.ts`: an optional responder, so concurrent requests are answered by what they ask.
  - Tests: `harness/test/planner.test.ts` and `harness/test/scheduler.test.ts`. `harness/README.md` documents all of it.
- **Commits:**
  - `e3e9da9 docs(objectives): start OBJ-05`
  - `aed70c7 feat(protocol): add the Plan the planner model returns`
  - `0027623 feat(harness): add the planner, scheduler, and task summary`
  - `b93a50b feat(protocol): let the planner mark a subtask as needing the keyboard`
  - `c5fbfb7 refactor(harness): point OBJ-05 comments at the renumbered objectives`
  - `docs(harness): document the planner and scheduler`
  - `docs(objectives): finish OBJ-05` (this Outcome)
- **Expectations:**
  - "Planner splits a goal into subtasks": `test/scheduler.test.ts`, "Scenario: Planner splits a goal into subtasks". For "summarize the 5 PDFs in Downloads into one note", at the moment the task leaves planning it has one subtask reading each of the 5 PDFs and one writing the note, the note depends on all 5, and the task is running. The run then reads 5 text files in a temporary home folder through the stand-in file tools and writes the note.
  - "Task finishes and reports back": same file, "Scenario: Task finishes and reports back". Every subtask is done, the task is done with the summary saved, and a bare app client on the real local socket receives `speak` with "Done. I put the summary of all 5 PDFs in a new note called PDF Summary.", valid as `Speak`.
  - Overlap, measured: "runs independent subtasks at the same time, up to the parallel slots". With the mock taking 60 ms per worker step and 3 slots, the first three reads ran over 0-222 ms, 1-223 ms, and 1-222 ms, the last two over 229-421 ms, and never more than 3 requests were in flight. 22 worker steps took 958 ms, against 1320 ms one after another. With one slot, one at a time. The note's first step started after the last read finished ("runs a plan with dependencies in the right order").
  - A broken plan never reaches the scheduler: "fails the task after the planner's second broken plan". Two cyclic plans: two requests, nothing routed, no subtasks saved, the task failed, and a `UserError` of kind `unexpected` with no technical text. Unit tests cover each check, and a fixed plan on the retry runs to done.
  - `python3 scripts/verify.py` passes: docs, protocol (260 tests), harness typecheck, lint, format, and 145 tests, bridge, and the Mac build. The harness suite passed 11 runs in a row.
- **Not verified:**
  - The real model. The brief said not to load it, so the planner prompt, the summary prompt, and plan quality were tested only with the mock. To check: start the server as in `harness/README.md` with `--max-num-seqs 3`, then call `runTask` on a planning task with the stand-in tools on a scratch home folder.
  - Real parallel decoding. mlx-vlm 0.7.6 decodes concurrent requests in one continuous batch with per-request logits processors (`mlx_vlm/server/generation.py`, `--max-num-seqs` in `server/cli.py`), but neither the speed-up nor the memory use with 3 sequences on 16 GB was measured. The default of 3 is an estimate.
  - The Docker Swift and Kotlin compile checks (Docker was not running). Instead, the Mac build compiled the generated Swift, and the generated Kotlin compiled locally with `kotlinc` 2.4.21, the serialization plugin, and `-Werror`. CI runs the Docker checks on push.
- **Decisions and deviations:**
  - Plan ids are short planner-picked words, not Uuids, so the model can write dependencies. The harness gives each subtask a Uuid.
  - The plan limit is 12 subtasks (SPEC-02 sets no number). It is in the harness and in the schema sent to the model, not in the protocol.
  - Workers see only the last 5 steps of their own subtask, so data moves between subtasks through files the planner names in both instructions. A helper's file text reaches its next step only through the step's 300-character observation line.
  - A helper's observation is empty (`windowTitle: ""`, no elements), because it has no window.
  - On a helper, keystrokes (`type`, `key`) are recorded as blocked steps, and `ask` ends the subtask as `blocked`, because questions are not wired up yet (OBJ-38).
  - Only "allowed" tool calls run; "ask" and "blocked" are recorded as blocked steps until approvals exist (OBJ-38).
  - Invalid worker output (twice) is logged but not stored as a step: a `Step` needs an action, and an invalid reply has none.
  - If one subtask fails, the others are stopped and marked failed, subtasks that never started stay pending or ready, and the task fails. There is no replanning. The user gets `unexpected` with the last action-log line, or `taskTookTooLong` when the 25-step guard stops a subtask. An external cancel leaves statuses to the pause and cancel flow.
  - The 25-step guard only stops the loop; OBJ-06 owns limits and attempts.
  - If the model cannot write a summary, Yumi says "Done. I finished everything you asked for." This sentence is not in a spec.
  - `savePlan` emits the task's change to running first, then one event per subtask, all after the commit.
- **For the next objectives:**
  - OBJ-07: pass your router as `route` in `RunTaskDeps`; it gets each `Subtask` before it runs and returns `{ lane, reason }`. Add lanes to `lanes`. Copy `needsKeyboard` from the plan in `subtasksFromPlan` (`src/planner/planner.ts`) once `Subtask` has it.
  - OBJ-37: implement `LaneTools` (`tools`, `permission(call)`, `run(call, signal)`) and replace `createStandInFileTools`. `changedFiles` in `src/scheduler/result.ts` reads `copy` and `move` paths from the step log; with numbered names, the real path may differ, so store it or change that function.
  - OBJ-38: questions, approvals, pause, and cancel plug into `src/scheduler/subtask-runner.ts` (`ask`, permission "ask") and the external `signal` of `runTask`.
  - Whoever wires confirmation: when a task reaches planning, call `runTask(taskId, deps)` with `localVoice(harness.server, logger, macDeviceId)`. A task from the phone is spoken on the Mac until OBJ-25 adds cross-device messages.
  - Tests: `scriptedModel` in `test/scheduler.test.ts` shows how to answer planner, worker, and summary requests by their system prompt.
