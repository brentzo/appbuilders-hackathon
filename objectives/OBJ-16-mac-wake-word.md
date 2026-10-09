---
id: OBJ-16
title: Mac wake word
product: mac
assignee: Patrick
touches: []
specs: [SPEC-01]
status: in-progress
priority: p0
depends-on: [OBJ-15]
integrates-with: [OBJ-12]
tags: [objective, p0, mac, voice]
---

# OBJ-16 Mac wake word

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Saying "Hey Yumi" starts listening hands-free.
openWakeWord ships as a Python library, so its small audio feature step has to be ported to Swift and its models run with ONNX Runtime.
Audio before the wake word is never transcribed, stored, or sent anywhere.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), requirements 9-11, the "Listening modes" scenarios, and "Wake word detector".
- [OBJ-12](OBJ-12-hey-yumi-wake-word.md) results (Jepoy), when available: model files, feature models, threshold. Do not wait for them; build with a stand-in model.
- The openWakeWord source for its audio feature pipeline. A community C++ port exists and may help.

## Tasks

- [x] **OBJ-16.1** Add ONNX Runtime to the Mac app and load openWakeWord's feature models plus a wake word model. Until `hey_yumi.onnx` from OBJ-12 lands, use one of openWakeWord's pre-trained models (for example "hey jarvis") as a stand-in, then swap the file.
- [x] **OBJ-16.2** Port the audio feature step (audio frames to features to embeddings) to Swift, matching the Python output on the same audio within a small tolerance.
- [x] **OBJ-16.3** Run detection on a continuous microphone stream with the threshold from OBJ-12. Keep audio only in a short rolling buffer in memory, and discard it.
- [x] **OBJ-16.4** On detection: play a short listening sound, turn on the listening indicator, and start the same capture path as push-to-talk, ending when the user stops speaking.
- [x] **OBJ-16.5** Respect the wake word setting: when off, the microphone is not opened for wake word detection at all. Push-to-talk always works.
- [x] **OBJ-16.6** Measure CPU use while idle-listening and record it.
- [ ] **OBJ-16.7** Repeat OBJ-12's miss and false-trigger tests through the Mac app, and compare with the Python results.

## Expectations

- [ ] SPEC-01 scenarios pass: "Wake word starts listening", "Wake word turned off", "Speech before the wake word is ignored".
- [x] Swift features match the Python reference on a fixed test clip.
- [ ] Idle CPU use and the in-app miss and false-trigger rates are in the Outcome.

## Expected outcomes

- On-device "Hey Yumi" detection in the Mac app, with the Swift feature port and tests.

## Out of scope

- Training or retraining the model: [OBJ-12](OBJ-12-hey-yumi-wake-word.md).
- Android wake word: [OBJ-24](OBJ-24-android-voice-intake.md).

## Outcome

- **Result:** In progress.
  OBJ-16.1 to OBJ-16.6 are done with the stand-in model.
  OBJ-16.7 waits for "Hey Yumi" from [OBJ-12](OBJ-12-hey-yumi-wake-word.md), and so do the threshold and the in-app miss and false-trigger rates.
  The live microphone path needs Patrick's hand check (below).
- **Delivered:**
  - `mac/Yumi/WakeWord/`:
    - `OnnxModel`: one ONNX model through ONNX Runtime, on one thread.
    - `WakeWordFeatures` and `WakeWordScorer`: the Swift port of openWakeWord 0.6.0's feature step (`AudioFeatures`) and its scoring, with its 80 ms chunks, 480-sample overlap, `x / 10 + 2` transform, 76-frame windows, 16-embedding model input, and zeroed first 5 scores.
    - `WakeWordModels`: where the models live, and the stand-in.
    - `WakeWordListener` and `WakeWordAudio`: the setting, the microphone stream, detection off the main thread, the listening sound, and the hand-over.
  - `VoiceIntake.listenForGoalAfterWakeWord()`: the push-to-talk capture path, ended by silence. A false wake-up with nothing said is dropped quietly.
  - ONNX Runtime 1.24.2 as a Swift package (`onnxruntime-swift-package-manager`).
  - `mac/scripts/fetch-wake-word-models.sh`: downloads the 3 models from openWakeWord's v0.5.1 release and checks their SHA-256.
  - Test aid: `-YumiWakeWordFile <wav>` and `-YumiWakeWordLoop YES` (Debug builds).
  - Tests in `mac/YumiTests/WakeWordTests.swift`, with the fixed clip, the Python reference, and the script that makes it in `mac/YumiTests/Fixtures/WakeWord/`.
