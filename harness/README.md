# Yumi Harness

The brain-side runtime on the Mac.
It runs the agent loop, owns all task state, plans goals into subtasks, routes subtasks to lanes, and talks to the local model, the Mac app, and the bridge.
The model is stateless; everything that makes Yumi feel long-running and reliable lives here.

Owner: Brent.

Status: the skeleton is built ([OBJ-03](../objectives/OBJ-03-harness-skeleton.md)): the forked agent loop, the local model client, the tool registry, output validation with one retry, the local RPC server with `hello`, `ping`, and events, and the log.
The task store is built ([OBJ-04](../objectives/OBJ-04-task-store.md)): tasks, subtasks, steps, screenshots, and the action log in SQLite, kept forever, with the history methods and the `taskStatusChanged` event.
The planner, scheduler, and task summary are built ([OBJ-05](../objectives/OBJ-05-planner-and-scheduler.md)), with every subtask running as a helper on test-only file tools until the lane router and the typed file tools land.
Resume and limits are built ([OBJ-06](../objectives/OBJ-06-resume-and-limits.md)): startup recovery, `resumeTask` and `cancelTask`, and the step, attempt, and depth limits.
Approvals, pause, and the action log are built ([OBJ-38](../objectives/OBJ-38-approvals-pause-and-action-log.md)): the send and delete approvals with their re-checks, blocked actions, `pause` with two scopes, a cancel that stops every lane, and the action log file.
The `gui_act` sub-agent is built ([OBJ-36](../objectives/OBJ-36-gui-act-sub-agent.md)): ghost and main subtasks run a short step loop in the target app's window through the Mac app, and return a structured result.
Debug mode is built ([OBJ-52](../objectives/OBJ-52-harness-debug-logs.md)): the detailed debug log, its 7-day retention, `setDebugMode`, and the `workerThought` events for the thoughts panel.

## Responsibilities

- **Agent loop:** call the model, validate its output, run the tool, record the result, repeat ([SPEC-02](../specs/02-task-lifecycle.md)).
- **Model client:** talk to the local Qwen3.5-9B server through an OpenAI-compatible API.
- **Task store:** tasks, subtasks, steps, locks, and the action log in SQLite, kept forever.
- **Planner and scheduler:** split a confirmed goal into subtasks with dependencies and run independent ones in parallel.
- **Resume and limits:** checkpoints, crash and reboot resume, step and attempt limits.
- **Lane router:** decide helper, ghost, or main for each subtask, with window locks, busy-window handling, and the cursor cap ([SPEC-03](../specs/03-lane-routing.md)).
- **Bridge client:** connect the Mac to the VPS bridge, encrypt and sign messages ([SPEC-08](../specs/08-device-bridge.md)).
- **Local RPC server:** the Mac app connects to the harness over a local socket.

## Not responsible for

- Anything native to macOS: screen capture, accessibility, mouse and keyboard, overlay cursors, microphone, speech. The [mac](../mac/README.md) app does these when the harness asks.
- Drawing anything. The harness sends events; the Mac app renders them.

## Technical choices

- TypeScript on Node.js 24 or later (developed on Node.js 26.7.0), run with `tsx`.
- The agent loop is forked from Pi's agent core, `@earendil-works/pi-agent-core` 1.1.0 (MIT). See [src/agent/FORK.md](src/agent/FORK.md) for the commit and what changed.
- Model server: mlx-vlm 0.7.6 serving `mlx-community/Qwen3.5-9B-4bit` through its OpenAI-compatible API. Every step sends its output schema as `response_format`, and every reply is validated again against the protocol schema.
- SQLite for the task store, through Node's built-in `node:sqlite` (stability 1.2, release candidate, in Node.js 26.7.0), so there is no native dependency to build.
- JSON-RPC 2.0 over a Unix domain socket for the Mac app, through the protocol's `RpcPeer`.
- Types and validation come from [protocol](../protocol/README.md). Never hand-write a schema type here.

## Layout

| Path | What it is |
|---|---|
| `src/main.ts` | Starts the harness: the log, then `src/harness.ts`, which opens the task store and starts the RPC server. |
| `src/config.ts` | Configuration from environment variables. |
| `src/agent/` | The forked Pi agent loop, message types, and session state. |
| `src/model/` | The model client (`client.ts`), the server's wire shapes (`openai.ts`), and the loop's stream function (`stream-fn.ts`). |
| `src/tools/registry.ts` | The tool registry and per-call tool subsets (at most 10). Starts empty: Pi's coding tools are not included. |
| `src/tools/file-tools.ts` | The typed file tools: `read_file`, `list_dir`, `write_new_file`, `copy`, and `move`. Each checks its own call with the gate and never replaces a file. |
| `src/safety/rules.ts` | The SPEC-07 permission table as data: levels, secret locations, protected folders, labels, key combos, risky apps and their safe labels. |
| `src/safety/gate.ts` | `checkAction`, the one permission gate every action goes through. |
| `src/safety/paths.ts` | Path resolution through `..` and symlinks, and the home, Library, dotfile, and secret checks. |
| `src/safety/trash.ts` | The `move_to_trash` checks and the `FileSummary` for the delete card. |
| `src/approvals/` | The approval flow and the `ApprovalGate` seam (`approval-flow.ts`), the card text (`copy.ts`), and finding and reading the To and Cc fields (`recipients.ts`). |
| `src/control/run-control.ts` | One run's pause state, which every step loop checks before it acts. |
| `src/action-log/text-log.ts` | The action log file, written from the task store. |
| `src/worker/` | One step: the prompt, the action names (`actions.ts`), the narrowed output schema, validation, and the one retry. |
| `src/gui/` | `gui_act` (`gui-act.ts`): one attempt's step loop, with the Mac app seam (`mac.ts`), settling and the no-effect check (`screen.ts`), the home folder watch for files an app wrote (`file-watch.ts`), questions to the user (`questions.ts`), the copy it speaks (`copy.ts`), and the orchestrator's tool list (`orchestrator-tools.ts`). |
| `src/router/` | The lane router (`router.ts`), the app capability probe and cache (`capability.ts`), each lane's actions (`lanes.ts`), and cursors and window locks (`windows.ts`). |
| `src/schema/bundle.ts` | Turns a protocol type into one self-contained JSON Schema. |
| `src/harness.ts` | Opens the task store, starts the RPC server with the history methods, and sends status changes as events. |
| `src/planner/` | The planner prompt (`prompt.ts`), the plan checks (`check.ts`), `makePlan` with its one retry (`planner.ts`), and the spoken summary (`summary.ts`). |
| `src/scheduler/` | `runTask` and `continueTask` (`run-task.ts`), the scheduler (`scheduler.ts`), one subtask's step loop (`subtask-runner.ts`), the worker input (`worker-input.ts`), the structured result and what was finished so far (`result.ts`), the route and lane seams (`lanes.ts`), the ghost and main lanes through `gui_act` (`gui-lane.ts`), startup recovery (`recovery.ts`), and starting, resuming, and cancelling tasks (`task-control.ts`). |
| `src/store/task-store.ts` | The task store: the only module with SQL. Tasks, subtasks, steps, screenshots, the action log, history queries, window locks, and app capabilities. |
| `src/store/migrations.ts` | The database schema as ordered migrations, and the triggers that refuse deletes. |
| `src/store/transitions.ts` | The allowed task and subtask status changes. |
| `src/rpc/server.ts` | The local JSON-RPC server for the Mac app. |
| `src/rpc/history.ts` | The `listTasks`, `searchTasks`, and `getTask` methods. |
| `src/rpc/tasks.ts` | The `pause`, `resumeTask`, and `cancelTask` methods. `resumeTask` also answers "Keep going" on an open blocked-action card. |
| `src/rpc/confirmation.ts` | The `submitGoal` and `replyToConfirmation` methods. |
| `src/confirm/` | The goal confirmation loop (`confirmation.ts`), the repeat-back prompt and checks (`restate.ts`), and reading the user's answer (`classify.ts`). A goal sent with `autoMode` skips the loop and starts in `planning` with the trimmed transcript as `confirmedGoal` (SPEC-01 r14). |
| `src/errors.ts` | Maps failures to the protocol's `UserError` kinds. Never builds user-facing text. |
| `src/log.ts` | The local log file. |
| `src/debug/` | Debug mode (OBJ-52): the detailed debug log and its retention (`debug-log.ts`), keeping password text out of it (`scrub.ts`), the words of each `workerThought` (`thoughts.ts`), and what each subtask's step loop writes and sends, shared by the helper runner and `gui_act` (`trail.ts`). |
| `src/rpc/debug.ts` | The `setDebugMode` method. |
| `scripts/model-check.ts` | Checks the harness against the real model server. |
| `scripts/gui-run.ts` | Runs one `gui_act` subtask on the real Mac app and model, several times, and prints each run's steps and time. |
| `scripts/check-grammar.py` | Checks that the output schema compiles as mlx-vlm's grammar, without loading a model. |
| `test/` | Tests, with a mock model server that answers like mlx-vlm 0.7.6. |

