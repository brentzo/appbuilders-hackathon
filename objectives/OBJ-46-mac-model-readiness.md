---
id: OBJ-46
title: Mac app shows whether the model is ready
product: mac
assignee: Patrick
touches: []
specs: [SPEC-11]
status: in-progress
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

- [x] **OBJ-46.1** Handle `modelStateChanged` in `HarnessLink` (`HarnessEvent` already decodes it) and read `HelloResult.modelState` after `hello`.
- [x] **OBJ-46.2** Replace the `ModelReadiness` placeholder with `loading`, `ready`, and `failed`, and keep the status line on "Yumi is getting ready" while the model loads.
- [x] **OBJ-46.3** Decide, and record in the spec, what happens to a goal spoken while the model loads: hold it until the model is ready, or say so and drop it.
- [x] **OBJ-46.4** On `failed`, show the SPEC-11 "Model failed to load" copy, whose "Try again" restarts the harness.
- [x] **OBJ-46.5** Test against the mock harness's model states: the `model-loading` and `model-failed` scripts.

## Expectations

- [x] The status line says "Yumi is getting ready" until the model is ready, including when the app connects after the model started loading.
- [x] A model that fails to load shows "Model failed to load", never a raw error.

## Expected outcomes

- `ModelReadiness` driven by the harness, with tests against the mock harness.

## Out of scope

- How the harness measures the model's state: [OBJ-47](OBJ-47-harness-model-readiness.md).

## Outcome

- **Result:** In progress: the code and tests are done; it waits for Brent's yes on the 46.3 proposal and a check in the live app.
- **Delivered:** `mac/Yumi/App/ModelReadiness.swift` (`ModelReadiness` with `loading`, `ready`, `failed`, and `ModelGate`, which holds goals), `HarnessClient.onModelState` from `hello`, `modelStateChanged` handled in `HarnessLink`, `AppModel.status` on "Yumi is getting ready" until the model is ready, `ErrorButtonAction.restartHarness` and `HarnessSupervisor.restart()` for "Try again". Tests in `mac/YumiTests/ModelReadinessTests.swift`.
- **Commits:** `381263c feat(mac): show whether the model is ready and hold goals until it is`, `8bccd82 docs(spec-11): propose holding a goal spoken while the model loads`.
- **Expectations:** Status line: `statusLineSaysGettingReadyUntilTheModelIsReady` and `helloWhileLoadingShowsGettingReady`, and the mock harness's `model-loading` script in `modelLoadingScript`. Failure copy: `modelFailedToLoadShowsSpec11CopyWithTryAgainThatRestartsTheHarness`, and the `model-failed` script in `modelFailedScript`; the error goes through `ErrorPresenter`, so no raw text reaches the user.
- **Not verified:** The live app with the real harness: quit the model server, launch Yumi, check the menu says "Yumi is getting ready", say a goal and hear "I'm still waking up. I'll start on that as soon as I'm ready.", start `mlx_vlm.server`, and check the goal is repeated back once the model is ready. Then stop the server for longer than `YUMI_MODEL_LOAD_TIMEOUT_MS`, check "Model failed to load" shows, start the server, press "Try again", and check the menu returns to "Yumi is ready". Not run because only one agent may use the live app at a time.
- **Decisions and deviations:** 46.3 is recorded as a proposal under SPEC-11 "Open questions", not as a decision: hold the goal, say Yumi is waking up, and start it when ready; keep only the latest; drop it on failure. Typed goals are held too, since they go through the same `submitGoal`. A goal while the model has failed shows "Model failed to load" again instead of reaching the harness. A harness that leaves `modelState` out counts as ready. While the model has failed, the status line still says "Yumi is getting ready", because SPEC-11 has no status-line copy for it; the error window carries the message. Files changed that Patrick owns: everything under `mac/` listed above, plus `AppDelegate.swift`, `ErrorPresenter.swift`, `HarnessSupervisor.swift`, `AppStatusTests.swift`, `VoiceIntakeTests.swift`, and `mac/README.md`.
- **For the next objectives:** `HarnessLink.modelGate` holds a goal while the model loads; goals reach the harness only through `submitGoal`, which asks the gate first.
