---
id: OBJ-22
title: Android app shell and foreground service
product: android
assignee: Brent
touches: [character]
specs: [SPEC-10, SPEC-08, SPEC-01]
status: in-progress
priority: p0
depends-on: []
integrates-with: [OBJ-10]
tags: [objective, p0, android]
---

# OBJ-22 Android app shell and foreground service

**Product:** [Yumi for Android](../android/README.md) · **Also touches:** [character](../character/README.md) · **Specs:** [SPEC-10](../specs/10-android-companion.md), [SPEC-08](../specs/08-device-bridge.md), [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

This creates the Android app every other Android objective builds on: a home screen with the cat, permission onboarding, and a foreground service that keeps Yumi running in the background for the bridge connection and the wake word.
Android only lets a background app stay alive this way, with a visible notification.

## Read first

- [android/README.md](../android/README.md).
- [SPEC-10](../specs/10-android-companion.md), Part A requirements 4-6 and the "Setup checklist".
- [SPEC-01](../specs/01-voice-intake.md) requirement 12 (wake word inside the foreground service) and [SPEC-08](../specs/08-device-bridge.md) requirement 10 (connection state).
- [character/README.md](../character/README.md), "State machine contract".
- [SPEC-11](../specs/11-user-facing-errors.md), "Permission missing (Android)".
- Current Android rules for foreground service types on Android 14 and 15.

## Tasks

- [x] **OBJ-22.1** Create the Android project in `android/`: Kotlin, Jetpack Compose, minimum Android 12 (API 31), using the generated Kotlin types from `protocol/`.
- [x] **OBJ-22.2** Home screen with the Rive cat (Rive Android runtime, `character/yumi-cat.riv`) showing idle and listening states, a mic button, and a connection state line. Until Patrick's [OBJ-10](OBJ-10-yumi-cat-v0.md) ships the file, use a static placeholder image and swap it in later.
- [x] **OBJ-22.3** Foreground service with a persistent notification that shows Yumi's state and has a "Stop" action. Use type `specialUse` or `connectedDevice` for the bridge connection, never `dataSync` (it has a daily time limit on Android 15), plus `microphone` for the wake word. Verify against the current docs.
- [x] **OBJ-22.4** Permission onboarding for microphone and notifications: one plain sentence on why, then "Allow" and "Not now". Other permissions are asked only when a tool first needs them. If the app is in the background at that moment, post a notification explaining why, which opens the app to show the Android permission dialog.
- [x] **OBJ-22.5** Map structured error kinds to the SPEC-11 copy and buttons in one error presenter. Unknown kinds use the "Unexpected" copy.
- [x] **OBJ-22.6** Settings screen: wake word on or off, and pairing (placeholder until [OBJ-23](OBJ-23-android-bridge-client.md)).
- [x] **OBJ-22.7** First-run setup asks to ignore battery optimization, with a plain explanation, so Doze and phone-maker battery savers do not drop the connection.
- [ ] **OBJ-22.8** Install and run on both the 12 GB demo phone and the 8 GB development phone. Check light and dark mode and fix anything that looks off.

## Expectations

- [ ] The service survives leaving the app and locking the screen for at least 30 minutes on the demo phone.
- [x] SPEC-10 scenario "Permission asked from the background" passes, using a test tool.
- [x] "Stop" in the notification stops the service.
- [x] The cat plays and switches between idle and listening.
- [x] No raw Android or library error text reaches the user.

## Expected outcomes

- The `android/` project with home screen, cat, onboarding, settings, foreground service, and the error presenter.
- Build, install, and sideload instructions in `android/README.md`.

## Out of scope

- Bridge connection: [OBJ-23](OBJ-23-android-bridge-client.md). Voice: [OBJ-24](OBJ-24-android-voice-intake.md).
- Phone-only goals, phone tools, and delegated goals: SPEC-09 and SPEC-10 Part A, objectives not written yet.
- Everything in SPEC-10 Part B (p1).

## Outcome

Not finished: the 12 GB demo phone checks (OBJ-22.8 and the 30-minute expectation) are still open, so this stays in-progress.
Notes from the work so far:

- **Delivered:**
  - The Gradle project in `android/` (Kotlin 2.4, Jetpack Compose, minimum Android 12, target Android 16), with the Gradle wrapper and `android/.gitignore`.
  - Home screen, onboarding, and settings in `android/app/src/main/java/ai/yumi/android/ui/`.
  - The foreground service `service/YumiService.kt`, with its persistent notification and Stop action in `notifications/YumiNotifications.kt`.
  - The error presenter: `errors/ErrorKind.kt`, the SPEC-11 copy in `errors/ErrorCopy.kt`, and `errors/ErrorPresenter.kt`.
  - Tool permissions from anywhere, including the background: `permissions/PermissionCoordinator.kt`, plus a debug-only test tool (`tools/TestPermissionTool.kt`, `src/debug/.../TestToolReceiver.kt`).
  - Build, install, and sideload steps and a code map in [android/README.md](../android/README.md).
- **Commits:**
  - `b4728e5 docs(objectives): mark OBJ-22 in progress`
  - `b119e1e build(android): add Gradle project and wrapper`
  - `b0509e2 feat(android): add app shell with home, onboarding, settings, and foreground service`
  - `cf9e32b fix(android): guard specialUse on Android 12 and 13, exclude data from backup, and update libraries`
  - `ab7fa3e fix(android): show quotes in copy, center the home screen, and skip the in-app card when coming from a permission notification`
  - `baa0662 fix(android): remove the service notification when the service stops`
  - `e279afe docs(android): add build, install, and sideload steps`
- **Expectations:**
  - Survives 30 minutes in the background with the screen locked, on the demo phone: not verified on the demo phone. On the development phone (Samsung Galaxy A56, SM-A566B, Android 16, 8 GB), the service kept the same process and stayed in the foreground for 30 minutes in the background with deep Doze forced (`dumpsys deviceidle force-idle`) and the charger simulated as unplugged. The screen was off and locked for the first 15 to 20 minutes, then someone unlocked the phone, so a clean 30 minutes locked is still open there too.
  - SPEC-10 "Permission asked from the background": passed on the development phone with the debug test tool. Leaving the app posted "I need permission to use your location for this.", and tapping it opened the app straight into the Android location dialog. The tool received the answer. Also covered by `PermissionCoordinatorTest.permissionAskedFromTheBackground`.
  - "Stop" in the notification: on the development phone the service stopped, its notification was removed, and the home screen offered "Start again".
  - The cat switches between idle and listening: verified on the development phone with the placeholder cat (ears perk up, eyes widen, a soft pulse). The Rive cat is not in yet.
  - No raw error text reaches the user: all UI error text comes from `ErrorPresenter`, which maps only `YumiException` kinds and shows "Unexpected" for anything else. `ErrorPresenterTest.rawErrorNeverReachesTheUser` throws a `java.net.SocketException("ECONNRESET...")` and checks the text, speech, and buttons never contain it and that it is logged. `ErrorCopySpecTest` parses the SPEC-11 table and fails if the code drifts.
  - Light and dark mode: checked on the development phone (home, onboarding, settings, error card, permission card, typed goal) and on an API 36 emulator before the switch to the phone. Fixed missing quotes around "Hey Yumi", the cat's ear outline, and the home layout, which left a large empty gap.
  - Build: `./gradlew assembleDebug testDebugUnitTest lintDebug` passes, 15 unit tests, no lint errors or warnings except "newer version available" notices.
- **Not verified:**
  - Everything on the 12 GB demo phone (OBJ-22.8 and the 30-minute expectation). Steps for Brent:
    1. Install as in [android/README.md](../android/README.md), go through setup, and allow "Stop optimising battery usage".
    2. Check the notification shows "Yumi is running".
    3. Press Home, lock the phone, unplug it, and leave it untouched for 30 minutes.
    4. Unlock and run `adb shell dumpsys activity services ai.yumi.android | grep isForeground`: it must say `isForeground=true`, and the notification must still be there.
    5. Repeat steps 3 and 4 once with the phone maker's own battery settings at their default, since phone makers add savers on top of Android.
    6. Look through every screen in light and dark mode.
  - A clean 30 minutes locked on the development phone: same steps 3 and 4.
  - On Android 12 or 13: only built for, not run. The service runs with no type there (`specialUse` exists from Android 14), and the notifications step is skipped because Android 12 has no runtime permission for it.
- **Decisions and deviations:**
  - Service type: `specialUse` for the connection (declared with a `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` reason), plus `microphone` only while the wake word is on and the microphone is allowed. Checked against the current Android docs: `dataSync` is not used, and `connectedDevice` is for nearby hardware and needs Bluetooth, USB, or network-change permissions. Android only lets the app add `microphone` while the app is in the foreground, so the service tries it, and on failure falls back to `specialUse` alone and logs it.
  - OBJ-22.1 says "using the generated Kotlin types from protocol/". They do not exist yet, so `protocol/TemporaryTypes.kt` holds a minimal `ConnectionState`, and `ErrorKind` is local. Both are marked temporary.
  - The cat is a drawn placeholder behind `CatRenderer` and `LocalCatRenderer`. The Rive runtime is not added yet: the state machine inputs are not defined (OBJ-10), and an unused native library would only add size.
  - The mic button drives a stand-in `VoiceInput` that switches the cat to listening without opening the microphone. "Type instead" works and shows the goal on the home screen.
  - "Stop" in the notification also turns off "Keep Yumi running" in settings, so the app does not restart the service on the next open. The home screen then explains this and offers "Start again".
  - "Allow" on a permission Android will no longer ask for (denied twice) opens Yumi's app settings instead of doing nothing, and reads the answer when the user comes back.
  - The "Unexpected" copy with no last action drops the sentence "Here's the last thing I did: ..." instead of showing a blank. SPEC-11 does not cover this case; see the questions in the final report.
  - Libraries are the newest that compile against the installed Android SDK 36 with AGP 8.13. Newer AndroidX releases need compileSdk 37 and AGP 9, which means installing SDK 37.
  - Backups are off and data extraction rules exclude everything, so pairing keys (OBJ-23) never leave the phone.
- **For the next objectives:**
  - OBJ-23: implement `service/Seams.kt` `BridgeConnection` and swap `UnpairedBridgeConnection` in `AppGraph.kt`. `start(scope)` runs once inside the foreground service, with a scope that ends when the service stops. Its `state` drives the home screen line and the notification text. Replace `protocol/TemporaryTypes.kt` with the generated types. The pairing row in settings is a disabled "Pair now" button. Throw `YumiException(ErrorKind.BridgeDown)` or `ErrorKind.UnpairedDevice` and show them with `graph.errors.present(...)`. The app needs `INTERNET` added to the manifest.
  - OBJ-24: implement `WakeWordDetector` (the service only calls `start` while it holds the `microphone` type) and `VoiceInput` in `voice/VoiceInput.kt`, and route transcripts to `GoalSink.onGoal`. `graph.errors` already has the copy for "Microphone permission missing", "Didn't catch speech", and "Language not supported on this phone". The wake word switch in settings is already stored (`SettingsStore.wakeWordEnabled`), and the service re-reads it.
  - New tool permissions: add a `ToolPermission` entry and call `graph.permissions.ensure(...)` with a timeout. SPEC-11 only has copy for location today.
  - OBJ-10: implement `CatRenderer` with the Rive runtime and provide it through `LocalCatRenderer`. The app uses `CatState.Idle` and `CatState.Listening`.