- **Commits:**
  - `aa00ce9 docs(objectives): start OBJ-16`
  - `6630308 feat(mac): run openWakeWord's feature step and the wake word model through ONNX Runtime, matching Python`
  - `0fb66ec feat(mac): listen for the wake word and hand over to the push-to-talk capture path`
  - and the commit that records this outcome, with the README.
- **Expectations:**
  - Swift features match Python: on the fixed clip (the macOS voice Samantha saying "Hey Jarvis. Export my Keynote deck as a PDF.", with 2 s of silence before and 1 s after, 79 chunks), every Swift embedding equals openWakeWord's exactly (largest difference 0.0), and every "hey jarvis" score after the 16-chunk warm-up is within 2.1e-7.
    Python peaks at 0.9994 on chunk 38; so does Swift.
  - "Wake word starts listening", live with the test aid against the mock harness: the clip woke Yumi (score 0.96), wake word listening stopped, the main cursor appeared in its listening state, the goal recording was transcribed on the device as "Export my keynote deck as a PDF.", and the mock received `submitGoal` and answered with the repeat-back.
    Not checked with a real voice and microphone, or by ear for the sound.
  - "Wake word turned off": with the setting off nothing listens for the wake word, and turning it on and off opens and closes it (`theSettingOpensAndClosesWakeWordListening`). Push-to-talk is a separate hot key and is not affected.
  - "Speech before the wake word is ignored": by construction. Detection keeps audio only in its rolling in-memory buffers (at most 10 s), nothing reaches a recognizer before the wake word, and closing the detector drops the buffers.
  - Idle CPU (OBJ-16.6): 5.6% of one core with the wake word on, against 0.2% with it off, for Yumi's own process over 60 s of looping speech with no wake word, Debug build, Apple silicon. The audio came from the test aid, so the microphone engine's own cost is not included.
    No false wake-ups in those 60 s, a sample far too small to be a rate.
- **ONNX Runtime's size:** it adds about 32 MB to the app (the Debug binary went from 12 MB to 43 MB; the library is linked in statically).
  Building needs a one-time 52 MB download, which unpacks to 210 MB in the build folder, plus 57 MB for the extensions archive that Yumi does not use.
  The Release size was not measured.
- **Hand check for Patrick:**
  1. Run `mac/scripts/fetch-wake-word-models.sh` once.
  2. Build Debug with your `Signing.local.xcconfig`, start Yumi, and allow the microphone.
     The log (category `wakeword`) says "Wake word is "Hey Jarvis" (stand-in until OBJ-12)" and "Listening for the wake word".
  3. Say "Hey Jarvis", then a goal such as "export my Keynote deck as a PDF".
     Expect a short sound, the cursor next to the pointer in its listening state, and the repeat-back once you stop speaking.
  4. Talk normally for a few minutes without saying it; Yumi should not wake.
  5. Turn the wake word off in Settings: the macOS microphone indicator goes off, "Hey Jarvis" does nothing, and ⌥Space still works.
- **Not verified:**
  - The microphone path and the sound, live (the ad hoc build in this worktree would be asked for the microphone after every rebuild).
  - Detection with different voices, accents, distances, and background noise; the threshold is openWakeWord's default, 0.5.
  - In the live run, 15 s passed between the wake-up and the transcript of the goal recording. The silence endpoint from OBJ-15 ended it, working from a file instead of a live microphone, so the real delay with a person speaking is not known.
  - CPU with the real microphone engine, in a Release build, and on battery.
  - Wake word and push-to-talk at the same moment: a detection while push-to-talk or a spoken answer has the microphone is ignored, but this was not tried live.
  - Yumi hearing its own voice through the speakers (for example the repeat-back) and waking itself; nothing guards against this yet.
- **Decisions and deviations:**
  - The stand-in is openWakeWord's "hey jarvis" (`hey_jarvis_v0.1.onnx`), labelled in the log and the README. When `hey_yumi.onnx` is in the models folder, Yumi uses it instead, with no code change.
  - openWakeWord's pre-trained models are CC BY-NC-SA 4.0 (non-commercial), so they are downloaded by a script and never committed or shipped. The feature models come from the same release.
  - The models live in `~/Library/Application Support/Yumi/Models/WakeWord`, like Whisper's, not in the app bundle.
  - Swift Testing skips the wake word tests, and says why, when the models are missing, so a fresh checkout still passes.
  - The wake word default stays on, as OBJ-14 set it; SPEC-01 does not say.
  - openWakeWord fills its embedding history with 4 s of random noise at start; the port does too, so the first 16 scores differ run to run, as in Python.
- **For the next objectives:**
  - [OBJ-12](OBJ-12-hey-yumi-wake-word.md): put `hey_yumi.onnx` in the models folder (or add it to the fetch script with its checksum), say its threshold, and set `WakeWordModels.threshold`. Then OBJ-16.7.
