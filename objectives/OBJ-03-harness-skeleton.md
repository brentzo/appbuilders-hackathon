---
id: OBJ-03
title: Harness skeleton and local model client
product: harness
assignee: Brent
touches: []
specs: [SPEC-02]
status: in-progress
priority: p0
depends-on: [OBJ-01]
integrates-with: []
tags: [objective, p0, harness]
---

# OBJ-03 Harness skeleton and local model client

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

This creates the harness as a running program: a minimal agent loop forked from Pi, a client for the local Qwen3.5-9B server, a tool registry, strict output validation, and the local socket the Mac app will connect to.
Every other harness objective plugs into this skeleton.

## Read first

- [harness/README.md](../harness/README.md).
- [SPEC-02](../specs/02-task-lifecycle.md), requirements 5 and 6 (worker input and one validated action).
- [docs/task-record-schema.md](../docs/task-record-schema.md), section "What a worker receives".
- Pi's agent core source (`@mariozechner/pi-agent-core`, MIT; may now be under an `earendil-works` npm scope).

## Tasks

- [x] **OBJ-03.1** Set up `harness/` as a TypeScript project on Node.js LTS with lint, format, and test scripts. Import types from `protocol/`.
- [x] **OBJ-03.2** Fork Pi's core agent loop into the harness. Keep its loop, message handling, and session state. Remove the coding tools (read, write, edit, bash) from the default tool set; they come back later as explicit Yumi tools.
- [x] **OBJ-03.3** Write a model client for an OpenAI-compatible local server (mlx-vlm or mlx-lm server running Qwen3.5-9B 4-bit). Base URL and model name come from config. Support text and image input.
- [x] **OBJ-03.4** Document in `harness/README.md` how to start the model server locally, which model file to download, and how to confirm Qwen3.5 vision works with that server.
- [x] **OBJ-03.5** Add a tool registry: each tool has a name, JSON Schema arguments, and a handler. A call can only offer a chosen subset of tools (5-10 per lane).
- [x] **OBJ-03.6** Validate every model output against the protocol's `WorkerOutput` schema. Use the server's structured output mode if it has one. On an invalid output, retry once with the validation error added to the prompt, then return an `invalidOutput` outcome.
- [x] **OBJ-03.7** Start a JSON-RPC 2.0 server on a Unix domain socket in the user's Application Support folder for the Mac app. Implement a `ping` method and the event stream plumbing.
- [x] **OBJ-03.8** Log technical detail (model errors, timing, token counts) to a local log file. Nothing technical goes into user-facing messages ([SPEC-11](../specs/11-user-facing-errors.md)).
- [x] **OBJ-03.9** Tests: valid output passes, invalid output retries once then fails as `invalidOutput`, tool subset is enforced, RPC `ping` works. Mock the model server with the same response shapes the real server returns.

## Expectations

- [ ] With the model server running, a test script sends a prompt and gets back a validated action.
- [x] SPEC-02 scenario "Worker returns an invalid action" passes against a mocked server.
- [x] A client can connect to the socket and get a `ping` reply.
- [x] No user-facing string contains raw model or server errors.

## Expected outcomes

- A runnable `harness/` package with the forked loop, model client, tool registry, validation, and RPC server.
- Setup instructions for the local model server.

## Out of scope

- Persisting tasks: [OBJ-04](OBJ-04-task-store.md).
- Planning and scheduling: [OBJ-05](OBJ-05-planner-and-scheduler.md).
- GUI tools (`gui_act`, `look`): SPEC-05, not finalized.

## Outcome

- **Result:** In progress. Every task is done and three of the four expectations are verified against mocks. The real-server expectation waits until the model is free on this Mac.
- **Delivered:**
  - `harness/`: a TypeScript package (`@yumi/harness`) with `@yumi/protocol` as a local file dependency, and `typecheck`, `lint`, `format`, `test`, and `verify` scripts.
  - `harness/src/agent/`: Pi's agent loop, message handling, and session state, forked from `@earendil-works/pi-agent-core` 1.1.0 (tag `v1.1.0`, commit `abe508e1b89912adde45528136c3221eb69acdd7`), with Pi's MIT license. `FORK.md` lists what was copied and changed.
  - `harness/src/model/`: the model client for the OpenAI-compatible server (text and image input, base URL and model from config) and the forked loop's stream function.
  - `harness/src/tools/registry.ts`: the tool registry (name, JSON Schema arguments, handler) and per-call subsets of at most 10 tools.
  - `harness/src/worker/`: one step from a `WorkerInput` to one validated `WorkerOutput`, with one retry. Action kind names live only in `actions.ts`.
  - `harness/src/rpc/server.ts`: the JSON-RPC server on `~/Library/Application Support/Yumi/harness.sock` with `hello`, `ping`, events to the app, and calls to the app.
  - `harness/src/log.ts` and `harness/src/errors.ts`: the local log (`harness.log` in the same folder) and the mapping from failures to `UserError` kinds.
  - `harness/scripts/model-check.ts` (the real-server test script, with `--image` for vision) and `harness/scripts/check-grammar.py`.
  - `harness/README.md`: layout, commands, configuration, and how to install, start, and check the model server, including vision.
