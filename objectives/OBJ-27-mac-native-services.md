---
id: OBJ-27
title: Mac native services for the harness
product: mac
assignee: Patrick
touches: []
specs: [SPEC-03, SPEC-08]
status: in-progress
priority: p0
depends-on: [OBJ-14]
integrates-with: [OBJ-03, OBJ-07, OBJ-08, OBJ-21]
tags: [objective, p0, mac, gui, bridge]
---

# OBJ-27 Mac native services for the harness

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-03](../specs/03-lane-routing.md), [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The harness (Brent) and the bridge client (Jepoy) need a few things only native macOS code can do: probe what an app supports, open and arrange windows, keep secrets in the Keychain, and show the pairing and connection screens.
Putting all of them in one Mac objective keeps Swift work with the Mac app's owner, so nobody writes code in someone else's app.
Each service follows a contract from [OBJ-01](OBJ-01-task-record-schemas.md), so Brent and Jepoy build against the mock Mac app while this is in progress.

## Read first

- [OBJ-01](OBJ-01-task-record-schemas.md): the window service, secret, pairing, and event contracts.
- [SPEC-03](../specs/03-lane-routing.md) (lanes, busy windows) and [SPEC-08](../specs/08-device-bridge.md) (pairing, connection state).
- [docs/lane-router.md](../docs/lane-router.md), "Checks".
- [SPEC-11](../specs/11-user-facing-errors.md), "Bridge down" and "Unpaired device".
- [OBJ-14](OBJ-14-mac-app-shell.md) Outcome.

## Tasks

- [ ] **OBJ-27.1** `probeAppCapability(bundleId)`: report whether the app exposes an actionable accessibility tree, and whether it is a Chromium browser with DevTools control available. Include the app version so the harness can cache the result.
- [ ] **OBJ-27.2** `openNewWindow(bundleId)`: open a new window when the app supports it (new Chrome window, new Finder window, new Mail draft) and return its window id, or return "unsupported". Start with Chrome, Finder, and Mail, and keep the per-app strategies in one place.
- [ ] **OBJ-27.3** `listWindows`, `getWindowFrame`, and `setWindowFrame` through the Accessibility API, in global screen coordinates, correct across displays and scale factors.
- [ ] **OBJ-27.4** `storeSecret` and `loadSecret` backed by the macOS Keychain, scoped to Yumi. Secrets never touch files or logs.
- [ ] **OBJ-27.5** Pairing screen: call `startPairing`, show the QR code, then "Paired with <device name>" when done. Add "Unpair" in settings.
- [ ] **OBJ-27.6** Show the bridge connection state (connected, reconnecting, offline) in the menu bar from `bridgeStateChanged`, and the SPEC-11 "Bridge down" and "Unpaired device" copy from `userError` events.
- [ ] **OBJ-27.7** Test each method with the mock harness and by hand against Chrome, Finder, Mail, Keynote, and one app without accessibility support.
- [ ] **OBJ-27.8** When [OBJ-03](OBJ-03-harness-skeleton.md) is done, switch the Mac app from the mock harness to the real one (a launcher next to `MockHarnessLauncher` in `mac/Yumi/Harness/HarnessLauncher.swift`), and re-check the [OBJ-14](OBJ-14-mac-app-shell.md) expectations against it. Moved here from OBJ-14 so OBJ-14 could finish before the real harness exists.

## Expectations

- [ ] Every method matches its OBJ-01 contract and validates against the schema.
- [ ] `probeAppCapability` reports Chrome as DevTools-capable and an app without accessibility support as not background-capable.
- [ ] `openNewWindow` works for Chrome, Finder, and Mail, and returns "unsupported" for other apps instead of failing.
- [ ] Setting a window's frame and reading it back returns the same frame, on a laptop display and an external display.
- [ ] Secrets are only in the Keychain.
- [ ] The pairing screen and connection state look right in light and dark mode.

## Expected outcomes

- Window services, Keychain secrets, the pairing screen, and connection state in the Mac app, all behind the OBJ-01 contracts.

## Out of scope

- Deciding lanes or locks: [OBJ-07](OBJ-07-lane-router-core.md) and [OBJ-08](OBJ-08-locks-busy-windows-cap.md) (Brent).
- Pairing logic, crypto, and the bridge connection: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Jepoy).
- Tiling decisions and the consent panel: [OBJ-20](OBJ-20-window-tiling.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
