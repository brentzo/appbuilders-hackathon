---
id: OBJ-12
title: "\"Hey Yumi\" wake word model"
product: models
assignee: Jepoy
touches: [mac, android]
specs: [SPEC-01]
status: blocked
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, models, voice]
---

# OBJ-12 "Hey Yumi" wake word model

**Product:** [Yumi Models](../models/README.md) · **Also touches:** [mac](../mac/README.md), [android](../android/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

"Hey Yumi" starts Yumi hands-free.
We chose openWakeWord because it is free and fully offline (Porcupine checks its key online and has no free tier).
The model is trained once, before the demo, and then runs on each device.
Push-to-talk is the fallback if the wake word is not reliable by demo day.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), section "Wake word detector": decision, plan with estimates, and test method.
- The openWakeWord repository README and its simple Colab training notebook.

## Tasks

- [ ] **OBJ-12.1** Train a basic "Hey Yumi" model with openWakeWord's simple Colab notebook, using synthetic speech in several voices and accents, including Filipino-accented English.
- [ ] **OBJ-12.2** Export the model in ONNX format and save it to `models/wake-word/hey_yumi.onnx` (small enough to commit).
- [ ] **OBJ-12.3** Collect the shared feature models openWakeWord needs at runtime (its audio feature and embedding models) and record where they come from and their licenses.
- [ ] **OBJ-12.4** Test misses: each teammate says "Hey Yumi" 20 times at different distances. Run detection on a laptop with the Python library.
- [ ] **OBJ-12.5** Test false triggers: play an hour of everyday Taglish talk, TV, and music, and count wake-ups.
- [ ] **OBJ-12.6** Tune the detection threshold for the best balance and record it.
- [ ] **OBJ-12.7** If misses are high, retrain once with more accent variety and compare.
- [ ] **OBJ-12.8** Write `models/wake-word/RESULTS.md`: training settings, threshold, miss rate, false triggers per hour, and the files the apps need.

## Expectations

- [ ] The model file, feature models, and threshold are ready for the apps, with sources and licenses documented.
- [ ] Miss rate and false triggers per hour are measured and written down.
- [ ] Results are good enough for a live demo, or the doc says plainly that the demo uses push-to-talk.

## Expected outcomes

- `models/wake-word/hey_yumi.onnx` and the feature model list.
- `models/wake-word/RESULTS.md`.

## Out of scope

- Running the model in the apps, including porting the audio feature step: [OBJ-16](OBJ-16-mac-wake-word.md) (Mac), [OBJ-24](OBJ-24-android-voice-intake.md) (Android).
- Training the p1 stop keywords: [OBJ-55](OBJ-55-voice-stop-keyword-models.md).
- The full training notebook. Skip it for the hackathon.

## Outcome

Blocked: training and the required acoustic evaluation need an authenticated Colab run, teammate voice samples, and an approved hour of representative non-wake audio.
Jepoy can unblock the model work by running the official notebook and coordinating those recordings; this environment has no Colab session or team audio corpus.
`python scripts/objectives.py check` and `python scripts/verify.py` pass.
The Android unit-test attempt stopped before execution because the Android SDK is not installed; macOS tools and a connected phone are also unavailable, so no app end-to-end or device smoke result is claimed.
The SPEC-06 p1 voice-stop model gap is tracked by [OBJ-55](OBJ-55-voice-stop-keyword-models.md).

