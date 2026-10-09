---
id: OBJ-27
title: Mac native services for the harness
product: mac
assignee: Patrick
touches: []
specs: [SPEC-03, SPEC-08]
status: done
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
- [x] **OBJ-27.7** Test each method with the mock harness and by hand against Chrome, Finder, Mail, Keynote, and one app without accessibility support. Keynote and the Mail draft are not verified, accepted by the lead: see Not verified in the Outcome.
- [x] **OBJ-27.8** When [OBJ-03](OBJ-03-harness-skeleton.md) is done, switch the Mac app from the mock harness to the real one (a launcher next to `MockHarnessLauncher` in `mac/Yumi/Harness/HarnessLauncher.swift`), and re-check the [OBJ-14](OBJ-14-mac-app-shell.md) expectations against it. Moved here from OBJ-14 so OBJ-14 could finish before the real harness exists.

## Expectations

- [x] Every method matches its OBJ-01 contract and validates against the schema.
- [x] `probeAppCapability` reports Chrome as DevTools-capable and an app without accessibility support as not background-capable.
- [x] `openNewWindow` works for Chrome, Finder, and Mail, and returns "unsupported" for other apps instead of failing. Mail is not verified (no Mail account here), accepted by the lead: see Not verified in the Outcome.
- [x] Setting a window's frame and reading it back returns the same frame, on a laptop display and an external display. The external display is not verified, accepted by the lead: see Not verified in the Outcome.
- [x] Secrets are only in the Keychain.
- [x] The pairing screen and connection state look right in light and dark mode. The menu bar status line is not verified, accepted by the lead: see Not verified in the Outcome.

## Expected outcomes

- Window services, Keychain secrets, the pairing screen, and connection state in the Mac app, all behind the OBJ-01 contracts.

## Out of scope

- Deciding lanes or locks: [OBJ-07](OBJ-07-lane-router-core.md) and [OBJ-08](OBJ-08-locks-busy-windows-cap.md) (Brent).
- Pairing logic, crypto, and the bridge connection: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Jepoy).
- Tiling decisions and the consent panel: [OBJ-20](OBJ-20-window-tiling.md).

## Outcome

- **Result:** Done for the demo. The lead (Brent) accepted the items under Not verified: OBJ-27.7 ran against the mock-style driver, Chrome, Finder, Mail, and WezTerm (no accessibility), but not Keynote. Three expectations are checked with a note because their remaining parts need a Mail account, an external display, or the menu checked by eye.
- **Delivered:**
  - `mac/Yumi/Native/`: `WindowService` (list windows, get and set a frame), `AppCapabilityProbe` (with `AppLauncher`), `NewWindowOpener` (the per-app strategies in one table), `SecretStore` (Keychain), and `AppMethodServer`, which serves those seven app methods to the harness.
  - `mac/Yumi/Harness/HarnessClient.swift`: harness-to-app requests go to `AppMethodServer`. Replies are a result, -32601 for methods no objective serves yet, -32602 for params that break the contract, or -32000 with a SPEC-11 `UserError`.
  - `mac/Yumi/Pairing/`: `PhoneLink` (connection state, paired phone, pairing code), `PhoneCalls` (the harness calls), `PairingView` with `PairingWindow` (QR code, countdown, "Paired with <name>"), and `PhoneViews` (the menu bar status line and "Pair your phone…", plus the Phone section in settings with Unpair).
  - "Pair now" on the SPEC-11 Unpaired device error opens the pairing window. Bridge down and Unpaired device already showed through the OBJ-14 error window.
  - `mac/Yumi/Harness/RealHarnessLauncher.swift`: the real harness is the default. `-YumiMockHarness YES` or any mock option picks the mock.
  - Debug options `-YumiOpen pairing` and `-YumiOpen pairing-code` for snapshots.
  - Tests in `mac/YumiTests/AppMethodServerTests.swift`.
