---
id: OBJ-59
title: "\"Hey Yumi\" on Android with Vosk"
product: android
assignee: Brent
touches: []
specs: [SPEC-01, SPEC-10]
status: in-progress
priority: p0
depends-on: []
integrates-with: [OBJ-12, OBJ-24]
tags: [objective, p0, android, voice]
---

# OBJ-59 "Hey Yumi" on Android with Vosk

**Product:** [Yumi on Android](../android/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md), [SPEC-10](../specs/10-android-companion.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The phone still wakes on the "Hey Jarvis" stand-in, and Jepoy's trained "Hey Yumi" model ([OBJ-12](OBJ-12-hey-yumi-wake-word.md)) may not be ready before the hackathon deadline.
SPEC-01's Decisions let the phone spot "Hey Yumi" with Vosk, an offline recognizer limited to that phrase, until OBJ-12's model replaces it.
Sound-alikes waking it are fine for the demo.

## Read first

- SPEC-01 requirements 9 to 12 and its Decisions, and SPEC-10's voice requirements.
- [OBJ-24](OBJ-24-android-voice-intake.md) and its Outcome: the wake word in the foreground service, push-to-talk, and the hand-over to goal capture.
- [android/README.md](../android/README.md) and [wiki/android-voice-intake.md](../wiki/android-voice-intake.md).
- Vosk's Android library and model pages, for licence, model size, and the grammar (limited vocabulary) mode; verify facts there.

## Tasks

- [ ] **OBJ-59.1** Check Vosk's licence, the small English model's size and licence, and that it runs offline on the demo phone; record them.
- [ ] **OBJ-59.2** Add a Vosk spotter limited to "hey yumi" plus an unknown-word catch-all, running in the foreground service in place of the openWakeWord stand-in, and accept common sound-alikes.
- [ ] **OBJ-59.3** Ship the model with the app or install it ahead of time, never downloaded at first run, and keep the app's no-internet promise.
- [ ] **OBJ-59.4** Hand over to the existing goal capture after the phrase, as the stand-in did, and never keep or log what was heard before it.
- [ ] **OBJ-59.5** Keep the openWakeWord path so OBJ-12's `hey_yumi.onnx` can replace Vosk with a small switch when it is ready.
- [ ] **OBJ-59.6** Tests, then a live check on the demo phone: "Hey Yumi" at arm's length, a minute of normal talk, battery and CPU for a short run.

## Expectations

- [ ] Saying "Hey Yumi" at arm's length wakes the demo phone and captures the goal said after it.
- [ ] "Hey Jarvis" no longer wakes the phone.
- [ ] No network traffic from Yumi during spotting.

## Expected outcomes

- A Vosk "Hey Yumi" spotter in the Android app, its model and licences recorded, and a short wiki note with the measurements.

## Out of scope

- Training the openWakeWord model: [OBJ-12](OBJ-12-hey-yumi-wake-word.md).
- The Mac: [OBJ-58](OBJ-58-mac-hey-yumi-recognizer.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
