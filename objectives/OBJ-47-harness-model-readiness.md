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

- [OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md), and `ModelState` and `ModelStateChanged` in [protocol/schemas/rpc.json](../protocol/schemas/rpc.json) once OBJ-45.3 is written.
- "The local model server" in [harness/README.md](../harness/README.md), including its `/health` endpoint.
- `harness/src/model/client.ts` and how it maps an unreachable server to `modelFailedToLoad`.

## Tasks

- [ ] **OBJ-47.1** Track the model state: `loading` from start until the model server's `/health` reports the configured model, `ready` after that, and `failed` when it stays unreachable past a timeout or reports another model.
- [ ] **OBJ-47.2** Emit `modelStateChanged` on every change, and put the current state in `HelloResult.modelState`.
- [ ] **OBJ-47.3** Go back to `loading` or `failed` when a request finds the server gone, so a server restarted during the demo is noticed.
- [ ] **OBJ-47.4** Tests with the mock model server: slow start, ready, never starts, wrong model, and lost mid-run.

## Expectations

- [ ] The Mac app learns the model's state within a few seconds of every change.
- [ ] A missing model server ends in `failed`, which the Mac shows as "Model failed to load".

## Expected outcomes

- Model state tracking in the harness, with tests.

## Out of scope

- What the Mac shows: [OBJ-46](OBJ-46-mac-model-readiness.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
