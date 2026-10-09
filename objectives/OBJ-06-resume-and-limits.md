---
id: OBJ-06
title: Resume and limits
product: harness
assignee: Brent
touches: []
specs: [SPEC-02]
status: done
priority: p0
depends-on: [OBJ-04, OBJ-05]
integrates-with: []
tags: [objective, p0, harness]
---

# OBJ-06 Resume and limits

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

Small models loop, stall, and produce bad output.
Limits stop runaway work, and resume lets Yumi pick up after a crash or reboot without redoing or skipping steps.
Resume never starts on its own: the user is always asked first.

## Read first

- [SPEC-02](../specs/02-task-lifecycle.md), requirements 4 and 8, and scenarios "Resume after the app crashes", "Resume after a reboot", "Step limit is reached".
- [docs/task-record-schema.md](../docs/task-record-schema.md), sections "Limits" and "Checkpointing".
- [SPEC-11](../specs/11-user-facing-errors.md), "Task took too long".

## Tasks

- [x] **OBJ-06.1** On startup, find tasks that were `running` and mark them as interrupted. Find steps with no outcome and set them to `noEffect`.
- [x] **OBJ-06.2** Emit an `interruptedTaskFound` event so the app can ask "I was interrupted while working on your task. Want me to pick up where I left off?"
- [x] **OBJ-06.3** Add RPC methods `resumeTask` and `cancelTask`. Resume always captures a fresh observation before the next step.
- [x] **OBJ-06.4** Tasks that were `paused` before a restart stay paused and are listed with a "Resume" action. Nothing runs until the user resumes.
- [x] **OBJ-06.5** Enforce limits from config with these defaults: 25 steps per subtask, 3 attempts per subtask, subtask depth 1.
- [x] **OBJ-06.6** When the step limit is hit, mark the subtask `failed` and emit a user-facing error event of kind `taskTookTooLong`, carrying what was finished so far. The app turns the kind into the SPEC-11 copy.
- [x] **OBJ-06.7** Reject any attempt to create a subtask from inside a subtask (depth limit).
- [x] **OBJ-06.8** Tests: crash simulated between step insert and outcome, reboot with a paused task, each limit.

## Expectations

- [x] SPEC-02 scenarios "Resume after the app crashes", "Resume after a reboot", and "Step limit is reached" pass.
- [x] Resuming never repeats an action whose outcome was already recorded.
- [x] No task resumes without an explicit user action.
- [x] Error events carry a structured kind, never raw error text.

## Expected outcomes

- Startup recovery, resume and cancel RPC methods, and limit enforcement with configurable defaults.

## Out of scope

- The "Resume" prompt UI on the Mac: built with the app's task UI, using these events.
- Ghost-specific failure counting and handoff: [OBJ-09](OBJ-09-ghost-handoff.md).
- User "stop" and mouse takeover: SPEC-06, not reviewed yet.

## Outcome

- **Result:** Done.
- **Delivered:**
  - `harness/src/scheduler/recovery.ts`: `recoverAfterRestart`, run by `startHarness` before the socket opens. Steps with no outcome become `noEffect` with an action log line ("Started to create Note 4.md, but was interrupted before it finished") and an observation that tells the next worker to check before doing it again. Tasks that were planning, running, or waiting for the user become `paused` and marked interrupted. Running, needsApproval, and queued subtasks of every paused task go back to `ready` with their attempts kept, and their window locks are released. Safe to run again after a crash halfway through.
  - `harness/src/harness.ts`: on every `hello`, after the answer, one `interruptedTaskFound` per interrupted task. `Harness.tasks` (`TaskControl`) and `Harness.recovery`. An optional `work` option (model client, lanes, device id, home, slots) lets the harness run tasks; without it, tasks can be cancelled but not started or resumed.
  - `harness/src/scheduler/task-control.ts`: `TaskControl` with `start`, `resume`, `cancel`, and `close`, the one place a task's work starts, so a cancel can always find it.
  - `harness/src/rpc/tasks.ts`: the `resumeTask` and `cancelTask` methods. A refusal answers the `unexpected` kind with the task's last action; the reason is logged as `task.refused`.
  - `harness/src/scheduler/run-task.ts`: `continueTask`, which carries on a resumed task with a saved plan; a task interrupted while planning plans again through `runTask`.
  - `harness/src/config.ts`: `Limits` and `DEFAULT_LIMITS` (25 steps, 3 attempts, depth 1), from `YUMI_STEPS_PER_SUBTASK`, `YUMI_ATTEMPTS_PER_SUBTASK` (1 to 3), and `YUMI_SUBTASK_DEPTH`.
  - `harness/src/scheduler/subtask-runner.ts` and `result.ts`: the configured step limit, counted across attempts and restarts, failing the subtask with `taskTookTooLong` and `finishedSoFar`. `scheduler.ts`: the attempt limit, checked before routing; a resumed subtask continues its attempt (`ScheduleOptions.continuing`).
  - `harness/src/store/`: migration 5 (`tasks.interrupted`, `subtasks.parent_subtask_id`), `setTaskStatus(..., { interrupted })`, `listInterruptedTasks`, `listTasksByStatus`, `listSubtaskActionLog`, and the depth check on `addSubtask({ parentSubtaskId })` (rule `subtaskDepth`), with `maxSubtaskDepth` from the limits.
  - Tests: `harness/test/resume-and-limits.test.ts` and the crash fixture `harness/test/fixtures/crash-mid-task.ts`. `harness/README.md` documents it under "Resume and limits".
  - No protocol change: `resumeTask`, `cancelTask`, `interruptedTaskFound`, and `UserError.finishedSoFar` were already in `protocol/schemas/`.
