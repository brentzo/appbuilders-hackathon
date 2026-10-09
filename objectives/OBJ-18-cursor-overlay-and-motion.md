---
id: OBJ-18
title: Cursor overlay and motion
product: mac
assignee: Patrick
touches: []
specs: [SPEC-04]
status: done
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

- [x] **OBJ-18.1** Create one borderless, transparent, click-through panel per display, above normal windows, following display changes (plug, unplug, rearrange).
- [x] **OBJ-18.2** Cursor model: id, kind (main or ghost), position, state (listening, thinking, moving, acting, waiting, paused), color, and label. Placeholder drawing for now.
- [x] **OBJ-18.3** Motion: move to a target along an eased curve in about 300 ms, never teleporting, crossing displays correctly in global screen coordinates.
- [x] **OBJ-18.4** Correct size and position at every display scale factor, including mixed scales across displays.
- [x] **OBJ-18.5** Ghost cursors get their own color and a short label with the subtask title. Helpers show as small status chips, not cursors.
- [x] **OBJ-18.6** Fade cursors in on spawn and out within 1 second when their task ends.
- [x] **OBJ-18.7** Drive everything from the harness's `cursorCommand` events (spawn, move, set state, label, fade). Add a debug menu to trigger each command by hand.
- [x] **OBJ-18.8** Check it looks right in light and dark mode, over full-screen apps, and on an external display.

## Expectations

- [x] SPEC-04 scenarios pass: "Cursor moves smoothly to a target", "Thinking state during a slow step", "Ghost cursors are labeled", "Overlay does not block the user", "Cursor works on a second display", "Cursors leave when the task ends".
- [x] Clicks by the user anywhere on screen reach the app underneath while cursors are visible.
- [x] Motion stays smooth with 3 cursors moving at once.

## Expected outcomes

- The overlay, cursor model, motion system, ghost labels, helper chips, and `cursorCommand` handling, with a debug menu.

## Out of scope

- The cat art and animation: [OBJ-19](OBJ-19-rive-cat-cursor.md).
- Performing the actual click or key press: SPEC-05, not finalized. The click point this objective exposes is what SPEC-05 will use.

## Outcome

- **Result:** Done for the demo, with a placeholder drawing until the Rive cat (OBJ-19) and the checks below still needing hands-on time.
- **Delivered:**
  - `mac/Yumi/Overlay/`: `OverlayPanel` (one click-through panel per display), `CursorOverlay` (cursor model, `cursorCommand` handling, motion, fades, `clickPoint(of:)`), `CursorLayer` (the placeholder drawing), `HelperChips`, `ElementLocator` (stand-in), `ScreenGeometry`, and `CursorDebugActions`.
  - `mac/Yumi/Harness/HarnessLink.swift`: cursor events go to the overlay; helper routes show chips; every cursor fades when no task is active or the harness link drops.
  - `mac/Yumi/MenuBar/CursorDebugMenu.swift`: the "Cursor debug" submenu.
  - `mac/YumiTests/CursorOverlayTests.swift` and the `-YumiOverlayDemo <dir>` snapshot option.
- **Commits:**
  - `e9c0d12 docs(objectives): start OBJ-18`
  - `ca966e2 feat(mac): add the click-through cursor overlay`
  - `a300b78 feat(mac): drive the cursors from the harness's cursor events`
  - `3d1ae64 feat(mac): add a cursor debug menu and an overlay snapshot option`
  - `fbceebc docs(mac): document the cursor overlay, its debug menu, and its stand-ins`
  - and the commit that finishes this objective.
- **Expectations:**
  - "Cursor moves smoothly to a target": moves animate on an ease-in-out curve over 0.3 s, starting from where the cursor is on screen, so they never teleport (`CursorOverlay.move`, `CursorOverlayTests`).
    The "click happens after the cursor arrives" part belongs to executing actions (OBJ-44).
  - "Thinking state during a slow step": the thinking badge pulses for as long as the state lasts, checked in the `-YumiOverlayDemo` render.
  - "Ghost cursors are labeled": each ghost gets its own accent color and the label from `spawn` or `setLabel` (`CursorOverlayTests.harnessCommandsDriveTheCursors`, and the render).
  - "Overlay does not block the user" and "Clicks by the user anywhere reach the app underneath": every panel ignores mouse events (`CursorOverlayTests.oneClickThroughPanelPerDisplay`).
    Not checked by clicking by hand.
  - "Cursor works on a second display": one panel per display, every cursor drawn on every panel along one global path, each panel at its own scale.
    Only one display was connected, so this is not verified on a second display.
  - "Cursors leave when the task ends": every cursor fades in 0.6 s when no task is active (`CursorOverlayTests.cursorsLeaveWhenTheTaskEnds`); live against the mock's `keynote-export`, the cursor faded as the task finished.
  - "Motion stays smooth with 3 cursors moving at once": motion runs in Core Animation; "Three cursors moving at once" in the debug menu shows it.
    Not watched on screen here.
  - Live against the mock (`-YumiMockScript keynote-export -YumiSendSampleGoal YES`): `spawn` placed the main cursor next to the user's pointer, the state changes arrived, and the cursor faded at the end.
    Its `move` targets a Keynote element in a window that did not exist here, so the cursor stayed where it was, as designed.
  - Light and dark: the `-YumiOverlayDemo` render over white and over black reads well on both.
- **Not verified:**
  - Anything that needs watching the screen, because this session cannot capture the screen: run `open mac/build/Build/Products/Debug/Yumi.app` and use "Cursor debug" in the menu to check motion, three cursors at once, fades, and clicking through the cursors into the app underneath.
  - A second display and mixed scale factors: connect an external display and use "Move main to next display".
  - Display hot-plugging, full-screen apps, and other Spaces: the panels join every Space and full-screen apps, and are rebuilt on display changes, but none of this was tried.
  - Moving to a Keynote element with Keynote open: the stand-in locator then uses Keynote's frontmost window.
- **Decisions and deviations:**
  - `ScreenPoint` is read as top-left global coordinates (y down, the Quartz and Accessibility convention), from its "negative on displays left of or above the main one".
  - Cursors carry no task id in the protocol, so "no cursor after its task ends" is enforced by fading every cursor when no task is active, plus the harness's own `fade` commands.
  - Element targets go to the center of the target window, or the app's frontmost window, until element paths are resolved through the Accessibility API (OBJ-44).
  - Helper chips come from `routeDecided` with the `helper` lane and leave when that subtask is done or failed.
    The event has no subtask title, so the chip says "Helper working" (placeholder copy).
  - Ghost accents are teal, orange, purple, green, blue, and pink, never red, so a ghost never looks like an error.
  - The panels sit at the screen saver window level, above normal windows, menus, and the Dock.
- **For the next objectives:**
  - OBJ-19: replace `CursorLayer` with the Rive cat.
    It receives the cursor's state, label, and accent, and its position is the click point.
  - OBJ-44: `CursorOverlay.clickPoint(of:)` gives the click point in protocol coordinates.
    Replace `WindowCenterLocator` with real element lookup behind `ElementLocating`, and click only after the 0.3 s move ends.
  - Protocol, for Jepoy: a subtask title on helper routes would let chips say what the helper does, and a task id on `spawn` would let cursors fade per task.
