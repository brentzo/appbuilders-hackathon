---
id: OBJ-34
title: Mac GUI execution
product: mac
assignee: Patrick
touches: []
specs: [SPEC-05, SPEC-11]
status: todo
priority: p0
depends-on: [OBJ-14, OBJ-18]
integrates-with: [OBJ-26, OBJ-31]
tags: [objective, p0, mac, gui]
---

# OBJ-34 Mac GUI execution

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-05](../specs/05-mac-gui-control.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The harness decides what to do, but only the Mac app can touch other apps.
This objective builds the Mac side of every GUI action: a trimmed, numbered accessibility tree, `AXPress` and `AXValue` on those elements, tagged keystrokes for the main cursor, and the typed direct tools that open apps, files, URLs, and Finder folders.
It turns a `ModelAction` from the harness's `gui_act` sub-agent ([OBJ-31](OBJ-31-gui-act-sub-agent.md)) into a real effect in Keynote, Mail, and Notes, while the cat shows where Yumi works and the user's own mouse stays put.
Until OBJ-31 exists, build and test against the mock harness from [OBJ-01](OBJ-01-task-record-schemas.md).

## Read first

- [SPEC-05](../specs/05-mac-gui-control.md), requirements 1-3, 6, 7, and 11, the "Demo tasks", and the "Mac GUI control" scenarios.
- [SPEC-03](../specs/03-lane-routing.md) requirement 7: only `main` sends keystrokes.
- [SPEC-06](../specs/06-user-control.md) requirements 3 and 4: Yumi tags its own input, and types in short chunks so a pause lands between chunks. The pause itself is [OBJ-30](OBJ-30-mac-stop-and-take-over.md).
- [SPEC-11](../specs/11-user-facing-errors.md), the "Accessibility permission missing (Mac)" row.
- [docs/task-record-schema.md](../docs/task-record-schema.md), "What the model sees", "Actions", and "Typed tools".
- [OBJ-01](OBJ-01-task-record-schemas.md): `Observation`, `TreeElement`, `ModelAction`, `ResolvedElement`, the typed tool schemas, and the RPC methods `observeWindow`, `executeAction` (which carries the `cursorId` to animate first; OBJ-01 folded `animateCursorTo` into it), and `readFieldValues`. Implement those; never hand-write a contract type (see the contracts-and-stand-ins skill).
- [OBJ-26](OBJ-26-gui-smoke-test.md) Outcome and its throwaway trimming script in `models/gui/`, if done.
- The Outcome of [OBJ-14](OBJ-14-mac-app-shell.md) (RPC client, error presenter), [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) (click point), and [OBJ-27](OBJ-27-mac-native-services.md) (`probeAppCapability` and window services, which this objective reuses and does not rebuild).

## Tasks

- [ ] **OBJ-34.1** Tree reader: walk the target window's `AXUIElement` tree and keep only visible elements with an actionable role (button, menu item, text field, link, checkbox, pop-up button). Skip empty layout groups, number the kept elements, and stop at 200 (SPEC-05 r2). Keep each element's full accessibility path on the Mac side only, so a later action can resolve its number. Include an open menu's items, so "Export To" then "PDF..." in Keynote works, and record how menus are walked in the Outcome.
- [ ] **OBJ-34.2** `observeWindow`: return an `Observation` with the window title and the trimmed elements. An `AXSecureTextField` appears with no `value`, ever (SPEC-05 r7). Never read its contents, not even into a log.
- [ ] **OBJ-34.3** `executeAction` for element actions, resolving the number from the last observation of that window: `axPress` performs `AXPress`, `setValue` sets `AXValue`, and `scroll` scrolls through the accessibility API. Refuse `setValue` on a secure text field with a structured error kind. Return the `ResolvedElement` (path, role, label) so the harness can check its risk and log it.
- [ ] **OBJ-34.4** Before every element action, animate the cursor to the element's center and act only after it arrives. The real mouse pointer never moves for accessibility actions (SPEC-05 r3).
- [ ] **OBJ-34.5** Keystrokes for the `main` lane only: `type` sends text with `CGEvent` in short chunks, and `key` sends one combo. Reject both for any other lane. Tag every event Yumi sends (for example with `kCGEventSourceUserData`), and check a cancel flag between chunks so typing stops before the next chunk. [OBJ-30](OBJ-30-mac-stop-and-take-over.md) sets the flag.
- [ ] **OBJ-34.6** Typed direct tools: `open_app` (bundle id), `open_file`, `open_url`, and `reveal_in_finder`, with `NSWorkspace`. Each takes only its schema arguments. There is no shell, AppleScript, or `Process` call anywhere in this code.
- [ ] **OBJ-34.7** `readFieldValues`: read the current To and Cc values of a Mail draft through the accessibility API. The harness builds the send approval from these, never from model text (SPEC-07 r13).
- [ ] **OBJ-34.8** Missing Accessibility permission: every method that needs it returns a structured error kind, and the app shows the SPEC-11 "Accessibility permission missing (Mac)" copy through the [OBJ-14](OBJ-14-mac-app-shell.md) error presenter, with "Open settings" opening the Accessibility pane.
- [ ] **OBJ-34.9** A debug window that shows the trimmed tree of the frontmost window with its numbers and presses an element by number. Use it to check Keynote, Mail, and Notes by hand.
- [ ] **OBJ-34.10** Tests: trimming against a recorded tree fixture with more than 1,500 elements, secure field handling, the lane check for keystrokes, event tagging, and typing stopping on the cancel flag. Run every method against the mock harness, then against the real harness when [OBJ-31](OBJ-31-gui-act-sub-agent.md) is done.

## Expectations

- [ ] SPEC-05 scenario "The model sees a trimmed tree" passes on a real Keynote window, at the Mac level.
- [ ] SPEC-05 scenario "Accessibility is used before vision" passes at the Mac level: the menu items are pressed through the accessibility API, the cursor animation moves to each item, the real mouse does not move, and no screenshot is taken.
- [ ] SPEC-05 scenario "Direct tool is used when available" passes at the Mac level: `reveal_in_finder` opens the Downloads folder and no element is pressed.
- [ ] SPEC-05 scenario "Accessibility permission is missing" passes: the user sees "I need permission to control your Mac before I can help with this." and "Open settings" opens the Accessibility pane.
- [ ] A secure text field never has a `value` in any observation, log line, or RPC payload, and `setValue` on it is refused.
- [ ] Every event Yumi sends carries the tag, and `type` or `key` from a ghost lane is rejected.
- [ ] Every method matches its OBJ-01 contract and validates against the schema.

## Expected outcomes

- The tree reader, `observeWindow`, `executeAction`, `readFieldValues`, and the direct tools in the Mac app.
- Tagged, chunked keystroke sending with a cancel flag for OBJ-30.
- A debug window for the trimmed tree.

## Out of scope

- The step loop, the 10-step limit, the no-effect check, and the structured result: [OBJ-31](OBJ-31-gui-act-sub-agent.md) (Brent).
- Permission levels and file tools: [OBJ-32](OBJ-32-permission-gate-and-file-tools.md) (Brent). `moveToTrash` and the approval card: [OBJ-35](OBJ-35-mac-approval-cards.md).
- `probeAppCapability`, `openNewWindow`, and window frames: [OBJ-27](OBJ-27-mac-native-services.md).
- Watching the user's input and pausing: [OBJ-30](OBJ-30-mac-stop-and-take-over.md).
- Vision fallback, screenshots for the model, coordinate conversion, and the moved-window check (SPEC-05 r12 and r13, p1). Until then the `click` action is rejected.
- Chromium DevTools control for ghosts: not specified yet.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
