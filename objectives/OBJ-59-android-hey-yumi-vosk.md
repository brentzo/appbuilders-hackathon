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

- [x] **OBJ-59.1** Check Vosk's licence, the small English model's size and licence, and that it runs offline on the demo phone; record them.
- [x] **OBJ-59.2** Add a Vosk spotter limited to "hey yumi" plus an unknown-word catch-all, running in the foreground service in place of the openWakeWord stand-in, and accept common sound-alikes.
- [x] **OBJ-59.3** Ship the model with the app or install it ahead of time, never downloaded at first run, and keep the app's no-internet promise.
- [x] **OBJ-59.4** Hand over to the existing goal capture after the phrase, as the stand-in did, and never keep or log what was heard before it.
- [x] **OBJ-59.5** Keep the openWakeWord path so OBJ-12's `hey_yumi.onnx` can replace Vosk with a small switch when it is ready.
- [x] **OBJ-59.6** Tests, then a live check on the demo phone: "Hey Yumi" at arm's length, a minute of normal talk, battery and CPU for a short run.

## Expectations

- [x] Saying "Hey Yumi" at arm's length wakes the demo phone and captures the goal said after it.
- [ ] "Hey Jarvis" no longer wakes the phone.
- [x] No network traffic from Yumi during spotting.

## Expected outcomes

- A Vosk "Hey Yumi" spotter in the Android app, its model and licences recorded, and a short wiki note with the measurements.

## Out of scope

- Training the openWakeWord model: [OBJ-12](OBJ-12-hey-yumi-wake-word.md).
- The Mac: [OBJ-58](OBJ-58-mac-hey-yumi-recognizer.md).

## Outcome

- **Result:** Done except one check on the phone: whether "Hey Jarvis" still wakes it with a real voice. Left in progress until Brent confirms or accepts it as is.
- **Delivered:** `android/app/src/main/java/ai/yumi/android/voice/wakeword/VoskSpotter.kt` (the grammar-limited spotter and the model unpacking), `WakeWordSpotter.kt` (the spotter interface and the `WakeWordChoice` switch), `MicrophoneWakeWordDetector.kt` (the microphone loop both spotters share, formerly `OpenWakeWordDetector`), `VoskSpotterTest`, the `fetchVoskModel` task in `android/app/build.gradle.kts`, the licences and decision in [android/README.md](../android/README.md), and the measurements in [wiki/android-hey-yumi-vosk.md](../wiki/android-hey-yumi-vosk.md). Also synced the Android design tokens from `character/design/generated/YumiTheme.kt`.
- **Commits:** `e916dc6 docs(objectives): start OBJ-59`, `7a94ac6 feat(android): spot "Hey Yumi" with Vosk until OBJ-12's model is ready`, `f3ca922 chore(android): sync the design tokens from character/design`, and this one.
- **Expectations:**
  - "Hey Yumi" at arm's length: on the demo phone at 3:11 am, Brent's voice woke it 3 times and each goal was handed over (logcat `YumiWakeWord` and `YumiVoice`); Brent: "It worked just fine, and normally."
  - "Hey Jarvis": 0 of 6 wake-ups with synthesized voices on the Mac, and only finished utterances count (`VoskSpotterTest`). Not confirmed on the phone, see below.
  - No network traffic: the merged manifest and `dumpsys package` show no internet permission, and `dumpsys netstats detail` holds no traffic entries for Yumi's uid after the test.
- **Not verified:** "Hey Jarvis" on the phone with a real voice. Brent: say "Hey Jarvis" 3 times at arm's length with Yumi open; nothing should happen. One wake-up at 3:13:08 am, as the phone was locked, was followed by no goal; it is not known whether it was Brent's locked-phone try or a false trigger. Also not measured: an hour-long idle run, battery drain off USB, and false triggers from everyday Taglish, TV, and music.
- **Decisions and deviations:** the model is fetched at build time with a pinned SHA-256 into Gradle's cache, not committed, to keep 70 MB of binaries out of git; the first build on a machine needs internet, the app never does. Only finished Vosk utterances count, because its in-progress guesses read "hey yumi" for "Hey Jarvis" for a moment. The settings "stand-ins" copy now describes the simpler "Hey Yumi" listener instead of "Hey Jarvis".
- **For the next objectives:** OBJ-12: put `hey_yumi.onnx` in `android/app/src/main/assets/wakeword/`, point `WakeWordConfig.Current` at it, and set `WakeWordChoice.Current` to `OpenWakeWord`; then the Vosk dependency, the `fetchVoskModel` task, and `VoskSpotter` can be removed. Installing over a build from another machine fails on the debug signature: uninstall first (the app keeps only its settings file). Idle listening is about 6% of one core and the app uses about 267 MB with the model loaded.
