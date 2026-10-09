---
id: OBJ-03
title: Harness skeleton and local model client
product: harness
assignee: Brent
touches: []
specs: [SPEC-02]
status: todo
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

- [ ] **OBJ-03.1** Set up `harness/` as a TypeScript project on Node.js LTS with lint, format, and test scripts. Import types from `protocol/`.
- [ ] **OBJ-03.2** Fork Pi's core agent loop into the harness. Keep its loop, message handling, and session state. Remove the coding tools (read, write, edit, bash) from the default tool set; they come back later as explicit Yumi tools.
- [ ] **OBJ-03.3** Write a model client for an OpenAI-compatible local server (mlx-vlm or mlx-lm server running Qwen3.5-9B 4-bit). Base URL and model name come from config. Support text and image input.
- [ ] **OBJ-03.4** Document in `harness/README.md` how to start the model server locally, which model file to download, and how to confirm Qwen3.5 vision works with that server.
- [ ] **OBJ-03.5** Add a tool registry: each tool has a name, JSON Schema arguments, and a handler. A call can only offer a chosen subset of tools (5-10 per lane).
- [ ] **OBJ-03.6** Validate every model output against the protocol's `WorkerOutput` schema. Use the server's structured output mode if it has one. On an invalid output, retry once with the validation error added to the prompt, then return an `invalidOutput` outcome.
- [ ] **OBJ-03.7** Start a JSON-RPC 2.0 server on a Unix domain socket in the user's Application Support folder for the Mac app. Implement a `ping` method and the event stream plumbing.
- [ ] **OBJ-03.8** Log technical detail (model errors, timing, token counts) to a local log file. Nothing technical goes into user-facing messages ([SPEC-11](../specs/11-user-facing-errors.md)).
- [ ] **OBJ-03.9** Tests: valid output passes, invalid output retries once then fails as `invalidOutput`, tool subset is enforced, RPC `ping` works. Mock the model server with the same response shapes the real server returns.

## Expectations

- [ ] With the model server running, a test script sends a prompt and gets back a validated action.
- [ ] SPEC-02 scenario "Worker returns an invalid action" passes against a mocked server.
- [ ] A client can connect to the socket and get a `ping` reply.
- [ ] No user-facing string contains raw model or server errors.

## Outcomes

- A runnable `harness/` package with the forked loop, model client, tool registry, validation, and RPC server.
- Setup instructions for the local model server.

## Out of scope

- Persisting tasks: [OBJ-04](OBJ-04-task-store.md).
- Planning and scheduling: [OBJ-05](OBJ-05-planner-and-scheduler.md).
- GUI tools (`gui_act`, `look`): SPEC-05, not finalized.

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
