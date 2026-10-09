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
  - `protocol/schemas/plan.json`: `Plan`, `PlannedSubtask` (with the optional `needsKeyboard` from SPEC-03 r17), and `PlannedSubtaskId`. `protocol/schemas/task.json` and `worker.json`: the optional `toolOutput` (`ToolOutput`, at most 4000 characters) on `Step` and `StepSummary`. Examples, regenerated types, and validation tests. Not breaking; the protocol stays at version 3.
  - `harness/src/planner/`: the planner prompt, the plan checks (schema, repeated and unknown ids, cycles, at most 12 subtasks), `makePlan` with one retry, `subtasksFromPlan` (carrying `needsKeyboard`), and the summary step with the SPEC-02 r9 fallback sentence.
  - `harness/src/scheduler/`: `runTask`, the scheduler, one subtask's step loop (every action through `checkAction`), the worker input builder, the structured result, plain-language action log lines (`describe.ts`), the lane seams (`routeWith`, `LaneRunner`, `registryTools`, `fileHelperLane`), and `localVoice`.
  - `harness/src/harness.ts`: `startHarness` creates the lane router once (`harness.router`).
  - `harness/src/store/`: `savePlan` (the plan and the move to running in one transaction), and migration 3, which stores `toolOutput` on steps.
  - `harness/src/worker/prompt.ts`: a recent step shows its tool output as one quoted JSON string, marked as data.
  - `harness/src/config.ts`: `parallelSlots` from `YUMI_MODEL_PARALLEL_SLOTS`, default 3.
  - `harness/test/mock-model-server.ts`: an optional responder, so concurrent requests are answered by what they ask.
  - Tests: `harness/test/planner.test.ts` and `harness/test/scheduler.test.ts`. `harness/README.md` documents it.
- **Commits:**
  - `55f03e6 docs(objectives): start OBJ-05`
  - `cede982 feat(protocol): add the Plan the planner model returns`
  - `9aea036 feat(harness): add the planner, scheduler, and task summary`
  - `85c3110 feat(protocol): let the planner mark a subtask as needing the keyboard`
  - `f85bba0 refactor(harness): point OBJ-05 comments at the renumbered objectives`
  - `31f0d72 docs(harness): document the planner and scheduler`
  - `6f21d1a docs(objectives): finish OBJ-05`
  - `612fddb feat(harness): route each subtask through the lane router (OBJ-07.8)`
  - `490df80 docs(objectives): record OBJ-07.8`
  - `28a9a74 feat(harness): run every task action through the permission gate with the typed file tools`
  - `9257d42 feat(harness): tell the user which step could not finish when a subtask fails`
  - `d6bc62a test(harness): keep the scheduler tests steady on a loaded machine`
  - `a248b18 feat(protocol): add the tool output to a step and the worker's recent steps`
  - `0ac6cdf feat(harness): give the next steps what a tool returned`
  - `docs(objectives): update the OBJ-05 outcome after the router, gate, and tool output` (this Outcome)
- **Expectations:**
  - "Planner splits a goal into subtasks": `test/scheduler.test.ts`, "Scenario: Planner splits a goal into subtasks". For "summarize the 5 PDFs in Downloads into one note", at the moment the task leaves planning it has one subtask reading each of the 5 PDFs and one writing the note, the note depends on all 5, and the task is running. The run reads 5 text files in a temporary home folder with OBJ-37's typed file tools, through the router and the gate, and writes the note.
  - "Task finishes and reports back": same file, "Scenario: Task finishes and reports back". Every subtask is done, the task is done with the summary saved, and a bare app client on the real local socket receives `speak` with "Done. I put the summary of all 5 PDFs in a new note called PDF Summary.", valid as `Speak`.
  - Overlap, measured: "runs independent subtasks at the same time, up to the parallel slots". With the mock taking 60 ms per worker step and 3 slots, the first three reads ran over 0-222 ms, 1-223 ms, and 1-222 ms, the last two over 229-421 ms, and exactly 3 requests were in flight at most. 22 worker steps took 958 ms, against 1320 ms one after another. With one slot, one at a time. The note's first step started after the last read finished.
  - A broken plan never reaches the scheduler: "fails the task after the planner's second broken plan". Two cyclic plans: two requests, nothing routed, no subtasks saved, the task failed, and a `UserError` of kind `unexpected` with no technical text.
  - `python3 scripts/verify.py` passes: docs, protocol (282 tests), harness typecheck, lint, format, and 308 tests, bridge, the Mac build and tests, and Android. The harness suite also passed six runs at once, three suites in parallel twice.
