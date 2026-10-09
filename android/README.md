# Yumi for Android

The Android app.
It is built in two parts ([SPEC-10](../specs/10-android-companion.md)):

- **Part A (p0), tool host and voice remote.** No model. The phone listens, runs a few phone-only jobs through Android intents, offers phone tools to the Mac, and delegates every other goal to the Mac ([SPEC-09](../specs/09-cross-device-routing.md)).
- **Part B (p1), phone brain.** A local model on the phone decides phone or Mac, controls other apps through accessibility, and is the brain when the Mac is unreachable.

Owner: Brent.

Status: app shell built ([OBJ-22](../objectives/OBJ-22-android-app-shell.md)): home screen with a placeholder cat, permission onboarding, settings, the foreground service, and the error presenter.
Voice intake and the wake word work ([OBJ-24](../objectives/OBJ-24-android-voice-intake.md)), with Vosk spotting "Hey Yumi" ([OBJ-59](../objectives/OBJ-59-android-hey-yumi-vosk.md)) until OBJ-12's trained model exists.
The bridge and the Rive cat are stand-ins until their objectives land.

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
- Wake word: openWakeWord models with ONNX Runtime for Android, inside the foreground service. Until OBJ-12's model is ready, an offline Vosk recognizer limited to "hey yumi" runs there instead (SPEC-01 Decisions).
- Foreground service type `specialUse` or `connectedDevice` for the bridge, never `dataSync` (it has a daily time limit on Android 15), plus `microphone` for the wake word.
- Bridge: OkHttp WebSocket in the foreground service, lazysodium for crypto, types generated from [protocol](../protocol/README.md).
- QR scanning: CameraX with an on-device barcode scanner.
- Cat: Rive's Android runtime playing the `.riv` file from [character](../character/README.md).
- Model runtime (Part B): MNN or llama.cpp, chosen after benchmarking.
- Sideloaded for the hackathon. See the setup checklist in SPEC-10.

## Build, install, and sideload

The project is a standard Gradle build in this folder (Kotlin, Jetpack Compose, minimum Android 12, target Android 16).

### What you need

- JDK 17 or newer (21 works).
- The Android SDK with platform 36 and build-tools 36. Android Studio installs both.
- No global Gradle. Use the wrapper (`./gradlew`), which downloads the pinned Gradle version.

### First-time setup

Tell Gradle where the SDK is, either with `ANDROID_HOME` or a `local.properties` file in this folder (not committed):

```sh
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
```

### Build and test

```sh
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest    # unit tests, including the SPEC-11 copy check
./gradlew lintDebug            # Android lint
```

### Install on a phone over USB

1. On the phone, turn on Developer options (Settings, About phone, Software information, tap "Build number" seven times), then turn on "USB debugging".
2. Connect the phone and tap "Allow" on the USB debugging prompt.
3. Check it shows as `device`: `adb devices -l`.
4. Install and open:

```sh
ANDROID_SERIAL=<serial> ./gradlew installDebug
adb -s <serial> shell am start -n ai.yumi.android/.MainActivity
```

On a phone with a second profile (for example Samsung Secure Folder), install for the main user only: `adb -s <serial> install -r --user 0 app/build/outputs/apk/debug/app-debug.apk`.

### Sideload without a computer

Copy `app-debug.apk` to the phone (for example over a shared drive or chat), open it in the Files app, and allow "Install unknown apps" for that app when Android asks.

### First run