## Commands

Run from `harness/` after `npm install` here and in `protocol/`.

| Command | What it does |
|---|---|
| `npm start` | Starts the harness. |
| `npm test` | Runs every test. The model server is mocked; the RPC tests also start the protocol's mock Mac app. |
| `npm run typecheck` | Type-checks the package. |
| `npm run lint` | ESLint. |
| `npm run format` / `npm run format:check` | Prettier. Markdown is not formatted. |
| `npm run verify` | Typecheck, lint, format check, and tests. Run it before every commit that touches `harness/`. |
| `npm run model:check` | Sends the protocol's example step to the real model server and prints the validated action. See below. |
| `npm run gui:run -- --app Keynote --instruction "..." --runs 5 --first 41` | Runs a GUI subtask on the real Mac app and model server. `{run}` in the instruction becomes the run number, counting from `--first`. Start the model server, then this, then the Mac app (see "gui_act"). |

## Configuration

Environment variables, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `YUMI_SUPPORT_DIR` | `~/Library/Application Support/Yumi` | Folder for `harness.sock`, `harness.log`, and the task store. Set it to run a second harness, or for tests, which never use the real folder. Keep it short: a socket path must fit in 104 bytes. |
| `YUMI_MODEL_BASE_URL` | `http://127.0.0.1:8080/v1` | The model server's OpenAI-compatible API. |
| `YUMI_MODEL` | `mlx-community/Qwen3.5-9B-4bit` | Model name sent with every request. |
| `YUMI_MODEL_TIMEOUT_MS` | `120000` | Give up on one model request after this long. |
| `YUMI_MODEL_LOAD_TIMEOUT_MS` | `150000` | How long the model server may take to start answering before the model state is `failed` (OBJ-47). |
| `YUMI_MODEL_MAX_TOKENS` | `1024` | Most tokens per reply. |
| `YUMI_MODEL_STRUCTURED_OUTPUT` | on | `0` stops sending `response_format`. Replies are validated either way. |
| `YUMI_MODEL_PARALLEL_SLOTS` | `3` | How many subtasks run at the same time, each as its own request. Start the model server with `--max-num-seqs` set to the same number. |
| `YUMI_STEPS_PER_SUBTASK` | `25` | Steps per subtask, across attempts and restarts, before it fails with `taskTookTooLong` (SPEC-02 r8). |
| `YUMI_ATTEMPTS_PER_SUBTASK` | `3` | Attempts per subtask, from 1 to 3 (`Subtask.attempts` allows at most 3). |
| `YUMI_SUBTASK_DEPTH` | `1` | How deep subtasks may nest. 1: only the planner makes subtasks. |
| `YUMI_CURSOR_CAP` | `3` | Visible cursors at once, including `main` (SPEC-03 r6). More ghost and main subtasks queue. |
| `YUMI_DEBUG_MODE` | on | `0` starts with Debug mode off. The Mac app's setting, sent with `setDebugMode` after every hello, wins. See "Debug mode" below. |

Sampling uses the Qwen3.5 model card's instruct settings (temperature 0.7, top_p 0.8, top_k 20), with thinking off.

## The local model server

