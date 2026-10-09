---
id: OBJ-53
title: Expand a cursor to see what it is thinking
product: mac
assignee: Brent
touches: []
specs: [SPEC-07]
status: todo
priority: p0
depends-on: [OBJ-52]
integrates-with: []
tags: [objective, p0, mac, debug, ux]
---

# OBJ-53 Expand a cursor to see what it is thinking

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-07 requirement 23 lets the user, in Debug mode, expand any cursor or helper chip to see what it is doing and why.
It makes the multi-cursor demo explainable and lets Brent see a stuck worker's reasoning without opening log files.
It reads the reasoning data that [OBJ-52](OBJ-52-harness-debug-logs.md) adds.

## Read first

- SPEC-07 requirements 22 and 23, and SPEC-04 requirements 3 to 6.
- [OBJ-52](OBJ-52-harness-debug-logs.md) and the protocol fields it adds.
- `mac/Yumi/Overlay/CursorBubble.swift`, `mac/Yumi/Overlay/HelperChips.swift`, and `mac/Yumi/Overlay/CursorOverlay.swift`.
- `mac/Yumi/MenuBar/CursorDebugMenu.swift` for the existing debug options.

## Tasks

- [ ] **OBJ-53.1** Add the Debug mode toggle to the Mac Settings window and send it to the harness, matching OBJ-52.
- [ ] **OBJ-53.2** In Debug mode, clicking a cursor's bubble or a helper chip expands a small panel with the subtask title, the lane, what it sees (short), its last action, and the model's last decision and reason.
- [ ] **OBJ-53.3** Update the panel live as steps happen, and collapse it on click or when the subtask ends.
- [ ] **OBJ-53.4** Keep the overlay click-through everywhere except the expandable bubble and chip (SPEC-04 requirement 7).
- [ ] **OBJ-53.5** Make the panel look right in light and dark mode and at every scale, with the Yumi design tokens.
- [ ] **OBJ-53.6** Tests for the view model, and a live check with a real goal.

## Expectations

- [ ] In Debug mode, Brent can expand the main cat and a ghost during a real task and read why each did its last action.
- [ ] With Debug mode off, nothing is expandable and the overlay behaves as before.

## Expected outcomes

- The expandable thoughts panel for cursors and helper chips, with tests.

## Out of scope

- Writing the logs and the reasoning data: [OBJ-52](OBJ-52-harness-debug-logs.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