Follow the in-app setup: microphone, notifications, and "Stop optimising battery usage".
Then work through the [SPEC-10 setup checklist](../specs/10-android-companion.md#setup-checklist).
Some phone makers add their own battery saver on top of Android's.
If Yumi stops when the phone is locked, open Yumi's app settings from Yumi's Settings screen and set battery use to Unrestricted.

### Debug-only test hooks

- Settings shows a "Testing" section in debug builds, with a background permission test and a list of the stand-ins in the build.
- The same test tool can run from a computer: `adb shell am broadcast -a ai.yumi.android.debug.RUN_TEST_TOOL -p ai.yumi.android`.
- Logs: `adb logcat -s YumiService YumiError YumiTestTool YumiNotifications Yumi YumiVoice YumiWakeWord`. Transcripts are never logged, only their word count.

### Code map

| Path under `app/src/main/java/ai/yumi/android/` | What it is |
|---|---|
| `AppGraph.kt` | The single object graph. Swap stand-ins here |
| `service/` | `YumiService` (foreground service), the `BridgeConnection` and `WakeWordDetector` seams, and their stand-ins |
| `errors/` | `ErrorKind`, the SPEC-11 copy in `ErrorCopy.kt`, and `ErrorPresenter` |
| `permissions/` | `PermissionCoordinator`: tools ask for permissions from anywhere, including the background |
| `notifications/` | Notification channels, the service notification, and permission request notifications |
| `ui/` | Compose screens: onboarding, home, settings, the cat renderer, and the theme |
| `voice/` | Voice intake: `OnDeviceVoiceInput` (push-to-talk and after the wake word), `SpeechEngine` (the on-device recognizer only), `MicrophoneOwner`, the listening chime, and the `GoalSink.onGoal` entry point |
| `voice/wakeword/` | The wake word: `MicrophoneWakeWordDetector` (the microphone loop in the foreground service), `WakeWordChoice` (the switch between spotters), `VoskSpotter`, and for openWakeWord `AudioFeatures` (the Kotlin port of its feature step), `WakeWordEngine`, the ONNX models, and `WakeWordConfig` |

### Wake word models

`WakeWordChoice.Current` picks the spotter: `Vosk` now, `OpenWakeWord` once OBJ-12's model is ready.

**Vosk (in use).** `com.alphacephei:vosk-android` 0.3.75 (Apache 2.0) with JNA 5.18.1 (Apache 2.0 or LGPL 2.1), and the `vosk-model-small-en-us-0.15` model (40 MB zip, Apache 2.0, from `https://alphacephei.com/vosk/models`).
The model is not in git: the `fetchVoskModel` Gradle task downloads the zip once per machine into `~/.gradle/caches/yumi/`, checks its SHA-256 (`30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498`), and adds it to the APK's assets.
So the first build needs internet; the app never does.
On its first start the app copies the model out of the APK into its private storage, because Vosk reads it from files.
The grammar is `["hey yumi", "[unk]"]`, and only finished utterances count. Measurements are in [wiki/android-hey-yumi-vosk.md](../wiki/android-hey-yumi-vosk.md).

**openWakeWord.**

The files in `app/src/main/assets/wakeword/` come from openWakeWord's v0.5.1 release (`https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/<file>`), the release its current code downloads from:

| File | SHA-256 | License |
|---|---|---|
| `melspectrogram.onnx` | `ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f` | Apache 2.0 |
| `embedding_model.onnx` | `70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f` | Apache 2.0 (Google's speech_embedding, re-implemented by openWakeWord) |
| `hey_jarvis_v0.1.onnx` | `94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb` | CC BY-NC-SA 4.0, non-commercial. Stand-in only |

To switch to OBJ-12's model: put `hey_yumi.onnx` in that folder, change `WakeWordConfig.Current` to it, and set `WakeWordChoice.Current` to `OpenWakeWord`.
The UI reads the phrase from there.
`AudioFeaturesParityTest` checks the Kotlin port against openWakeWord's Python pipeline, using `src/test/resources/wakeword/reference.py` and its recorded scores.
| `protocol/TemporaryTypes.kt` | Temporary local types until the generated protocol types land (OBJ-01) |

## Decisions

- **Part B model:** Qwen3.5-4B, fixed (SPEC-10 requirement 9). 9B (~6 GB plus context) was too tight on 12 GB of real RAM, and 4B scores about the same on phone tasks (AndroidWorld 58.6 vs 57.8). Decided 2026-10-09.
- **ONNX Runtime:** pinned to 1.28.0, the newest release without telemetry. 1.29.0 and later add the INTERNET permission and a content provider that starts an HTTP telemetry client when the app opens. The manifest also removes that provider, so a version bump cannot turn it on. Chosen in OBJ-24 on 2026-10-09.
- **ABIs:** arm64 only. Both phones are arm64, and ONNX Runtime adds 34 to 41 MB per ABI. Chosen in OBJ-24 on 2026-10-09.
- **Vosk until OBJ-12:** the phone spots "Hey Yumi" with Vosk, limited by a grammar to that phrase, because the trained openWakeWord model may not be ready before the deadline (SPEC-01 Decisions). Sound-alikes such as "hey you, come here" can wake it, which is fine for the demo. Its model is fetched at build time with a checksum instead of committed, to keep 70 MB of binaries out of git. Chosen in OBJ-59 on 2026-10-10.
- **Android SDK:** stay on compile and target SDK 36 with AGP 8.13. Newer AndroidX releases need SDK 37 and AGP 9, which adds disk use and upgrade risk for no feature we need. Decided 2026-10-09.

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
| [OBJ-22](../objectives/OBJ-22-android-app-shell.md) | Android app shell and foreground service | Brent | done |
| [OBJ-23](../objectives/OBJ-23-android-bridge-client.md) | Android bridge client and pairing | Brent | todo |
| [OBJ-24](../objectives/OBJ-24-android-voice-intake.md) | Android voice intake and wake word | Brent | done |
| [OBJ-42](../objectives/OBJ-42-version-mismatch-copy.md) | Add the protocol version mismatch copy | Brent | todo |
| [OBJ-59](../objectives/OBJ-59-android-hey-yumi-vosk.md) | "Hey Yumi" on Android with Vosk | Brent | in-progress |
<!-- generated:product-objectives:end -->

Not written yet: Part A phone-only goals, phone tools, and delegated goals (SPEC-09 and SPEC-10 Part A), and everything in Part B.
