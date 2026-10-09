---
id: OBJ-10
title: Yumi cat v0 without Rive
product: character
assignee: Patrick
touches: [mac]
specs: [SPEC-04]
status: done
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, character, ux]
---

# OBJ-10 Yumi cat v0 without Rive

**Product:** [Yumi Character](../character/README.md) · **Also touches:** [mac](../mac/README.md) · **Specs:** [SPEC-04](../specs/04-cursor-presence.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Yumi's personality is a playful cat, and the cat is how users understand what Yumi is doing.
The apps needed a cat with a pose for every cursor state, a fixed click point, and ghost littermate colors, so the cursor could be built early.
This was first planned as a Rive file; Rive is now out of scope, and the cat is drawn as vector poses rendered from the layered art (SPEC-04 Decisions, 2026-10-10).

## Read first

- [SPEC-04](../specs/04-cursor-presence.md): requirements 10-18, "Cat behaviors", "Animation tools", and Decisions.
- `mac/scripts/render-cursor-cat.py` and `mac/Yumi/Overlay/CursorLayer.swift`.

## Tasks

- [x] **OBJ-10.1** Render one pose per cursor state (idle, listening, thinking, moving, acting, waitingForUser, paused, done, stuck), plus ears back for pointer avoidance, from the layered cat art.
- [x] **OBJ-10.2** Render each pose in every cat palette: ginger for the main cursor, and mint, sky, and slate for ghost littermates.
- [x] **OBJ-10.3** Fix the click point where the paws land in the pose image, so a click lands on it.
- [x] **OBJ-10.4** Record that Rive is out of scope in SPEC-04 Decisions.

## Expectations

- [x] Every cursor state has its own pose.
- [x] Ghost littermates are the same cat in their own color.
- [x] The click point is defined in one place and used by the cursor.

## Expected outcomes

- The cat poses for every state and palette, the render script, and the click point.

## Out of scope

- Checking the cat cursor against every SPEC-04 "Cursor character" scenario on the Mac: [OBJ-19](OBJ-19-cat-cursor.md).
- The cat in the Android app: [OBJ-22](OBJ-22-android-app-shell.md) and later Android work.

## Outcome

- **Result:** Done without Rive. Rive is out of scope and will not be implemented (Patrick, 2026-10-10); the cat cursor already works with native vector poses.
- **Delivered:**
  - `mac/scripts/render-cursor-cat.py` (with `mac/scripts/cursor-cat-states.tsx` and `mac/scripts/render-ears-back-cat.py`): renders every state in every palette from the layered cat in `character/remotion/src/cat` and the palettes in `character/design/tokens.json`.
  - `mac/Yumi/Overlay/CursorCat.xcassets`: 40 pose image sets, 10 poses (9 states plus ears back) in 4 coats (ginger, mint, sky, slate), at 1x and 2x.
  - The click point in `CursorLayer.hotspot`: (229.6, 434.3) in the 512-unit pose image.
  - The SPEC-04 decision dropping Rive, and requirement 16 reworded to "drawn from vector art".
- **Commits:**
  - `6ca8a07 feat(mac): render the cat cursor's poses for every state in its four coats`
  - `5f7ff47 feat(mac): draw cursors as the Yumi cat and move them on a curved leap, with ghosts splitting out of the main cat`
  - `docs(objectives): finish OBJ-10 without Rive` (this commit)
- **Expectations:**
  - Every cursor state has its own pose: the image sets in `CursorCat.xcassets` cover every `CursorState` in `protocol/schemas/rpc.json`.
  - Ghost littermates: each pose exists in the mint, sky, and slate coats.
  - Click point: `CursorLayer.hotspot`, where the layer's position is the click point.
- **Not verified:** Nothing new here; the cursor's behavior on screen is checked in OBJ-19.
- **Decisions and deviations:** The original tasks (Rive editor, `.riv` export, state machine contract) were dropped with Rive. The original pounce, `reduceMotion`, and blending expectations belong to the cursor's motion, now in OBJ-19 and the overlay.
- **For the next objectives:** OBJ-19 no longer adds a Rive runtime; it checks the native cat against SPEC-04. Re-render the poses with `python3 mac/scripts/render-cursor-cat.py` after any art change.
