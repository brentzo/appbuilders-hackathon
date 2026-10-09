---
id: OBJ-26
title: Qwen3.5-9B smoke test on the demo tasks
product: models
touches: []
specs: [SPEC-05]
status: todo
priority: p0
depends-on: []
tags: [objective, p0, models, gui]
---

# OBJ-26 Qwen3.5-9B smoke test on the demo tasks

**Product:** [Yumi Models](../models/README.md) · **Specs:** [SPEC-05](../specs/05-mac-gui-control.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The demo depends on Qwen3.5-9B at 4-bit choosing the right element from a trimmed accessibility tree.
Nobody has checked that yet.
The public scores used to pick the model (ScreenSpot-Pro, OSWorld) measure vision, and p0 uses no vision.
The full model comparison in SPEC-05 requirement 14 is p1, so this objective answers the p0 question early and cheaply: does 9B work on our three demo tasks, and how often does its output fail validation?
If the answer is no, the team needs to know before building the harness around it.

## Read first

- [SPEC-05](../specs/05-mac-gui-control.md), requirements 1-6 and 10, and "Demo tasks".
- [docs/task-record-schema.md](../docs/task-record-schema.md), "What the model sees" and "Actions".
- [OBJ-01](OBJ-01-task-record-schemas.md), if done: use its `Observation` and `ModelAction` schemas. If not, follow the design doc.
- [models/README.md](../models/README.md).

## Tasks

- [ ] **OBJ-26.1** Run Qwen3.5-9B at 4-bit with an OpenAI-compatible MLX server on the 16 GB Mac. Record the server, version, and whether it supports schema-constrained decoding.
- [ ] **OBJ-26.2** Write a throwaway script (Python with pyobjc is fine) that reads the target window's accessibility tree, trims it as in SPEC-05 requirement 2, numbers the elements, and presses or sets the chosen element. No cursor animation, no harness.
- [ ] **OBJ-26.3** Write the prompt: confirmed goal, subtask instruction, last 3-5 steps, the trimmed tree, and the allowed actions. The model answers with one `ModelAction` as JSON.
- [ ] **OBJ-26.4** Run each demo task 5 times from the same starting state: Keynote export to PDF, Mail draft to Ana with the PDF attached (stop before Send), and a new note in Notes with a summary.
- [ ] **OBJ-26.5** For every run, record: success, steps used (limit 10), seconds per step, how many outputs failed validation, how many steps had no effect, and peak memory.
- [ ] **OBJ-26.6** Repeat with constrained decoding on and off, if the server supports it.
- [ ] **OBJ-26.7** Write `models/gui/SMOKE-TEST.md` with the numbers, the prompt, and a plain verdict.

## Expectations

- [ ] Each demo task has 5 recorded runs.
- [ ] The verdict uses SPEC-05's bar: a task passes with 4 or more successful runs out of 5.
- [ ] If any task fails, the doc names the failure pattern (wrong element, invalid output, no effect, too many elements) and suggests a fix to try.
- [ ] Peak memory with the model loaded is recorded, for the Whisper choice in [OBJ-11](OBJ-11-whisper-bake-off.md).

## Outcomes

- `models/gui/SMOKE-TEST.md` with results and the verdict.
- The throwaway script, committed under `models/gui/` for reruns, clearly marked as not product code.

## Out of scope

- Comparing Qwen3.5-4B and UI-TARS-1.5-7B. That is the p1 bake-off in SPEC-05 requirement 14. UI-TARS is a vision model, so it only matters for the p1 vision fallback.
- Vision, coordinates, and screenshots (p1).
- Building `gui_act` in the harness.

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
