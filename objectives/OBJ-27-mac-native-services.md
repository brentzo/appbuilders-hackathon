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

- [x] **OBJ-27.1** `probeAppCapability(bundleId)`: report whether the app exposes an actionable accessibility tree, and whether it is a Chromium browser with DevTools control available. Include the app version so the harness can cache the result.
- [x] **OBJ-27.2** `openNewWindow(bundleId)`: open a new window when the app supports it (new Chrome window, new Finder window, new Mail draft) and return its window id, or return "unsupported". Start with Chrome, Finder, and Mail, and keep the per-app strategies in one place.
- [x] **OBJ-27.3** `listWindows`, `getWindowFrame`, and `setWindowFrame` through the Accessibility API, in global screen coordinates, correct across displays and scale factors.
- [x] **OBJ-27.4** `storeSecret` and `loadSecret` backed by the macOS Keychain, scoped to Yumi. Secrets never touch files or logs.
- [x] **OBJ-27.5** Pairing screen: call `startPairing`, show the QR code, then "Paired with <device name>" when done. Add "Unpair" in settings.
- [x] **OBJ-27.6** Show the bridge connection state (connected, reconnecting, offline) in the menu bar from `bridgeStateChanged`, and the SPEC-11 "Bridge down" and "Unpaired device" copy from `userError` events.
- [ ] **OBJ-27.7** Test each method with the mock harness and by hand against Chrome, Finder, Mail, Keynote, and one app without accessibility support.
- [x] **OBJ-27.8** When [OBJ-03](OBJ-03-harness-skeleton.md) is done, switch the Mac app from the mock harness to the real one (a launcher next to `MockHarnessLauncher` in `mac/Yumi/Harness/HarnessLauncher.swift`), and re-check the [OBJ-14](OBJ-14-mac-app-shell.md) expectations against it. Moved here from OBJ-14 so OBJ-14 could finish before the real harness exists.

## Expectations

- [x] Every method matches its OBJ-01 contract and validates against the schema.
- [x] `probeAppCapability` reports Chrome as DevTools-capable and an app without accessibility support as not background-capable.
- [ ] `openNewWindow` works for Chrome, Finder, and Mail, and returns "unsupported" for other apps instead of failing.
- [ ] Setting a window's frame and reading it back returns the same frame, on a laptop display and an external display.
- [x] Secrets are only in the Keychain.
- [ ] The pairing screen and connection state look right in light and dark mode.

## Expected outcomes

- Window services, Keychain secrets, the pairing screen, and connection state in the Mac app, all behind the OBJ-01 contracts.

## Out of scope

- Deciding lanes or locks: [OBJ-07](OBJ-07-lane-router-core.md) and [OBJ-08](OBJ-08-locks-busy-windows-cap.md) (Brent).
- Pairing logic, crypto, and the bridge connection: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Jepoy).
- Tiling decisions and the consent panel: [OBJ-20](OBJ-20-window-tiling.md).

## Outcome

- **Result:** In progress: everything is built and works for the demo, but OBJ-27.7 and three expectations need things this Mac does not have (Keynote, a Mail account, an external display). Set it done once those are checked or the lead accepts them as not verified.
- **Delivered:**
  - `mac/Yumi/Native/`: `WindowService` (list windows, get and set a frame), `AppCapabilityProbe` (with `AppLauncher`), `NewWindowOpener` (the per-app strategies in one table), `SecretStore` (Keychain), and `AppMethodServer`, which serves those seven app methods to the harness.
  - `mac/Yumi/Harness/HarnessClient.swift`: harness-to-app requests go to `AppMethodServer`. Replies are a result, -32601 for methods no objective serves yet, -32602 for params that break the contract, or -32000 with a SPEC-11 `UserError`.
  - `mac/Yumi/Pairing/`: `PhoneLink` (connection state, paired phone, pairing code), `PhoneCalls` (the harness calls), `PairingView` with `PairingWindow` (QR code, countdown, "Paired with <name>"), and `PhoneViews` (the menu bar status line and "Pair your phone…", plus the Phone section in settings with Unpair).
  - "Pair now" on the SPEC-11 Unpaired device error opens the pairing window. Bridge down and Unpaired device already showed through the OBJ-14 error window.
  - `mac/Yumi/Harness/RealHarnessLauncher.swift`: the real harness is the default. `-YumiMockHarness YES` or any mock option picks the mock.
  - Debug options `-YumiOpen pairing` and `-YumiOpen pairing-code` for snapshots.
  - Tests in `mac/YumiTests/AppMethodServerTests.swift`.
