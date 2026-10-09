---
id: OBJ-14
title: Mac app shell, permissions, and harness link
product: mac
assignee: Patrick
touches: [harness]
specs: [SPEC-01, SPEC-04]
status: done
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
- [OBJ-01](OBJ-01-task-record-schemas.md): the RPC contracts and the mock harness. Build against the mock; [OBJ-03](OBJ-03-harness-skeleton.md) (Brent) provides the real harness later, and [OBJ-27](OBJ-27-mac-native-services.md) task OBJ-27.8 switches the app to it.

## Tasks

- [x] **OBJ-14.1** Create the Xcode project in `mac/`: a Swift, SwiftUI and AppKit menu bar app, minimum macOS 15, using the generated Swift types from `protocol/`. Set up signing as in "Signing" in `mac/README.md`: Apple Development certificate, App Sandbox off, Hardened Runtime with Audio Input, and a committed `Signing.xcconfig` that includes a gitignored `Signing.local.xcconfig` per person.
- [x] **OBJ-14.2** Menu bar item with Yumi's icon, a status line (ready, listening, working, paused), and menu entries for settings and quitting.
- [x] **OBJ-14.3** Permission onboarding for Microphone, Accessibility, and Screen Recording: explain in one plain sentence why each is needed, then show an "Open settings" button that opens the right System Settings pane. Detect when each is granted without restarting the app where macOS allows it.
- [x] **OBJ-14.4** Start the harness process (the mock harness from OBJ-01 until OBJ-03 is done), restart it if it exits, and show a friendly state until it answers. Model readiness is a stand-in that always reports "unknown": the protocol cannot report it yet, and no repo file says how the model server starts. The contract change is an open question in the Outcome.
- [x] **OBJ-14.5** Connect to the harness's JSON-RPC socket, with reconnect. Subscribe to its event stream.
- [x] **OBJ-14.6** Map structured error kinds from the harness to the SPEC-11 copy and buttons in one place (an error presenter). Unknown kinds use the "Unexpected" copy.
- [x] **OBJ-14.7** Settings window: wake word on or off, push-to-talk shortcut, demo mode, and the visible cursor cap. Store them and send relevant ones to the harness.
- [x] **OBJ-14.8** Check light mode, dark mode, and every display scale for the menu, onboarding, and settings, and fix anything that looks off.

## Expectations

- [x] SPEC-11 scenario "Missing screen permission" passes: the copy appears and "Open settings" opens the Screen Recording pane.
- [x] Killing the harness process shows a friendly state and it restarts on its own.
- [x] The app calls the harness `ping` and receives events.
- [x] No raw error text from the harness or macOS reaches the user.

## Expected outcomes

- The `mac/` Xcode project with menu bar, onboarding, settings, harness supervision, RPC client, and the error presenter.
- Build and run instructions in `mac/README.md`.

## Out of scope

- Voice: [OBJ-15](OBJ-15-mac-voice-intake.md). Overlay and cursors: [OBJ-18](OBJ-18-cursor-overlay-and-motion.md).
- Executing GUI actions: SPEC-05, not finalized.

## Outcome

- **Result:** Done, with the stand-ins and open questions below.
  The switch to the real harness moved to OBJ-27.8.
- **Delivered:**
  - `mac/Yumi.xcodeproj`: the menu bar app (no Dock icon, macOS 15 minimum), a `YumiProtocol` static library built from `protocol/generated/swift/YumiProtocol.swift` in place, and the `YumiTests` unit tests.
  - `mac/Signing.xcconfig` and `mac/Signing.local.xcconfig.example`: Apple Development with automatic signing, App Sandbox off, Hardened Runtime with Audio Input, per-person team and bundle identifier suffix.
  - `mac/Yumi/MenuBar/`, `mac/Yumi/Onboarding/`, `mac/Yumi/Permissions/`, `mac/Yumi/Settings/`: the menu with its status line, permission onboarding, and the settings window.
  - `mac/Yumi/Harness/`: the mock harness launcher and supervisor, the line-based Unix socket, the JSON-RPC client (`HarnessClient`), and event handling (`HarnessLink`).
  - `mac/Yumi/Errors/`: the error copy for every protocol `ErrorKind`, the error presenter, and the error window.
  - `mac/README.md`: build, run, test, signing, harness, and UI check instructions.
