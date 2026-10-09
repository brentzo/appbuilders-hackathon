# Yumi for Android

The Android app.
It lets the user talk to Yumi from the phone, runs its own small model on the phone, controls other apps, offers phone tools to the Mac, and stays connected to the bridge in the background.

Status: empty scaffold, nothing built yet.

## Devices

- **Demo phone:** 12 GB RAM (teammate's). Advertised as "12 GB + 6 GB", but the extra 6 GB is extended RAM: storage used as slow swap, not real memory. Runs Qwen3.5-4B. Qwen3.5-9B is too tight to run reliably.
- **Development phone:** 8 GB RAM (Brent's). Runs 4B, or falls back to 2B.

## Responsibilities

- **App shell:** home screen with the Rive cat, settings, permission onboarding, and a foreground service with a persistent notification that includes "Stop".
- **Voice:** mic button (push-to-talk), "Hey Yumi" wake word, on-device speech recognition, speaking replies ([SPEC-01](../specs/01-voice-intake.md)).
- **Bridge client:** pairing by QR scan, encrypted and signed messages, connection state, at-most-once execution ([SPEC-08](../specs/08-device-bridge.md)).
- **On-device model and app control:** Qwen3.5 on the phone, Accessibility Service control, intents, phone tools for the Mac. Defined by SPEC-10, which is not finalized yet.
- **Phone or laptop routing:** decide where a goal spoken on the phone runs. Defined by SPEC-09, which is not finalized yet.

## Not responsible for

- Planning Mac tasks. Goals for the laptop are sent to the Mac harness.

## Initial technical plan

- Kotlin with Jetpack Compose. Minimum Android 12 (API 31), needed for the on-device speech recognizer.
- Speech: `SpeechRecognizer.createOnDeviceSpeechRecognizer` for native on-device recognition, whisper.cpp through JNI for Whisper. Never cloud.
- Speech output: Android `TextToSpeech`, behind a `speak` interface.
- Wake word: openWakeWord models with ONNX Runtime for Android, inside the foreground service.
- Bridge: OkHttp WebSocket in the foreground service, lazysodium for crypto, types generated from [protocol](../protocol/README.md).
- QR scanning: CameraX with an on-device barcode scanner.
- Cat: Rive's Android runtime playing the `.riv` file from [character](../character/README.md).
- Model runtime: MNN or llama.cpp, decided in SPEC-10.
- Sideloaded for the hackathon. Apps using an Accessibility Service face Play Store review limits.

## Specs

- [SPEC-01 Voice intake and confirmation](../specs/01-voice-intake.md)
- [SPEC-08 Device bridge](../specs/08-device-bridge.md)
- Not finalized yet: [SPEC-09 Cross-device routing](../specs/09-cross-device-routing.md), [SPEC-10 Yumi on Android](../specs/10-android-companion.md).
- Always follows [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md).

## Objectives

| ID | Objective | Status |
|---|---|---|
| [OBJ-22](../objectives/OBJ-22-android-app-shell.md) | Android app shell and foreground service | todo |
| [OBJ-23](../objectives/OBJ-23-android-bridge-client.md) | Android bridge client and pairing | todo |
| [OBJ-24](../objectives/OBJ-24-android-voice-intake.md) | Android voice intake and wake word | todo |
