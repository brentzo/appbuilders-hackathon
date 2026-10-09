---
id: OBJ-09
title: Ghost handoff
product: harness
assignee: Brent
touches: [mac]
specs: [SPEC-03]
status: done
priority: p0
depends-on: [OBJ-06, OBJ-08]
integrates-with: []
tags: [objective, p0, harness, gui]
---

# OBJ-09 Ghost handoff

**Product:** [Yumi Harness](../harness/README.md) · **Also touches:** [mac](../mac/README.md) · **Specs:** [SPEC-03](../specs/03-lane-routing.md) · **Assignee:** Brent

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
- [OBJ-06](OBJ-06-resume-and-limits.md) and [OBJ-08](OBJ-08-locks-busy-windows-cap.md) Outcome.

## Tasks

- [x] **OBJ-09.1** Count consecutive `invalidOutput` and `noEffect` outcomes per subtask.
- [x] **OBJ-09.2** Trigger a handoff after 2 consecutive `invalidOutput` or 3 consecutive `noEffect` on a ghost.
- [x] **OBJ-09.3** On handoff: set the subtask to `handoff`, release the window lock, record `lastGoodStep`, and queue the subtask for `main` with route reason `promotedAfterFailure`.
- [x] **OBJ-09.4** Emit `cursorCommand` events for the visual: fade out the ghost, move the main cursor to the window.
- [x] **OBJ-09.5** When `main` picks up the subtask, build its input from the task record and a fresh observation, starting after `lastGoodStep`.
- [x] **OBJ-09.6** If `main` hits 3 consecutive `noEffect` on a handed-off subtask, pause it and emit a user-facing error event of kind `stuckOnScreen`.
- [x] **OBJ-09.7** Tests with scripted outcomes: both handoff triggers, lock release, resume from the last good step, the stuck-on-main path.

## Expectations

- [x] SPEC-03 scenarios "Stuck ghost hands off to the main cursor" and "Main cursor also gets stuck" pass.
- [x] The handed-off subtask never repeats steps that already had an `ok` outcome.
- [x] The step log is intact after a handoff.

## Expected outcomes

- Failure counters, the handoff path, handoff cursor events, and the stuck-on-main pause.

## Out of scope

- Drawing the fade and move: [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) and [OBJ-19](OBJ-19-cat-cursor.md) consume these events.
- The "I'll show you" interaction from the stuck error: SPEC-05 and SPEC-06, not finalized.

## Outcome

- **Result:** Done.
- **Delivered:**
  - `harness/src/scheduler/handoff.ts`: `handoffDue` (2 invalid replies or 3 no-effect steps in a row, from `gui_act`'s streaks) and `lastGoodStep`.
  - `harness/src/scheduler/gui-lane.ts`: a stuck ghost returns the new `handoff` run outcome instead of failing; a handed-off subtask first spawns and moves the main cursor to the window's center (`elementPath: "AXWindow"`). The ghost's own `gui_act` attempt already fades its cursor.
  - `harness/src/scheduler/scheduler.ts`: on `handoff`, the subtask is set to `handoff` with `lastGoodStep` (the store releases its window lock in the same change), then `queued`, and routed again to `main`. If `main` gets stuck on it, the UI lanes pause, the task goes to `paused`, and the user gets a `stuckOnScreen` error; Resume tries again on `main`.
  - `harness/src/router/router.ts` and `harness/src/scheduler/lanes.ts`: `route(subtask, proposed, promoted)` sends a handed-off subtask to `main` with reason `promotedAfterFailure`. Its claim prefers the window the ghost worked in.
  - `harness/test/ghost-handoff.test.ts`: runs the scheduler, the real lane router, and `gui_act` against a fake Keynote window, with no socket.
- **Commits:** `feat(harness): hand a stuck ghost's subtask to the main cursor` (this commit).
- **Expectations:**
  - "Stuck ghost hands off to the main cursor": test of the same name (status `handoff`, no window lock at that moment, ghost fade then main move, `promotedAfterFailure`, main continues). "Main cursor also gets stuck": test of the same name (`stuckOnScreen` error, task paused, Resume finishes on `main`).
  - No repeated steps: the same test checks the Mac actions after the handoff are only main's new ones.
  - Step log intact: the same test checks the ghost's step ids and outcomes are unchanged after the handoff.
  - Both triggers: the no-effect scenario test, and "hands off after 2 invalid replies in a row".
- **Not verified:**
  - The full harness suite on macOS: on Windows, 198 tests fail before and after this change (Unix sockets and POSIX paths), the same list both times. Run `python3 scripts/verify.py` on a Mac.
  - The fade and move on a real Mac overlay: run a goal whose ghost gets stuck (for example `-YumiMockScript` with a button that never changes the window) and watch the ghost fade and the main cat move to that window.
- **Decisions and deviations:**
  - The handed-off subtask is set to `queued` right after `handoff`, as docs/lane-router.md step 3 says, so a pause or restart finds it in a status the scheduler already handles.
  - "Stuck on screen" for a stuck `main` pauses the task rather than failing it, so the user's Resume can carry on. "I'll show you" and "Skip this step" stay out of scope.
  - Which subtasks were handed off is kept per run: after a restart, a handed-off subtask is routed by capability again.
- **For the next objectives:** `RouteSubtask` takes an optional `promoted` flag. `SubtaskRun` has a `handoff` outcome that only the ghost lane returns. `SchedulerDeps.voice` carries the stuck error to the user.
