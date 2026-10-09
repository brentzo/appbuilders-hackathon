---
id: OBJ-24
title: Android voice intake and wake word
product: android
assignee: Brent
touches: []
specs: [SPEC-01, SPEC-10]
status: done
priority: p0
depends-on: [OBJ-22]
integrates-with: [OBJ-12]
tags: [objective, p0, android, voice]
---

# OBJ-24 Android voice intake and wake word

**Product:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md), [SPEC-10](../specs/10-android-companion.md) · **Assignee:** Brent

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
- [OBJ-12](OBJ-12-hey-yumi-wake-word.md) results (Jepoy), when available. Do not wait for them; build with a stand-in model.
- [OBJ-22](OBJ-22-android-app-shell.md) Outcome.

## Tasks

- [x] **OBJ-24.1** Mic button: tap to start, stop when the user stops speaking. Show the listening indicator only while the microphone is on.
- [x] **OBJ-24.2** Native recognizer with `SpeechRecognizer.createOnDeviceSpeechRecognizer`, English. Never use the default recognizer, which may use the cloud.
- [x] **OBJ-24.3** If the on-device recognizer has no model for the spoken language, show the SPEC-11 "Language not supported on this phone" copy with "Try again" and "Type instead". Never fall back to a cloud recognizer.
- [x] **OBJ-24.4** Wake word in the foreground service: ONNX Runtime for Android, the feature models, a wake word model, and a Kotlin port of the audio feature step that matches the Python reference. Until `hey_yumi.onnx` from OBJ-12 lands, use one of openWakeWord's pre-trained models (for example "hey jarvis") as a stand-in, then swap the file.
- [x] **OBJ-24.5** Keep audio before the wake word only in a short in-memory buffer, and discard it.
- [x] **OBJ-24.6** Respect the wake word setting: when off, do not open the microphone for detection.
- [x] **OBJ-24.7** Handle silence or unusable audio with the SPEC-11 "Didn't catch speech" copy and its "Try again" and "Type instead" buttons. "Type instead" opens a text box that accepts a goal the same way as speech.
- [x] **OBJ-24.8** Hand the transcript to a single `onGoal(text)` entry point that the Part A routing objective will connect (phone-only rule or delegate to the Mac). For now, show the transcript on screen.
- [x] **OBJ-24.9** Measure battery and CPU while idle-listening for an hour on the demo phone, and the miss and false-trigger rates in the app.
- [x] **OBJ-24.10** Handle a missing microphone permission with the SPEC-11 "Microphone permission missing" copy.

## Expectations

- [x] SPEC-01 scenarios pass on the demo phone: "Push-to-talk on the phone", "Wake word starts listening", "Wake word turned off", "Speech before the wake word is ignored".
- [x] SPEC-10 scenarios pass: "English speech is transcribed on the phone", "No on-device model for the language".
- [x] No audio is sent to a cloud recognizer, verified by the recognizer choice and a traffic check.
- [x] Battery, CPU, miss, and false-trigger numbers are in the Outcome.

## Expected outcomes

- Mic button, the on-device English recognizer, typed goals, the wake word in the foreground service, the Kotlin feature port, and the `onGoal` entry point.

## Out of scope

- Repeating the goal back and confirming on the phone, and deciding phone or Mac: the Part A routing objective (SPEC-09, SPEC-10 Part A), not written yet.
- Whisper and Taglish on the phone: SPEC-10 Part B (p1).

## Outcome

- **Result:** Done on 2026-10-09.
- **Delivered:**
  - Push-to-talk on the on-device recognizer only: `android/app/src/main/java/ai/yumi/android/voice/OnDeviceVoiceInput.kt` and `SpeechEngine.kt` (`createOnDeviceSpeechRecognizer`, English, never `createSpeechRecognizer`).
  - The language check over a whole session: `voice/LanguageGuesses.kt`.
  - The wake word in the foreground service: `voice/wakeword/OpenWakeWordDetector.kt`, the Kotlin port of openWakeWord's streaming feature step `voice/wakeword/AudioFeatures.kt`, `WakeWordEngine.kt`, the ONNX Runtime models `WakeWordModels.kt`, and the stand-in choice in `WakeWordConfig`.
  - openWakeWord's `melspectrogram.onnx`, `embedding_model.onnx`, and the stand-in `hey_jarvis_v0.1.onnx` in `android/app/src/main/assets/wakeword/`, with sources, checksums, and licenses in [android/README.md](../android/README.md).
  - Handing the microphone between the detector and the recognizer: `voice/MicrophoneOwner.kt`. A soft chime when the wake word fires: `voice/ListeningSound.kt`.
  - Every transcript and typed goal goes to `GoalSink.onGoal(text)`; the stand-in `LastGoal` shows it on the home screen.
  - The SPEC-11 row "Speech recognition not set up on this phone", approved by Brent: SPEC-11, `protocol/schemas/errors.json` (`speechRecognitionNotSetUp`), the Mac copy, and the Android copy, with tests.
  - The report [wiki/android-voice-intake.md](../wiki/android-voice-intake.md).
