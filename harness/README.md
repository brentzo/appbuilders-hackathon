# Yumi Harness

The brain-side runtime on the Mac.
It runs the agent loop, owns all task state, plans goals into subtasks, routes subtasks to lanes, and talks to the local model, the Mac app, and the bridge.
The model is stateless; everything that makes Yumi feel long-running and reliable lives here.

Owner: Brent.

Status: the skeleton is built ([OBJ-03](../objectives/OBJ-03-harness-skeleton.md)): the forked agent loop, the local model client, the tool registry, output validation with one retry, the local RPC server with `hello`, `ping`, and events, and the log.
Tasks are not stored yet ([OBJ-04](../objectives/OBJ-04-task-store.md)).

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
- SQLite for the task store (OBJ-04).
- JSON-RPC 2.0 over a Unix domain socket for the Mac app, through the protocol's `RpcPeer`.
- Types and validation come from [protocol](../protocol/README.md). Never hand-write a schema type here.

## Layout

| Path | What it is |
|---|---|
| `src/main.ts` | Starts the harness: the log and the RPC server. |
| `src/config.ts` | Configuration from environment variables. |
| `src/agent/` | The forked Pi agent loop, message types, and session state. |
| `src/model/` | The model client (`client.ts`), the server's wire shapes (`openai.ts`), and the loop's stream function (`stream-fn.ts`). |
| `src/tools/registry.ts` | The tool registry and per-call tool subsets (at most 10). Starts empty: Pi's coding tools are not included. |
| `src/worker/` | One step: the prompt, the action names (`actions.ts`), the narrowed output schema, validation, and the one retry. |
| `src/schema/bundle.ts` | Turns a protocol type into one self-contained JSON Schema. |
| `src/rpc/server.ts` | The local JSON-RPC server for the Mac app. |
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
| `YUMI_SUPPORT_DIR` | `~/Library/Application Support/Yumi` | Folder for `harness.sock` and `harness.log`. |
| `YUMI_MODEL_BASE_URL` | `http://127.0.0.1:8080/v1` | The model server's OpenAI-compatible API. |
| `YUMI_MODEL` | `mlx-community/Qwen3.5-9B-4bit` | Model name sent with every request. |
| `YUMI_MODEL_TIMEOUT_MS` | `120000` | Give up on one model request after this long. |
| `YUMI_MODEL_MAX_TOKENS` | `1024` | Most tokens per reply. |
| `YUMI_MODEL_STRUCTURED_OUTPUT` | on | `0` stops sending `response_format`. Replies are validated either way. |

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

## Local RPC

- The harness listens on `harness.sock` in the support folder, readable only by this user, and replaces a stale socket left by a crash.
- It refuses to start if another harness is already listening.
- The Mac app calls `hello` with the protocol version first. Events go only to connections that said hello.
- Build and test the Mac side against it with the protocol's mock Mac app: `npm start` here, then `npm run mock:mac` in `protocol/`.

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
- [SPEC-08 Device bridge](../specs/08-device-bridge.md)
- Also follows [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md) for any message a user can see.

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-03](../objectives/OBJ-03-harness-skeleton.md) | Harness skeleton and local model client | Brent | done |
| [OBJ-04](../objectives/OBJ-04-task-store.md) | Task store and history | Brent | todo |
| [OBJ-05](../objectives/OBJ-05-planner-and-scheduler.md) | Planner, scheduler, and task summary | Brent | todo |
| [OBJ-06](../objectives/OBJ-06-resume-and-limits.md) | Resume and limits | Brent | todo |
| [OBJ-07](../objectives/OBJ-07-lane-router-core.md) | Lane router core | Brent | todo |
| [OBJ-08](../objectives/OBJ-08-locks-busy-windows-cap.md) | Window locks, busy windows, and cursor cap | Brent | todo |
| [OBJ-09](../objectives/OBJ-09-ghost-handoff.md) | Ghost handoff | Brent | todo |
| [OBJ-21](../objectives/OBJ-21-mac-bridge-client-and-pairing.md) | Mac bridge client and pairing | Jepoy | todo |
<!-- generated:product-objectives:end -->
