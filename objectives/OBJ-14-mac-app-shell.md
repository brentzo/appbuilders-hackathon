---
id: OBJ-14
title: Mac app shell, permissions, and harness link
product: mac
assignee: Patrick
touches: [harness]
specs: [SPEC-01, SPEC-04]
status: in-progress
priority: p0
depends-on: [OBJ-01]
integrates-with: [OBJ-03]
tags: [objective, p0, mac]
---

# OBJ-14 Mac app shell, permissions, and harness link

**Product:** [Yumi for Mac](../mac/README.md) · **Also touches:** [harness](../harness/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md), [SPEC-04](../specs/04-cursor-presence.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

This creates the Mac app every other Mac objective builds on: a menu bar app that gets the permissions Yumi needs, starts and watches the harness, and talks to it over the local socket.
Permission onboarding is the first thing users see, so it must be clear and friendly.

## Read first

- [mac/README.md](../mac/README.md) and [harness/README.md](../harness/README.md).
- [SPEC-11](../specs/11-user-facing-errors.md), "Screen permission missing (Mac)", "Accessibility permission missing (Mac)", "Microphone permission missing", and "Unexpected".
- [OBJ-01](OBJ-01-task-record-schemas.md): the RPC contracts and the mock harness. Build against the mock; [OBJ-03](OBJ-03-harness-skeleton.md) (Brent) provides the real harness later.

## Tasks

- [x] **OBJ-14.1** Create the Xcode project in `mac/`: a Swift, SwiftUI and AppKit menu bar app, minimum macOS 15, using the generated Swift types from `protocol/`. Set up signing as in "Signing" in `mac/README.md`: Apple Development certificate, App Sandbox off, Hardened Runtime with Audio Input, and a committed `Signing.xcconfig` that includes a gitignored `Signing.local.xcconfig` per person.
- [x] **OBJ-14.2** Menu bar item with Yumi's icon, a status line (ready, listening, working, paused), and menu entries for settings and quitting.
- [x] **OBJ-14.3** Permission onboarding for Microphone, Accessibility, and Screen Recording: explain in one plain sentence why each is needed, then show an "Open settings" button that opens the right System Settings pane. Detect when each is granted without restarting the app where macOS allows it.
- [ ] **OBJ-14.4** Start the harness process (the mock harness from OBJ-01 until OBJ-03 is done) and the local model server (or check it is running), restart the harness if it exits, and show a friendly state if the model is still loading.
- [x] **OBJ-14.5** Connect to the harness's JSON-RPC socket, with reconnect. Subscribe to its event stream.
- [x] **OBJ-14.6** Map structured error kinds from the harness to the SPEC-11 copy and buttons in one place (an error presenter). Unknown kinds use the "Unexpected" copy.
- [x] **OBJ-14.7** Settings window: wake word on or off, push-to-talk shortcut, demo mode, and the visible cursor cap. Store them and send relevant ones to the harness.
- [ ] **OBJ-14.8** When [OBJ-03](OBJ-03-harness-skeleton.md) is done, switch from the mock harness to the real one and re-check the expectations.
- [x] **OBJ-14.9** Check light mode, dark mode, and every display scale for the menu, onboarding, and settings, and fix anything that looks off.

## Expectations

- [ ] SPEC-11 scenario "Missing screen permission" passes: the copy appears and "Open settings" opens the Screen Recording pane.
- [ ] Killing the harness process shows a friendly state and it restarts on its own.
- [ ] The app calls the harness `ping` and receives events.
- [ ] No raw error text from the harness or macOS reaches the user.

## Expected outcomes

- The `mac/` Xcode project with menu bar, onboarding, settings, harness supervision, RPC client, and the error presenter.
- Build and run instructions in `mac/README.md`.

## Out of scope

- Voice: [OBJ-15](OBJ-15-mac-voice-intake.md). Overlay and cursors: [OBJ-18](OBJ-18-cursor-overlay-and-motion.md).
- Executing GUI actions: SPEC-05, not finalized.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
