---
id: OBJ-08
title: Window locks, busy windows, and cursor cap
product: harness
assignee: Brent
touches: []
specs: [SPEC-03]
status: in-progress
priority: p0
depends-on: [OBJ-07]
integrates-with: [OBJ-27]
tags: [objective, p0, harness, gui]
---

# OBJ-08 Window locks, busy windows, and cursor cap

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-03](../specs/03-lane-routing.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Two cursors in one window would fight over the same form, so each window is locked to one cursor.
When a job needs a window that is busy, Yumi opens a second window of the same app if it can, and otherwise waits, telling the user if the wait gets long.
At most 3 cursors are visible at once.

## Read first

- [SPEC-03](../specs/03-lane-routing.md), requirements 5, 6, 11-13, the "Busy window" and "Cursor cap" scenarios, and the Decisions section.
- [docs/lane-router.md](../docs/lane-router.md), "Checks" and "Lane-specific rules".
- [OBJ-07](OBJ-07-lane-router-core.md) Outcome.

## Tasks

- [ ] **OBJ-08.1** Store window locks in the task store with `windowId`, `subtaskId`, `lane`, `acquiredAt`, and `expiresAt`. Expired locks are released automatically so a crashed worker cannot block a window.
- [ ] **OBJ-08.2** Acquire the lock as part of routing a `ghost` or `main` subtask, and release it when the subtask ends, fails, or hands off.
- [ ] **OBJ-08.3** Call the Mac app's `openNewWindow(bundleId)`, which opens a new window of the app when the app supports it (for example a new Chrome window, Finder window, or email draft) and returns its window id, or says it cannot. Develop against the mock Mac app; Patrick implements it in [OBJ-27](OBJ-27-mac-native-services.md).
- [ ] **OBJ-08.4** Busy window rule: if the target window is locked, try `openNewWindow` and route to the new window. If the app cannot, queue the subtask until the lock is released.
- [ ] **OBJ-08.5** After a subtask has waited 2 minutes, emit a `waitingForWindow` event with the app name and the subtask, so the Mac app can say "I'm waiting for Keynote to be free before I add the chart. It should be quick."
- [ ] **OBJ-08.6** Cursor cap: count visible cursors (main plus ghosts). If 3 are visible, queue new ghost-capable subtasks until one finishes. The cap comes from config.
- [ ] **OBJ-08.7** When a task is about to use more than one window at once, emit a `tilingSuggested` event listing the windows. Patrick's [OBJ-20](OBJ-20-window-tiling.md) handles it in the Mac app.
- [ ] **OBJ-08.8** Tests: lock acquire and release, lock expiry, second window path, waiting path, 2-minute notice, cap queueing.

## Expectations

- [ ] SPEC-03 scenarios pass: "Busy window, app supports a second window", "Busy window, app cannot open a second window", "Long wait is explained", "Cursor cap is reached".
- [ ] No two cursors ever hold the same window at the same time, including after a crash and restart.
- [ ] The 2-minute notice is a structured event; the spoken copy lives in the app.

## Expected outcomes

- Lock management, the `openNewWindow` call, the waiting notice and tiling suggestion events, and the cursor cap.

## Out of scope

- Window tiling: [OBJ-20](OBJ-20-window-tiling.md).
- Ghost failure and handoff: [OBJ-09](OBJ-09-ghost-handoff.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
