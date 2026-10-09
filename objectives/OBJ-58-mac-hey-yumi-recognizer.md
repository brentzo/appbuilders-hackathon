---
id: OBJ-58
title: "\"Hey Yumi\" on the Mac with the on-device recognizer"
product: mac
assignee: Brent
touches: []
specs: [SPEC-01]
status: in-progress
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

- [ ] **OBJ-58.1** Add a phrase spotter that listens with the native recognizer forced on-device (never the cloud), restarts its session as needed, and fires on "hey yumi" and common mishearings (for example "hey you me", "hey yummy", "hey umi", "a yumi").
- [ ] **OBJ-58.2** Use it as the Mac's wake word when the setting is on, in place of the openWakeWord stand-in, and hand over to the same capture path, so the goal said after "Hey Yumi" is captured as today.
- [ ] **OBJ-58.3** Never store, log, or send what it hears before the wake word; keep only whether the phrase was heard.
- [ ] **OBJ-58.4** Pause spotting while Yumi is speaking or capturing a goal, so it does not wake itself.
- [ ] **OBJ-58.5** Tests for the phrase matching and the hand-over, and a live check on the real Mac app.

## Expectations

- [ ] Saying "Hey Yumi, open Notes" at a normal distance wakes Yumi and captures "open Notes".
- [ ] Nothing heard before the wake word appears in any log.

## Expected outcomes

- A recognizer-based "Hey Yumi" spotter in the Mac app, wired in as the wake word, with tests.

## Out of scope

- The trained openWakeWord model: [OBJ-12](OBJ-12-hey-yumi-wake-word.md).
- The phone's wake word: [SPEC-10](../specs/10-android-companion.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
