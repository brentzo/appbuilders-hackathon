---
id: OBJ-16
title: Mac wake word
product: mac
touches: []
specs: [SPEC-01]
status: todo
priority: p0
depends-on: [OBJ-12, OBJ-15]
tags: [objective, p0, mac, voice]
---

# OBJ-16 Mac wake word

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), Qwen3.5-4B on the Android demo phone (12 GB), Whisper and native on-device speech recognition for voice.
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Saying "Hey Yumi" starts listening hands-free.
openWakeWord ships as a Python library, so its small audio feature step has to be ported to Swift and its models run with ONNX Runtime.
Audio before the wake word is never transcribed, stored, or sent anywhere.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), requirements 9-11, the "Listening modes" scenarios, and "Wake word detector".
- [OBJ-12](OBJ-12-hey-yumi-wake-word.md) results: model files, feature models, threshold.
- The openWakeWord source for its audio feature pipeline. A community C++ port exists and may help.

## Tasks

- [ ] **OBJ-16.1** Add ONNX Runtime to the Mac app and load `hey_yumi.onnx` plus openWakeWord's feature models.
- [ ] **OBJ-16.2** Port the audio feature step (audio frames to features to embeddings) to Swift, matching the Python output on the same audio within a small tolerance.
- [ ] **OBJ-16.3** Run detection on a continuous microphone stream with the threshold from OBJ-12. Keep audio only in a short rolling buffer in memory, and discard it.
- [ ] **OBJ-16.4** On detection: play a short listening sound, turn on the listening indicator, and start the same capture path as push-to-talk, ending when the user stops speaking.
- [ ] **OBJ-16.5** Respect the wake word setting: when off, the microphone is not opened for wake word detection at all. Push-to-talk always works.
- [ ] **OBJ-16.6** Measure CPU use while idle-listening and record it.
- [ ] **OBJ-16.7** Repeat OBJ-12's miss and false-trigger tests through the Mac app, and compare with the Python results.

## Expectations

- [ ] SPEC-01 scenarios pass: "Wake word starts listening", "Wake word turned off", "Speech before the wake word is ignored".
- [ ] Swift features match the Python reference on a fixed test clip.
- [ ] Idle CPU use and the in-app miss and false-trigger rates are in the completion notes.

## Outcomes

- On-device "Hey Yumi" detection in the Mac app, with the Swift feature port and tests.

## Out of scope

- Training or retraining the model: [OBJ-12](OBJ-12-hey-yumi-wake-word.md).
- Android wake word: [OBJ-24](OBJ-24-android-voice-intake.md).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