- **Commits:**
  - `836c51b docs(objectives): start OBJ-27`
  - `ebbec28 feat(mac): serve native window, capability, and Keychain methods, and show pairing and phone state`
  - `7e6a3c0 feat(mac): start the real harness by default`
  - `6d8d0c2 feat(mac): sharpen the pairing QR code and add pairing snapshot options`
  - `3ba1520 feat(mac): open pairing from the Unpaired device error's Pair now`
- **Expectations:**
  - Contracts: a throwaway driver ran every method through `AppMethodServer.serve` and validated params and results (and `UserError` data) against the protocol schemas with the protocol package's validator. All valid. Against the real harness, its `RpcPeer` validated both sides of `storeSecret` and `loadSecret` for `bridge.device-seeds`.
  - Probe: Chrome reports `devtools: true, accessibility: true`. WezTerm, which draws its window itself, reports `accessibility: false` with a window open. An app that is not installed fails with `unsupportedRequest`.
  - New windows: Chrome and Finder return the new window's id. TextEdit returns `supported: false` (test `openNewWindowIsUnsupportedForAppsWithoutAStrategy`). Mail is not verified, see below.
  - Frames: on the laptop display, set a Finder window's frame and read back the same frame, then restored it. The external display is not verified.
  - Secrets: `SecretStore` writes only to the Keychain (service `<bundle id>.secrets`, this device only) and never logs values. Test `secretsRoundTripThroughTheKeychain` round-trips a value.
  - Light and dark mode: snapshots of the pairing window with a code, "Paired with <name>", and the Unpaired device error look right. The menu bar status line is a plain system menu item and was not snapshotted.
  - Mac tests: 54 tests in 12 suites pass.
  - Real harness (OBJ-27.8): the app starts it, `hello` and `ping` work, `bridgeStateChanged` events arrive, and after `kill -9` the supervisor restarts it and reconnects.
- **Not verified:**
  - Mail: "New Message" is disabled on this Mac because Mail has no account. On the demo Mac, with an account, call `openNewWindow` with `com.apple.mail` and check that it returns a window id and a draft opens.
  - Keynote is not installed here. Install it and call `probeAppCapability` and `listWindows` with `com.apple.iWork.Keynote`.
  - External display: with a second display attached, move a window there with `setWindowFrame` and read it back with `getWindowFrame`. The frame should be equal, and negative x or y should work on displays left of or above the main one.
  - Pairing against the real bridge and a real phone (needs OBJ-21 and the Android app): open "Pair your phone…", scan the code, check "Paired with <name>", the menu status line, and Unpair in settings.
  - A team-signed build: the ad hoc build has no Accessibility grant, so window methods were exercised through the driver from an AX-trusted shell, not from the app. With `Signing.local.xcconfig`, grant Yumi Accessibility and repeat one `listWindows` from the harness.
  - The menu bar status line in light and dark mode (system-drawn).
- **Decisions and deviations:**
  - Coordinates are Quartz global points: origin at the top left of the main display, y down. The OBJ-01 contract does not say; this matches what the Accessibility API and screenshots use.
  - Window ids are `CGWindowID`s, found through the private `_AXUIElementGetWindow`, the only way to match an AX window to the id screenshots use.
  - `devtools` means "a known Chromium browser" (Chrome, Arc, Brave, Edge, Chromium, Vivaldi, Opera). It does not check that a debugging port is open.
  - `accessibility` means actionable roles inside a window, not just the menu bar. The probe launches the app (in the background) if it is not running, sets `AXManualAccessibility` (which Chromium and Electron apps need before they build their tree), and retries for about 3 seconds.
  - `openNewWindow` presses English menu titles (File > New Window, New Finder Window, New Message). Other languages return `supported: false`.
  - Copy I wrote that is not in SPEC-08 or SPEC-11, for Patrick to review: "Pair your phone…", "Pair your phone" (window title), "Scan this code with Yumi on your phone", "The code works for m:ss.", "This code expired.", "New code", "Getting a pairing code…", "Paired with <name>", "Not paired", "<name>: connected", "<name>: reconnecting…", "<name>: offline", "Unpair", and the settings section title "Phone".
  - The real harness connects to the live bridge (`wss://yumibridge.studiokova.co`) unless `YUMI_BRIDGE_URL` says otherwise.
- **For the next objectives:**
  - New app methods go in `AppMethodServer.serve`. Everything it does not handle answers -32601, so OBJ-34 (`executeAction`, `observeWindow`) and the approval cards plug in there.
  - Map native failures to SPEC-11 kinds in `AppMethodServer.reply(for:method:)`. Accessibility missing becomes `accessibilityPermissionMissing`.
  - Per-app new-window strategies are the `NewWindowOpener.strategies` table.
  - `PhoneLink.shared` holds the phone state for any view. Files that import `YumiProtocol` whole cannot be `@Observable`, so protocol calls live in `PhoneCalls`.