- **Commits:**
  - `cdd4fae build(mac): add the Yumi menu bar app Xcode project`
  - `79df9e3 feat(mac): add the settings window with local storage`
  - `2bed92a feat(mac): show Yumi's status at the top of the menu`
  - `9ad0e5c feat(mac): add permission onboarding for microphone, accessibility and screen recording`
  - `f8d951f docs(mac): add build, run, test and UI check instructions`
  - `08b1101 fix(mac): poll permissions only while onboarding is open`
  - `88006c9 docs(mac): mark UserErrorKind as temporary until the OBJ-01 ErrorKind exists`
  - `653aaa9 docs(mac): explain Debug vs Release signing and add the Release build command`
  - `2308b5d fix(mac): snapshot windows as the key, active window`
  - `85039c2 docs(objectives): start OBJ-14`
  - `87f7c87 build(mac): compile the generated protocol types into a YumiProtocol framework`
  - `88b2e7e fix(mac): link YumiProtocol statically so Release builds launch`
  - `5f48992 feat(mac): start and supervise the mock harness`
  - `524215f feat(mac): connect to the harness over JSON-RPC with reconnect`
  - `e81bd89 feat(mac): show harness errors through one SPEC-11 error presenter`
  - `7f92cbb fix(mac): refresh permissions when the menu opens`
  - `1698830 docs(mac): document the harness link, protocol types, and mock launch options`
  - `588f1a6 docs(objectives): tick OBJ-14.1, 14.5 and 14.6`
  - `63c4e71 fix(mac): let -YumiSendSampleGoal work in Release builds`
  - `13cd877 build(mac): sign with each person's team through Signing.xcconfig`
  - `aebfa8b fix(mac): read mock options from launch arguments only`
  - `7ed9432 fix(mac): deliver socket lines in order and ignore a replaced socket`
  - `b5bbca1 fix(mac): time-limit the node lookup and try the interactive shell`
  - `57127ff test(mac): fail the harness tests loudly when the mock cannot run`
  - `f41c417 docs(mac): name the right file in the repo root comment`
  - `304567c docs(objectives): tick OBJ-14.1 now that signing is set up`
  - `489eee4 docs(objectives): move the real-harness switch from OBJ-14 to OBJ-27`
  - `5ce1eeb docs(mac): point the mock-harness notes at OBJ-27.8`
  - `bd48044 fix(mac): make the socket current before it starts reading`
  - `da4200f fix(mac): set up socket reading on the socket's own queue`
  - `48b7220 fix(mac): stop the whole process group when the node lookup times out`
  - `d69e51e test(mac): check hello sends the generated protocol version instead of pinning it`
  - `54e7028 test(mac): stop the first mock even when the reconnect test fails early`
  - `2968f04 test(mac): keep tests out of the app's real preferences`
  - `16601f5 docs(objectives): finish OBJ-14`
  - `422b26a feat(mac): follow the new SPEC-11 permission, pairing and Unexpected copy`
  - and the commit that updates this Outcome.
- **Expectations:**
  - "Missing screen permission": verified in code and tests, not by hand.
    `ErrorPresenterTests.screenPermissionScenario` checks the exact SPEC-11 copy and that "Open settings" maps to the Screen Recording permission.
    `PermissionCenterTests.screenRecordingOpensItsPane` checks that it opens `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`.
    `UserErrorCopyTests` checks every error kind word for word against SPEC-11.
    The error window was checked by snapshot in light and dark mode at 1x and 2x.
    Not verified: that this URL opens the Screen Recording pane on macOS 26, and the scenario's trigger "a task needs a screenshot", which needs native capture (OBJ-27).
    See "Not verified".
  - "Killing the harness process shows a friendly state and it restarts on its own": verified live on the final tree in a Release build.
    After `kill -9` on the mock, it was running again 0.5 seconds later, and the status line said "Yumi is getting ready" while the link was down.
    In round 2 the full cycle back to "Yumi is ready" took 1.8 seconds.
    `HarnessClientTests.reconnectsAfterTheHarnessIsKilled` covers the reconnect.
  - "The app calls the harness `ping` and receives events": verified live against the mock while the protocol was at version 1.
    `hello` and `ping` answered, the app pinged every 5 seconds, all 12 `keynote-export` events and all 8 `windows-and-bridge` events arrived and decoded, and `HarnessClientTests` passed.
    Re-verified at protocol version 2 against the mock, once it accepted the real `PROTOCOL_VERSION`: `HarnessClientTests.helloPingAndEvents` connects, calls `hello` and `ping`, and receives all 8 `windows-and-bridge` events.
    `HelloVersionTests` checks that `hello` sends the generated `PROTOCOL_VERSION` and that a harness answering another version is refused.
  - "No raw error text from the harness or macOS reaches the user": verified by tests and live.
    `ErrorPresenterTests` and `HarnessClientTests.failedMethodCarriesAUserError` check that the mock's error message never reaches the presented copy, and that unknown kinds and unreadable errors show the "Unexpected" copy.
    Live in round 2, a forced `submitGoal` failure showed the "Stuck on screen" copy, and "Mock failure for submitGoal" appeared only in the log.
    Live on the final tree, the mock's "Protocol version 2 does not match 1" appeared only in the log, and no error window opened.