- **Commits:**
  - `c8e157b docs(objectives): start OBJ-24`
  - `b3eb95e feat(android): add on-device voice intake and the openWakeWord detector`
  - `900d0d2 fix(android): judge the spoken language by the latest confident guess and ship arm64 only`
  - `749ffd2 fix(android): drop ONNX Runtime telemetry, report other languages, and clear old voice errors`
  - `dd9e425 feat(protocol): add the speechRecognitionNotSetUp error kind for the new SPEC-11 row`
  - `4308507 docs(android): document voice intake, the wake word models, and the ONNX Runtime pin`
  - `43473ce fix(android): judge the spoken language over the whole session and trust a transcript`
  - `6f031f6 docs(objectives): record OBJ-24 results`
  - `docs(objectives): finish OBJ-24`
- **Expectations:**
  - SPEC-01, on the demo phone (Xiaomi, Android 15), with Brent's voice on 2026-10-09:
    - "Push-to-talk on the phone": "set a timer for 10 minutes" was transcribed when he stopped speaking.
    - "Wake word starts listening": the chime plays, and the cat and the notification show listening once the microphone is on, about 0.7 seconds after the wake word. 6 of 6 goals after the wake word were transcribed, 3 with the phone locked.
    - "Wake word turned off": the scenario is written for the Mac; on the phone, with the switch off, Yumi closes the microphone (no Yumi recording in `dumpsys audio`), the service drops its microphone type, "Hey Jarvis" did nothing, and push-to-talk still worked.
    - "Speech before the wake word is ignored": the recognizer only starts after a detection, so earlier speech never reaches it. Before the wake word, audio lives only in the detector's buffer of at most 110 ms, which is cleared on detection and when listening stops. `AudioFeaturesParityTest.clearDiscardsAllBufferedAudio` checks the clearing.
  - The language fix, with Brent's voice at 11:53 pm: "export my Keynote deck as a PDF" was transcribed 3 times out of 3, and "pakigising yung Mac ko" showed "Language not supported on this phone". `LanguageGuessesTest` replays his recorded guesses.
  - SPEC-10: "English speech is transcribed on the phone" passed as above. "No on-device model for the language": Tagalog ("pakigising yung Mac ko", 2 tries by Brent) and Spanish (3 tries from the Mac) show "Language not supported on this phone", with no traffic.
  - No audio to a cloud recognizer: only `createOnDeviceSpeechRecognizer` is used, and `OnDeviceVoiceInputTest.noOnDeviceRecognizerNeverFallsBackToAnotherOne` checks there is no fallback. The recognizer is Android System Intelligence, which has no internet permission. Yumi has none either. `dumpsys netstats` showed 0 bytes for both across three sessions.
  - Numbers (short measurements, as Brent asked): about 2% of the battery an hour (Android's estimate, 16.8 mAh in 10 minutes), about 9% of one CPU core, 0 false wake-ups in 10 minutes of synthesized speech, and misses of 0 of 10 at arm's length and 8 of 10 from across the room. Reliable within about 2 arm's lengths. Details in the wiki report.
  - Build: `python3 scripts/verify.py` passes (Android build, 46 unit tests, lint; protocol, harness, bridge, and the Mac build and tests).
  - The Kotlin feature port matches openWakeWord's Python pipeline within 0.002 per score on two clips (`AudioFeaturesParityTest`, with `src/test/resources/wakeword/reference.py`).
- **Not verified:**
  - "Open settings" on "Speech recognition not set up on this phone" was not tried on a phone missing the pack. On the Xiaomi the intent opens "Assist & voice input".
  - The "Hey Yumi" model (OBJ-12 is not done). The swap is one file and one line, and the miss and false-trigger numbers must be measured again with it.
  - An hour-long run, a drain measured off USB, false triggers with real everyday Taglish, TV, and music, and the development phone.
  - The protocol's Swift and Kotlin compile checks (Docker was not running; CI runs them).
- **Decisions and deviations:**
  - OBJ-24.9 asked for an hour; Brent asked for a short measurement instead (10 minutes, extrapolated). Brent accepted about 2% an hour, and showing a transcript from the locked phone only when the app opens, until the routing objective.
  - ONNX Runtime is pinned to 1.28.0: 1.29.0 and later add the internet permission and an HTTP telemetry client that starts with the app. The manifest also removes the telemetry provider.
  - The app ships arm64 only; each ONNX Runtime ABI adds 34 to 41 MB.
  - Recognizer error codes 12 and 13, and a phone with no on-device recognizer, show the new "Speech recognition not set up on this phone" row. "Language not supported on this phone" is for speech the recognizer hears as another language, using Android 14's language detection.
  - The UI names the wake word from `WakeWordConfig`, so it says "Hey Jarvis" while that is the stand-in.
  - Partial transcripts show live under the cat while listening.
- **For the next objectives:**
  - Routing (SPEC-09, SPEC-10 Part A): replace `LastGoal` in `AppGraph.kt` with the real `GoalSink`. `onGoal` runs on the main thread, for spoken and typed goals alike. After the wake word with the phone locked, nothing comes to the front: the routing objective decides how to repeat the goal back then.
  - OBJ-12: put `hey_yumi.onnx` in `android/app/src/main/assets/wakeword/` and set `WakeWordConfig.Current` to it with the phrase `"Hey\u00A0Yumi"`. Run `AudioFeaturesParityTest` unchanged; it uses the stand-in's recorded scores, so add a "Hey Yumi" clip and scores if you want the new model covered.
  - Test transcription with a person: speech from a laptop speaker is too quiet at the phone and made the recognizer fail in ways people did not.
  - Logs: `adb logcat -s YumiVoice YumiWakeWord`. Transcripts are never logged.
