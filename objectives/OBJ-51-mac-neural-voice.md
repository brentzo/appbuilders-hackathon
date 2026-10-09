---
id: OBJ-51
title: Yumi's neural voice on the Mac
product: mac
assignee: Brent
touches: [models]
specs: [SPEC-04]
status: in-progress
priority: p0
depends-on: []
integrates-with: [OBJ-17]
tags: [objective, p0, mac, character, voice]
---

# OBJ-51 Yumi's neural voice on the Mac

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-04](../specs/04-cursor-presence.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Brent found the system voice robotic and not cute at all.
SPEC-04 requirement 20 replaces it with a neural voice model on the device.
The Mac app already speaks through the `SpeechOutput` interface, so the voice can change behind it without touching callers.

## Read first

- SPEC-04 requirements 11 and 20, and its Decisions.
- SPEC-11's "Voice didn't load (Mac)" row and scenario "Voice that did not load stays quiet".
- `mac/Yumi/Confirmation/Speech.swift`: the `SpeechOutput` interface.
- [mac/README.md](../mac/README.md), "Speech output".
- [models/README.md](../models/README.md) for how models are stored and pinned.
- The [Kokoro-82M model card](https://huggingface.co/hexgrad/Kokoro-82M) for its licence, voices, and languages; verify facts there before relying on them.

## Tasks

- [x] **OBJ-51.1** Choose the runtime for Kokoro on the Mac (for example mlx-audio, or an on-device Core ML or ONNX build), checking licence, memory, first-word latency, and that it runs fully offline. Record the choice and the numbers.
- [x] **OBJ-51.2** Make 4 to 6 short samples of Yumi's lines (the repeat-back, "On it.", a meow-ish greeting, an error line) in several voices and speeds, and let Brent pick the voice that sounds cute and playful.
- [x] **OBJ-51.3** Implement a `SpeechOutput` that uses the chosen voice, with the model stored and loaded offline, never downloaded at first run.
- [x] **OBJ-51.4** When the neural voice fails to load, stay quiet (never the system voice), log why, and show SPEC-11's "Voice didn't load (Mac)" in a panel that does not take focus, with "Try again" (Brent's decision, 2026-10-10, replacing the system-voice fallback).
- [x] **OBJ-51.5** Measure first-word latency and memory next to Qwen3.5-9B on Brent's Mac, and keep the repeat-back from feeling slower than before.
- [ ] **OBJ-51.6** Tests for the failed load and for speaking in order, and a live check on the real Mac app.

## Expectations

- [ ] Brent picked the voice from the samples, and every line Yumi says on the Mac uses it.
- [x] No audio or text leaves the Mac to make speech.
- [x] The voice works with the network off.

## Expected outcomes

- A neural `SpeechOutput` on the Mac, the stored voice model, and the measurements in a wiki report.

## Out of scope

- The phone's voice: [SPEC-10](../specs/10-android-companion.md).
- What Yumi says: the copy in SPEC-01, SPEC-07, and SPEC-11.

## Outcome

- **Result:** Built, tested, and measured; waiting for Brent to confirm the meow sample and to listen to the live app (OBJ-51.6, first expectation), so the status stays `in-progress`.
- **Delivered:**
  - `mac/Yumi/Speech/`: `NeuralSpeech` (the `SpeechOutput` the app uses: order, sentence by sentence, the opening meow, the failed load), `KokoroVoice` (loads the model on its own queue), `SpeechPlayback` (`AVAudioEngine` with `AVAudioUnitTimePitch` and the meow), `VoiceWarningPanel`.
  - `mac/Packages/KokoroSwift/`: kokoro-ios (MIT) at `4d6d1d8` with Yumi's changes: throwing loads, `pitchShift` and `intonation`, and `KokoroSpeaker`.
  - `mac/scripts/fetch-voice-model.sh`, and the `mac-voice` entry in `models/manifest.json` with checksums.
  - `speakOpening` on `SpeechOutput`; `GoalConfirmation` uses it for the first repeat-back of a goal. `SystemSpeech` is removed.
  - SPEC-11 "Voice didn't load (Mac)", the protocol kind `voiceFailedToLoad`, and its copy on the Mac and Android.
  - [wiki/mac-neural-voice.md](../wiki/mac-neural-voice.md): candidates, licences, the samples, and the measurements.
- **Commits:** `a7d98fe docs(objectives): start OBJ-51`, `f847141 docs(spec-11): add "Voice didn't load (Mac)" and drop the system-voice fallback`, `46a0733 feat(mac): speak with Yumi's neural voice`.
- **Expectations:**
  - Brent picked the voice ("heart-blend-plus7", with a sound before lines), and every line goes through the one `NeuralSpeech` in `HarnessLink`; no other speech path is left in the app. Not checked yet: Brent has not confirmed the meow sample or heard the live app.
  - No audio or text leaves the Mac: the model and voice are read from `~/Library/Application Support/Yumi/Models/Voice`, and with internet traffic blocked by a sandbox rule `lsof` showed no internet sockets while Yumi spoke.
  - Works with the network off: the same sandboxed run loaded the voice and logged the repeat-back as heard. Wi-Fi itself was not switched off, because other agents were using it.
  - Tests: `NeuralSpeechTests` (order, speak returns once heard, opening meow, no meow with sounds off, the real loader's missing-file error stays quiet and warns once, Try again, a failed sentence, splitting, the warning's buttons, only the first repeat-back opens), `UserErrorCopyTests` over the new kind, the protocol's `error-kinds.test.ts`, and Android's `ErrorCopySpecTest`. `python3 scripts/verify.py` passed.
  - Measurements next to a loaded Qwen3.5-9B: "On it." 162 ms to the first word (system voice 105 ms), the repeat-back 482 ms without the meow, and with the meow the first sound at once and the first word at 1.17 s; about 490 MB while loaded, 1.3 GB peak while loading.
- **Not verified:**
  - Brent's listen. Steps, once the orchestrator gives the go for the live app: build from `mac/` with `xcodebuild -project Yumi.xcodeproj -scheme Yumi -configuration Debug -derivedDataPath build -allowProvisioningUpdates build`, then `open build/Build/Products/Debug/Yumi.app --args -YumiSay "You want me to rename the invoices in your Downloads folder by date. Should I go ahead?" -YumiSayOpening YES`, listen, and quit Yumi from the menu. Then give it a real goal and listen to the repeat-back.
  - The meow sample for confirmation: `afplay ~/Developer/vendor/yumi-voice-samples/round3-heart-blend-plus7-meow-repeat-back.wav`.
  - A Release build's latency, and latency while Qwen3.5-9B is answering at the same moment.
- **Decisions and deviations:**
  - No system-voice fallback (Brent, 2026-10-10): a voice that fails to load stays quiet and shows the warning; a sentence that fails to render ends its line quietly and is logged, for the same reason.
  - The meow plays only before the first repeat-back of a goal, not before asking again, cancels, approvals, errors, or the harness's `speak` lines, and follows "Play sounds". It is Patrick's `cat-meow.mp3`, unchanged; its source and licence are not recorded in the repo (question for Patrick).
  - kokoro-ios is copied into the repo instead of used as a package, because the pitch shift needs a change inside `generateAudio`.
  - Building the Mac app now needs Xcode's Metal Toolchain (installed on Brent's Mac with `xcodebuild -downloadComponent MetalToolchain`).
- **For the next objectives:** call `speech.speak(_:)` for every line and `speakOpening(_:)` only for the line that opens a conversation. `-YumiSay`, `-YumiSayOpening`, and `-YumiVoiceFolder` (Debug) say a line or show the warning without the harness. The `speech` log category has load time, first-word time, and why a load failed.
