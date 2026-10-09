---
id: OBJ-18
title: Cursor overlay and motion
product: mac
assignee: Patrick
touches: []
specs: [SPEC-04]
status: todo
priority: p0
depends-on: [OBJ-14]
integrates-with: []
tags: [objective, p0, mac, ux]
---

# OBJ-18 Cursor overlay and motion

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-04](../specs/04-cursor-presence.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Yumi's cursors are drawn on a transparent layer above every app.
This objective builds that layer and the motion system with simple placeholder shapes, so cursor behavior can be built and tested before the Rive cat is ready.
The overlay must never get in the way of the user's own clicks.

## Read first

- [SPEC-04](../specs/04-cursor-presence.md), requirements 1-9 and the "Cursor presence" scenarios.
- [OBJ-14](OBJ-14-mac-app-shell.md) Outcome.
- The `cursorCommand` event schema from [OBJ-01](OBJ-01-task-record-schemas.md).

## Tasks

- [ ] **OBJ-18.1** Create one borderless, transparent, click-through panel per display, above normal windows, following display changes (plug, unplug, rearrange).
- [ ] **OBJ-18.2** Cursor model: id, kind (main or ghost), position, state (listening, thinking, moving, acting, waiting, paused), color, and label. Placeholder drawing for now.
- [ ] **OBJ-18.3** Motion: move to a target along an eased curve in about 300 ms, never teleporting, crossing displays correctly in global screen coordinates.
- [ ] **OBJ-18.4** Correct size and position at every display scale factor, including mixed scales across displays.
- [ ] **OBJ-18.5** Ghost cursors get their own color and a short label with the subtask title. Helpers show as small status chips, not cursors.
- [ ] **OBJ-18.6** Fade cursors in on spawn and out within 1 second when their task ends.
- [ ] **OBJ-18.7** Drive everything from the harness's `cursorCommand` events (spawn, move, set state, label, fade). Add a debug menu to trigger each command by hand.
- [ ] **OBJ-18.8** Check it looks right in light and dark mode, over full-screen apps, and on an external display.

## Expectations

- [ ] SPEC-04 scenarios pass: "Cursor moves smoothly to a target", "Thinking state during a slow step", "Ghost cursors are labeled", "Overlay does not block the user", "Cursor works on a second display", "Cursors leave when the task ends".
- [ ] Clicks by the user anywhere on screen reach the app underneath while cursors are visible.
- [ ] Motion stays smooth with 3 cursors moving at once.

## Expected outcomes

- The overlay, cursor model, motion system, ghost labels, helper chips, and `cursorCommand` handling, with a debug menu.

## Out of scope

- The cat art and animation: [OBJ-19](OBJ-19-rive-cat-cursor.md).
- Performing the actual click or key press: SPEC-05, not finalized. The click point this objective exposes is what SPEC-05 will use.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
