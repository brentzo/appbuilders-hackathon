---
id: OBJ-59
title: "Quick \"Hey Yumi\" wake word model for the demo"
product: models
assignee: Brent
touches: [android, mac]
specs: [SPEC-01]
status: todo
priority: p0
depends-on: []
integrates-with: [OBJ-16, OBJ-24, OBJ-58]
tags: [objective, p0, models, voice]
---

# OBJ-59 Quick "Hey Yumi" wake word model for the demo

**Product:** [Models](../models/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Both apps still wake on the "Hey Jarvis" stand-in, and the full openWakeWord training ([OBJ-12](OBJ-12-hey-yumi-wake-word.md)) needs Linux and a 17.3 GB dataset that does not fit before the deadline.
SPEC-01's Decisions allow a quick model trained on this Mac with synthetic voices, accepting sound-alikes.
The Mac ([OBJ-16](OBJ-16-mac-wake-word.md)) and Android ([OBJ-24](OBJ-24-android-voice-intake.md)) apps already load an openWakeWord ONNX model, so a `hey_yumi.onnx` file switches both without app changes.

## Read first

- SPEC-01 "Wake word detector" and Decisions.
- The Outcomes of OBJ-16 and OBJ-24: where each app looks for the model, the feature models, and the threshold.
- [models/README.md](../models/README.md) and `models/manifest.json`.
- openWakeWord's training code and `notebooks/automatic_model_training.ipynb` in its repository, for the classifier and feature pipeline it uses.

## Tasks

- [ ] **OBJ-59.1** Generate a few thousand "Hey Yumi" clips with on-device voices (Kokoro in `~/.venvs/yumi-tts`, many voices and speeds, plus a few of Brent's own takes if he records them), with light noise and room echo.
- [ ] **OBJ-59.2** Build negatives from generated everyday sentences and small, freely licensed noise and speech sets; keep downloads under about 2 GB (the disk has about 17 GB free).
- [ ] **OBJ-59.3** Train openWakeWord's small classifier on its frozen feature models, export `hey_yumi.onnx`, and store it in `models/wake-word/` with its checksum in the manifest.
- [ ] **OBJ-59.4** Pick a threshold that wakes reliably at arm's length; sound-alikes waking it is acceptable.
- [ ] **OBJ-59.5** Put the model where the Mac and Android apps load it, and check on each that "Hey Yumi" wakes it and "Hey Jarvis" no longer does.
- [ ] **OBJ-59.6** Write `models/wake-word/RESULTS.md`: how it was trained, the threshold, and what was measured.

## Expectations

- [ ] Saying "Hey Yumi" at arm's length wakes the demo phone and the Mac.
- [ ] Neither app wakes on "Hey Jarvis" any more.

## Expected outcomes

- `models/wake-word/hey_yumi.onnx`, its manifest entry, `RESULTS.md`, and both apps using it.

## Out of scope

- A production-quality model with the full negative dataset: [OBJ-12](OBJ-12-hey-yumi-wake-word.md).
- The Mac recognizer route: [OBJ-58](OBJ-58-mac-hey-yumi-recognizer.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
