---
id: OBJ-47
title: Harness reports whether the model is ready
product: harness
assignee: Brent
touches: []
specs: [SPEC-11]
status: todo
priority: p0
depends-on: [OBJ-03, OBJ-45]
integrates-with: [OBJ-46]
tags: [objective, p0, harness, ux]
---

# OBJ-47 Harness reports whether the model is ready

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The Mac app shows "Yumi is getting ready" only until the harness answers `hello`, but Qwen3.5-9B can still be loading after that.
[OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md) adds `ModelState` and the `modelStateChanged` event; the harness is the only side that can tell whether the model server answers.

## Read first

- [OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md), and `ModelState` and `ModelStateChanged` in [protocol/schemas/rpc.json](../protocol/schemas/rpc.json).
- "The local model server" in [harness/README.md](../harness/README.md), including its `/health` endpoint.
- `harness/src/model/client.ts` and how it maps an unreachable server to `modelFailedToLoad`.

## Tasks

- [x] **OBJ-47.1** Track the model state: `loading` from start until the model server's `/health` reports the configured model, `ready` after that, and `failed` when it stays unreachable past a timeout or reports another model.
- [x] **OBJ-47.2** Emit `modelStateChanged` on every change, and put the current state in `HelloResult.modelState`.
- [x] **OBJ-47.3** Go back to `loading` or `failed` when a request finds the server gone, so a server restarted during the demo is noticed.
- [x] **OBJ-47.4** Tests with the mock model server: slow start, ready, never starts, wrong model, and lost mid-run.

## Expectations

- [x] The Mac app learns the model's state within a few seconds of every change.
- [x] A missing model server ends in `failed`, which the Mac shows as "Model failed to load".

## Expected outcomes

- Model state tracking in the harness, with tests.

## Out of scope

- What the Mac shows: [OBJ-46](OBJ-46-mac-model-readiness.md).

## Outcome

- **Result:** Done in code; the status stays `todo` because its hard dependency [OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md) is still in-progress, and the check refuses a later status until OBJ-45 is done. The contract it needs is on `main`.
- **Delivered:** `harness/src/model/readiness.ts` (`ModelReadiness`), wired in `harness/src/main.ts`, `harness/src/harness.ts` (`HarnessOptions.model`, `modelStateChanged`), and `harness/src/rpc/server.ts` (`HelloResult.modelState`). `ModelClient` takes an `onFailure` callback. `YUMI_MODEL_LOAD_TIMEOUT_MS` (default 150000) in `harness/src/config.ts`. The mock model server answers `GET /health` and can listen on a given port. "Model readiness" in `harness/README.md`.
- **Commits:** `53b3824 feat(harness): report whether the local model is loading, ready, or failed`.
- **Expectations:** Within a few seconds: the harness checks `/health` every second while loading and every 3 seconds while ready, and at once when a model request finds the server unreachable; `harness/test/model-readiness.test.ts` "answers hello with the current state and sends every change as modelStateChanged" checks the event reaches an app on the socket. Missing server ends in `failed`: "fails when the server never starts within the load timeout"; the Mac side is OBJ-46's `modelFailedScript` test.
- **Not verified:** Against the real mlx-vlm server on this Mac: start the harness with the model server stopped, check `harness.log` shows `model.readiness.changed` to `failed` after 150 seconds, then start `mlx_vlm.server` and check it changes to `ready`. Not run here because only one agent may use the live app and harness at a time.
- **Decisions and deviations:** mlx-vlm 0.7.6 with `--model` loads the model before it accepts connections (`lifespan` in `mlx_vlm/server/app.py`), so "loading" is "nothing answers yet". A `/health` with no `loaded_model` (a server started without `--model`, which loads the requested model on demand) counts as ready, with a warning in the log. A local path ending in the configured repo id counts as the configured model. A slow `/health` answer changes nothing, so a busy server never flips to `loading`. After `failed` it keeps checking, so a server started late still ends in `ready`.
- **For the next objectives:** `startHarness(..., { model })` takes anything with `state` and `onChange`. Tests can start the mock model server late or restart it at the same URL with `startMockModelServer(model, port)`.
