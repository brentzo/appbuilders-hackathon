---
id: OBJ-60
title: Filipino-accented wake-word training workflow
product: models
assignee: Jepoy
touches: []
specs: [SPEC-01]
status: todo
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, models, voice]
---

# OBJ-60 Filipino-accented wake-word training workflow

**Product:** [Yumi Models](../models/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted bridge on our VPS.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

OBJ-12 requires synthetic speech in several voices and accents, including Filipino-accented English.
The simple training notebook produced US English clips and advertises mixed-license data for non-commercial personal use only, while its current DeepPhonemizer checkpoint path prevents model export.
This objective establishes a reproducible and license-documented path that can produce a model for OBJ-12 to evaluate.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), the wake word detector decision and evaluation method.
- [OBJ-12](OBJ-12-hey-yumi-wake-word.md), the parent model and end-to-end evaluation objective.
- [Yumi Models README](../models/README.md), product ownership and artifact rules.
- The openWakeWord simple Colab training notebook and its data/model license notices.

## Tasks

- [ ] **OBJ-60.1** Reproduce the notebook failure in a clean runtime and pin or document a supported dependency and checkpoint combination that exports an ONNX model.
- [ ] **OBJ-60.2** Identify synthetic speech sources that provide multiple voices and Filipino-accented English, and record each source's provenance and license.
- [ ] **OBJ-60.3** Resolve whether the training data and resulting model may be used for the hackathon demo and committed to this repository; record the decision and restrictions.
- [ ] **OBJ-60.4** Generate the training set with Filipino-accented English and other voice variation, then export the ONNX model and shared feature models with checksums and source/license notes.
- [ ] **OBJ-60.5** Hand the model and its training manifest to OBJ-12 for teammate miss-rate, one-hour false-trigger, threshold, and device validation.

## Expectations

- [ ] A clean runtime can reproduce the documented training command and produce the ONNX artifact.
- [ ] The training manifest describes the source, voice/accent coverage, and license for every dataset and model artifact.
- [ ] The model's use and repository distribution restrictions are explicit, and the result is suitable for OBJ-12's evaluation.

## Expected outcomes

- A reproducible training workflow or precise pinned setup instructions.
- A Filipino-accented "Hey Yumi" ONNX model and shared feature model manifest, if the applicable licenses permit delivery.
- Training provenance, artifact checksums, and license/use restrictions documented for OBJ-12.

## Out of scope

- Teammate miss testing, false-trigger testing, and threshold selection: [OBJ-12](OBJ-12-hey-yumi-wake-word.md).
- Integrating the detector in the Mac and Android apps: [OBJ-16](OBJ-16-mac-wake-word.md) and [OBJ-24](OBJ-24-android-voice-intake.md).
- Changing wake-word behavior in [SPEC-01](../specs/01-voice-intake.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
