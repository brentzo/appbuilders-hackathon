---
id: OBJ-52
title: Debug mode keeps full local logs
product: harness
assignee: Brent
touches: [mac]
specs: [SPEC-07]
status: done
priority: p0
depends-on: []
integrates-with: [OBJ-53]
tags: [objective, p0, harness, safety, debug]
---

# OBJ-52 Debug mode keeps full local logs

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

When a goal fails today, the logs drop what was said and what the model saw, so nobody can tell why.
In Brent's run, his "yes" was read as a correction and nobody could see what was transcribed.
SPEC-07 requirement 22 adds a Debug mode that keeps full, local logs, and requirement 23's thoughts panel ([OBJ-53](OBJ-53-mac-thoughts-panel.md)) reads from them.

## Read first

- SPEC-07 requirements 20, 22, and 23, and its Decisions.
- `harness/src/log.ts` and `harness/src/config.ts`.
- `harness/src/model/client.ts` (model requests and replies), `harness/src/confirm/` (transcripts and answers), `harness/src/planner/`, and `harness/src/worker/`.
- [harness/README.md](../harness/README.md), where the log files live.

## Tasks

- [x] **OBJ-52.1** Add a Debug mode setting to the harness config: on by default for development, off for release builds, and controllable from the Mac app's settings.
- [x] **OBJ-52.2** In Debug mode, write a separate detailed log in the support folder: transcripts and the user's spoken answers, each model request (messages, schema name) and reply (content, timing, tokens), plans, and each step's observation summary and decision.
- [x] **OBJ-52.3** Never write text typed into password fields or secure field values, and test it (SPEC-07 r20).
- [x] **OBJ-52.4** Delete detailed logs older than 7 days at startup.
- [x] **OBJ-52.5** Expose a step's decision and the model's reasoning in a form the Mac can read for the thoughts panel (through `getTask` or an event), as a non-breaking protocol addition, coordinated with OBJ-53.
- [x] **OBJ-52.6** Document where the logs are and how to read them in harness/README.md, and add a short how-to for debugging a failed goal.

## Expectations

- [x] With Debug mode on, a failed goal can be explained from the detailed log alone: what was heard, what the model was asked, and what it answered.
- [x] With Debug mode off, the detailed log is not written.
- [x] No password text appears in any log.

## Expected outcomes

- The detailed debug log, its retention, the setting, the reasoning data for OBJ-53, and docs.

## Out of scope

- The panel that shows the reasoning: [OBJ-53](OBJ-53-mac-thoughts-panel.md).
- The user-facing action log: [OBJ-38](OBJ-38-approvals-pause-and-action-log.md).

## Outcome

- **Result:** Done.
- **Delivered:**
  - `harness/src/debug/debug-log.ts`: the detailed debug log, `Debug log/<yyyy-mm-dd>.jsonl` in the support folder (folder 0700, files 0600), written only while Debug mode is on, never throwing, and deleting day files older than 7 days at startup (in either mode) and at each new day.
  - `harness/src/debug/scrub.ts`: `PasswordScrubber`, which removes the text of any `type` or `setValue` that could reach a password field from every debug line for that subtask, including later prompts that list the step, and logs a non-JSON reply by length only while a password field is on screen.
  - `harness/src/debug/thoughts.ts` and `harness/src/scheduler/subtask-runner.ts`: the `workerThought` words and events, and the `step.decided`, `step.finished`, `subtask.started`, and `subtask.ended` entries.
  - Debug entries in the confirmation loop (`voice.goal`, `voice.answer`, `confirm.*`), the model client (`model.request`, `model.reply`, `model.failure`, matched by `requestId`), the planner (`plan.made`, `plan.rejected`), the summary, and the task (`task.planning`, `task.done`, `task.failed` with `why`).
  - The setting: `HarnessConfig.debugMode` from `YUMI_DEBUG_MODE` (on unless `0`), and the `setDebugMode` method in `harness/src/rpc/debug.ts`.
  - Protocol, non-breaking, still version 4: the `setDebugMode` method (`SetDebugModeParams`), the `workerThought` event (`WorkerThought`), and an optional `WorkerOutput.reason`, with examples, tests, regenerated types, and one `workerThought` in the mock harness's `keynote-export` script.
  - `harness/README.md` "Debug mode": where the log is, every event, and a how-to for debugging a failed goal. `protocol/README.md` documents the contract.
- **Commits:**
  - `235e167 docs(objectives): start OBJ-52`
  - `b29fea0 feat(protocol): add setDebugMode, the workerThought event, and a model reason`
  - `0ae1c4c feat(harness): keep a detailed local debug log in Debug mode`
