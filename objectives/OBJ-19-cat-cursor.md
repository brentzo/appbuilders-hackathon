---
id: OBJ-19
title: Cat cursor without Rive
product: mac
assignee: Patrick
touches: []
specs: [SPEC-04]
status: in-progress
priority: p0
depends-on: [OBJ-10, OBJ-18]
integrates-with: []
tags: [objective, p0, mac, ux, character]
---

# OBJ-19 Cat cursor without Rive

**Product:** [Yumi Mac](../mac/README.md) · **Specs:** [SPEC-04](../specs/04-cursor-presence.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The cursors on the Mac overlay are Yumi the cat.
Rive is out of scope (SPEC-04 Decisions, 2026-10-10), so the cat is drawn from the native poses from [OBJ-10](OBJ-10-yumi-cat-v0.md) and moved with Core Animation.
A click is a pounce, and the paws must land exactly on the click point.

## Read first

- [SPEC-04](../specs/04-cursor-presence.md), requirements 10-18 and the "Cursor character" scenarios.
- [OBJ-10](OBJ-10-yumi-cat-v0.md) and [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) Outcomes.
- `mac/Yumi/Overlay/CursorLayer.swift`, `mac/Yumi/Overlay/CursorMotion.swift`, `mac/Yumi/Overlay/CursorOverlay.swift`.

## Tasks

- [x] **OBJ-19.1** Draw each cursor as the cat pose for its state, from `CursorCat.xcassets`.
- [x] **OBJ-19.2** Map every cursor state to its pose: idle, listening, thinking, moving, acting, waiting for the user, paused, done, stuck.
- [x] **OBJ-19.3** Put the paws on the cursor position, so a pounce lands on the target point.
- [x] **OBJ-19.4** Pounce on a click in 0.3 seconds, with the paws staying on the click point.
- [x] **OBJ-19.5** Ghost cursors: the same cat in their own coat (mint, sky, slate).
- [x] **OBJ-19.6** Read macOS "Reduce motion": leaps, arcs, pounces, and pose motion turn into straight glides or stillness.
- [x] **OBJ-19.7** Show listening on the wake word or push-to-talk, and thinking while the model works.
- [ ] **OBJ-19.8** Check sharpness on Retina and non-Retina displays, light and dark backgrounds, and CPU use with 3 cats animating.

## Expectations

- [ ] SPEC-04 "Cursor character" scenarios pass on the Mac: "Cat reacts to the wake word", "Click is a pounce on the exact point", "Playfulness does not slow the task", "Ghost cursors are littermates", "Reduce motion", "Cat stays sharp", "Stuck cat is gentle".
- [ ] The pounce lands within a pixel of the click point at every display scale.
- [ ] CPU use with 3 animating cats is measured and written in the Outcome.

## Expected outcomes

- The cat cursor on the Mac overlay, wired to cursor states, ghost coats, pounce, and Reduce motion.

## Out of scope

- Changing the cat art: [character](../character/README.md).
- The cat in the Android app: [OBJ-22](OBJ-22-android-app-shell.md).

## Outcome

- **Result:** In progress. Every behavior is built; what is left is the hand check on a Mac (OBJ-19.8 and the expectations).
- **Delivered:**
  - Poses per state and coat: `CursorLayer.showPose`, from `mac/Yumi/Overlay/CursorCat.xcassets` ([OBJ-10](OBJ-10-yumi-cat-v0.md)).
  - Click point: `CursorLayer.hotspot`; the layer's position is the click point.
  - Pounce: the `.acting` motion in `CursorLayer` (0.3 s crouch, stretch, land, paws fixed), and `CursorOverlay.pounce(id:)`.
  - Reduce motion: `CursorMotion.reduceMotion` and `CursorLayer.reduceMotion` (`accessibilityDisplayShouldReduceMotion`), used for moves, the island, the bubble, and pose motion.
  - Listening: `VoiceIntake` and `GoalConfirmation` set the main cursor to listening. Thinking: the harness sends `setState` thinking (`harness/src/confirm/confirmation.ts`, `harness/src/gui/gui-act.ts`).
- **Commits:** `6ca8a07`, `5f7ff47`, `4e50839`, `73c52f8` (see OBJ-10 and OBJ-18), plus `docs(objectives): rewrite OBJ-19 for the native cat cursor`.
- **Expectations:** Not checked yet; covered in part by `CursorOverlayTests` (`harnessCommandsDriveTheCursors`, `movesArcLikeALeapAndEndOnTheTarget`).
- **Not verified:** On a Mac with a Retina display and, if possible, a non-Retina one:
  1. Run Yumi with `-YumiMockScript keynote-export -YumiSendSampleGoal YES` and walk each "Cursor character" scenario.
  2. Use the cursor debug menu to put 3 cats in motion and read CPU in Activity Monitor; write the number here.
  3. Turn on Reduce motion in System Settings and check that leaps and pounces become glides.
  4. Zoom a screenshot of a pounce to check the paws stay within a pixel of the click point.
- **Decisions and deviations:** The Rive tasks (runtime, `.riv`, state machine inputs) are gone with Rive; the same behaviors are built natively.
- **For the next objectives:** None.