- **Not verified:**
  - Patrick's hands-on checks: the menu itself in light and dark mode; that each "Open settings" button opens the right System Settings pane on macOS 26 (run `tccutil reset All <bundle identifier>`, launch Yumi, click each button); scaled display modes and a non-Retina external display (System Settings > Displays, then reopen the onboarding and settings windows); and recording a push-to-talk shortcut by hand.
  - The real harness: everything above ran against the mock.
    OBJ-27.8 switches to the real harness when OBJ-03 is done and re-checks these expectations.
  - Error buttons whose feature is not built or not decided are shown disabled: "Try again", "Stop", "Keep going", "Type instead", "Show what I did", "I'll show you", "Skip this step", "Run it now", "Run it when it's back", "Work on this device only", "Pair now", "Scan again", and "Allow".
    Esc and the close button dismiss the window.
- **Decisions and deviations:**
  - The generated types compile into a separate `YumiProtocol` static library, force-loaded into the app.
    The generated struct `Observation` shadows Apple's Observation module and breaks `@Observable` in the same module.
    Files that declare `@Observable` types import protocol types one by one.
    A rename in the generator was proposed to Jepoy.
  - A dynamic framework was tried first and did not load in ad hoc signed Release builds (hardened runtime library validation), so the library is static.
  - Without `Signing.local.xcconfig`, the build falls back to ad hoc signing so a fresh checkout still builds and tests.
    The README says this is not enough to use Yumi, because macOS forgets its permissions after each ad hoc rebuild.
  - The mock harness runs as one `node --import tsx` process, with node found through the login shell and then an interactive login shell.
    It restarts with a delay growing from 0.5 to 8 seconds, stops when Yumi quits (SIGTERM included), and a leftover one is stopped at the next launch.
  - The status line has a fifth state, "Yumi is getting ready", shown until the harness answers `hello` and `ping`.
  - The "Open settings" button for a microphone that macOS has never asked about shows macOS's own Allow prompt instead of opening System Settings, because System Settings cannot list Yumi until macOS has asked once.
  - The visible cursor cap setting only goes from 1 to 3, because SPEC-03 caps visible cursors at 3.
  - Settings are stored locally and handed to `PendingHarnessSettingsSink`, which only logs, because the protocol has no settings method.
  - Harness-to-app methods (`executeAction` and the rest) answer "method not found" until OBJ-27 serves them.
  - "Cancel" in an error window calls `cancelTask` when the error has a task.
  - An "Unexpected" error without a last action uses SPEC-11's nothing-done-yet copy: "Something went wrong and I stopped to be safe." with Try again and Stop.
  - An Android permission error without a permission name shows the "Unexpected" copy, so a raw `{permission}` placeholder never reaches the user.
- **Open questions:**
  - Model readiness (Jepoy and Brent): the proposal is option A, a `modelStateChanged` event (`loading`, `ready`, `failed`) plus the same state in `HelloResult`, so a reconnecting app knows it right away.
    Who starts the model server, and how, is also undecided.
    Until then `ModelReadiness` is always `unknown`.
  - For Patrick:
    - Copy: the window title "Welcome to Yumi", the heading "Before Yumi can help", the "Not now" and "Done" buttons, "Yumi is getting ready", "Using the mock harness", and "Send sample goal to the mock"; whether onboarding should reuse SPEC-11's "before I can help with this"; and whether "Type instead" belongs in onboarding.
    - The wake word default (on) and the push-to-talk default (Option-Space).
    - The bundle identifier prefix: `ph.appbuilders.yumi` (placeholder) or `co.studiokova.yumi` from Brent's example in "Signing".
    - What "Stop" does in an error window: pause, as SPEC-06 says for the menu, or cancel.
    - Copy for a harness that will not start or keeps refusing to connect.
      Today the status line stays "Yumi is getting ready" and the details go to the log.
  - The speech recognition usage description for Info.plist lands with OBJ-15, where speech recognition is first used.
- **For the next objectives:**
  - Build and run: see `mac/README.md`.
    Each person creates `mac/Signing.local.xcconfig` from the example.
    The mock harness needs `npm install` in `protocol/`.
  - Talk to the harness through `HarnessLink` and `HarnessClient` in `mac/Yumi/Harness/`.
    Events arrive as `HarnessEvent`, decoded into the generated types; add handling in `HarnessLink.handle(_:)`.
  - Show every user-facing error through `ErrorPresenter` and `AppDelegate.showError(_:)`.
    Wire a disabled button by adding its action in `ErrorPresenter.button(for:error:)`.
  - OBJ-15: drive the `listening` status, register the push-to-talk shortcut from `SettingsStore`, and add the speech recognition usage description.
  - OBJ-27: serve the harness-to-app methods in `HarnessClient` (today they answer -32601), and do OBJ-27.8.
  - Launch options for testing against the mock: `-YumiMockScript`, `-YumiMockFail`, `-YumiSendSampleGoal`; Debug builds also have UI snapshot options.
    All are read from launch arguments only.
  - The unified log subsystem is `ph.appbuilders.yumi`.
