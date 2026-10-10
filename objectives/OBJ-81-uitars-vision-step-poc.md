---
id: OBJ-81
title: Use UI-TARS as the vision step model (POC)
product: harness
assignee: Brent
touches: [mac, models]
specs: [SPEC-05]
status: in-progress
priority: p1
depends-on: []
integrates-with: [OBJ-75]
tags: [objective, p1, harness, gui, models]
---

# OBJ-81 Use UI-TARS as the vision step model (POC)

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-05](../specs/05-mac-gui-control.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

[OBJ-75](OBJ-75-vision-fallback.md) made the vision path work end to end, but a live run showed the worker model guessing pixels: it clicked `(386,186)` for a row whose center is `(640,138)`, and returned `y=935` for a 705-pixel image.
A direct grounding test on the same Spotify screenshot (2026-10-10) compared the two models, temperature 0:

| Target | Truth | Qwen3.5-9B | UI-TARS-1.5-7B |
|---|---|---|---|
| Search bar | (655, 29) | (498, 29) | (646, 28) |
| First result | (640, 138) | (386, 186) | (468, 140) |
| Chill Mix | (150, 268) | (65, 375) | (152, 263) |
| Play button | (640, 665) | (499, 935) | (640, 679) |

UI-TARS is a GUI-grounding model (ScreenSpot-Pro 49.6 for the 7B, [model card](https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B), apache-2.0) and an MLX 4-bit build exists (`mlx-community/UI-TARS-1.5-7B-4bit`).
This objective is a proof of concept: when a window has no accessible content, the harness asks UI-TARS for the step, behind a flag, so it can be measured against the Qwen worker without changing the demo.
The full bake-off (Qwen3.5-4B, Qwen3.5-9B, and UI-TARS-1.5-7B on the three demo tasks, five runs each, SPEC-05 r14) is a separate models objective.

## Read first

- [SPEC-05](../specs/05-mac-gui-control.md) requirements 1.3, 12, and 14, and the p1 "Vision fallback" scenarios.
- [OBJ-75](OBJ-75-vision-fallback.md)'s Outcome for the vision path that already exists.
- `harness/src/gui/gui-act.ts`, `harness/src/worker/step.ts`, `harness/src/model/client.ts`, and `harness/src/config.ts`.
- The UI-TARS prompt and action space: `codes/ui_tars/prompt.py` in the [UI-TARS repo](https://github.com/bytedance/UI-TARS).

## Tasks

- [ ] **OBJ-81.1** Add a vision step module: the UI-TARS GUI-agent prompt (its action space: `click`, `type`, `hotkey`, `scroll`, `finished`) built from the goal, the instruction, the recent steps, and the screenshot.
- [ ] **OBJ-81.2** Parse its `Thought`/`Action` reply into our `ModelAction`: `click(point='<|box_start|>(x,y)<|box_end|>')` to `clickAt`, `type` to `type`, `hotkey` to `key` (normalize `cmd l` to `cmd+l`), `finished` to `finish`. Reject anything else as an invalid step.
- [ ] **OBJ-81.3** In `gui_act`, when the observation carries a screenshot and the vision model is configured, run that step instead of the worker step. Keep the gate, the Mac app, and the look loop unchanged.
- [ ] **OBJ-81.4** Configure a second model server through the environment (`YUMI_VISION_MODEL`, `YUMI_VISION_MODEL_URL`), so the flag is off by default and the demo is unchanged.
- [ ] **OBJ-81.5** Coordinates: UI-TARS answers in the image's pixels (verified), the same space as `clickAt`; reject a point outside the image and ask again.
- [ ] **OBJ-81.6** Tests: the parser for each action and for a reply it cannot parse; a `gui_act` test with a scripted UI-TARS reply that drives a `clickAt`; and that nothing changes when the flag is off.
- [ ] **OBJ-81.7** Live check on the Mac: with the flag on, drive a window with no accessible content and compare its steps and success with the Qwen worker on the same goal.

## Expectations

- [ ] With the flag on, a window with no accessible content is driven by UI-TARS, and a grounded click lands on the target in the Spotify screenshot.
- [ ] With the flag off, `gui_act` behaves exactly as today (the existing tests pass unchanged).
- [ ] A reply UI-TARS does not fit is a rejected step, never a wrong click.

## Expected outcomes

- `harness/src/gui/uitars.ts` (prompt and parser), the branch in `gui-act.ts`, the vision model in `config.ts`, and tests.

## Out of scope

- The full model bake-off and the final model choice: SPEC-05 requirement 14, a models objective.
- Running both models at once: a 16 GB Mac cannot hold Qwen3.5-9B and UI-TARS-1.5-7B together, so the POC swaps the served model.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
