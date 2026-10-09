---
id: OBJ-20
title: Window tiling with consent
product: mac
touches: [harness]
specs: [SPEC-03]
status: todo
priority: p0
depends-on: [OBJ-08, OBJ-18]
tags: [objective, p0, mac, harness, ux]
---

# OBJ-20 Window tiling with consent

**Product:** [Yumi for Mac](../mac/README.md) · **Also touches:** [harness](../harness/README.md) · **Specs:** [SPEC-03](../specs/03-lane-routing.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), Qwen3.5-4B on the Android demo phone (12 GB), Whisper and native on-device speech recognition for voice.
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Tiling arranges the task's windows side by side so the user can watch every cursor at once.
Ghosts work fine in covered windows, so tiling is only for watching, and moving someone's windows without asking is rude.
Yumi asks first, puts every window back afterward, and has a demo mode that tiles without asking.

## Read first

- [SPEC-03](../specs/03-lane-routing.md), requirements 14-16, the "Window tiling" scenarios, and Decisions.
- [OBJ-08](OBJ-08-locks-busy-windows-cap.md) completion notes (which windows a task holds).

## Tasks

- [ ] **OBJ-20.1** Harness: when a task is about to use more than one window at once, emit a `tilingSuggested` event listing the windows.
- [ ] **OBJ-20.2** Mac: unless demo mode is on, ask "Want me to arrange your windows so you can watch all of us work?" by voice and in a panel with "Arrange windows" and "Leave them" buttons.
- [ ] **OBJ-20.3** Mac: before moving anything, save each window's original position, size, and display.
- [ ] **OBJ-20.4** Mac: tile with the Accessibility API (window position and size), in a grid on the display where the task started, so every task window is fully visible.
- [ ] **OBJ-20.5** Mac: on "Leave them", move nothing. Ghosts keep working in covered windows.
- [ ] **OBJ-20.6** Mac: restore every moved window when the task ends or is cancelled, including after a harness restart (keep the saved layout in the task store).
- [ ] **OBJ-20.7** Demo mode setting (from [OBJ-14](OBJ-14-mac-app-shell.md)), off by default: tile without asking.
- [ ] **OBJ-20.8** Check the layout looks clean with 2, 3, and 4 windows, on a laptop display and an external display, and fix gaps or overlaps.

## Expectations

- [ ] SPEC-03 scenarios pass: "Yumi asks before tiling", "User says yes", "User says no", "Layout is restored", "Demo mode tiles without asking".
- [ ] No window is ever moved without a yes, unless demo mode is on.
- [ ] Every moved window returns to its exact original frame.

## Outcomes

- The tiling suggestion event, the consent panel, tiling and restore on the Mac, and demo mode behavior.

## Out of scope

- Unminimizing windows for ghosts: part of GUI control (SPEC-05).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
