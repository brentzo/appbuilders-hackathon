# Yumi for Android

The Android app.
It is built in two parts ([SPEC-10](../specs/10-android-companion.md)):

- **Part A (p0), tool host and voice remote.** No model. The phone listens, runs a few phone-only jobs through Android intents, offers phone tools to the Mac, and delegates every other goal to the Mac ([SPEC-09](../specs/09-cross-device-routing.md)).
- **Part B (p1), phone brain.** A local model on the phone decides phone or Mac, controls other apps through accessibility, and is the brain when the Mac is unreachable.

Owner: Brent.

Status: empty scaffold, nothing built yet.

## Devices

- **Demo phone:** 12 GB RAM (teammate's). Advertised as "12 GB + 6 GB", but the extra 6 GB is extended RAM: storage used as slow swap, not real memory. Runs Part A and Part B.
- **Development phone:** 8 GB RAM (Brent's). Part A only.

## Responsibilities

### Part A (p0)

- **App shell:** home screen with the Rive cat, settings, permission onboarding, and a foreground service with a persistent notification that includes "Stop".
- **Voice:** mic button, "Hey Yumi" wake word ([SPEC-01](../specs/01-voice-intake.md)), and Android's on-device recognizer, English only. Speaking replies.
- **Phone-only goals:** a fixed rule, no model. Set alarm, set timer, and open app run through intents. Everything else is delegated to the Mac.
- **Phone tools for the Mac:** `set_alarm`, `set_timer`, `open_app`.
- **Delegated goals:** send the confirmed goal to the Mac, show "Working on your Mac" with the current subtask and Stop, ask for risky-action approvals, and speak the result.
- **Bridge client:** pairing by QR scan, encrypted and signed messages, connection state, at-most-once execution ([SPEC-08](../specs/08-device-bridge.md)).

### Part B (p1)

- **On-device model:** one fixed model that replaces the Part A rule and is the brain when the Mac is unreachable.
- **Whisper on the phone,** so Taglish works on the phone too.
- **App control:** Accessibility Service, element tree first, screenshots only when needed, 10-step limit.
- **More phone tools:** `get_location`, `read_recent_photos`, `phone_gui_act`.
- **Waking the Mac:** Wake-on-LAN over local Wi-Fi.

## Not responsible for

- Planning Mac work. A goal that is not phone-only goes to the Mac as a whole, and the Mac plans it.

## Initial technical plan

- Kotlin with Jetpack Compose. Minimum Android 12 (API 31), needed for the on-device speech recognizer.
- Speech (Part A): `SpeechRecognizer.createOnDeviceSpeechRecognizer`, English only, never the cloud. Other languages get the "Language not supported on this phone" error from [SPEC-11](../specs/11-user-facing-errors.md).
- Speech (Part B): whisper.cpp through JNI.
- Speech output: Android `TextToSpeech`, behind a `speak` interface.
- Wake word: openWakeWord models with ONNX Runtime for Android, inside the foreground service.
- Foreground service type `specialUse` or `connectedDevice` for the bridge, never `dataSync` (it has a daily time limit on Android 15), plus `microphone` for the wake word.
- Bridge: OkHttp WebSocket in the foreground service, lazysodium for crypto, types generated from [protocol](../protocol/README.md).
- QR scanning: CameraX with an on-device barcode scanner.
- Cat: Rive's Android runtime playing the `.riv` file from [character](../character/README.md).
- Model runtime (Part B): MNN or llama.cpp, chosen after benchmarking.
- Sideloaded for the hackathon. See the setup checklist in SPEC-10.

## Decisions

- **Part B model:** Qwen3.5-4B, fixed (SPEC-10 requirement 9). 9B (~6 GB plus context) was too tight on 12 GB of real RAM, and 4B scores about the same on phone tasks (AndroidWorld 58.6 vs 57.8). Decided 2026-10-09.

## Specs

- [SPEC-01 Voice intake and confirmation](../specs/01-voice-intake.md)
- [SPEC-08 Device bridge](../specs/08-device-bridge.md)
- [SPEC-09 Cross-device routing](../specs/09-cross-device-routing.md)
- [SPEC-10 Yumi on Android](../specs/10-android-companion.md)
- Always follows [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md).

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-22](../objectives/OBJ-22-android-app-shell.md) | Android app shell and foreground service | Brent | todo |
| [OBJ-23](../objectives/OBJ-23-android-bridge-client.md) | Android bridge client and pairing | Brent | todo |
| [OBJ-24](../objectives/OBJ-24-android-voice-intake.md) | Android voice intake and wake word | Brent | todo |
<!-- generated:product-objectives:end -->

Not written yet: Part A phone-only goals, phone tools, and delegated goals (SPEC-09 and SPEC-10 Part A), and everything in Part B.
