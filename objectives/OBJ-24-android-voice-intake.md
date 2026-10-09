---
id: OBJ-24
title: Android voice intake and wake word
product: android
touches: []
specs: [SPEC-01, SPEC-10]
status: todo
priority: p0
depends-on: [OBJ-12, OBJ-22]
tags: [objective, p0, android, voice]
---

# OBJ-24 Android voice intake and wake word

**Product:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md), [SPEC-10](../specs/10-android-companion.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The phone is the other place users talk to Yumi.
This objective makes the mic button and "Hey Yumi" work on Android for Part A (p0), with all transcription on the phone and never in the cloud.
Part A has no model and no Whisper, so the phone understands English only, through Android's on-device recognizer.
Whisper and Taglish on the phone come with SPEC-10 Part B (p1).
The transcript goes to a single entry point that the Part A routing objective will connect.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), requirements 1, 2, 8-12, the "Listening modes" and "Voice intake on Android" scenarios, and "Wake word detector".
- [SPEC-10](../specs/10-android-companion.md), Part A requirement 1 and the "English speech is transcribed on the phone" and "No on-device model for the language" scenarios.
- [OBJ-12](OBJ-12-hey-yumi-wake-word.md) results (wake word files and threshold).
- [OBJ-22](OBJ-22-android-app-shell.md) completion notes.

## Tasks

- [ ] **OBJ-24.1** Mic button: tap to start, stop when the user stops speaking. Show the listening indicator only while the microphone is on.
- [ ] **OBJ-24.2** Native recognizer with `SpeechRecognizer.createOnDeviceSpeechRecognizer`, English. Never use the default recognizer, which may use the cloud.
- [ ] **OBJ-24.3** If the on-device recognizer has no model for the spoken language, show the SPEC-11 "Language not supported on this phone" copy with "Try again" and "Type instead". Never fall back to a cloud recognizer.
- [ ] **OBJ-24.4** Wake word in the foreground service: ONNX Runtime for Android, `hey_yumi.onnx`, the feature models, and a Kotlin port of the audio feature step that matches the Python reference.
- [ ] **OBJ-24.5** Keep audio before the wake word only in a short in-memory buffer, and discard it.
- [ ] **OBJ-24.6** Respect the wake word setting: when off, do not open the microphone for detection.
- [ ] **OBJ-24.7** Handle silence or unusable audio with the SPEC-11 "Didn't catch speech" copy and its "Try again" and "Type instead" buttons. "Type instead" opens a text box that accepts a goal the same way as speech.
- [ ] **OBJ-24.10** Handle a missing microphone permission with the SPEC-11 "Microphone permission missing" copy.
- [ ] **OBJ-24.8** Hand the transcript to a single `onGoal(text)` entry point that the Part A routing objective will connect (phone-only rule or delegate to the Mac). For now, show the transcript on screen.
- [ ] **OBJ-24.9** Measure battery and CPU while idle-listening for an hour on the demo phone, and the miss and false-trigger rates in the app.

## Expectations

- [ ] SPEC-01 scenarios pass on the demo phone: "Push-to-talk on the phone", "Wake word starts listening", "Wake word turned off", "Speech before the wake word is ignored".
- [ ] SPEC-10 scenarios pass: "English speech is transcribed on the phone", "No on-device model for the language".
- [ ] No audio is sent to a cloud recognizer, verified by the recognizer choice and a traffic check.
- [ ] Battery, CPU, miss, and false-trigger numbers are in the completion notes.

## Outcomes

- Mic button, the on-device English recognizer, typed goals, the wake word in the foreground service, the Kotlin feature port, and the `onGoal` entry point.

## Out of scope

- Repeating the goal back and confirming on the phone, and deciding phone or Mac: the Part A routing objective (SPEC-09, SPEC-10 Part A), not written yet.
- Whisper and Taglish on the phone: SPEC-10 Part B (p1).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
