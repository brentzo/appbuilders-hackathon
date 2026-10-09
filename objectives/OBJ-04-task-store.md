---
id: OBJ-04
title: Task store and history
product: harness
assignee: Brent
touches: []
specs: [SPEC-02]
status: blocked
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

- [x] **OBJ-04.1** Create the SQLite database in the user's Application Support folder, with tables for tasks, subtasks, steps, window locks, app capabilities, and the action log. Add migrations.
- [x] **OBJ-04.2** Write a typed repository layer using the protocol types. No raw SQL outside it.
- [x] **OBJ-04.3** Enforce allowed status transitions for tasks and subtasks. An illegal transition is a bug and is logged, not silently applied.
- [x] **OBJ-04.4** Implement the step checkpoint rule: insert the step row before its action runs, update outcome and duration after.
- [x] **OBJ-04.5** Store step screenshots as files next to the database and keep their paths on the step. Nothing is deleted automatically.
- [x] **OBJ-04.6** Write an action log entry for every executed action: time, device, lane, and a plain-language description.
- [x] **OBJ-04.7** Add history queries: list past tasks newest first, and search by text across goals, subtask titles, and summaries. Expose them over the local RPC (`listTasks`, `searchTasks`, `getTask`).
- [x] **OBJ-04.8** Emit a `taskStatusChanged` event on every status change.
- [x] **OBJ-04.9** Tests for transitions, checkpointing, search, and that records survive closing and reopening the database.

## Expectations

- [ ] SPEC-02 scenario "Finished tasks are kept" passes: a task finished long ago is found by searching "invoices", with its steps and action log.
- [x] Killing the process between the step insert and the outcome update leaves a step with no outcome, which [OBJ-06](OBJ-06-resume-and-limits.md) relies on.
- [x] Every status change produces exactly one event.
- [x] No code path deletes tasks, steps, logs, or screenshots.

## Expected outcomes

- The task store module, database migrations, and history RPC methods.
- A documented on-disk layout in `harness/README.md`.

## Out of scope

- Creating subtasks from a goal: [OBJ-05](OBJ-05-planner-and-scheduler.md).
- Resume behavior: [OBJ-06](OBJ-06-resume-and-limits.md).
- The past-tasks screen in the Mac and phone apps. This objective only provides the queries.

## Outcome

- **Result:** Blocked on one protocol change. Every task is done; one expectation cannot pass over RPC until the protocol has it.
- **Blocked by:** `TaskDetail` in `protocol/schemas/rpc.json` (the `getTask` result) has `task`, `subtasks`, and `steps`, but no action log, and no other RPC method returns it.
  So the Mac app cannot show a past task "with its steps and action log", as SPEC-02 "Finished tasks are kept" says.
  The store already keeps and returns the action log (`TaskStore.getTaskHistory`), and the scenario passes against the store.
  **Who can unblock:** Jepoy (protocol owner), or Brent deciding otherwise.
  **Proposed change (not breaking):** add an optional `actionLog` property to `TaskDetail`, an array of `ActionLogEntry`, oldest first, update `TaskDetail.keynote.json`, and regenerate.
  The harness then returns `history.actionLog` from `getTask` (one line in `src/rpc/history.ts`) and a test asserts it, and this objective can be finished.
- **Delivered:**
  - `harness/src/store/task-store.ts`: the task store (`TaskStore`), the only module with SQL. Tasks, subtasks, steps, step screenshots, the action log, history queries, window locks, and app capabilities, using the protocol types.
  - `harness/src/store/migrations.ts`: the schema as ordered migrations tracked in `PRAGMA user_version`, with triggers that refuse deleting tasks, subtasks, steps, and action log lines, and changing a log line.
  - `harness/src/store/transitions.ts`: the allowed task and subtask status changes.
  - `harness/src/rpc/history.ts`: `listTasks`, `searchTasks`, and `getTask`.
  - `harness/src/harness.ts`: opens the store, starts the RPC server with the history methods, and sends every status change as `taskStatusChanged`. `src/main.ts` uses it.
  - `harness/README.md`: the task store, its on-disk layout, its tables, the rules it enforces, and the history behavior.
  - Tests: `harness/test/task-store.test.ts`, `harness/test/history-rpc.test.ts`, and the crash fixture `harness/test/fixtures/crash-mid-step.ts`.
- **Commits:**
  - `c96d0b8 docs(objectives): start OBJ-04`
  - `4fc4ee7 feat(harness): add the task store, history RPC methods, and status events`
  - `docs(objectives): block OBJ-04 on the action log in TaskDetail` (this Outcome)
