---
id: OBJ-22
title: Android app shell and foreground service
product: android
touches: [character]
specs: [SPEC-08, SPEC-01]
status: todo
priority: p0
depends-on: [OBJ-10]
tags: [objective, p0, android]
---

# OBJ-22 Android app shell and foreground service

**Product:** [Yumi for Android](../android/README.md) · **Also touches:** [character](../character/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md), [SPEC-01](../specs/01-voice-intake.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), Qwen3.5-4B on the Android demo phone (12 GB), Whisper and native on-device speech recognition for voice.
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

This creates the Android app every other Android objective builds on: a home screen with the cat, permission onboarding, and a foreground service that keeps Yumi running in the background for the bridge connection and the wake word.
Android only lets a background app stay alive this way, with a visible notification.

## Read first

- [android/README.md](../android/README.md).
- [SPEC-01](../specs/01-voice-intake.md) requirement 12 (wake word inside the foreground service) and [SPEC-08](../specs/08-device-bridge.md) requirement 10 (connection state).
- [character/README.md](../character/README.md), "State machine contract".
- [SPEC-11](../specs/11-user-facing-errors.md), "Permission missing (Android)".
- Current Android rules for foreground service types on Android 14 and later.

## Tasks

- [ ] **OBJ-22.1** Create the Android project in `android/`: Kotlin, Jetpack Compose, minimum Android 12 (API 31), using the generated Kotlin types from `protocol/`.
- [ ] **OBJ-22.2** Home screen with the Rive cat (Rive Android runtime, `character/yumi-cat.riv`) showing idle and listening states, a mic button, and a connection state line.
- [ ] **OBJ-22.3** Foreground service with a persistent notification that shows Yumi's state and has a "Stop" action. Declare the foreground service types the current Android rules require (microphone for the wake word, plus a type that fits a persistent connection). Verify against the current docs.
- [ ] **OBJ-22.4** Permission onboarding for microphone and notifications: one plain sentence on why, then "Allow" and "Not now". Other permissions are asked only when a feature first needs them.
- [ ] **OBJ-22.5** Map structured error kinds to the SPEC-11 copy and buttons in one error presenter. Unknown kinds use the "Unexpected" copy.
- [ ] **OBJ-22.6** Settings screen: wake word on or off, and pairing (placeholder until [OBJ-23](OBJ-23-android-bridge-client.md)).
- [ ] **OBJ-22.7** Ask to be excluded from battery optimization, with a plain explanation, so the service is not killed.
- [ ] **OBJ-22.8** Install and run on both the 12 GB demo phone and the 8 GB development phone. Check light and dark mode and fix anything that looks off.

## Expectations

- [ ] The service survives leaving the app and locking the screen for at least 30 minutes on the demo phone.
- [ ] "Stop" in the notification stops the service.
- [ ] The cat plays and switches between idle and listening.
- [ ] No raw Android or library error text reaches the user.

## Outcomes

- The `android/` project with home screen, cat, onboarding, settings, foreground service, and the error presenter.
- Build, install, and sideload instructions in `android/README.md`.

## Out of scope

- Bridge connection: [OBJ-23](OBJ-23-android-bridge-client.md). Voice: [OBJ-24](OBJ-24-android-voice-intake.md).
- On-device model and app control: SPEC-10, not finalized.

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
