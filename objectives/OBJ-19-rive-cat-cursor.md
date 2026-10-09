---
id: OBJ-19
title: Rive cat cursor
product: mac
assignee: Patrick
touches: [character]
specs: [SPEC-04]
status: todo
priority: p0
depends-on: [OBJ-10, OBJ-18]
integrates-with: []
tags: [objective, p0, mac, ux, character]
---

# OBJ-19 Rive cat cursor

**Product:** [Yumi for Mac](../mac/README.md) · **Also touches:** [character](../character/README.md) · **Specs:** [SPEC-04](../specs/04-cursor-presence.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

This replaces the placeholder cursors with Yumi the cat.
The overlay sets the cat's state; Rive's state machine does the animation and blends the transitions.
A click is a pounce, and the paw tip must land exactly on the click point.

## Read first

- [SPEC-04](../specs/04-cursor-presence.md), requirements 10-18 and the "Cursor character" scenarios.
- [character/README.md](../character/README.md), "State machine contract".
- [OBJ-10](OBJ-10-yumi-cat-v0.md) and [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) completion notes.

## Tasks

- [ ] **OBJ-19.1** Add Rive's Apple runtime (rive-ios, which supports macOS) and render `character/yumi-cat.riv` inside each cursor view on the overlay.
- [ ] **OBJ-19.2** Map every cursor state from OBJ-18 to the contract's inputs: idle, listening, thinking, moving, waiting, paused, done, stuck.
- [ ] **OBJ-19.3** Align the contract's click point (paw tip) with the cursor position, so a pounce lands on the target point.
- [ ] **OBJ-19.4** Fire the pounce trigger just before a click, within the normal ~300 ms movement time.
- [ ] **OBJ-19.5** Ghost cursors: the same cat with their own color through the contract's color input.
- [ ] **OBJ-19.6** Read macOS "Reduce motion" and set the contract's `reduceMotion` input, so leaps and pounces become glides. Update when the setting changes.
- [ ] **OBJ-19.7** React to "Hey Yumi" and thinking: listening state on wake word or push-to-talk, thinking state while the model chooses the next action.
- [ ] **OBJ-19.8** Check sharpness on Retina and non-Retina displays, light and dark backgrounds, and CPU use with 3 cats animating.

## Expectations

- [ ] SPEC-04 "Cursor character" scenarios pass: "Cat reacts to the wake word", "Click is a pounce on the exact point", "Playfulness does not slow the task", "Ghost cursors are littermates", "Reduce motion", "Cat stays sharp", "Stuck cat is gentle".
- [ ] The pounce lands within a pixel of the click point at every display scale.
- [ ] CPU use with 3 animating cats is measured and written in the completion notes.

## Outcomes

- The cat cursor on the Mac overlay, wired to cursor states, ghost colors, pounce, and Reduce motion.

## Out of scope

- Changing the Rive file or its contract: [character](../character/README.md) and [OBJ-10](OBJ-10-yumi-cat-v0.md).
- The cat in the Android app: [OBJ-22](OBJ-22-android-app-shell.md).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
