---
id: OBJ-45
title: Pause scope and model readiness contracts
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-06, SPEC-07, SPEC-11]
status: in-progress
priority: p0
depends-on: [OBJ-01]
integrates-with: [OBJ-35, OBJ-38, OBJ-46, OBJ-47]
tags: [objective, p0, protocol, ux]
---

# OBJ-45 Pause scope and model readiness contracts

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-06](../specs/06-user-control.md), [SPEC-07](../specs/07-safety.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Two contracts the Mac app and the harness need are missing from `protocol/schemas/rpc.json`.
SPEC-06 r2 says a take-over pauses only the UI lanes while helpers keep running, but `PauseParams` holds only `taskId`, so the Mac sends the same `pause` for the stop shortcut and for a take-over ([OBJ-35](OBJ-35-mac-stop-and-take-over.md) task 3, [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) task 5; gap G6 in `objectives/README.md`).
And the harness cannot tell the Mac app whether the local model is still loading, so `mac/Yumi/App/ModelReadiness.swift` is a placeholder and a goal sent while Qwen3.5-9B loads fails ([OBJ-14](OBJ-14-mac-app-shell.md) open question).

## Read first

- [SPEC-06](../specs/06-user-control.md) requirements 1, 2, and 8, and [SPEC-07](../specs/07-safety.md) requirement 5.
- `PauseParams`, `HelloResult`, and `x-rpc` in [protocol/schemas/rpc.json](../protocol/schemas/rpc.json).
- The OBJ-14 Outcome, "Model readiness".
- `mac/Yumi/Control/PauseController.swift` and `mac/Yumi/Harness/HarnessEvent.swift`.

## Tasks

- [ ] **OBJ-45.1** Add `PauseScope` (`everyLane`, `uiLanes`) and an optional `scope` to `PauseParams`, where a missing scope means every lane, so the Mac's current `pause` keeps its meaning. Regenerate, add examples, and test it.
- [ ] **OBJ-45.2** Record the blocked-action card's reply in the contract docs: "Keep going" calls `resumeTask` and "Stop" calls `cancelTask`, as the Mac already does, so no new method is needed. Close gap G6.
- [ ] **OBJ-45.3** Add `ModelState` (`loading`, `ready`, `failed`), a `modelStateChanged` event, and an optional `modelState` in `HelloResult`, so an app that connects late knows the state at once.
  The Mac's event decoder is exhaustive over `RpcEvent` on purpose, so this lands in one push with [OBJ-46](OBJ-46-mac-model-readiness.md).
- [ ] **OBJ-45.4** Teach the mock harness to report the model state, so the Mac can be built against it before [OBJ-47](OBJ-47-harness-model-readiness.md).

## Expectations

- [ ] A `pause` with `scope: uiLanes` validates, a missing scope still validates, and any other scope does not.
- [ ] The Mac app still builds against the regenerated Swift types after OBJ-45.1, with no change on its side.
- [ ] `modelStateChanged` and `HelloResult.modelState` validate, and the Mac app builds and handles them in the same push.

## Expected outcomes

- `PauseScope`, `ModelState`, and `ModelStateChanged` in `protocol/schemas/rpc.json`, with generated types, examples, and tests.

## Out of scope

- Honouring the scope in the harness: [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) task 5.
- Sending `uiLanes` on a take-over: [OBJ-35](OBJ-35-mac-stop-and-take-over.md) task 3.
- Measuring the model's state in the harness: [OBJ-47](OBJ-47-harness-model-readiness.md).
- Showing it on the Mac: [OBJ-46](OBJ-46-mac-model-readiness.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