The harness talks to [mlx-vlm](https://github.com/Blaizzy/mlx-vlm)'s OpenAI-compatible server running Qwen3.5-9B at 4-bit.
mlx-vlm handles Qwen3.5's vision input, and it supports schema-constrained output through `response_format`.
The commands below were checked against mlx-vlm 0.7.6's own documentation and source.

**Memory:** the model is about 5.6 GB on disk, and the server needs more while it runs.
On a 16 GB Mac, run only one model server at a time.

1. Install mlx-vlm in a Python virtual environment (Python 3.10 or later):

   ```sh
   python3 -m venv ~/.venvs/yumi-model
   ~/.venvs/yumi-model/bin/pip install mlx-vlm==0.7.6
   ```

2. Start the server with the model:

   ```sh
   ~/.venvs/yumi-model/bin/mlx_vlm.server --model mlx-community/Qwen3.5-9B-4bit --host 127.0.0.1 --port 8080
   ```

   The model file is the Hugging Face repository `mlx-community/Qwen3.5-9B-4bit`.
   If it is not in `~/.cache/huggingface` yet, the server downloads it the first time it loads.
   `--host 127.0.0.1` keeps the server on this Mac; mlx-vlm listens on every network interface (`0.0.0.0`) by default.
   Thinking stays off unless you pass `--enable-thinking`, and the harness also turns it off per request.

3. Check that it is up:

   ```sh
   curl http://127.0.0.1:8080/health
   ```

   It answers `{"status":"healthy","loaded_model":...}`.

4. Check that the harness gets a validated action back:

   ```sh
   npm run model:check
   ```

   It sends the protocol's example Keynote step and prints the validated action and the attempts.

5. Check that vision works with this server: send any screenshot and check that the description matches it.

   ```sh
   npm run model:check -- --image ~/Desktop/screenshot.png
   ```

   The model reads the image as a base64 data URL in an OpenAI `image_url` content part, which is how the harness sends screenshots.

To check that a changed output schema still compiles as mlx-vlm's grammar, without loading a model, use the server's Python:

```sh
npm run --silent model:check -- --print-schema | ~/.venvs/yumi-model/bin/python scripts/check-grammar.py
```

mlx-vlm 0.7.6 compiles schemas with llguidance 1.9.1, which rejects `uniqueItems`, so the harness removes that keyword from the schema it sends.

### Model readiness

The harness tells the Mac app whether the model is ready ([OBJ-47](../objectives/OBJ-47-harness-model-readiness.md), `src/model/readiness.ts`), so the status line says "Yumi is getting ready" instead of looking frozen while the model loads.
mlx-vlm started with `--model` loads the model before it accepts connections, so while it loads, `/health` does not answer at all.
- `loading`: from the start, and again whenever `/health` stops answering, until it names the configured model.
- `ready`: `/health` names the configured model (or a local path that ends in it, or none, for a server started without `--model`).
- `failed`: nothing answered within `YUMI_MODEL_LOAD_TIMEOUT_MS`, or the server serves another model. The app shows SPEC-11 "Model failed to load".

It checks every second while loading or failed and every 3 seconds while ready, and at once when a model request finds the server unreachable, so a server restarted during a demo is noticed.
A slow `/health` answer while the model is busy changes nothing.
The state goes to the app in the `hello` answer (`HelloResult.modelState`) and every change as `modelStateChanged`.
It keeps checking after `failed`, so a server started late still ends in `ready`.

## Device bridge

- The harness starts the bridge client after the Mac app completes `hello`; device keys are stored through the Mac app Keychain RPC, and paired devices/outbox state is stored in `bridge.sqlite` in the support folder.
- Set `YUMI_BRIDGE_URL` to override the default `wss://yumibridge.studiokova.co` endpoint.
- This Mac's bridge device id goes to the app in `hello` (once the keys are loaded) and in every `bridgeStateChanged` ([OBJ-64](../objectives/OBJ-64-cross-device-local-rpc-contract.md)). New action log lines name this Mac by it; `mac-local`, the id used before, still reads as this Mac (`src/device.ts`).

### Goals from the phone

`src/bridge-client/delegated-goals.ts` runs goals the paired phone sends ([SPEC-09](../specs/09-cross-device-routing.md) r4 to r9, [OBJ-68](../objectives/OBJ-68-harness-delegated-goals.md)).

- `delegateGoal` creates the task with the goal id as its id and the phone as its origin, straight in `planning` with no repeat-back, spawns the main cursor, and answers `goalAccepted` (`started`).
  The same goal sent again, even at the same moment, is answered again, not run twice.
- While another task works, the goal waits as `queued`, answered `goalAccepted` (`queued`) with that task's current title, and starts when it ends ([OBJ-77](../objectives/OBJ-77-harness-cross-device-edge-cases.md), r14).
- While the screen is locked, as the Mac app reads it with `getScreenLock`, the goal is held and answered `waitingForUnlock`; it starts by itself once the user unlocks the Mac, and a `cancel` before then drops it ([OBJ-80](../objectives/OBJ-80-harness-wake-and-lock.md), r20).
  The harness never reads, stores, or types a password.
- `progress` goes to the phone on every task and subtask status change, after `goalAccepted`, and every 25 seconds until the task ends. Its title is the subtask in progress, or "Making a plan" while planning.
- `goalFinished` carries the summary, the failure in SPEC-11 words without the Mac's buttons with its `error` kind, or "Okay, I stopped. Nothing else will happen."
  None of it is spoken or shown on the Mac.
  Anything said while the task still runs (a blocked action, a question) stays on the Mac.
- `pause`, `resume`, and `cancel` act only on the sending phone's own goals.
  `pauseConfirmed`, `resumeConfirmed`, and `cancelConfirmed` are sent once the change is in effect, and `ping` is answered with `pingResult`.
  A command the harness refuses, such as control of a goal the phone did not send, gets no result, only the ack: the protocol has no result for it, and the phone's own timeout covers it.
- Approvals for a phone goal are asked on the phone (`src/bridge-client/phone-approvals.ts`, [OBJ-70](../objectives/OBJ-70-harness-phone-approvals-and-stop.md), r10): an `approvalRequest` command, answered by the phone's `approvalResponse` result.
  The Mac app gets `approvalWaitingElsewhere` and shows only a banner, then `approvalAnsweredElsewhere`.
  A delete answered by voice is asked again.
  With no answer by `expiresAt`, 5 minutes after asking, the approval closes, `approvalCancelled` goes to the phone and the app, and the task pauses, for a goal from the Mac too ([OBJ-77](../objectives/OBJ-77-harness-cross-device-edge-cases.md)).
- Tests: `test/delegated-goals.test.ts` and `test/cross-device.test.ts`, with a scripted phone (`test/support/scripted-phone.ts`) on the fake relay; `test/support/phone-run.ts` wires a whole harness to it as `src/main.ts` does.

### The phone's tools

`src/bridge-client/phone-tools.ts` gives the planner the paired phone's tools ([OBJ-65](../objectives/OBJ-65-harness-phone-tool-lane.md), SPEC-09 r1, r2, r16).

- The harness keeps each paired phone's latest `toolList` and answers it with this Mac's own, which carries its `wakeAddresses` ([OBJ-80](../objectives/OBJ-80-harness-wake-and-lock.md), r19); each paired device also gets it on every relay connection.
  The phone never answers the Mac's list, so the two never loop.
- While a phone list is known, the helper lane offers the phone's tools as one `phone` tool, described from that list.
- A call goes through the permission gate, waits at most 2 minutes, and is never queued.
  When the relay answers `targetOffline` it fails at once: the app shows the "Other device offline" error, and the worker reads that it should not call the phone again ([OBJ-77](../objectives/OBJ-77-harness-cross-device-edge-cases.md)).
- The action log names the phone as the device, for example "Set an alarm for 6:30 am on your phone".

## Local RPC

- The harness listens on `harness.sock` in the support folder, readable only by this user, and replaces a stale socket left by a crash.
- It refuses to start if another harness is already listening.
- The Mac app calls `hello` with the protocol version first. Events go only to connections that said hello.
- Build and test the Mac side against it with the protocol's mock Mac app: `npm start` here, then `npm run mock:mac` in `protocol/`.
- `answerQuestion` delivers the user's answer to a `gui_act` question (`questionAsked`). An answer nobody is waiting for, such as a late one after a pause, answers the `unexpected` kind.

## Task store

The task store is the single source of truth for long-running work ([SPEC-02](../specs/02-task-lifecycle.md)).
Everything is kept forever (SPEC-02 r10): no code deletes tasks, subtasks, steps, action log lines, or screenshots, and database triggers refuse it.

### On-disk layout

Everything is in the support folder (`YUMI_SUPPORT_DIR`), readable only by this user:

| Path | What it is |
|---|---|
| `tasks.db` | The SQLite database, in WAL mode with full sync. `tasks.db-wal` and `tasks.db-shm` sit next to it while it is open. |
| `screenshots/<task id>/<step id>.png` | Step screenshots (`.jpg` for JPEG). `Step.screenshotPath` holds the absolute path. A file is never replaced. |
| `Action log/<yyyy-mm-dd>.txt` | The action log file, one per day (see "Action log" below). |
| `harness.sock`, `harness.log` | The local RPC socket and the log. |
| `Debug log/<yyyy-mm-dd>.jsonl` | The detailed debug log, one file a day, only while Debug mode is on, deleted after 7 days (see "Debug mode"). |

| Table | Holds |
|---|---|
| `tasks` | One row per `Task`. `plan` is a JSON array of subtask ids. `created_ms` orders history. |
| `subtasks` | One row per `Subtask`, with its `position` in the plan. Nested values are JSON. |
| `steps` | One row per `Step`, with `outcome` and `duration_ms` NULL until the action finished. |
| `action_log` | One row per `ActionLogEntry`, with the step it came from. Append-only. |
| `approvals` | One row per `Approval`, as JSON with its decision, and `closed` once it can never be used again: used, declined, changed, or cancelled. |
| `window_locks` | One row per locked window, with its expiry. Working state: replaced and released. |
| `app_capabilities` | One row per app and version probed. Working state: replaced. |

`PRAGMA user_version` is the number of migrations applied.
Migrations live in `src/store/migrations.ts`; add new ones at the end and never edit one that has shipped.
A harness refuses a database written by a newer harness.

### Rules the store enforces

- Every record is checked against the protocol schema before it is written.
- Status changes follow `src/store/transitions.ts`.
  An illegal change, including a change to the status a record already has, is logged as `store.illegalTransition` and refused with `IllegalTransitionError`.
- Every accepted status change, including a new task's or subtask's first status, emits exactly one `taskStatusChanged` event, after it is committed.
- Checkpointing (SPEC-02 r3): `beginStep` commits the step with no outcome before the action runs, and `finishStep` writes the outcome, observation, and duration after it.
  A subtask must be `running` to begin a step, and its previous step must have finished.
- `finishStep` writes the action log line in the same transaction, for every outcome except `invalidOutput`, which ran nothing.
- `listUnfinishedSteps` returns the steps a crash interrupted.
- A subtask added with `parentSubtaskId` is refused with the rule `subtaskDepth` when it would nest deeper than the depth limit, which with the default of 1 is always.
- `tasks.interrupted` marks a task a restart paused, until it leaves paused (`listInterruptedTasks`). It is not part of the protocol's `Task`.

### History

`listTasks` and `searchTasks` answer newest first, 50 tasks by default.
Both leave out tasks the user cancelled before confirming them; their records are kept.
Search matches tasks whose goal, confirmed goal, summary, or subtask titles contain every word of the query, ignoring case and accents.
`getTask` returns the task with its subtasks, steps, and action log.

## Lane router

The router picks each subtask's lane ([SPEC-03](../specs/03-lane-routing.md)): `route(subtask, proposed)` in `src/router/router.ts`.
The planner's proposal is only logged; the router picks the cheapest lane that passes every check.

- The app is the subtask's `target`, or the planner's `targetApp`; a name is resolved to a bundle id with the Mac app's `resolveApp` (Launch Services, as `open_app` does) and stored as `target`. A name no installed app has fails routing with `unsupportedRequest`.
- No target app: `helper`, reason `noUI`.
- A subtask the planner marked `needsKeyboard`: `main`, reason `needsKeyboard`, without probing the app (SPEC-03 r17).
- A target app with an actionable accessibility tree or the DevTools protocol: `ghost`, reason `backgroundCapable`.
- Any other target app: `main`, reason `appNotBackgroundCapable`.

It stores the lane and reason on the subtask, logs `router.decided` with the proposal, and sends the `routeDecided` event.
App capability comes from the Mac app's `probeAppCapability`, stored in `app_capabilities` per bundle id and version.
Before probing, the router reads the installed version with `getAppVersion` and reuses the stored result for that version, so an app is probed again only after it updates.
If the Mac app cannot answer `getAppVersion` (an older app answers "method not found"), each app is probed once per harness run.
A failed probe is not cached: `route` rejects with `ProbeFailure`, which carries the SPEC-11 `UserError`, and nothing is stored or sent.

Only `main` gets keystrokes (`type`, `key`); a ghost sets text with `setValue`, and a helper gets no UI actions (`src/router/lanes.ts`).
`runWorkerStep` takes the subtask's lane, and the schema, the prompt, and the validation offer and accept only that lane's actions.

### Window locks, busy windows, and the cursor cap

After the lane, a ghost or main subtask claims a cursor and a window from the `WindowCoordinator` (`src/router/windows.ts`, SPEC-03 r5, r6, r11 to r13).
Claims run one at a time.

1. **Cursor cap:** every ghost is a cursor, and `main` is one more, of which there is only one. With `YUMI_CURSOR_CAP` cursors visible (3), or `main` busy, the subtask is queued with reason `atCapacity`.
2. **Window:** the window the subtask worked in before, else the app's first window from `listWindows`, else a window another subtask of the task worked in. The first one no other cursor holds is locked, and stored on the subtask as `target.windowId`.
3. **Busy window:** if every one is held, the Mac app's `openNewWindow` opens a new window and the subtask works there, reason `openedSecondWindow`. If the app cannot, the subtask is queued with reason `windowLocked`, and `openNewWindow` is not asked again while it waits.
4. **Waiting notice:** after 2 minutes waiting, for a window or for a free cursor, the apps get `waitingForWindow` with the task, the subtask, its title, and the app name, once per wait. The Mac app says the sentence.
5. **Tiling:** when a task holds more windows at once than before, and at least 2, the apps get `tilingSuggested` with those windows. The Mac app asks before it arranges them (OBJ-20).

A queued decision is stored and sent as `routeDecided` like any other.
The scheduler sets the subtask to `queued`, gives its model slot back while it waits, and routes it again whenever a cursor finishes or a lock is released or expires.
A pause puts a waiting subtask back to `ready`; another subtask's failure fails it.

Locks live in the task store with an expiry (60 seconds), and the coordinator renews the locks of working cursors every 20 seconds.
`acquireWindowLock` takes a window in one transaction and refuses one another subtask holds, unless that lock expired, so even two connections to the database never share a window.
A lock is released in the same transaction as any status change that ends the subtask's work (anything but `running` and `needsApproval`), when its run ends, or when it expires, and startup recovery releases every lock left in the store.
An app with no window that cannot open one gets the cursor without a lock (`windows.noWindow` in the log); the lane opens the app itself.

## Safety

Every action goes through `checkAction(action, { home, app })` in `src/safety/gate.ts` before it runs ([SPEC-07](../specs/07-safety.md)).
It returns the level (`allowed`, `ask`, or `blocked`), the rule that decided it, and the `RecordedAction` with the level stored on it.
Only `allowed` may run without the user; `ask` goes through the approval flow below, and `blocked` never runs.

- The gate reads only the resolved action, the app the Mac app reported, and the real file system. It never reads model text.
- The rules are data in `src/safety/rules.ts`. A rule changes only with a change to SPEC-07.
- Paths are resolved through `..` and every symlink before the check, and names are compared without regard to case, as on a default Mac volume.
- The file tools never replace a file: a taken name gets a number ("Report.pdf" becomes "Report 2.pdf").
- There is no shell, AppleScript, or edit tool, and a test fails if the harness ever imports `child_process` or mentions `osascript`.

## Approvals and blocked actions

`ApprovalFlow` in `src/approvals/approval-flow.ts` implements the `ApprovalGate` seam that step loops call when the gate does not allow an action ([OBJ-38](../objectives/OBJ-38-approvals-pause-and-action-log.md)): the helper lane's tool steps now, and the `gui_act` step loop ([OBJ-36](../objectives/OBJ-36-gui-act-sub-agent.md)) for a Send button or key.

- **`request(decision, context, signal)`** for an `ask`:
  1. Builds the approval from real data only: for a send, the To and Cc fields read with the Mac app's `readFieldValues`; for a delete, the file list from `checkTrash` on the real file system. Never from model text.
  2. Writes the `Approval` to the store, sets the subtask to `needsApproval` and the task to `waitingForUser`, and calls `showApprovalCard`.
  3. A delete counts as approved only with `method: tap` (SPEC-07 r11): a voice "yes" shows the same card again. A send may be approved by a tap or by "send it" (`method: voice`, r15). An `action` approval is tap-only too (OBJ-38.11).
  4. Right before the action, it reads the recipients or lists the files again, comparing each file's identity, size, and modification time. If anything changed, it closes the approval as `changed` and asks again with what is there now (r12, r14).
  5. Closes the approval as `used` and returns `approved`: one approval covers exactly one action, once.
- Sends, `move_to_trash` deletes, and unclassified risky clicks and key presses have a card. A send needs the step loop to pass the window and the element paths of its To and Cc fields (`findRecipientFields` finds them in the tree by role and label); Mail and Messages are the apps whose recipients it reads.
- **The card text** is in `src/approvals/copy.ts`, from SPEC-07 r13, the "Strict delete" scenario, and the SPEC-07 "Draft copy" table, which is still a draft for Patrick's review: "I'm about to send this email to Ana. Should I send it?", "with a copy to ...", "this message" for Messages, "Ana, Ben, and 3 others", and the one-file, one-folder, and several-folder delete forms.
- **Unclassified risky actions** (OBJ-38.11): a click or key press the gate rules `unclassified` gets an `action` card worded from the resolved action, "I'm about to click Archive in Mail. Should I allow it?" (`actionText` in `src/approvals/copy.ts`). Right before it runs, the flow looks at the window again; if the app changed or the clicked element is gone or different, nothing runs (`actionChanged`).
- **`move_to_trash`** is offered on the helper lane and only ever runs through the approval: the harness calls the Mac app's `moveToTrash` with exactly the approved, re-checked paths, and the log line lists every path that moved.
- **`blocked(context, signal)`** for a `blocked` action: the step is already recorded as `blocked` and never runs. It sends a `userError` of kind `blockedAction`, with `skippedAction` naming what was skipped (`describeSkipped`: "click File in Keynote", from the step's action and the app, never model or typed text), sets the task to `waitingForUser`, and waits. "Keep going" (`resumeTask`) carries on; "Stop" (`cancelTask`) cancels the task.
- Approval timeouts (5 minutes) and approvals on the other device are SPEC-09 and not built: `expiresAt` is written but nothing acts on it.

## Pause and cancel

`TaskControl` in `src/scheduler/task-control.ts` is the one place tasks pause, resume, and cancel ([SPEC-06](../specs/06-user-control.md)).
Each run has a `RunControl` (`src/control/run-control.ts`), and every step loop calls `mayAct(lane)` right before it writes and sends an action, so nothing is sent once a pause covers its lane.

- **`pause(taskId, scope)`**, from the `pause` method. With no `taskId`, every working task pauses.
  - `everyLane` (the default: the stop shortcut, the menu bar "Stop", the blocked-action "Stop"): the whole run stops, the step in progress gets its outcome, the working subtasks go back to ready, and the task is paused.
  - `uiLanes` (the user took the mouse or keyboard): the ghost and main subtasks stop before their next action and go back to ready, no UI subtask starts, and helpers keep running. A helper that needs the user waits for the resume. While planning, it stops the planner, since nothing could keep running.
  - A `uiLanes` pause while the task waits for the user and no UI lane is acting is ignored, as a second guard behind the Mac app (SPEC-06 r2).
  - Both cancel every pending approval and blocked-action card: each open card gets `approvalCancelled`, the approval is closed as `cancelled`, a late tap is ignored, and the step is recorded as not done. After the resume, the action goes through the gate and asks again.
- **`resumeTask`** after a `uiLanes` pause, while the helpers still run, lifts the pause in the same run, and the UI subtasks carry on in the same attempt. Otherwise it works as in "Resume and limits" below.
- **`cancelTask`** stops every lane, helpers included, cancels every open approval and card, fails every subtask that had started ("Cancelled before it finished.") and drops every one that had not ("Cancelled before it started."), and sets the task to cancelled. Nothing runs after it.
- A task the user took over can end while paused: helpers may finish or fail it.

## Action log

Every action that ran, was blocked, or was declined has an `ActionLogEntry` in the task store, written with its step's outcome ([SPEC-07](../specs/07-safety.md) r18).
Each line is also written, as it is committed, to the action log file in the support folder:

```
~/Library/Application Support/Yumi/Action log/2026-10-09.txt
```

One file a day, in local time, with lines like these:

```
3:42 pm, Mac, main cursor: Clicked Export in Keynote
3:43 pm, Mac, helper: Moved 2 files from Downloads to the Trash
    /Users/ana/Downloads/old-invoice.pdf
    /Users/ana/Downloads/old-receipt.pdf
3:44 pm, Mac, task done ("export the deck as a PDF"): Read 3 files and clicked 12 times
```

- Lines say the time (am/pm), the device ("Mac" or "phone"), the lane ("helper", "ghost cursor", "main cursor"), and what happened in plain language. A delete lists every path on its own line.
- When a task ends, a count line says what it did, counting only actions that ran: "Read 3 files and clicked 12 times".
- Descriptions never contain text Yumi typed or set (`src/scheduler/describe.ts`), so a password never reaches the log (SPEC-07 r20). `describeGuiAction` is the line for a UI action, a direct tool, or a question in `gui_act`.

## Planner and scheduler

`runTask(taskId, deps)` in `src/scheduler/run-task.ts` carries a confirmed task from `planning` to `done` ([SPEC-02](../specs/02-task-lifecycle.md) r1, r5, r7, r9).

1. **Plan.** The planner sees the confirmed goal and the tool list, never the screen, and returns a protocol `Plan`.
   The harness rejects schema errors, repeated or unknown ids, dependency cycles, and more than 12 subtasks, and asks the planner once to fix a broken plan.
   A second broken plan fails the task with the `unexpected` error before anything runs.
2. **Save.** `TaskStore.savePlan` adds every subtask and moves the task to `running` in one transaction.
3. **Schedule.** A subtask is `ready` when everything it depends on is `done`.
   Ready subtasks run at the same time, up to `YUMI_MODEL_PARALLEL_SLOTS`, each routed by the lane router first (`routeWith(harness.router)`).
   A subtask whose app the router cannot check fails with the probe's error.
   If one fails, the others are stopped and the task fails; there is no replanning yet.
4. **Work.** Every action goes through `checkAction` before it runs, and the step is written with the gate's level.
   `allowed` runs, `ask` runs only once the approval flow approved it, and `blocked` never runs (see "Approvals and blocked actions").
   The helper lane's tools are OBJ-37's typed file tools and `move_to_trash` (`fileHelperLane` in `src/scheduler/lanes.ts`).
   Each step's worker input is exactly the confirmed goal, the subtask instruction, the subtask's last 5 finished steps, a fresh observation, and the lane's tools.
   Each recent step carries one line on what happened and, for a tool, what the tool returned (`toolOutput`, at most 4000 characters, cut with a note).
   A helper has no window, so its observation is empty.
   Workers never see each other's steps, so the planner is told to pass work between subtasks through files named in both instructions.
5. **Result.** Each subtask stores a `SubtaskResult`: done or stuck from the worker's `finish`, the real paths its tools created or changed, and a note of at most 200 characters.
6. **Summary.** The model writes one or two sentences from the goal and the results, retried once.
   The task is set to `done` with the summary, and the summary is sent as a `speak` event.
   When the task only listed folders, the `speak` event also carries the full list (`FoundList`), built from `list_dir`'s real output, for the Mac's summary card.

### Lists in a new note

A goal that asks for a list ends its repeat-back with "Want it in a note too?" instead of "Should I go ahead?" (SPEC-02 r13, [OBJ-74](../objectives/OBJ-74-save-list-to-note.md)).

- The question is about the note, so a yes ("yes", "sure", "yes, in a note") goes ahead with the note; "no", "no thanks", "just list them", or the Go ahead button goes ahead without it. Other answers go to the model with a fifth answer, `confirmWithNote`. The choice is kept on the task (`list_to_note`, harness-only).
- Once the listing is done, `runPlan` adds one main-lane subtask in Notes (`src/planner/list-note.ts`): press cmd+n, then type the note in one `type` action. The worker types the placeholder `NOTE_TEXT`, and `gui_act` types the list the harness found in its place, title first, so the model never writes the list out.
- The summary is the answer's first sentence, then "I put the full list in a new note called {title}."
- In Auto mode there is no question: the task is marked for a note when it starts, and the note is written whenever the task finds a list (SPEC-02 r13, Brent's decision 2026-10-10).
- `saveListToNote` (the card's "Save to Notes", or "save it") starts a short follow-up task with only the note subtask: no repeat-back, no planner, and a fixed summary.

Ghost and main subtasks run through `gui_act` (below), unless a test gives the lane its own runner; helpers run the step loop in `subtask-runner.ts`.
The planner names the app a UI subtask works in (`targetApp`); file work names none and runs as a helper.
The confirmation flow (`src/confirm/`) starts it through `harness.tasks.start`, after the user confirms or, in Auto mode, right away.

## Resume and limits

Resume never starts on its own: the user is always asked first ([SPEC-02](../specs/02-task-lifecycle.md) r4).

- **Startup recovery** (`src/scheduler/recovery.ts`) runs when the harness starts, before the socket opens.
  A step with no outcome is finished as `noEffect`, with an action log line such as "Started to create Note 4.md, but was interrupted before it finished".
  A task that was planning, running, or waiting for the user is paused and marked interrupted.
  An approval still open is closed as cancelled, so a resume asks again.
  The subtasks of every paused task that were running, waiting for approval, or queued go back to `ready`, keeping their attempts, and every window lock left in the store is released.
- **Asking:** each time an app says hello, the harness sends one `interruptedTaskFound` per interrupted task, so the app asks "I was interrupted while working on your task. Want me to pick up where I left off?"
  A task the user paused is not announced: `listTasks` returns it as `paused`, and the app shows Resume.
- **`resumeTask`** sets a paused task back to `running` (or `planning` when it had no plan yet) and carries on in the background.
  Done subtasks stay done, no recorded step runs again, and each cut-off subtask goes on from its next step, with a fresh observation first, as the same attempt.
  A second resume while the task runs does nothing.
- **`cancelTask`** stops the task's work if it runs, waits for the step in progress to get its outcome, fails every subtask that had started ("Cancelled before it finished.") and every one that had not ("Cancelled before it started."), and sets the task to `cancelled` (see "Pause and cancel").
  Cancelling a task that already ended does nothing.
- A request about an unknown task, or a resume of a task that is not paused, answers the `unexpected` kind, with the reason in the log as `task.refused`.
- `startHarness` runs tasks only when given `work` (the model client, lanes, device id, home folder, and slots); without it, tasks can be cancelled but not started or resumed.
  `src/main.ts` does not pass it yet, because the harness learns its device id only after pairing; OBJ-17 wires it with `runTask`.
- **Limits** come from the configuration (`Limits` in `src/config.ts`):
  - Steps per subtask (25): every step counts, across attempts and restarts. At the limit the subtask fails and the user gets `taskTookTooLong` with `finishedSoFar`: the titles of the finished subtasks, then what the stopped subtask did that worked, one line each, at most 500 characters.
  - Attempts per subtask (3): starting a subtask starts an attempt; a resume carries on the attempt it cut off. A subtask whose attempts are used up fails before it is routed, with `stepFailed` naming it.
  - Subtask depth (1): the task store refuses a subtask made from inside a subtask.

## gui_act

`guiAct(subtaskId, deps, options)` in `src/gui/gui-act.ts` is one attempt at a ghost or main subtask ([SPEC-05](../specs/05-mac-gui-control.md)).
The orchestrator never looks at the screen: it gets back a `SubtaskResult`, never a transcript.

### The orchestrator's tools

The planner is offered at most 8 tools (SPEC-05 r9, `src/gui/orchestrator-tools.ts`), and a test fails past 8:

`gui_act`, `read_file`, `list_dir`, `write_new_file`, `copy`, `move`, `move_to_trash`, `phone`.

`open_app`, `open_file`, `open_url`, and `reveal_in_finder` live inside `gui_act`, as the direct tools its worker is offered first.
`phone` is offered only while a paired phone's tool list is known.
`gui_act` takes the subtask: its instruction and target come from the task record.

### One attempt

1. Count the attempt on the subtask (a resume carries on the one it cut off), spawn the lane's cursor (`main`, or the ghost's worker id with the subtask title), and look at the target window.
   If the app has no window to read, open it with `open_app` first, as a step of its own.
2. Each step: stop if the subtask's signal aborted or `RunControl.mayAct(lane)` is false (a cancel, a pause, or a take-over), the attempt has run 10 steps (`partial`), or the subtask 25 (`taskTookTooLong`).
3. Build the worker input with the OBJ-05 builder and the direct tools, set the cursor to thinking, and call the model with the step's schema for constrained decoding. An invalid reply is retried once.
4. `finish` ends the attempt. Its status is checked against the step log: `done` after an attempt in which no action worked is `stuck`; `done` before any action stays `done`.
5. An action that would fill a password field (setting it, typing while it has focus, or clicking it) never runs: the user is asked to type the password, with the SPEC-07 draft copy. So is any `ask` while a password field is on screen; other questions are the model's own.
   A question is a step: the subtask waits for the user the way an approval does (`RunControl.setWaiting`, task `waitingForUser`), so a take-over `pause` while the user types is ignored; the `questionAsked` event goes out, and the answer from `answerQuestion` goes into the step's observation for the next step.
6. Otherwise resolve the element, check the action with the gate, check `mayAct` once more, and write the step row before anything runs.
   - `blocked`: recorded as not done, then `approvals.blocked`; "Keep going" goes on, anything else ends the attempt.
   - `ask`: `approvals.request`, with the To and Cc fields from `findRecipientFields` for a send. Only `approved` runs; a no or an unavailable approval is recorded as not done, and the model reads why.
7. Run it through the Mac app's `executeAction` with the lane's cursor, which the Mac app moves to the element first. Then look again until two looks 500 ms apart match (at most 5 seconds), so a closing sheet is not shown as the current screen.
8. The outcome: a UI action that left the trimmed tree and the window title as they were is `noEffect`, unless a file appeared; so is an accessibility error from the Mac app, with its reason. A direct tool is judged by the Mac app's answer.
   The step's line says what the Mac app did, what changed, why nothing changed (for example "clicking a text field only puts the cursor in it. Use setValue to fill it."), and any file that appeared ("New file: Q3 Report.pdf.").
9. 3 `noEffect` in a row end the attempt with `stuck` and `stuckOnScreen`; 2 invalid replies in a row end it with `stuck`. The result carries both streaks for OBJ-09's handoff, which is not built yet, so a ghost ends the same way as main.

Action log lines come from `describeGuiAction` and `describeNotDone` (`src/scheduler/describe.ts`).
The result's note is the harness's own words ("Done in 6 steps.", "Stopped after 10 steps without finishing, with a sheet in front."), never model or screen text.
Its files are the files written in the home folder during the attempt (below).

Element paths are a stand-in (`#3`): the observation carries no paths, and the Mac app resolves numbers itself for `executeAction`.
`readFieldValues` cannot resolve them, so until the Mac app returns paths (OBJ-39, "Protocol asks"), a send's recipients cannot be read and the send is not run.

### What the scheduler does with it

`runGuiSubtask` (`src/scheduler/gui-lane.ts`) calls `gui_act` again after a `partial` attempt, up to 3 attempts and 25 steps, and keeps the files of every attempt.
`done` finishes the subtask; anything else fails it with the attempt's error, or "Couldn't finish a step".
A take-over sends the subtask back to `ready` with its attempt, and Resume carries on with the same attempt (OBJ-38).

### Files an app wrote

A PDF exported through Keynote's menus is in no tool call, so `gui_act` watches the home folder for the length of the attempt with recursive `fs.watch` (FSEvents).
It reports files written after the attempt began that still exist, as `~/` paths, and collapses changes inside a document package (`.key`, `.pages`) into the package.
`~/Library`, hidden files, and hidden folders are never reported.
A watch goes live a little after it starts and events arrive a little after the write, so the watcher writes a marker file in `~/Library/Application Support/Yumi` and waits for its event before the first action and before each report.
It cannot tell who wrote a file: a download or another subtask writing at the same time is reported too.

### Running it on the real Mac

The Mac app always connects to `~/Library/Application Support/Yumi/harness.sock` and starts its own harness, which does not run tasks yet.
`npm run gui:run` starts a harness with the work it needs on that socket: start the model server, then the script, then the Mac app.
The app's own harness then exits because the socket is taken, and the app keeps retrying it; that is only noise in its log.

## Errors and the log

- The log is `harness.log` in the support folder, one JSON object per line: model errors with the server's detail and status, timing, and token counts.
  It never holds prompts, screen text, or model replies, only their sizes.
  The words are in the debug log (see "Debug mode").
- Failures that reach the user are `UserError` kinds from the protocol, with no technical detail.
  An unreachable model server is `modelFailedToLoad`; every other model failure is `unexpected`.

## Debug mode

Debug mode ([SPEC-07](../specs/07-safety.md) r22 and r23) keeps what `harness.log` leaves out, so a failed goal can be explained on the device without guessing.

- **Setting:** the Mac app sends `setDebugMode` after every hello and whenever the user changes it: on by default in Debug builds, off in release builds ([OBJ-53](../objectives/OBJ-53-mac-thoughts-panel.md)).
  Until the app says, the harness uses `YUMI_DEBUG_MODE`, which is on, because a harness run from source is a development run.
  The harness keeps no copy of the setting, so a restarted harness follows the app again after its hello.
- **Where:** `~/Library/Application Support/Yumi/Debug log/<yyyy-mm-dd>.jsonl`, one file a day in local time, readable only by you.
  It never leaves the Mac: nothing reads it back or sends it anywhere.
- **Retention:** files whose last change is more than 7 days old are deleted when the harness starts, in either mode, and again when a new day's file begins.
- **Off:** nothing is written, no folder is made, no `workerThought` is sent, and the model is not asked for its reason.
- **Passwords:** the Mac app never reads a secure field's value, and for each subtask the log learns the text of every `type` or `setValue` that could reach a password field and removes it from every line, as `[password field text removed]`.
  A reply that is not JSON while a password field is on screen is logged by length only (SPEC-07 r20).
- **Thoughts:** each step sends a `workerThought` for the thoughts panel: the subtask title, lane, cursor, a short summary of what it sees, its last action, and the model's decision and reason.
  `gui_act` steps carry the cursor they move: `main`, or the ghost's own id (its `workerId`, such as `ghost-2`), the same id as its `spawn`; a helper's carry none.
  In Debug mode the model writes a one-sentence `reason` before its action; the reason never changes what runs.

### Reading it

Each line is one JSON object with `time` (UTC) and `event`.
Every line about a task has its `taskId`, and every line about a subtask has its `subtaskId`.

| Event | What it holds |
|---|---|
| `voice.goal` | The transcript as the Mac app heard it, and the device. |
| `voice.answer` | The user's answer to the repeat-back: the spoken text as transcribed, or the button. |
| `confirm.classified`, `confirm.read` | How the answer was read: `confirm`, `cancel`, `correction`, or `unclear`, and whether by the fixed list, the model, or a failure. |
| `confirm.repeatBack` | The transcript, the corrections, and the sentence Yumi said back. |
| `confirm.confirmed`, `confirm.cancelled`, `confirm.unclear`, `confirm.ended` | How the question ended, with the `UserError` when it ended in one. |
| `model.request` | `requestId`, `purpose` (`restateGoal`, `classifyReply`, `plan`, `workerStep`, `summary`), the schema name, and every message. Images are written as their type and size. |
| `model.reply`, `model.failure` | The same `requestId` and `purpose`, then the reply's content, finish reason, tokens, and `durationMs`; or the failure kind with the server's detail. |
| `plan.made`, `plan.rejected` | The checked plan, or why the reply failed the plan checks. `gaveUp` marks the second rejection. |
| `task.planning`, `task.done`, `task.failed` | The confirmed goal; the summary; or the `UserError` the user got and, in `why`, what really happened. |
| `subtask.started`, `subtask.ended` | The subtask's instruction and lane; its outcome, result, and error. |
| `step.decided` | The step number, the full observation, what the worker sees, the action, the decision in words, and the model's reason. |
| `step.invalidOutput` | Why a worker reply was rejected. |
| `step.finished` | The step's outcome, permission, the one-line observation, the tool output, and how long it took. |

`jq` reads it well, for example `jq -c 'select(.taskId == "<id>")' "Debug log/2026-10-10.jsonl"`.

### Debugging a failed goal

1. Make sure Debug mode was on when it failed, then open today's file in `~/Library/Application Support/Yumi/Debug log/`.
2. Find the goal: search for the words you said in the `voice.goal` lines, and take its `taskId`.
3. Read that task's lines in order: `jq -c 'select(.taskId == "<id>") | {time, event}' "<file>"` gives the outline.
4. **What was heard:** `voice.goal` and `voice.answer` show the transcripts exactly. If Yumi misread your answer, `confirm.classified` shows the text and what it was read as.
5. **What the model was asked and answered:** each `model.request` has its messages; find its `model.reply` by `requestId`. A `model.failure` names why the model did not answer.
6. **Why it stopped:** `task.failed` has the error you saw and `why`. Before it, look for `plan.rejected` (the planner's reply broke the checks), `step.invalidOutput` (a worker reply was rejected twice), or `subtask.ended` with a `userError`.
7. The same task's lines in `harness.log` have the timings and the server's error detail.

## Interfaces

| With | How | What |
|---|---|---|
| [mac](../mac/README.md) | Local socket, JSON-RPC | Harness asks Mac to execute actions and capture screens; Mac sends voice input, confirmations, and user interrupts; harness sends task and cursor events |
| Local model server | HTTP, OpenAI-compatible | Planning, tool calls, GUI steps |
| [bridge](../bridge/README.md) | WebSocket over TLS | Encrypted messages to and from the phone |

## Specs

- [SPEC-02 Task lifecycle and resume](../specs/02-task-lifecycle.md)
- [SPEC-03 Lane routing and handoff](../specs/03-lane-routing.md)
- [SPEC-05 Mac GUI control](../specs/05-mac-gui-control.md) (`gui_act`)
- [SPEC-06 User control](../specs/06-user-control.md) (pause and cancel)
- [SPEC-07 Safety](../specs/07-safety.md) (permission gate, file tools, approvals, action log)
- [SPEC-08 Device bridge](../specs/08-device-bridge.md)
- Also follows [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md) for any message a user can see.

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-03](../objectives/OBJ-03-harness-skeleton.md) | Harness skeleton and local model client | Brent | done |
| [OBJ-04](../objectives/OBJ-04-task-store.md) | Task store and history | Brent | done |
| [OBJ-05](../objectives/OBJ-05-planner-and-scheduler.md) | Planner, scheduler, and task summary | Brent | done |
| [OBJ-06](../objectives/OBJ-06-resume-and-limits.md) | Resume and limits | Brent | done |
| [OBJ-07](../objectives/OBJ-07-lane-router-core.md) | Lane router core | Brent | done |
| [OBJ-08](../objectives/OBJ-08-locks-busy-windows-cap.md) | Window locks, busy windows, and cursor cap | Brent | done |
| [OBJ-09](../objectives/OBJ-09-ghost-handoff.md) | Ghost handoff | Brent | done |
| [OBJ-21](../objectives/OBJ-21-mac-bridge-client-and-pairing.md) | Mac bridge client and pairing | Jepoy | done |
| [OBJ-36](../objectives/OBJ-36-gui-act-sub-agent.md) | gui_act sub-agent | Brent | in-progress |
| [OBJ-37](../objectives/OBJ-37-permission-gate-and-file-tools.md) | Permission gate and typed file tools | Brent | done |
| [OBJ-38](../objectives/OBJ-38-approvals-pause-and-action-log.md) | Approvals, pause, and action log in the harness | Brent | in-progress |
| [OBJ-41](../objectives/OBJ-41-mac-pairing-verdict.md) | Mac pairing waits for the relay's verdict | Brent | todo |
| [OBJ-43](../objectives/OBJ-43-mac-bridge-client-version-refusal.md) | Mac bridge client recovers from a version refusal | Brent | todo |
| [OBJ-47](../objectives/OBJ-47-harness-model-readiness.md) | Harness reports whether the model is ready | Brent | todo |
| [OBJ-49](../objectives/OBJ-49-mac-bridge-test-support.md) | Mac answers ping and has bridge test hooks | Brent | todo |
| [OBJ-52](../objectives/OBJ-52-harness-debug-logs.md) | Debug mode keeps full local logs | Brent | done |
| [OBJ-57](../objectives/OBJ-57-route-classified-gui-deletes-through-strict-delete.md) | Route classified GUI delete asks through strict delete | Brent | todo |
| [OBJ-61](../objectives/OBJ-61-harness-goal-revision.md) | Harness turns an interruption into a revised goal | Brent | in-progress |
| [OBJ-63](../objectives/OBJ-63-question-answer-interruption.md) | Decide when an answer to a task question changes its goal | Brent | todo |
| [OBJ-65](../objectives/OBJ-65-harness-phone-tool-lane.md) | Phone tool lane in the harness | Brent | todo |
| [OBJ-68](../objectives/OBJ-68-harness-delegated-goals.md) | Harness runs goals sent from the phone | Brent | blocked |
| [OBJ-70](../objectives/OBJ-70-harness-phone-approvals-and-stop.md) | Harness takes approvals and Stop from the phone | Brent | todo |
| [OBJ-74](../objectives/OBJ-74-save-list-to-note.md) | Save a list into a new note | Brent | done |
| [OBJ-77](../objectives/OBJ-77-harness-cross-device-edge-cases.md) | Harness edge cases for cross-device routing | Brent | todo |
| [OBJ-80](../objectives/OBJ-80-harness-wake-and-lock.md) | Harness wake addresses and a locked Mac | Brent | todo |
<!-- generated:product-objectives:end -->
