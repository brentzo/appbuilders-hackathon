---
id: OBJ-46
title: Mac app shows whether the model is ready
product: mac
assignee: Patrick
touches: []
specs: [SPEC-11]
status: todo
priority: p0
depends-on: [OBJ-14]
integrates-with: [OBJ-45, OBJ-47]
tags: [objective, p0, mac, ux]
---

# OBJ-46 Mac app shows whether the model is ready

**Product:** [Yumi Mac](../mac/README.md) · **Specs:** [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Qwen3.5-9B takes a while to load, and until now nothing told the Mac app whether it was ready, so `ModelReadiness` is a placeholder that always says "unknown".
[OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md) adds `ModelState`, the `modelStateChanged` event, and `HelloResult.modelState`.
The contract landed on `main` on 2026-10-10 with the decoder case in `HarnessEvent.swift`, so the Mac builds; `HarnessLink` logs the event as not handled yet, and this objective acts on it.

## Read first

- [OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md) and `ModelState`, `ModelStateChanged`, and `HelloResult` in [protocol/schemas/rpc.json](../protocol/schemas/rpc.json).
- [SPEC-11](../specs/11-user-facing-errors.md), the "Model failed to load" row.
- `mac/Yumi/App/ModelReadiness.swift`, `mac/Yumi/Harness/HarnessEvent.swift`, and the status line in `AppModel`.

## Tasks

- [ ] **OBJ-46.1** Handle `modelStateChanged` in `HarnessLink` (`HarnessEvent` already decodes it) and read `HelloResult.modelState` after `hello`.
- [ ] **OBJ-46.2** Replace the `ModelReadiness` placeholder with `loading`, `ready`, and `failed`, and keep the status line on "Yumi is getting ready" while the model loads.
- [ ] **OBJ-46.3** Decide, and record in the spec, what happens to a goal spoken while the model loads: hold it until the model is ready, or say so and drop it.
- [ ] **OBJ-46.4** On `failed`, show the SPEC-11 "Model failed to load" copy, whose "Try again" restarts the harness.
- [ ] **OBJ-46.5** Test against the mock harness's model states: the `model-loading` and `model-failed` scripts.

## Expectations

- [ ] The status line says "Yumi is getting ready" until the model is ready, including when the app connects after the model started loading.
- [ ] A model that fails to load shows "Model failed to load", never a raw error.

## Expected outcomes

- `ModelReadiness` driven by the harness, with tests against the mock harness.

## Out of scope

- How the harness measures the model's state: [OBJ-47](OBJ-47-harness-model-readiness.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
