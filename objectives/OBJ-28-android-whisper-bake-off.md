---
id: OBJ-28
title: Android Whisper bake-off
product: models
assignee: Jepoy
touches: [android]
specs: [SPEC-01, SPEC-10]
status: todo
priority: p1
depends-on: []
integrates-with: [OBJ-11, OBJ-24]
tags: [objective, p1, models, android, voice]
---

# OBJ-28 Android Whisper bake-off

**Product:** [Yumi Models](../models/README.md) · **Also touches:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md), [SPEC-10](../specs/10-android-companion.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and the phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-01 and SPEC-10 place Whisper on Android in p1.
This objective measures whisper.cpp on the 12 GB demo phone with the Android p1 model loaded and records the phone-specific choice.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), "Whisper model options" and the Android p1 scenario.
- [SPEC-10](../specs/10-android-companion.md), Part B requirements 9, 11, and 16.
- [OBJ-11](OBJ-11-whisper-bake-off.md) results and benchmark tooling.
- [models/README.md](../models/README.md), model and recording rules.

## Tasks

- [ ] **OBJ-28.1** Reuse the consented Taglish corpus and add phone recordings only if they are needed to cover the device's microphone and noise conditions.
- [ ] **OBJ-28.2** Run the selected Whisper options through whisper.cpp on the 12 GB demo phone, recording WER and warm end-of-speech-to-transcript latency.
- [ ] **OBJ-28.3** Measure peak memory and latency with Qwen3.5-4B loaded as specified by SPEC-10 Part B.
- [ ] **OBJ-28.4** Choose the smallest option whose errors do not change what Yumi repeats back and update SPEC-01 and the models manifest.
- [ ] **OBJ-28.5** Confirm the selected model variant is supported by the Android whisper.cpp build, then record its license, download source, and checksum in the models manifest.

## Expectations

- [ ] Results use real, consented Taglish recordings and include any skipped option with a reason.
- [ ] The selected model fits alongside Qwen3.5-4B on the 12 GB demo phone.
- [ ] Model variants, licenses, and checksums are recorded in the models manifest.
- [ ] SPEC-01's Android p1 Whisper choice is resolved.
- [ ] No voice recordings are committed.

## Expected outcomes

- Android p1 Whisper measurements in `models/whisper/RESULTS.md`.
- Updated SPEC-01 and the models manifest.

## Out of scope

- Mac Whisper measurements and choice: [OBJ-11](OBJ-11-whisper-bake-off.md).
- Wiring Whisper into Android: [OBJ-24](OBJ-24-android-voice-intake.md) and SPEC-10 Part B.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