- **Commits:**
  - `326ca66 docs(objectives): start OBJ-06`
  - `8843be9 feat(harness): resume interrupted tasks and enforce the step, attempt, and depth limits`
  - `docs(objectives): finish OBJ-06` (this Outcome)
- **Expectations:**
  - "Resume after the app crashes": `test/resume-and-limits.test.ts`, "Scenario: Resume after the app crashes". A separate process runs the notes task through the real planner, scheduler, and typed file tools against the mock model server and kills itself with SIGKILL after step 4 began and before its tool ran. The restarted harness pauses the task, a bare app client gets `interruptedTaskFound` (valid `TaskRef`), and nothing runs until it calls `resumeTask`. Step 4 is `noEffect`, the first worker request after the resume carries the observation taken after the restart (the lane's observation count was 1 when it arrived), and the task finishes.
  - "Resume after a reboot": "Scenario: Resume after a reboot". A task paused before the restart is `paused` in `listTasks`, gets no `interruptedTaskFound`, and in 500 ms makes no model request, no observation, and no step. `resumeTask` then finishes it.
  - "Step limit is reached": "Scenario: Step limit is reached". After 25 steps the subtask is `failed` (`partial`, "Stopped after 25 steps without finishing."), the 26th step is never requested, the task fails, and the app gets a valid `userError` `{ kind: "taskTookTooLong", taskId, finishedSoFar: "Read the lease\nLooked in the folder Downloads" }`.
  - Resuming never repeats a recorded action: in the crash scenario, notes 1 to 3 were written once before the crash, only the cut-off note 4 after it, and `~/Documents` holds exactly the four notes with no numbered copies. Steps are `ok, ok, ok, noEffect, ok`, and the subtask stays on attempt 1.
  - No task resumes without an explicit user action: the two scenarios above, plus "keeps asking after another restart until the user answers, and never resumes on its own" (two restarts, still paused and announced each time, no model request).
  - Error events carry a structured kind: `taskTookTooLong` and `stepFailed` events are validated as `UserError`; refused `resumeTask` and `cancelTask` calls answer `-32000` with `{ kind: "unexpected" }` and the last action, never the reason.
  - Limits: the configured step limit (3), the step limit counting steps from before a restart, the attempt limit (a subtask with 3 attempts fails before routing, with only the planner asked), the configured attempt limit with a resume continuing its attempt, the depth limit (refused with nothing written and no event), a configured depth of 2, and the environment variables.
  - The protocol's mock Mac app (`npm run mock:mac`) receives `interruptedTaskFound` and accepts it against the contract.
  - Each new test was checked to fail when its behavior is removed: dropping the announcement or counting a resume as a new attempt fails 6 tests.
  - End to end with `npm start`: a store left by the OBJ-04 crash fixture (SIGKILL mid-step), then the real harness with `YUMI_SUPPORT_DIR` on a temporary folder and a bare socket client. The log shows the step, subtask, and task recovered; after `hello` the client got `interruptedTaskFound`; `listTasks` showed the task `paused`; `cancelTask` cancelled it. `resumeTask` answered `unexpected`, because `src/main.ts` does not give the harness a model yet (see "Not verified").
  - `python3 scripts/verify.py` passes: docs, and harness typecheck, lint, format, and 332 tests. The full harness suite also passed three runs at once.
- **Not verified:**
  - Resume in the shipped harness: `src/main.ts` does not pass `work`, so `npm start` refuses `resumeTask` with `unexpected`. Nothing starts a task in the shipped harness yet either (OBJ-17), so nothing there can be interrupted. Wiring it needs this Mac's device id for the action log, which the harness learns only after pairing.
  - The Mac app's prompt ("I was interrupted while working on your task. Want me to pick up where I left off?") and the Resume button: out of scope here; tested with a bare client and the mock Mac app.
  - A fresh screen capture on a UI lane: only the helper lane exists until OBJ-36. The test uses a helper lane with a recognizable observation; a GUI lane's `observe` runs at the same point, at the top of every step.
  - The real model: the brief said not to start it.
- **Decisions and deviations:**
  - "Interrupted" is not a `TaskStatus`, so an interrupted task is `paused` with the harness-only flag `tasks.interrupted`. The flag is set only with `paused` and cleared by any status change. Only flagged tasks are announced, so a task the user paused is listed but not asked about.
  - Steps are marked `noEffect` at startup, as OBJ-06.1 says. The SPEC-02 scenario puts it after the user says yes; the record is the same by then. The step's duration runs to the moment recovery wrote it. Its action log device is the device of the task's last logged action, or the task's origin device when nothing was logged yet, because the harness does not know its own device id at startup.
  - A resume continues the attempt a pause or restart cut off; it is not a new attempt. Otherwise three pauses or crashes would fail a subtask that never failed. `Subtask.attempts` says "One gui_act call is one attempt", and a resumed gui_act would be a new call, so this is a question for Brent (below). The 25-step limit still bounds the work across resumes.
  - A subtask whose attempts are used up fails before it is routed, with `stepFailed` naming it, since SPEC-11 has no row of its own for it ("Stuck on screen" names a screen, and a helper has none). No path makes a second attempt yet; OBJ-09 handoff and the OBJ-38 Try again button will.
  - No action can make a subtask today, so the depth limit is enforced at the only write path: the task store refuses `addSubtask` with a `parentSubtaskId` that would nest too deep. The parent is stored internally, so a configured depth above 1 works.
  - `finishedSoFar`: the titles of finished subtasks, then what the stopped subtask did that worked, from its action log, one line each, each said once, at most 500 characters, with "And N more." for the rest. Absent when nothing was finished.
  - `cancelTask` fails every subtask that had started ("Cancelled before it finished.") and leaves the never-started ones as they were, like OBJ-05 does on failure. Cancelling a task that already ended does nothing, so a race with the task finishing shows no error. It does not speak "Okay, I stopped. Nothing else will happen."; that is SPEC-06 and OBJ-38.
  - A second `resumeTask` while the task runs does nothing, so a double tap is harmless. `resumeTask` on a task that is not paused, or an unknown task, answers `unexpected`.
  - Recovery leaves `handoff` subtasks alone: resuming a handoff belongs with OBJ-09.
  - `interruptedTaskFound` goes to every connection that said hello, each time one does, so a second app connection repeats it to the first. The Mac app is the only client today.
  - The step limit's log event is now `subtask.stepLimit` (was `subtask.stepGuard`).
  - The transition table in `src/store/transitions.ts` did not need any change.
- **For the next objectives:**
  - OBJ-17: start confirmed tasks with `harness.tasks.start(taskId)`, not `runTask`, so cancel and resume can find them. Pass `work` to `startHarness` in `src/main.ts`: `{ client: new ModelClient(config.model, logger), logger, deviceId, home: os.homedir(), lanes: { helper: fileHelperLane({ home, logger }) }, slots: config.model.parallelSlots }`. The route, the voice, and the limits default to the router, `localVoice`, and `config.limits`.
  - OBJ-38: a pause sets running subtasks back to `ready` (keeping attempts) and the task to `paused`, without `interrupted`. Resume and cancel go through `harness.tasks`; extend `TaskControl.cancel` for OBJ-38.6.
  - OBJ-36: `observe` runs at the top of every step, so a GUI lane's `observe` must capture the screen fresh each time. `describeInterrupted` in `src/scheduler/describe.ts` has one general line for UI actions; give it the element's label.
  - OBJ-09: a handoff or retry is a new attempt, so it must not be in `ScheduleOptions.continuing`; the scheduler checks the attempt limit. Recovery does not reset `handoff` subtasks yet.
  - Mac app: on `interruptedTaskFound`, ask the SPEC-02 question; yes calls `resumeTask`, no calls `cancelTask`. A `paused` task from `listTasks` shows Resume and Cancel. `taskTookTooLong` carries `finishedSoFar` as lines to show under "Here's what I finished so far."
  - Questions for Brent: should a resume after a crash count as a new attempt (`Subtask.attempts`: "One gui_act call is one attempt")? Is `stepFailed` the right kind when attempts run out?