- **Not verified:**
  - The real model. The brief said not to load it, so the planner prompt, the summary prompt, and plan quality were tested only with the mock. To check: start the server as in `harness/README.md` with `--max-num-seqs 3`, then call `runTask` on a planning task.
  - Real parallel decoding. mlx-vlm 0.7.6 decodes concurrent requests in one continuous batch with per-request logits processors (`mlx_vlm/server/generation.py`, `--max-num-seqs` in `server/cli.py`), but neither the speed-up nor the memory use with 3 sequences on 16 GB was measured. The default of 3 is an estimate, and so is the 4000-character tool output bound (about a page of text per step, five steps per prompt).
  - The Docker Swift and Kotlin compile checks (Docker was not running). The Mac build compiled the generated Swift, and the generated Kotlin compiled locally with `kotlinc` 2.4.21, the serialization plugin, and `-Werror`. CI runs the Docker checks on push.
  - `submitGoal` does not start a task yet; see "For the next objectives".
- **Decisions and deviations:**
  - Plan ids are short planner-picked words, not Uuids, so the model can write dependencies. The harness gives each subtask a Uuid.
  - The plan limit is 12 subtasks (SPEC-02 sets no number). It is in the harness and in the schema sent to the model, not in the protocol.
  - Plans carry no target app, so the router sends every planned subtask to `helper` (`noUI`). Only the helper lane has a runner until OBJ-36; a subtask routed to ghost or main fails until then.
  - Workers see only the last 5 steps of their own subtask, so the planner is told to pass work between subtasks through files named in both instructions. What a tool returned reaches the next steps of the same subtask in `toolOutput` (Brent's decision), never another subtask.
  - A helper's observation is empty (`windowTitle: ""`, no elements), because it has no window.
  - Every tool call goes through `checkAction` with the user's home folder, and the step stores the gate's level. Only `allowed` runs. `ask` and `blocked` are recorded as blocked steps with an action log line ("Did not ... because it needs your approval first" or "... because Yumi's safety rules do not allow it") and logged as `step.needsApproval` or `step.blocked`; the worker is told and can finish as stuck. `ask` ends the subtask as `blocked`, because questions are not wired up yet (OBJ-38).
  - A subtask's `files` are the real paths the tools reported, so a numbered name ("Report 2.pdf") is right. They are kept in memory while the subtask runs, so a resume (OBJ-06) starts the list again.
  - Invalid worker output (twice) is logged but not stored as a step: a `Step` needs an action, and an invalid reply has none.
  - If one subtask fails, the others are stopped and marked failed, subtasks that never started stay pending or ready, and the task fails. There is no replanning. The user gets `stepFailed` with the subtask's title as `step` (SPEC-11 r14), `taskTookTooLong` when the 25-step guard stops a subtask, the model's own error when the model fails, the probe's error when the router cannot check an app, and `unexpected` with the last action only for a harness bug. An external cancel leaves statuses to the pause and cancel flow.
  - The 25-step guard only stops the loop; OBJ-06 owns limits and attempts.
  - If the model cannot write a summary, Yumi says "Done. I finished everything you asked for." (SPEC-02 r9).
  - A task from the phone is spoken on the Mac until OBJ-25 (Brent's decision); `localVoice` logs `voice.originNotReachable` when it knows the Mac's device id.
  - `savePlan` emits the task's change to running first, then one event per subtask, all after the commit.
- **For the next objectives:**
  - Whoever wires confirmation (OBJ-17): when a task reaches planning, call `runTask(taskId, deps)` with `store: harness.store`, `route: routeWith(harness.router)`, `lanes: { helper: fileHelperLane({ home: os.homedir(), logger }) }`, `slots: config.model.parallelSlots`, `home: os.homedir()`, the Mac's `deviceId`, and `voice: localVoice(harness.server, logger, macDeviceId)`.
  - OBJ-36: add ghost and main to `lanes` as `LaneRunner`s (an `observe` that calls the Mac app and tools), and run element actions through `checkAction` with their resolved element and `observation.app`, as `runTool` does for tools.
  - OBJ-38: questions, approvals, pause, and cancel plug into `src/scheduler/subtask-runner.ts` (`ask`, the `ask` level) and the external `signal` of `runTask`. The Try again and Skip this step buttons of `stepFailed` need a way to rerun or skip one subtask.
  - OBJ-06: resume reads `toolOutput` from the stored steps, so a resumed worker sees what its tools returned.
  - Tests: `scriptedModel` in `test/scheduler.test.ts` answers planner, worker, and summary requests by their system prompt; `gather` holds replies until a number are in flight.
