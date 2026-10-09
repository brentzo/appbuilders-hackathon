---
id: OBJ-55
title: Voice stop keyword models
product: models
assignee: Jepoy
touches: [mac, android]
specs: [SPEC-06]
status: todo
priority: p1
depends-on: []
integrates-with: [OBJ-35]
tags: [objective, p1, models, voice, safety]
---

# OBJ-55 Voice stop keyword models

**Product:** [Yumi Models](../models/README.md) · **Also touches:** [mac](../mac/README.md), [android](../android/README.md) · **Specs:** [SPEC-06](../specs/06-user-control.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-06 requirement 10 needs a fast detector that can recognize stop phrases while Yumi is speaking, without waiting for the full speech pipeline.
This objective produces and measures the local keyword models that the Mac and Android apps can integrate.

## Read first

- [SPEC-06](../specs/06-user-control.md), requirement 10 and the "Voice stop" scenarios.
- [models/README.md](../models/README.md), including the model manifest and voice recording rules.
- [OBJ-12](OBJ-12-hey-yumi-wake-word.md) results and training settings, when available.
- The Outcomes of [OBJ-35](OBJ-35-mac-stop-and-take-over.md) and [OBJ-24](OBJ-24-android-voice-intake.md).

## Tasks

- [ ] **OBJ-55.1** Choose and document a fully local detector and training method that supports "stop", "teka", "tama na", and "hinto"; reuse OBJ-12's pipeline where it supports these phrases.
- [ ] **OBJ-55.2** Train the keyword model files with phrase and negative audio that covers the supported phrases and Filipino-accented English.
- [ ] **OBJ-55.3** Measure missed commands and false stops across speech, music, and device playback; select and record thresholds for each supported phrase.
- [ ] **OBJ-55.4** Record model sources, licenses, checksums, sizes, thresholds, and evaluation results in the manifest and `models/voice-stop/RESULTS.md`.

## Expectations

- [ ] SPEC-06 scenarios pass: "User says stop", "User says stop while Yumi is talking".
- [ ] The model supports all four phrases locally and detects them while speech playback is active.
- [ ] Misses and false stops are measured and documented with thresholds and the tested audio conditions.

## Expected outcomes

- Local voice stop detector model files and `models/voice-stop/RESULTS.md`.
- Manifest entries with pinned sources, licenses, checksums, and per-phrase thresholds.

## Out of scope

- Integrating the detector into the Mac app: [OBJ-35](OBJ-35-mac-stop-and-take-over.md) or its p1 follow-up.
- Android touch, notification stop, and connection-loss pause: SPEC-06 requirements 11-13.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._