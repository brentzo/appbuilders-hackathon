---
id: OBJ-11
title: Whisper bake-off
product: models
assignee: Jepoy
touches: [mac, android]
specs: [SPEC-01]
status: in-progress
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, models, voice]
---

# OBJ-11 Whisper bake-off

**Product:** [Yumi Models](../models/README.md) · **Also touches:** [mac](../mac/README.md), [android](../android/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Users will speak Taglish, and Whisper is weakest when speakers switch languages mid-sentence.
This p0 objective benchmarks the Mac options with real recordings and records the choice for Mac voice intake.
Android Whisper is p1 in SPEC-01 and SPEC-10, so its phone-specific benchmark is tracked separately in [OBJ-28](OBJ-28-android-whisper-bake-off.md).

## Read first

- [SPEC-01](../specs/01-voice-intake.md), section "Whisper model options" (options table, runtimes, how to decide).
- [models/README.md](../models/README.md), especially the rule about not committing voice recordings.

## Tasks

- [ ] **OBJ-11.1** Record about 20 real Taglish goals from the team, with consent, including names, numbers, and app names. Store them in the team's shared storage, not in git.
- [ ] **OBJ-11.2** Write the correct transcript for each and commit the transcripts to `models/whisper/transcripts/`.
- [x] **OBJ-11.3** Write a script that evaluates one selected model against a preloaded local endpoint, supporting both Mac runtimes: WhisperKit and whisper.cpp. Run it once per selected model/runtime combination when Mac access and recordings are available.
- [ ] **OBJ-11.4** Measure word error rate and warm end-of-speech-to-transcript latency for every Mac combination. Also run about 10 plain English commands to decide whether Whisper alone is fast enough for English on the Mac under SPEC-01 requirements 2 and 3.
- [ ] **OBJ-11.5** Measure memory on the Mac while Qwen3.5-9B and the wake word model are also loaded. Use the peak memory recorded in [OBJ-26](OBJ-26-gui-smoke-test.md) if it is done.
- [ ] **OBJ-11.6** Check confirmed model sizes against the estimates in SPEC-01 and correct the table if they differ.
- [ ] **OBJ-11.7** Pick the smallest Mac option whose errors would not change what Yumi repeats back. Write results and the Mac choice to `models/whisper/RESULTS.md`.
- [ ] **OBJ-11.8** Record the Mac decision in SPEC-01 and `models/manifest.json` with the download source and checksum. Leave the Android p1 question open for OBJ-28.

## Expectations

- [ ] Results cover every selected option and Mac runtime, or explain why one was skipped. Android results are tracked in OBJ-28 after SPEC-10 Part B (p1).
- [ ] The chosen Mac option fits in memory alongside Qwen3.5-9B and the wake word.
- [ ] The results say whether Whisper alone is fast enough for English commands on the Mac.
- [ ] SPEC-01 records the Mac choice and keeps the Android p1 choice open for OBJ-28.
- [ ] No voice recordings are in git.

## Expected outcomes

- `models/whisper/RESULTS.md` with numbers and the decision.
- A benchmark script and committed transcripts, with recordings kept in approved shared storage.
- A focused local HTTP-server and WER test for the benchmark runner.
- Updated SPEC-01 and `models/manifest.json` with the Mac decision.

## Out of scope

- Wiring Whisper into the apps: [OBJ-15](OBJ-15-mac-voice-intake.md) (Mac), [OBJ-24](OBJ-24-android-voice-intake.md) (Android).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
