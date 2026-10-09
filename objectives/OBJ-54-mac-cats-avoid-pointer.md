---
id: OBJ-54
title: Cats avoid the user's pointer
product: mac
assignee: Brent
touches: [character]
specs: [SPEC-04]
status: in-progress
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, mac, character, cursor, ux]
---

# OBJ-54 Cats avoid the user's pointer

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

Yumi's cats can sit on top of exactly what the user needs to click.
SPEC-04 requirement 21 makes them behave like cats that do not want to be petted: idle, thinking, and paused cats scoot away from the user's pointer, and an acting cat fades so the user can see through it.
It keeps the screen usable and adds personality.

## Read first

- SPEC-04 requirements 2, 7, 11, 14, 17, and 21, "Cat behaviors", and the Decisions.
- `mac/Yumi/Overlay/CursorMotion.swift`, `mac/Yumi/Overlay/OverlayCursor.swift`, `mac/Yumi/Overlay/CursorLayer.swift`, and `mac/Yumi/Overlay/CursorRoster.swift`.
- [character/README.md](../character/README.md) and the design tokens in `character/design/`.
- [SPEC-06](../specs/06-user-control.md) requirement 2: moving the pointer yourself is a take-over, so most cats will be paused while the user moves.

## Tasks

- [x] **OBJ-54.1** Track the user's pointer cheaply (no polling loop that wakes the CPU when the pointer is still) and find cats within a radius of it.
- [x] **OBJ-54.2** Idle, thinking, and paused cats scoot out of the way along a short eased hop with an ears-back pose, then drift back to their spot after the pointer leaves for about a second.
- [x] **OBJ-54.3** A cat that is acting stays put and fades to see-through while the pointer is near, then fades back.
- [x] **OBJ-54.4** With "Reduce motion" on, every cat fades instead of moving (SPEC-04 requirement 17).
- [x] **OBJ-54.5** Add the radius, hop distance, and fade level as design tokens in character/, and an ears-back pose if the art lacks one.
- [ ] **OBJ-54.6** Add it to the cursor demo, test the rules in the view model, and check it live with a real task.

## Expectations

- [ ] Moving the pointer onto an idle or paused cat makes it scoot away and come back afterwards.
- [ ] Moving the pointer onto an acting cat makes it see-through without moving it, so its click point is unchanged.
- [ ] SPEC-04 "Overlay does not block the user" still passes.

## Expected outcomes

- Pointer avoidance in the overlay, the new tokens and pose, and demo support.

## Out of scope

- Pausing on take-over: [OBJ-35](OBJ-35-mac-stop-and-take-over.md).

## Outcome

- **Result:** In progress. The dodge is built and tuned to Brent's decisions below; OBJ-54.6's live check with a real task is not done yet.
- **Delivered so far:** `mac/Yumi/Overlay/PointerAvoidance.swift` (the rules and `PointerAvoider`), the ears-back pose (`mac/scripts/render-ears-back-cat.py`), the tokens in `character/design/tokens.json`, and the "don't pet me" part of the cursor demo (`mac/Yumi/Overlay/CursorAvoidDemo.swift`).
- **Decisions and deviations:** Brent decided how the dodge feels on 2026-10-10 (SPEC-04 requirement 21 and its Decisions):
  - The hop is a quick, startled hop of about 200 ms (`avoidHopMs`); the drift back keeps the normal move curve and duration.
  - Listening, moving, waiting-for-the-user, done, and stuck cats fade in place, like acting ones, as built.
  - A cat reacts only when the user's pointer moves toward it and comes within about 24 points of its body, not its center (`avoidRadiusPt`, up from 8). A cat that appears next to a still pointer, as the main cat does after a goal is spoken, stays put; one already dodging keeps answering in the way its new state asks, so dodging and pausing still do not fight.
  - Tested in `mac/YumiTests/PointerAvoidanceTests.swift`: `onlyAPointerComingAtACatStartlesIt`, `aCatThatAppearsNextToAStillPointerStaysPut`, `anActingCatBesideAStillPointerStaysSolid`, `theHopIsAStartledHopAndTheDriftBackIsAMove`, and the radius in `nearMeansOverTheCatOrWithinTheRadius`. The cursor demo now parks the pointer, lands the main cat beside it, where it stays put, then moves the pointer at it so it hops.
- **Not verified:** the dodge on a real task (OBJ-54.6), and the demo's new part on screen: it needs the Yumi app running, which only one agent may do at a time. To check: `-YumiCursorDemo YES` from a Debug build, and watch the part after the four cats.

