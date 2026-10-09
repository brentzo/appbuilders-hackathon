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

- [ ] **OBJ-51.1** Choose the runtime for Kokoro on the Mac (for example mlx-audio, or an on-device Core ML or ONNX build), checking licence, memory, first-word latency, and that it runs fully offline. Record the choice and the numbers.
- [ ] **OBJ-51.2** Make 4 to 6 short samples of Yumi's lines (the repeat-back, "On it.", a meow-ish greeting, an error line) in several voices and speeds, and let Brent pick the voice that sounds cute and playful.
- [ ] **OBJ-51.3** Implement a `SpeechOutput` that uses the chosen voice, with the model stored and loaded offline, never downloaded at first run.
- [ ] **OBJ-51.4** When the neural voice fails to load, stay quiet (never the system voice), log why, and show SPEC-11's "Voice didn't load (Mac)" in a panel that does not take focus, with "Try again" (Brent's decision, 2026-10-10, replacing the system-voice fallback).
- [ ] **OBJ-51.5** Measure first-word latency and memory next to Qwen3.5-9B on Brent's Mac, and keep the repeat-back from feeling slower than before.
- [ ] **OBJ-51.6** Tests for the failed load and for speaking in order, and a live check on the real Mac app.

## Expectations

- [ ] Brent picked the voice from the samples, and every line Yumi says on the Mac uses it.
- [ ] No audio or text leaves the Mac to make speech.
- [ ] The voice works with the network off.

## Expected outcomes

- A neural `SpeechOutput` on the Mac, the stored voice model, and the measurements in a wiki report.

## Out of scope

- The phone's voice: [SPEC-10](../specs/10-android-companion.md).
- What Yumi says: the copy in SPEC-01, SPEC-07, and SPEC-11.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