- **Expectations:**
  - A failed goal explained from the log alone: `harness/test/debug-log.test.ts` "has what was heard, what the model was asked and answered, and why the goal failed" runs the real harness on its socket with a mocked model server: a Taglish goal, a spoken answer read by the model, and a plan rejected twice end in "Unexpected", and the debug log alone has the transcript, the answer and how it was read, every request's messages and schema with its reply, tokens, and timing, both rejection reasons, and the error with `why`. Also checked by hand through `npm start` (the real `main.ts`) with the model server unreachable: the log had `voice.goal`, `model.request`, `model.failure` (`unreachable`), and `confirm.ended` with `modelFailedToLoad`.
  - Debug mode off writes nothing: "writes no detailed log, sends no thoughts, and does not ask the model for a reason" (off through `setDebugMode` after hello) and "writes nothing when the harness starts with it off, until the app turns it on" (off through `YUMI_DEBUG_MODE=0`). No `Debug log` folder is made.
  - No password text in any log: "keeps the text the model tried to put into a password field out of every file" has a worker in Mail's password dialog reply with a `setValue` of the password and then with plain text holding it, and checks every file in the support folder (`harness.log`, the debug log, `tasks.db` and its WAL) for the text, raw and JSON-escaped; it also checks the replies were logged with the text removed, so the test cannot pass by logging nothing. Two more tests cover typing while focus is unknown, the next prompt's escaped copy, and ordinary fields being left alone.
  - `npm run verify` in `harness/` (405 tests) and `protocol/` (338 tests), the Mac build and tests, and `python3 scripts/verify.py` pass. Both worker output grammars (with and without `reason`) compile with llguidance 1.9.1 (`npm run --silent model:check -- --print-schema [--explain] | ~/.venvs/yumi-model/bin/python scripts/check-grammar.py`).
- **Not verified:**
  - A live run with the real Qwen3.5-9B model and the Mac app, because the model server was not free. Brent: start the model server and the app, say a goal, answer "yes", then run `jq -c '{time, event, purpose, transcript, reply, kind, said, error}' ~/Library/Application\ Support/Yumi/Debug\ log/$(date +%F).jsonl` and check you can follow what was heard and what the model answered.
  - Whether Qwen3.5-9B writes useful one-sentence reasons, and how much time they add per step (estimated at 20 to 40 extra tokens). `npm run model:check -- --explain` shows one.
  - The Swift and Kotlin Docker compile checks (`npm run compile:swift`, `npm run compile:kotlin`), because Docker was not running. The Mac app's Xcode build compiled the regenerated Swift; CI runs both on push.
- **Decisions and deviations:**
  - The harness keeps no copy of the setting. The Mac app sends `setDebugMode` after every hello and on every change; until then the harness uses `YUMI_DEBUG_MODE`, on by default because a harness run from source is a development run. Until OBJ-53 sends it, Debug mode is always on.
  - The model's reason is asked for only in Debug mode, so release builds pay no extra tokens. With it on, the model writes `reason` before `action`, so prompts differ slightly between the two modes.
  - The `workerThought` text never includes text typed or set, matching the action log. The debug log does keep typed text for ordinary fields, since it is what explains a failure.
  - Retention goes by each file's last change, so a day's file lives 7 days after its last line.
  - The Mac app's exhaustive event decoder needed the new case: `mac/Yumi/Harness/HarnessEvent.swift` (3 lines) and a comment in `mac/Yumi/Harness/HarnessLink.swift`. Nothing else in `mac/` changed.
- **For the next objectives:**
  - **OBJ-53, the setting:** call `setDebugMode` with `{ "enabled": Bool }` (`SetDebugModeParams`, result `Empty`) right after every successful `hello`, and whenever the user flips the toggle. Default on in Debug builds and off in release builds (`#if DEBUG`). The harness turns the debug log, the `workerThought` events, and the model's reasons on and off together.
  - **OBJ-53, the panel:** listen for the `workerThought` event (`HarnessEvent.workerThought(WorkerThought)` already decodes; `HarnessLink.handle` sends it to `default` today). Fields: `taskId`, `subtaskId`, `title` (at most 60), `lane`, optional `cursorId`, `sees` (at most 200), optional `lastAction`, `decision`, `reason` (each at most 200), and `at`. Keep the latest event per `subtaskId`: each one replaces the last. A cursor's panel finds its thought by `cursorId` (`main` for the main cursor); a helper chip's by `subtaskId`, which is the chip id `HarnessLink` already uses. Events come when the model has chosen an action (new `decision` and `reason`) and again when it finished (new `lastAction` and `sees`). Drop a subtask's thought when `taskStatusChanged` says the subtask is `done` or `failed`. `protocol/examples/WorkerThought.*.json` are real examples, and `npm run mock:harness -- --script keynote-export` plays one.
  - **OBJ-36 (UI lanes):** give a ghost lane's `LaneRunner` a `cursorId(subtask)` returning the ghost's cursor id, so its thoughts reach the right cat; the main lane defaults to `main`. Keep calling `runWorkerStep` with the subtask's `scrubber` (the runner passes one) so typed text stays out of the debug log.
  - Any new model call: pass `taskId` (and `subtaskId`) in `ChatOptions` so its lines can be found, and write rejection reasons with `deps.debug?.write`.
