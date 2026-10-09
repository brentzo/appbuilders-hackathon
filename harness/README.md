# Yumi Harness

The brain-side runtime on the Mac.
It runs the agent loop, owns all task state, plans goals into subtasks, routes subtasks to lanes, and talks to the local model, the Mac app, and the bridge.
The model is stateless; everything that makes Yumi feel long-running and reliable lives here.

Owner: Brent.

Status: the skeleton is built ([OBJ-03](../objectives/OBJ-03-harness-skeleton.md)): the forked agent loop, the local model client, the tool registry, output validation with one retry, the local RPC server with `hello`, `ping`, and events, and the log.
The task store is built ([OBJ-04](../objectives/OBJ-04-task-store.md)): tasks, subtasks, steps, screenshots, and the action log in SQLite, kept forever, with the history methods and the `taskStatusChanged` event.
The planner, scheduler, and task summary are built ([OBJ-05](../objectives/OBJ-05-planner-and-scheduler.md)), with every subtask running as a helper on test-only file tools until the lane router and the typed file tools land.

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
| `src/worker/` | One step: the prompt, the action names (`actions.ts`), the narrowed output schema, validation, and the one retry. |
| `src/router/` | The lane router (`router.ts`), the app capability probe and cache (`capability.ts`), and each lane's actions (`lanes.ts`). |
| `src/schema/bundle.ts` | Turns a protocol type into one self-contained JSON Schema. |
| `src/harness.ts` | Opens the task store, starts the RPC server with the history methods, and sends status changes as events. |
| `src/planner/` | The planner prompt (`prompt.ts`), the plan checks (`check.ts`), `makePlan` with its one retry (`planner.ts`), and the spoken summary (`summary.ts`). |
| `src/scheduler/` | `runTask` (`run-task.ts`), the scheduler (`scheduler.ts`), one subtask's step loop (`subtask-runner.ts`), the worker input (`worker-input.ts`), the structured result (`result.ts`), and the route and lane seams (`lanes.ts`). |
| `src/store/task-store.ts` | The task store: the only module with SQL. Tasks, subtasks, steps, screenshots, the action log, history queries, window locks, and app capabilities. |
| `src/store/migrations.ts` | The database schema as ordered migrations, and the triggers that refuse deletes. |
| `src/store/transitions.ts` | The allowed task and subtask status changes. |
| `src/rpc/server.ts` | The local JSON-RPC server for the Mac app. |
| `src/rpc/history.ts` | The `listTasks`, `searchTasks`, and `getTask` methods. |
| `src/errors.ts` | Maps failures to the protocol's `UserError` kinds. Never builds user-facing text. |
| `src/log.ts` | The local log file. |
| `scripts/model-check.ts` | Checks the harness against the real model server. |
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

## Configuration

Environment variables, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `YUMI_SUPPORT_DIR` | `~/Library/Application Support/Yumi` | Folder for `harness.sock`, `harness.log`, and the task store. Set it to run a second harness, or for tests, which never use the real folder. Keep it short: a socket path must fit in 104 bytes. |
| `YUMI_MODEL_BASE_URL` | `http://127.0.0.1:8080/v1` | The model server's OpenAI-compatible API. |
| `YUMI_MODEL` | `mlx-community/Qwen3.5-9B-4bit` | Model name sent with every request. |
| `YUMI_MODEL_TIMEOUT_MS` | `120000` | Give up on one model request after this long. |
| `YUMI_MODEL_MAX_TOKENS` | `1024` | Most tokens per reply. |
| `YUMI_MODEL_STRUCTURED_OUTPUT` | on | `0` stops sending `response_format`. Replies are validated either way. |
| `YUMI_MODEL_PARALLEL_SLOTS` | `3` | How many subtasks run at the same time, each as its own request. Start the model server with `--max-num-seqs` set to the same number. |

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

## Device bridge

- The harness starts the bridge client after the Mac app completes `hello`; device keys are stored through the Mac app Keychain RPC, and paired devices/outbox state is stored in `bridge.sqlite` in the support folder.
- Set `YUMI_BRIDGE_URL` to override the default `wss://yumibridge.studiokova.co` endpoint.

## Local RPC

- The harness listens on `harness.sock` in the support folder, readable only by this user, and replaces a stale socket left by a crash.
- It refuses to start if another harness is already listening.
- The Mac app calls `hello` with the protocol version first. Events go only to connections that said hello.
- Build and test the Mac side against it with the protocol's mock Mac app: `npm start` here, then `npm run mock:mac` in `protocol/`.

## Task store

The task store is the single source of truth for long-running work ([SPEC-02](../specs/02-task-lifecycle.md)).
Everything is kept forever (SPEC-02 r10): no code deletes tasks, subtasks, steps, action log lines, or screenshots, and database triggers refuse it.

### On-disk layout

Everything is in the support folder (`YUMI_SUPPORT_DIR`), readable only by this user:

