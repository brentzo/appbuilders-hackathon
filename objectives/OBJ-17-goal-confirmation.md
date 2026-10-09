---
id: OBJ-17
title: Goal confirmation loop
product: mac
assignee: Patrick
touches: [harness]
specs: [SPEC-01]
status: todo
priority: p0
depends-on: [OBJ-04, OBJ-15, OBJ-18]
integrates-with: []
tags: [objective, p0, mac, harness, voice, ux]
---

# OBJ-17 Goal confirmation loop

**Product:** [Yumi for Mac](../mac/README.md) · **Also touches:** [harness](../harness/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Yumi never acts on a goal it might have misheard.
It repeats the goal back in its own words, by voice and on screen, and waits for yes, a correction, or cancel.
This is also the moment the cat cursor appears, so it is the start of every demo.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), requirements 4-7 and the "Voice intake and confirmation" scenarios with their exact copy.
- [OBJ-04](OBJ-04-task-store.md), [OBJ-15](OBJ-15-mac-voice-intake.md), and [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) Outcome.

## Tasks

- [ ] **OBJ-17.1** Harness: on `submitGoal`, create a task in `awaitingConfirmation` with the raw transcript as `goal`.
- [ ] **OBJ-17.2** Harness: ask the model to restate the goal as a short repeat-back sentence ending in a question, matching the SPEC-01 copy style ("You want me to ... Should I go ahead?"). Taglish goals are repeated back in English.
- [ ] **OBJ-17.3** Mac: when a goal arrives, spawn the main cursor near the user's pointer.
- [ ] **OBJ-17.4** Mac: speak the repeat-back through a `speak` interface backed by `AVSpeechSynthesizer`, and show it in a small panel with "Go ahead", "Change it", and "Cancel" buttons.
- [ ] **OBJ-17.5** Listen for the reply right after speaking. Classify it as confirm, cancel, or correction (a short model call in the harness is fine).
- [ ] **OBJ-17.6** Confirm: save `confirmedGoal` and move the task to `planning`. Cancel: say "Okay, I won't do anything.", fade the cursor out, and do not keep the task as work. Correction: combine it with the goal, restate, and ask again.
- [ ] **OBJ-17.7** Make sure no planning or action happens before confirmation, even if the reply is unclear. Unclear replies get asked again once, then the panel waits for a button.
- [ ] **OBJ-17.8** Tests for the harness flow with a mocked model; manual checks of the full voice loop on the Mac.

## Expectations

- [ ] SPEC-01 scenarios pass with their exact copy: "User gives a goal and confirms it", "User corrects the goal", "User cancels before work starts".
- [ ] `confirmedGoal` and the raw `goal` are stored separately.
- [ ] Nothing runs before a confirm.

## Expected outcomes

- The confirmation flow in the harness, the confirmation panel and `speak` interface on the Mac, and reply classification.

## Out of scope

- Confirmation on Android: needs the phone model (SPEC-10, not finalized).
- Kokoro voice: later, behind the same `speak` interface.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
