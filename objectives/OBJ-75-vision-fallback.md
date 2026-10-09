---
id: OBJ-75
title: Vision fallback for apps without accessibility content
product: mac
assignee: Patrick
touches: [harness, protocol]
specs: [SPEC-05]
status: todo
priority: p0
depends-on: []
integrates-with: [OBJ-36, OBJ-39]
tags: [objective, p0, mac, harness, gui]
---

# OBJ-75 Vision fallback for apps without accessibility content

**Product:** [Yumi Mac app](../mac/README.md) · **Specs:** [SPEC-05](../specs/05-mac-gui-control.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Some apps draw their own interface, so their windows expose no usable accessibility content: Spotify's window gives Yumi only the close, minimize, and zoom buttons and its menu bar.
The worker model then has nothing to click and wanders the menus, and every Spotify goal fails.
SPEC-05 requirement 1.3 and the p1 "Vision fallback" scenarios already say what to do: send the model a screenshot of the window, let it answer with coordinates, and click there.
This objective builds that path, and it is p0 because Brent wants to open the hackathon demo with "Hey Yumi, open my Spotify and play <playlist>".
It also fixes a probe bug found while diagnosing the failures: the capability probe counts a window's own close, minimize, and zoom buttons as actionable content, so such apps are misclassified as background-capable and routed to a ghost that cannot use a vision click.

## Read first

- [SPEC-05](../specs/05-mac-gui-control.md) requirements 1.3, 2, 12, 13, 14, and 15, and the p1 "Vision fallback" scenarios.
- `mac/Yumi/GUI/WindowReader.swift`, `TreeTrimmer.swift`, `GuiExecutor.swift`, and `mac/Yumi/Native/AppCapabilityProbe.swift`.
- `mac/Yumi/Cursor/ScreenGeometry.swift` for the coordinate systems.
- `harness/src/gui/gui-act.ts`, `harness/src/gui/mac.ts`, `harness/src/worker/prompt.ts`, `harness/src/worker/schema.ts`, `harness/src/router/capability.ts`, and `harness/src/router/lanes.ts`.
- [protocol/schemas/observation.json](../protocol/schemas/observation.json) and [action.json](../protocol/schemas/action.json).
- The Outcomes of OBJ-36 (the gui_act sub-agent) and OBJ-39 (Mac GUI execution), which deferred this work.

## Tasks

- [ ] **OBJ-75.1** Fix the probe: window chrome (subroles `AXCloseButton`, `AXMinimizeButton`, `AXZoomButton`, `AXFullScreenButton`) and menu bar items are not actionable content, so an app whose window content has no actionable role is not background-capable and is routed to the `main` lane instead of a ghost.
- [ ] **OBJ-75.2** In `WindowReader`, note when a window's content has no actionable element (only chrome and the menu bar) and capture that window with ScreenCaptureKit, writing a PNG under the app's support folder and setting `Observation.screenshotPath`. If Screen Recording permission is missing, report the `screenPermissionMissing` error.
- [ ] **OBJ-75.3** Add an optional `windowFrame` (global top-left points) to `Observation` as a non-breaking protocol change, with an example and a validation test, so the harness can check that the window has not moved before a vision click.
- [ ] **OBJ-75.4** Execute `clickAt` in the Mac app: convert the model's image pixels to global screen points from the captured image size and window frame (Retina scale and displays with a negative origin included), activate the app, move the real mouse, and click. Refuse when the window moved or resized since the screenshot.
- [ ] **OBJ-75.5** In `gui_act`, offer `clickAt` to the model only when the observation carries a screenshot, describe the attached image in the prompt, and before running a `clickAt` read the window again: if it moved, resized, or lost focus, skip the click and ask the model again from the fresh screen.
- [ ] **OBJ-75.6** Tests: the Mac coordinate conversion (serialized against the `frame` plus a Retina scale and a display left of the main one), the probe fix, and the reachability check; the harness prompt showing `clickAt` only with a screenshot, and a moved-window `clickAt` being skipped and re-captured.
- [ ] **OBJ-75.7** Live check with Brent: build the app, clear the cached `com.spotify.client` capability, and say "open my Spotify and play <playlist>" and confirm the cat plays it from the screenshot.

## Expectations

- [ ] SPEC-05 scenarios pass: "Vision fallback for an app without accessibility", "Retina scaling is handled", "Second display to the left", "Window moved before the click".
- [ ] Spotify's window is captured and its `clickAt` clicks land on the element the model pointed at.
- [ ] An app with real accessibility content is still driven by `click` with no screenshot (SPEC-05 "Accessibility is used before vision").

## Expected outcomes

- A captured-window path and a `clickAt` executor in `mac/Yumi/GUI/`, the probe fix in `mac/Yumi/Native/AppCapabilityProbe.swift`, `Observation.windowFrame` in `protocol/schemas/observation.json`, the `clickAt` handling and moved-window check in `harness/src/gui/`, and tests on both sides.

## Out of scope

- The p1 GUI model bake-off (SPEC-05 requirement 14).
- Screenshot retention and deletion; keeping them is a demo-phase decision ([OBJ-38](OBJ-38-approvals-pause-and-action-log.md)).
- Revealing the play control in other apps: this covers any app whose content the accessibility tree does not expose.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