- **Expectations:**
  - "Finished tasks are kept" (not checked): `test/task-store.test.ts`, "Scenario: Finished tasks are kept", passes against the store: a task created 6 months earlier is found by searching "invoices" after closing and reopening the database, with its step and its action log line. Over RPC, `test/history-rpc.test.ts` finds it with `searchTasks` and gets its steps from `getTask`, but `getTask` cannot return the action log. See "Blocked by".
  - Killed between the insert and the update: `test/task-store.test.ts`, "leaves a step with no outcome when the process is killed between the insert and the outcome update". A separate Node process begins a step and kills itself with SIGKILL; reopening the database shows that step in `listUnfinishedSteps()` with no outcome and no duration, and no action log line.
  - One event per status change: `test/task-store.test.ts`, "emits exactly one event per status change, in order, each valid against the contract", plus tests that refused changes and non-status writes emit nothing. `test/history-rpc.test.ts` checks the events reach a bare client and the protocol's mock Mac app (`npm run mock:mac`), one per change.
  - Nothing deleted: `test/task-store.test.ts`, "nothing is deleted": the database refuses deletes from the four history tables, and a source scan finds no `DELETE` other than releasing a window lock, and no file removal other than the RPC server's own socket.
  - `python3 scripts/verify.py` passes (docs, harness typecheck, lint, format, and 101 tests; android and whisper unaffected). The harness suite passed five repeated runs.
  - End to end: `npm start` with `YUMI_SUPPORT_DIR` set to a temporary folder, a task seeded by a separate process, then a bare socket client: `hello`, `searchTasks` for "invoices" and `listTasks` returned the task, and `getTask` for an unknown id returned `-32000` with `{"kind":"unexpected"}`. SIGINT closed the socket and the database cleanly.
- **Not verified:** The real Mac app does not exist yet, so the history methods and events were tested with a bare client and the protocol's mock Mac app. Screenshots were tested with generated PNGs; nothing captures real screenshots yet.
- **Decisions and deviations:**
  - `node:sqlite`, not a native package: it is stability 1.2 (release candidate) in Node.js 26.7.0, needs no native build, and prints no experimental warning. It became a release candidate in v25.7.0 (Node's own sqlite docs, history table), so on Node.js 24, which the harness still allows, it is experimental; the harness is developed and tested on 26.7.0.
  - The transition table in `src/store/transitions.ts` is the harness's reading of the status descriptions in `docs/task-record-schema.md`, SPEC-03, SPEC-06, and SPEC-09. No spec lists allowed transitions, so Brent should review it. Main choices: done, failed, and cancelled are final; paused resumes to planning or running; a running subtask can go back to ready or queued (paused, or lost its lock); a needsApproval subtask goes back to ready when a pause cancels the approval.
  - A change to the status a record already has is refused like any illegal change, so every accepted change is a real one and emits exactly one event.
  - A new task's or subtask's first status counts as a status change and emits one event, so the dashboard learns about it. A task starts as awaitingConfirmation, queued, or planning; a subtask as pending or ready.
  - Every record is validated against its protocol schema before it is written, so the store never holds a record the apps would reject.
  - `finishStep` requires the action log line for every outcome except `invalidOutput`, and writes it in the same transaction as the outcome, so no finished action is missing from the log.
  - The store refuses a step for a subtask that is not running, and a new step while the subtask's previous step has no outcome.
  - Screenshots go to `screenshots/<task id>/<step id>.png` (or `.jpg`), readable only by this user, and are never replaced. The bytes must be a PNG or JPEG.
  - Search matches every word of the query against the goal, confirmed goal, summary, and subtask titles, ignoring case and accents, in a SQL function. It scans every task, which is fine for one person's history; full-text indexing can come later if it gets slow.
  - `getTask` for an unknown task answers the `unexpected` UserError and logs `history.taskNotFound`, since no SPEC-11 row fits and the app only asks for tasks it was given.
  - `tasks.db` and its WAL files are created readable only by this user, like the log and the socket.
  - Window locks and app capabilities are working state, not history: they can be replaced and released.
  - Screenshots are kept forever, following SPEC-02 r10. `docs/task-record-schema.md` still lists the open question against SPEC-07 r20 (p1, 7 days); this objective did not settle it.
- **For the next objectives:**
  - Open the store with `TaskStore.open({ dir, logger })`; the running harness has it as `startHarness(...).store`. Listen with `store.onStatusChanged`.
  - OBJ-05: `createTask`, `setTaskStatus(id, status, { confirmedGoal, summary })`, `addSubtask` (appends to the plan), `setSubtaskStatus(id, status, fields)`, and `updateSubtask` for router and worker fields.
  - Steps: `beginStep({ subtaskId, lane, action })` before the action runs, then `finishStep(id, { outcome, observation, log: { deviceId, description, paths } })`. `durationMs` defaults to the time since the step began. `saveStepScreenshot(id, bytes)` stores the image.
  - OBJ-06: `listUnfinishedSteps()` returns the steps a crash interrupted. Mark one with `finishStep(id, { outcome: "noEffect", log: ... })`; the log line is required, so describe the interrupted action.
  - OBJ-07 and OBJ-08: `putWindowLock`, `getWindowLock`, `listWindowLocks`, `releaseWindowLock`, `putAppCapability`, and `getAppCapability`.
  - Illegal changes throw `IllegalTransitionError`; broken records throw `InvalidRecordError`; other refused requests throw `StoreRuleError` with a `rule`. All are bugs in the caller and are logged.
  - Add schema changes as a new migration at the end of `MIGRATIONS`.
  - Tests: `test/store-helpers.ts` has `openStore`, `runningSubtask`, `exampleAction`, a hand-moved `TestClock`, and `tinyPng`. Keep socket paths short (104 bytes).