| Path | What it is |
|---|---|
| `tasks.db` | The SQLite database, in WAL mode with full sync. `tasks.db-wal` and `tasks.db-shm` sit next to it while it is open. |
| `screenshots/<task id>/<step id>.png` | Step screenshots (`.jpg` for JPEG). `Step.screenshotPath` holds the absolute path. A file is never replaced. |
| `harness.sock`, `harness.log` | The local RPC socket and the log. |

| Table | Holds |
|---|---|
| `tasks` | One row per `Task`. `plan` is a JSON array of subtask ids. `created_ms` orders history. |
| `subtasks` | One row per `Subtask`, with its `position` in the plan. Nested values are JSON. |
| `steps` | One row per `Step`, with `outcome` and `duration_ms` NULL until the action finished. |
| `action_log` | One row per `ActionLogEntry`, with the step it came from. Append-only. |
| `window_locks` | One row per locked window. Working state: replaced and released. |
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

### History

`listTasks` and `searchTasks` answer newest first, 50 tasks by default.
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

## Safety

Every action goes through `checkAction(action, { home, app })` in `src/safety/gate.ts` before it runs ([SPEC-07](../specs/07-safety.md)).
It returns the level (`allowed`, `ask`, or `blocked`), the rule that decided it, and the `RecordedAction` with the level stored on it.
Only `allowed` may run without the user; asking and the Trash are [OBJ-38](../objectives/OBJ-38-approvals-pause-and-action-log.md).

- The gate reads only the resolved action, the app the Mac app reported, and the real file system. It never reads model text.
- The rules are data in `src/safety/rules.ts`. A rule changes only with a change to SPEC-07.
- Paths are resolved through `..` and every symlink before the check, and names are compared without regard to case, as on a default Mac volume.
- The file tools never replace a file: a taken name gets a number ("Report.pdf" becomes "Report 2.pdf").
- There is no shell, AppleScript, or edit tool, and a test fails if the harness ever imports `child_process` or mentions `osascript`.

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
   Only `allowed` runs; `ask` and `blocked` are recorded as blocked steps and not run, until approvals come with [OBJ-38](../objectives/OBJ-38-approvals-pause-and-action-log.md).
   The helper lane's tools are OBJ-37's typed file tools (`fileHelperLane` in `src/scheduler/lanes.ts`).
   Each step's worker input is exactly the confirmed goal, the subtask instruction, the subtask's last 5 finished steps, a fresh observation, and the lane's tools.
   Each recent step carries one line on what happened and, for a tool, what the tool returned (`toolOutput`, at most 4000 characters, cut with a note).
   A helper has no window, so its observation is empty.
   Workers never see each other's steps, so the planner is told to pass work between subtasks through files named in both instructions.
5. **Result.** Each subtask stores a `SubtaskResult`: done or stuck from the worker's `finish`, the real paths its tools created or changed, and a note of at most 200 characters.
6. **Summary.** The model writes one or two sentences from the goal and the results, retried once.
   The task is set to `done` with the summary, and the summary is sent as a `speak` event.

Only the helper lane has a runner so far: ghost and main come with [OBJ-36](../objectives/OBJ-36-gui-act-sub-agent.md), and a subtask routed there fails until then.
The planner names the app a UI subtask works in (`targetApp`); file work names none and runs as a helper.
Nothing calls `runTask` in the running harness yet: the confirmation flow that moves a task to `planning` will.

## Errors and the log

- The log is `harness.log` in the support folder, one JSON object per line: model errors with the server's detail and status, timing, and token counts.
  It never holds prompts, screen text, or model replies, only their sizes.
- Failures that reach the user are `UserError` kinds from the protocol, with no technical detail.
  An unreachable model server is `modelFailedToLoad`; every other model failure is `unexpected`.

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
| [OBJ-06](../objectives/OBJ-06-resume-and-limits.md) | Resume and limits | Brent | todo |
| [OBJ-07](../objectives/OBJ-07-lane-router-core.md) | Lane router core | Brent | in-progress |
| [OBJ-08](../objectives/OBJ-08-locks-busy-windows-cap.md) | Window locks, busy windows, and cursor cap | Brent | todo |
| [OBJ-09](../objectives/OBJ-09-ghost-handoff.md) | Ghost handoff | Brent | todo |
| [OBJ-21](../objectives/OBJ-21-mac-bridge-client-and-pairing.md) | Mac bridge client and pairing | Jepoy | done |
| [OBJ-36](../objectives/OBJ-36-gui-act-sub-agent.md) | gui_act sub-agent | Brent | todo |
| [OBJ-37](../objectives/OBJ-37-permission-gate-and-file-tools.md) | Permission gate and typed file tools | Brent | done |
| [OBJ-38](../objectives/OBJ-38-approvals-pause-and-action-log.md) | Approvals, pause, and action log in the harness | Brent | todo |
| [OBJ-41](../objectives/OBJ-41-mac-pairing-verdict.md) | Mac pairing waits for the relay's verdict | Brent | todo |
| [OBJ-43](../objectives/OBJ-43-mac-bridge-client-version-refusal.md) | Mac bridge client recovers from a version refusal | Brent | todo |
<!-- generated:product-objectives:end -->
