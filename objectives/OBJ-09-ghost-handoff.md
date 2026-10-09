---
id: OBJ-09
title: Ghost handoff
product: harness
touches: [mac]
specs: [SPEC-03]
status: todo
priority: p0
depends-on: [OBJ-06, OBJ-08]
tags: [objective, p0, harness, gui]
---

# OBJ-09 Ghost handoff

**Product:** [Yumi Harness](../harness/README.md) · **Also touches:** [mac](../mac/README.md) · **Specs:** [SPEC-03](../specs/03-lane-routing.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

A ghost that gets stuck should not retry forever.
It hands its subtask to the main cursor, which continues from the last good step using the task record, with no shared conversation.
On screen, the ghost fades and the main cursor moves to that window, which makes the handoff visible.
If the main cursor gets stuck too, Yumi asks the user for help.

## Read first

- [SPEC-03](../specs/03-lane-routing.md), requirements 8 and 9, and the "Ghost handoff" scenarios.
- [docs/lane-router.md](../docs/lane-router.md), "Handoff (promotion)".
- [SPEC-11](../specs/11-user-facing-errors.md), "Stuck on screen".
- [OBJ-06](OBJ-06-resume-and-limits.md) and [OBJ-08](OBJ-08-locks-busy-windows-cap.md) completion notes.

## Tasks

- [ ] **OBJ-09.1** Count consecutive `invalidOutput` and `noEffect` outcomes per subtask.
- [ ] **OBJ-09.2** Trigger a handoff after 2 consecutive `invalidOutput` or 3 consecutive `noEffect` on a ghost.
- [ ] **OBJ-09.3** On handoff: set the subtask to `handoff`, release the window lock, record `lastGoodStep`, and queue the subtask for `main` with route reason `promotedAfterFailure`.
- [ ] **OBJ-09.4** Emit `cursorCommand` events for the visual: fade out the ghost, move the main cursor to the window.
- [ ] **OBJ-09.5** When `main` picks up the subtask, build its input from the task record and a fresh observation, starting after `lastGoodStep`.
- [ ] **OBJ-09.6** If `main` hits 3 consecutive `noEffect` on a handed-off subtask, pause it and emit a user-facing error event of kind `stuckOnScreen`.
- [ ] **OBJ-09.7** Tests with scripted outcomes: both handoff triggers, lock release, resume from the last good step, the stuck-on-main path.

## Expectations

- [ ] SPEC-03 scenarios "Stuck ghost hands off to the main cursor" and "Main cursor also gets stuck" pass.
- [ ] The handed-off subtask never repeats steps that already had an `ok` outcome.
- [ ] The step log is intact after a handoff.

## Outcomes

- Failure counters, the handoff path, handoff cursor events, and the stuck-on-main pause.

## Out of scope

- Drawing the fade and move: [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) and [OBJ-19](OBJ-19-rive-cat-cursor.md) consume these events.
- The "I'll show you" interaction from the stuck error: SPEC-05 and SPEC-06, not finalized.

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
