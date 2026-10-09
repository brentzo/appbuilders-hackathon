---
id: OBJ-20
title: Window tiling with consent
product: mac
assignee: Patrick
touches: []
specs: [SPEC-03]
status: in-progress
priority: p0
depends-on: [OBJ-18, OBJ-27]
integrates-with: [OBJ-08]
tags: [objective, p0, mac, harness, ux]
---

# OBJ-20 Window tiling with consent

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-03](../specs/03-lane-routing.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Tiling arranges the task's windows side by side so the user can watch every cursor at once.
Ghosts work fine in covered windows, so tiling is only for watching, and moving someone's windows without asking is rude.
Yumi asks first, puts every window back afterward, and has a demo mode that tiles without asking.

## Read first

- [SPEC-03](../specs/03-lane-routing.md), requirements 14-16, the "Window tiling" scenarios, and Decisions.
- The `tilingSuggested` event and window service contracts from [OBJ-01](OBJ-01-task-record-schemas.md). Brent's [OBJ-08](OBJ-08-locks-busy-windows-cap.md) emits the event; use the mock harness to script it until then.
- [OBJ-27](OBJ-27-mac-native-services.md) Outcome (window frames).

## Tasks

- [x] **OBJ-20.1** Handle the `tilingSuggested` event from the harness (scripted with the mock harness until OBJ-08 is done).
- [x] **OBJ-20.2** Unless demo mode is on, ask "Want me to arrange your windows so you can watch all of us work?" by voice and in a panel with "Arrange windows" and "Leave them" buttons.
- [x] **OBJ-20.3** Before moving anything, save each window's original position, size, and display.
- [x] **OBJ-20.4** Tile with the window services from OBJ-27 (window position and size through the Accessibility API), in a grid on the display where the task started, so every task window is fully visible.
- [x] **OBJ-20.5** On "Leave them", move nothing. Ghosts keep working in covered windows.
- [x] **OBJ-20.6** Restore every moved window when the task ends or is cancelled, including after an app or harness restart (keep the saved layout in the Mac app's own storage).
- [x] **OBJ-20.7** Demo mode setting (from [OBJ-14](OBJ-14-mac-app-shell.md)), off by default: tile without asking.
- [ ] **OBJ-20.8** Check the layout looks clean with 2, 3, and 4 windows, on a laptop display and an external display, and fix gaps or overlaps.

## Expectations

- [x] SPEC-03 scenarios pass: "Yumi asks before tiling", "User says yes", "User says no", "Layout is restored", "Demo mode tiles without asking".
- [x] No window is ever moved without a yes, unless demo mode is on.
- [x] Every moved window returns to its exact original frame.

## Expected outcomes

- The consent panel, tiling and restore on the Mac, and demo mode behavior.

## Out of scope

- Unminimizing windows for ghosts: part of GUI control (SPEC-05).

## Outcome

- **Result:** In progress.
  OBJ-20.1 to OBJ-20.7 are built and tested on the Mac side.
  OBJ-20.8 is open: the layout is checked with 2, 3, and 4 windows on the laptop display, but no external display was connected.
  The harness does not emit `tilingSuggested` yet; that is Brent's [OBJ-08](OBJ-08-locks-busy-windows-cap.md), and the Mac side was driven by the mock and by tests until then.
- **Delivered:**
  - `mac/Yumi/Tiling/`: `WindowTiler` (ask, tile, restore), `TilingLayout` (the grid), `TiledLayoutStore` (saved frames in Yumi's preferences), `TilingPanel` (the consent panel and the spoken question), `TaskDisplay`, and `TilingState` (for the menu).
  - `mac/Yumi/Harness/HarnessLink.swift`: `tilingSuggested` goes to the tiler, task status changes restore windows, and after connecting Yumi restores the windows of tasks that are no longer running.
  - "Put windows back" in the menu while windows are tiled.
  - Tests in `mac/YumiTests/WindowTilerTests.swift`.
- **Commits:**
  - `33ceec6 docs(objectives): start OBJ-20`
  - `60f230a feat(mac): ask before tiling a task's windows, tile them in a grid, and put them back`
  - `bbec799 test(mac): cover the window tiling scenarios`
  - `00989f1 docs(mac): document window tiling`
  - and the commit that records this outcome.
- **Checked:**
  - Tests: 73 of 73 in 15 suites, 6 of them for tiling.
  - Live, with OBJ-27's `WindowService` through a command-line build of the same sources and this shell's Accessibility permission, on 4 scratch TextEdit windows on the built-in display (visible area 1710 x 971 points):
    - with 2, 3, and 4 windows, nothing moved before the yes;
    - every tiled window landed exactly on its grid cell, fully inside the visible area, with no overlaps;
    - after the task ended, every window was back at its exact original frame.
  - Against the mock's `windows-and-bridge` script, the app received `tilingSuggested` and arranged nothing, because the script's Keynote and Chrome windows do not exist on this Mac.
  - The consent panel, rendered in light and dark.
- **Expectations:**
  - The SPEC-03 scenarios: "Yumi asks before tiling", "User says no", "Layout is restored", and "Demo mode tiles without asking" are covered by `WindowTilerTests`; "User says yes" and "Layout is restored" also live on real windows.
  - No window moves without a yes unless demo mode is on: the tiler only moves windows after "Arrange windows" or in demo mode, and a yes that arrives after the task ended does nothing.
  - Exact restore: checked live and in tests.
- **Hand check for Patrick:**
  1. Build Debug with your `Signing.local.xcconfig`, and allow Yumi in System Settings > Privacy & Security > Accessibility.
  2. Open two or three windows, for example Keynote, Mail, and Notes, somewhere on screen.
  3. Run Yumi with the real harness once OBJ-08 sends `tilingSuggested`; until then, a mock script with your real window ids does the same (the bundled `windows-and-bridge` script names windows that do not exist on your Mac).
     Ask the orchestrator to schedule the run: two Yumi apps on one Mac share the harness socket.
  4. Expect the question out loud and the panel at the top of the display with the cat cursor.
     "Leave them" moves nothing.
     "Arrange windows" tiles them side by side; check there are no gaps or overlaps you dislike.
  5. End or cancel the task: every window should go back exactly.
     While tiled, the menu shows "Put windows back".
  6. Turn on Demo mode in Settings and repeat: no question, the windows tile right away.
  7. If you have an external display, repeat steps 4 and 5 with the task on it.
- **Not verified:**
  - An external display, displays with different scales, and windows on another display than the task's.
  - Windows that refuse a size: an app with a minimum window size larger than its cell would overlap its neighbor.
  - Minimized and full-screen windows, and more than 4 windows.
  - A window whose app quit while tiled: it is skipped on restore.
  - Restoring after a real app or harness restart: covered by a test with a fresh tiler on the same storage, not by restarting the app.
  - The spoken question and the panel on screen in the running app: the app stayed un-launched this round so it would not share the harness socket with the OBJ-15 session.
- **Decisions and deviations:**
  - The task's display is the one with the main cursor, which appears next to the user's pointer when a task starts; without one, the pointer's display.
  - The grid: 2 windows side by side, 3 and 4 in two rows, with a last row of fewer windows stretched; 8 points between windows and around the edges, inside the display's visible area (without the menu bar and Dock).
  - The saved layout is kept in Yumi's preferences under `tiling.savedLayouts`: the harness offers no place for it.
    After every connect, Yumi calls `listTasks` and restores the layouts of tasks that are no longer active.
  - The answer stays in the app: the protocol has no method to send it to the harness, and the harness does not need it, since ghosts work in covered windows anyway.
  - The question is spoken with the system voice (`TilingVoice`), a stand-in until OBJ-17's `speak` interface; voice answers wait for voice intake.
  - The panel never becomes key, so "Arrange windows" uses its own accent style instead of AppKit's default button, which would draw gray.
  - A suggestion with fewer than 2 windows on screen arranges nothing.
- **For the next objectives:**
  - [OBJ-08](OBJ-08-locks-busy-windows-cap.md): send `tilingSuggested` with the task's window ids; a missing `windowId` uses the app's first window.
  - [OBJ-17](OBJ-17-goal-confirmation.md): replace `TilingVoice` with the `speak` interface.
