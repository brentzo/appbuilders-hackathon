---
id: OBJ-11
title: Whisper bake-off
product: models
assignee: Jepoy
touches: [mac, android]
specs: [SPEC-01]
status: todo
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
Which Whisper size and runtime to use on each device was left to be decided by testing real recordings.
This objective runs that test and records the choice that the Mac and Android voice objectives will use.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), section "Whisper model options" (options table, runtimes, how to decide).
- [models/README.md](../models/README.md), especially the rule about not committing voice recordings.

## Tasks

- [ ] **OBJ-11.1** Record about 20 real Taglish goals from the team, with consent, including names, numbers, and app names. Store them in the team's shared storage, not in git.
- [ ] **OBJ-11.2** Write the correct transcript for each and commit the transcripts to `models/whisper/transcripts/`.
- [ ] **OBJ-11.3** Write a script that runs each option (small, medium, large-v3-turbo, large-v3, and any Tagalog fine-tune worth testing) through each Mac runtime: WhisperKit and whisper.cpp. The Android demo phone run (whisper.cpp) waits for SPEC-10 Part B (p1); keep the script ready for it.
- [ ] **OBJ-11.4** Measure word error rate and time from end of speech to transcript for every combination. Also run about 10 plain English commands, to see whether Whisper alone is fast enough for every goal on the Mac. If it is, the Mac can skip the native recognizer and the rule for choosing between the two (SPEC-01 r2 and r3).
- [ ] **OBJ-11.5** Measure memory on the Mac while Qwen3.5-9B and the wake word model are also loaded. Use the peak memory recorded in [OBJ-26](OBJ-26-gui-smoke-test.md) if it is done.
- [ ] **OBJ-11.6** Check confirmed model sizes against the estimates in SPEC-01 and correct the table if they differ.
- [ ] **OBJ-11.7** Pick the smallest option per device whose errors would not change what Yumi repeats back. Write results and the choice to `models/whisper/RESULTS.md`.
- [ ] **OBJ-11.8** Record the decision in SPEC-01's open question and in the models manifest (download source and checksum).

## Expectations

- [ ] Results cover every option and runtime on the Mac, or explain why one was skipped. The phone results follow with SPEC-10 Part B (p1).
- [ ] The chosen option fits in memory alongside Qwen3.5-9B and the wake word on the Mac.
- [ ] The results say whether Whisper alone is fast enough for English commands on the Mac.
- [ ] SPEC-01 no longer lists the Whisper choice as open.
- [ ] No voice recordings are in git.

## Outcomes

- `models/whisper/RESULTS.md` with numbers and the decision.
- Committed transcripts and the benchmark script.
- Updated SPEC-01 and models manifest.

## Out of scope

- Wiring Whisper into the apps: [OBJ-15](OBJ-15-mac-voice-intake.md) (Mac), [OBJ-24](OBJ-24-android-voice-intake.md) (Android).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
