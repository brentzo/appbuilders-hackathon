---
id: OBJ-58
title: "\"Hey Yumi\" on the Mac with the on-device recognizer"
product: mac
assignee: Brent
touches: []
specs: [SPEC-01]
status: done
priority: p0
depends-on: []
integrates-with: [OBJ-16]
tags: [objective, p0, mac, voice]
---

# OBJ-58 "Hey Yumi" on the Mac with the on-device recognizer

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The "Hey Yumi" openWakeWord model ([OBJ-12](OBJ-12-hey-yumi-wake-word.md)) cannot be trained before the hackathon deadline, and the Mac only answers "Hey Jarvis" today.
SPEC-01 requirement 10 and its Decisions now let the Mac spot "Hey Yumi" with its on-device speech recognizer for the demo, accepting sound-alikes on purpose.
The goal is the fastest thing that works reliably in the demo, not a general detector.

## Read first

- SPEC-01 requirements 8 to 11 and 13, and its Decisions.
- [OBJ-16](OBJ-16-mac-wake-word.md) and its Outcome: the wake word listener and the hand-over to the push-to-talk capture path.
- `mac/Yumi/WakeWord/WakeWordListener.swift` and `mac/Yumi/Voice/`.

## Tasks

- [x] **OBJ-58.1** Add a phrase spotter that listens with the native recognizer forced on-device (never the cloud), restarts its session as needed, and fires on "hey yumi" and common mishearings (for example "hey you me", "hey yummy", "hey umi", "a yumi").
- [x] **OBJ-58.2** Use it as the Mac's wake word when the setting is on, in place of the openWakeWord stand-in, and hand over to the same capture path, so the goal said after "Hey Yumi" is captured as today.
- [x] **OBJ-58.3** Never store, log, or send what it hears before the wake word; keep only whether the phrase was heard.
- [x] **OBJ-58.4** Pause spotting while Yumi is speaking or capturing a goal, so it does not wake itself.
- [x] **OBJ-58.5** Tests for the phrase matching and the hand-over, and a live check on the real Mac app.

## Expectations

- [x] Saying "Hey Yumi, open Notes" at a normal distance wakes Yumi and captures "open Notes".
- [x] Nothing heard before the wake word appears in any log.

## Expected outcomes

- A recognizer-based "Hey Yumi" spotter in the Mac app, wired in as the wake word, with tests.

## Out of scope

- The trained openWakeWord model: [OBJ-12](OBJ-12-hey-yumi-wake-word.md).
- The phone's wake word: [SPEC-10](../specs/10-android-companion.md).

## Outcome

- **Result:** Done.
- **Delivered:**
  - `mac/Yumi/WakeWord/PhraseSpotter.swift`:
    - `WakePhrase`: the phrase and its sound-alikes, and the goal after it.
    - `PhraseSpotter`: Apple's on-device recognizer over the microphone, a new session every 8 seconds, and the last 2 seconds of audio.
    - `WakeHandover`: the microphone that heard the phrase, handed to the goal capture.
  - `WakeWordListener`: the recognizer is the default wake word; `-YumiWakeWordEngine openWakeWord` keeps OBJ-16's detector. It pauses while Yumi speaks or listens, and for 0.8 seconds after.
  - `VoiceIntake.listenForGoalAfterWakeWord(_:)`: the push-to-talk capture path on the handed-over microphone. The 2 seconds before the phrase go to the recognizer only, and only the words after the phrase become the goal.
  - `TrackedSpeech` (wraps `NeuralSpeech`, passes `speakOpening` on) and `AppModel.isSpeaking`.
  - `SpeechEndpoint(floor:speaking:)`, `MicrophoneCapture.play` (test aid), and spotter options on the native sessions (fast results, "Yumi" as a contextual string).
  - Tests in `mac/YumiTests/PhraseSpotterTests.swift`, and the "Wake word" section of `mac/README.md`.
- **Commits:**
  - `65534d1 docs(objectives): start OBJ-58`
  - `c93e754 feat(mac): spot "Hey Yumi" with the on-device recognizer and hand its microphone to the goal capture`
  - `201a56c test(mac): check that Yumi's voice is tracked as speaking and still meows first`
  - `2d90180 fix(mac): drop a "Hey" or "Yumi" left at the start of the goal after the wake word`
  - and the commit that records this outcome.
- **Expectations:**
  - "Hey Yumi, open Notes" at a normal distance: Brent's live check on 2026-10-10 at 2:28 am, signed Debug build, real harness and Qwen3.5-9B.
    Yumi woke 3 times out of 3 and the harness got "Hey, open Notes.", "Open notes.", and "Open notes, open my notes.".
    The first came out with "Hey" left at the start because the recognizer dropped "Yumi" the second time; `2d90180` drops such leftovers.
    Before that, `heyYumiThenAGoalReachesTheHarness` passed with the real recognizer on recordings of "Hey Yumi, open Notes." in one breath and with a pause.
  - Nothing heard before the wake word in any log: Brent said "Remind me to call Ana", then "Hey Yumi, open Notes".
    Neither "Ana" nor "remind" appears in Yumi's unified log, the harness log, or any transcript in the Debug log (the only "Ana" there is the repeat-back prompt's own example).
    The spotter logs only that the phrase was heard, and the capture logs only character counts.
  - Also live: a minute of normal talk with no wake-up; with the wake word off nothing listened for it and ⌥Space still worked; Yumi's repeat-backs did not wake it.
  - CPU while spotting: 2.1% and 4.5% of one core for Yumi over two 60-second runs of talk without the phrase (`cpuWhileSpotting`, Debug build), plus about 5% in macOS's `localspeechrecognition`; no wake-ups.
- **Not verified:** Nothing.
  The false-wake rate over a long stretch, other voices, and noisy rooms were not measured; sound-alikes waking Yumi are accepted on purpose.
- **Decisions and deviations:**
  - The goal capture keeps the microphone that heard the phrase and starts with the 2 seconds before it, instead of opening a new microphone after the sound, because a goal said in the same breath lost its first words otherwise.
    Those 2 seconds stay in memory only, like OBJ-16's rolling buffers.
  - After the phrase, the silence detector takes the room's level from the seconds before it and is not fed the first 0.35 seconds, so the listening sound does not count as speech.
  - The wake word pauses while Yumi talks (through `TrackedSpeech`) or listens, which also closes OBJ-16's "Yumi hearing its own voice".
  - The recognizer stays the Mac default for the demo (orchestrator, 2026-10-10). The trained model from OBJ-12 is to be compared when it arrives.
- **For the next objectives:**
  - [OBJ-12](OBJ-12-hey-yumi-wake-word.md): to compare, launch with `-YumiWakeWordEngine openWakeWord` and `hey_yumi.onnx` in the models folder. Making it the default is a one-line change to `WakeWordListener.Engine.chosen`.
  - Every line Yumi says should go through `HarnessLink.speech` (a `TrackedSpeech`), or the wake word will not pause for it. Reach `NeuralSpeech` with `(speech as? TrackedSpeech)?.inner`.
  - After a line, the wake word reopens 0.8 seconds later and closes again once Yumi listens for the reply, so the microphone indicator flickers. Harmless; smoothing it is open.