- **Commits:**
  - `c0ba726 docs(objectives): start OBJ-27`
  - `7b3a756 feat(mac): serve native window, capability, and Keychain methods, and show pairing and phone state`
  - `3d6d82d feat(mac): start the real harness by default`
  - `3227c4f feat(mac): sharpen the pairing QR code and add pairing snapshot options`
  - `4f6b5f5 feat(mac): open pairing from the Unpaired device error's Pair now`
  - `68f4ecf docs(objectives): record the OBJ-27 outcome so far`
  - `docs(objectives): finish OBJ-27` (this commit)
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
  - Steps for the demo Mac start from a team-signed build: create `mac/Signing.local.xcconfig` with the team id, build the Yumi scheme, open the app, and grant Yumi Accessibility in System Settings > Privacy & Security > Accessibility. Then start the real harness with Yumi (the default) and send the calls below from the harness, or from any JSON-RPC client on `~/Library/Application Support/Yumi/harness.sock`.
  - Window methods from the signed app: the ad hoc build here has no Accessibility grant, so window methods ran through a driver from an AX-trusted shell. Open a Finder window and call `listWindows` with `{"bundleId": "com.apple.finder"}`. Expect the Finder window with its frame, not an `accessibilityPermissionMissing` error.
  - Mail draft: "New Message" is disabled on this Mac because Mail has no account. Add a mail account in Mail, then call `openNewWindow` with `{"bundleId": "com.apple.mail"}`. Expect `supported: true` with a window id, and a new draft on screen.
  - Keynote is not installed here. Install it from the App Store, open a presentation, and call `probeAppCapability` with `{"bundleId": "com.apple.iWork.Keynote"}`. Expect `accessibility: true`, `devtools: false`, and the Keynote version. Then call `listWindows` with the same bundle id and expect the presentation window.
  - External display: attach a second display. Call `listWindows`, pick a window id, and call `setWindowFrame` with a frame on the second display (for a display left of or above the main one, x or y is negative). Call `getWindowFrame` and expect the same frame. Repeat on the laptop display.
  - Pairing with a phone (needs OBJ-21 and the Android app): choose "Pair your phone…" in the menu bar menu, scan the code with Yumi on the phone, and expect "Paired with <phone name>". Then check that the menu shows "<phone name>: connected", that turning off the phone's network shows reconnecting or offline, and that Unpair in settings brings back "Not paired".
  - The menu bar status line in light and dark mode (system-drawn): open the menu in both modes and check that it reads right.
- **Decisions and deviations:**
  - Coordinates are Quartz global points: origin at the top left of the main display, y down. The OBJ-01 contract does not say; this matches what the Accessibility API and screenshots use.
  - Window ids are `CGWindowID`s, found through the private `_AXUIElementGetWindow`, the only way to match an AX window to the id screenshots use.
  - `devtools` means "a known Chromium browser" (Chrome, Arc, Brave, Edge, Chromium, Vivaldi, Opera). It does not check that a debugging port is open.
  - `accessibility` means actionable roles inside a window, not just the menu bar. The probe launches the app (in the background) if it is not running, sets `AXManualAccessibility` (which Chromium and Electron apps need before they build their tree), and retries for about 3 seconds.
  - `openNewWindow` presses English menu titles (File > New Window, New Finder Window, New Message). Other languages return `supported: false`.
  - Copy I wrote that is not in SPEC-08 or SPEC-11, for Patrick to review: "Pair your phone…", "Pair your phone" (window title), "Scan this code with Yumi on your phone", "The code works for m:ss.", "This code expired.", "New code", "Getting a pairing code…", "Paired with <name>", "Not paired", "<name>: connected", "<name>: reconnecting…", "<name>: offline", "Unpair", and the settings section title "Phone".
  - The real harness connects to the live bridge (`wss://yumibridge.studiokova.co`) unless `YUMI_BRIDGE_URL` says otherwise.
- **For the next objectives:**
  - New app methods go in `AppMethodServer.serve`. Everything it does not handle answers -32601, so OBJ-39 (`executeAction`, `observeWindow`) and the approval cards plug in there.
  - Map native failures to SPEC-11 kinds in `AppMethodServer.reply(for:method:)`. Accessibility missing becomes `accessibilityPermissionMissing`.
  - Per-app new-window strategies are the `NewWindowOpener.strategies` table.
  - `PhoneLink.shared` holds the phone state for any view. Files that import `YumiProtocol` whole cannot be `@Observable`, so protocol calls live in `PhoneCalls`.