- **Commits:**
  - `0eae410 docs(objectives): start OBJ-03`
  - `3121fa4 feat(harness): set up the TypeScript project and fork Pi's agent loop`
  - `6fc3f21 feat(harness): add the model client, tool registry, step validation, and local RPC server`
  - `62a1b3f docs(objectives): record OBJ-03 progress`
  - `f1575ff test(harness): use the generated protocol version in the RPC tests`
- **Expectations:**
  - Real server: not verified yet (see below).
  - "Worker returns an invalid action": `test/worker-step.test.ts`, "Scenario: Worker returns an invalid action". The first invalid reply is recorded as `invalidOutput`, and the retry prompt holds the validation error. A second invalid reply ends the step as `invalidOutput` with no third request.
  - `ping`: `test/rpc-server.test.ts` sends `ping` from a bare socket client and gets `{"result":{}}`. The same file runs `npm run mock:mac` from `protocol/`, which says hello, receives an event, and answers `listWindows`. `npm start` and `npm run mock:mac` were also run together from the command line.
  - No raw errors: `test/model-client.test.ts`, "no user-facing string contains raw model or server errors". It covers an unreachable server, HTTP 500, 422, an unhandled exception, and a timeout. Each gives a contract-valid `UserError` (`modelFailedToLoad` or `unexpected`) that contains no detail text, status code, or transport string, and the detail is in the log.
  - `npm run verify` passes on protocol version 2 (`main` at `149a835`): typecheck, ESLint, Prettier, and 55 tests. The suite also passed three repeated runs.
  - `python3 scripts/verify.py` passes, but it only runs the docs check for `harness/` changes; it does not build or test the harness yet.
- **Not verified:**
  - "With the model server running, a test script sends a prompt and gets back a validated action." The script is written, and it runs end to end against the mock server. It has not run against the real server, because the model must not be loaded while another agent uses the Mac's memory. To verify, start the server as in `harness/README.md`, then run `npm run model:check` in `harness/`. It must print `OK: validated action ...`.
  - Qwen3.5 vision through the server: also not run. Run `npm run model:check -- --image <screenshot.png>` and check that the description matches the image.
  - The mock model server's shapes come from mlx-vlm 0.7.6's source (`server/schemas.py`, `openai.py`). Run the real check above to confirm them.
- **Decisions and deviations:**
  - `RpcPeer` was not exported from `@yumi/protocol`, despite OBJ-01's Outcome. Brent chose to export it from the package root (`00c4dd8` and `003ea46`), and the harness imports it from `@yumi/protocol`.
  - Pi's agent core never contained the coding tools; they live in Pi's coding agent. So the registry simply starts empty.
  - Pi's provider package is not a dependency. Only the message types and transcript helpers the loop needs were copied.
  - mlx-vlm 0.7.6 compiles `response_format` with llguidance 1.9.1, which fails the request on `uniqueItems`. The protocol's `WorkerOutput` uses it, so the schema sent to the model omits it. Replies are still validated against the full protocol schema.
  - The schema sent to the model is narrowed per step: only the element numbers on screen, only the lane's tools, and no vision click without a screenshot.
  - Validation also rejects replies the schema alone allows but the step cannot use: an element number not on screen, a tool outside `allowedTools`, `setValue` on a secure text field (SPEC-05 r7), and a vision click without a screenshot. Main-lane-only actions (`type`, `key`) are not checked, because `WorkerInput` does not carry the lane.
  - An unreachable model server maps to `modelFailedToLoad`. Every other model failure maps to `unexpected`. A cancel is not an error.
  - `ProtocolVersion` is a const in the contract, so an app with another version gets `-32602` from param validation before the harness's own version check runs. It never gets a `-32000` `UserError`.
  - Sampling follows the Qwen3.5 model card's instruct settings (temperature 0.7, top_p 0.8, top_k 20), with thinking off.
- **For the next objectives:**
  - Run a step with `runWorkerStep(input, { client, logger })` from `src/worker/step.ts`. Its outcome is `ok`, `invalidOutput`, `error` (with a `UserError`), or `aborted`, and `attempts` gives each attempt's step outcome for the task store (OBJ-04).
  - The coming rename of `axPress` to `click` (and of the vision click) is a change to `src/worker/actions.ts` plus the generated types; the prompt, schema narrowing, and validation read the names from there. Tests that use literal action JSON in `test/` need the new names too.
  - Register tools with `ToolRegistry.register` and offer them with `select(names)`. `ToolSet.toAgentTools()` feeds the forked `Agent`, and `createLocalStreamFn(client)` connects the loop to the model server.
  - Add app-to-harness methods through `HarnessRpcServer.start({ handlers })`. Send events with `emit`, and call the Mac app with `request`.
  - Tests use `test/mock-model-server.ts`. Add new error shapes there only after reading them in mlx-vlm's source.
