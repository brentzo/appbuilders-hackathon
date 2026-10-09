# Yumi for Mac

The native macOS app.
It is everything the user sees and hears on the Mac, and every native capability the harness needs: microphone, speech, wake word, screen capture, accessibility, mouse and keyboard, and the cat cursors drawn over the screen.

Owner: Patrick.

Status: the app shell is in progress ([OBJ-14](../objectives/OBJ-14-mac-app-shell.md)): menu bar item, status line, permission onboarding, settings, harness supervision, the harness RPC client, and the error presenter.
It starts the real harness from `harness/` by default, or the mock harness with `-YumiMockHarness YES`.

## Responsibilities

- **App shell:** menu bar app, settings, permission onboarding (Microphone, Accessibility, Screen Recording), starting and supervising the harness.
- **Voice:** push-to-talk, "Hey Yumi" wake word, on-device speech recognition, speaking replies ([SPEC-01](../specs/01-voice-intake.md)).
- **Goal confirmation:** repeat the goal back, and handle confirm, correct, and cancel.
- **Cursor overlay:** transparent click-through overlay on every display, smooth motion, the Rive cat, ghost colors and labels, helper chips ([SPEC-04](../specs/04-cursor-presence.md)).
- **Window tiling:** ask before arranging windows, restore them afterward, demo mode ([SPEC-03](../specs/03-lane-routing.md)).
- **Native execution:** when the harness asks, read a window's trimmed accessibility tree, press elements, set text, type for the main cursor, and run the typed direct tools ([SPEC-05](../specs/05-mac-gui-control.md)).
- **User control and safety UI:** the stop shortcut, pausing when the user takes the mouse, the paused state, and the approval cards ([SPEC-06](../specs/06-user-control.md), [SPEC-07](../specs/07-safety.md)).
- **Pairing screen:** show the QR code that pairs the phone ([SPEC-08](../specs/08-device-bridge.md)).

## Not responsible for

- Task state, planning, routing, or talking to the model. The [harness](../harness/README.md) owns these.
- Talking to the bridge directly. The harness is the Mac's bridge client.

## Initial technical plan

- Swift with SwiftUI and AppKit, minimum macOS 15. Use newer APIs (such as SpeechAnalyzer on macOS 26) when available.
- ScreenCaptureKit for capture, the Accessibility API (`AXUIElement`) for reading and acting on apps, `CGEvent` for mouse and keyboard.
- A borderless, transparent, click-through `NSPanel` per display for the overlay.
- Speech: WhisperKit or whisper.cpp for Whisper (final choice from [models](../models/README.md)); `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`, or SpeechAnalyzer, for native on-device recognition. Never cloud.
- Speech output: `AVSpeechSynthesizer` first, behind a `speak` interface so Kokoro can replace it later.
- Wake word: openWakeWord models run with ONNX Runtime.
- Cat: Rive's Apple runtime (rive-ios, which supports macOS) playing the `.riv` file from [character](../character/README.md).
- Talks to the harness over a local Unix socket with JSON-RPC, using types from [protocol](../protocol/README.md).

## Signing

Free Apple accounts ("Personal Team") are enough for the hackathon. Build Yumi from source on the Mac that runs it, including the demo Mac.

- **Certificate:** "Apple Development" with automatic signing, never "Sign to Run Locally". A signature that changes on every build makes macOS forget Yumi's Accessibility and Screen Recording permissions after each rebuild.
- **App Sandbox:** off. Apps that control other apps through Accessibility cannot be sandboxed.
- **Hardened Runtime:** on, with Audio Input for the microphone.
- **Info.plist:** microphone and speech recognition usage descriptions. They are user-facing copy, shown in macOS permission prompts.
- **Per-person signing:** Apple registers a bundle identifier for one team only, so each person uses their own. A committed `Signing.xcconfig` holds the shared settings and includes a gitignored `Signing.local.xcconfig` with each person's `DEVELOPMENT_TEAM` and bundle identifier suffix (for example `co.studiokova.yumi.brent`). The demo Mac uses Brent's.
- **Sharing a built app** with another Mac needs Developer ID signing and notarization, which need the paid Apple Developer Program. Not needed for the hackathon.

## Build and run

Needs Xcode 26 (built with 26.4.1).
The app runs on macOS 15 or later.
No other tools are needed to build: `mac/Yumi.xcodeproj` is a plain Xcode project.
To run Yumi against the mock harness, and for the harness tests, install the protocol package once with `npm install` in `protocol/` (needs Node.js).

From `mac/`:

```sh
# Build for development
xcodebuild -project Yumi.xcodeproj -scheme Yumi -configuration Debug -derivedDataPath build build

# Run (Yumi appears in the menu bar as a cat; it has no Dock icon)
open build/Build/Products/Debug/Yumi.app

# Build for demos and smoke tests (see "Signing and permissions")
xcodebuild -project Yumi.xcodeproj -scheme Yumi -configuration Release -derivedDataPath build build
open build/Build/Products/Release/Yumi.app

# Test (unit tests, the error copy check against SPEC-11, and RPC tests against the mock harness)
xcodebuild -project Yumi.xcodeproj -scheme Yumi -derivedDataPath build test
```

Or open `Yumi.xcodeproj` in Xcode and press Run.

The project uses folder-synchronized groups, so a new Swift file under `Yumi/` or `YumiTests/` is picked up without editing the project.

### Protocol types

The generated Swift types are used in place from `protocol/generated/swift/YumiProtocol.swift`, so `npm run generate` in `protocol/` is picked up by the next build.
They compile into the `YumiProtocol` static library, which is force-loaded into the app so the hosted tests find every type.
A dynamic framework would not load in ad hoc signed Release builds, because the hardened runtime rejects it.

The generated struct `Observation` shadows Apple's Observation module, which `@Observable` expands into.
A file that declares an `@Observable` type must import protocol types one by one, for example `import enum YumiProtocol.ErrorKind`, never `import YumiProtocol`.
A rename in the generator has been proposed to the protocol owner.

### Harness

Yumi starts the harness itself: the real one from `harness/` by default ([OBJ-27](../objectives/OBJ-27-mac-native-services.md)), or the mock from `protocol/mocks` with `-YumiMockHarness YES` or any mock option below.
It finds `node` through your login shell, runs the harness with `node --import tsx`, restarts it whenever it exits, and stops it when Yumi quits.
Run `npm install` in `harness/` and `protocol/` first.
With the mock, the menu says "Using the mock harness" so it is never demoed by accident.
The status line says "Yumi is getting ready" until the harness answers `hello` and `ping`.

Launch arguments, in Debug and Release:

- `-YumiMockScript <name>` plays a script from `protocol/mocks/scripts` (default `keynote-export`, which starts on `submitGoal`).
- `-YumiMockFail method=kind,...` makes harness methods fail with an `ErrorKind`, to see the error presenter.
- `-YumiSendSampleGoal YES` submits a sample goal once connected. The menu has the same action: "Send sample goal to the mock".
- The menu's "Cursor debug" submenu, shown while the mock is in use, sends each cursor command by hand: spawn, move, move to the next display, three cursors at once, every state, label, a helper chip, and fade.
- `YUMI_REPO_ROOT` (environment) points at another checkout of the repo.

What happens is logged under the subsystem `ph.appbuilders.yumi`, including the mock's own output:

```sh
/usr/bin/log stream --level info --predicate 'subsystem == "ph.appbuilders.yumi"'
```

### Controlling other apps

Yumi reads and presses other apps' windows through the Accessibility API ([OBJ-44](../objectives/OBJ-44-mac-gui-execution.md)).
The harness calls `observeWindow`, `executeAction`, and `readFieldValues`; `Yumi/GUI/` answers them.

- The trimmed tree keeps visible, actionable elements and the containers that scroll, numbered from 1, at most 200.
  An open menu is read instead of the window, followed by any open submenu.
  A sheet is read instead of the window.
  Otherwise the window comes first and the app's menu bar items last.
- Each element has an accessibility path such as `AXWindow/AXSheet[0]/AXButton[2]`; it never leaves the Mac except as `ResolvedElement.path`.
- A password field is listed with no value, never read, and never filled.
- `type` and `key` run only for the main cursor, and every event carries the tag `0x59554D49` ("YUMI") in `kCGEventSourceUserData`.
- `open_app`, `open_file`, `open_url`, and `reveal_in_finder` go through `NSWorkspace`. There is no shell or AppleScript anywhere in `Yumi/GUI/`.

Debug builds have "GUI debug…" in the menu: a floating window that shows the trimmed tree of any running app's front window and runs real `executeAction` calls on it, as the main cursor.
Clicking it does not activate Yumi, so a menu Yumi opened stays open while you press the next item.
Yumi needs Accessibility permission for it, like for any task.

### Signing and permissions

This is how the project implements "Signing" above.

- `Signing.xcconfig` (committed) holds the shared settings for every target: "Apple Development" with automatic signing, App Sandbox off, and Hardened Runtime. The Audio Input entitlement is in `Yumi.entitlements`.
- `Signing.local.xcconfig` (gitignored) holds your `DEVELOPMENT_TEAM` and `YUMI_BUNDLE_ID_SUFFIX`.
  Create it from the example:

  ```sh
  cp Signing.local.xcconfig.example Signing.local.xcconfig
  ```

  Your team ID is in Xcode under Settings > Accounts, or is the `OU` of your certificate: `security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject`.
- The bundle identifier is `YUMI_BUNDLE_ID_PREFIX` from `Signing.xcconfig` plus your suffix, for example `ph.appbuilders.yumi.brent`.
  The prefix `ph.appbuilders.yumi` is a placeholder until the real one is chosen.
- Without `Signing.local.xcconfig`, a fresh checkout still builds, signed ad hoc.
  That is enough to compile and run the tests, but not to use Yumi: macOS forgets its Accessibility and Screen Recording permissions after every ad hoc rebuild.
  Ad hoc Debug builds also lack the hardened runtime; Release builds have it.
  With your team, Debug and Release builds both have it.
- Use a Release build for demos and smoke tests.
- To reset Yumi's permissions while testing onboarding: `tccutil reset All <your bundle identifier>`.

### Checking the UI without clicking

Debug builds accept launch arguments, so the UI can be checked by screenshot:

```sh
open -n -W build/Build/Products/Debug/Yumi.app --args \
  -YumiAppearance dark -YumiOpen onboarding -YumiPermissions mixed -YumiSnapshotDir /tmp/yumi-shots
```

- `-YumiAppearance light|dark` forces the app's appearance.
- `-YumiOpen settings|onboarding|pairing|pairing-code|error:<ErrorKind>` opens that window at launch (`pairing-code` shows a sample pairing code).
  An error window uses the sample last action "Clicked Export in Keynote".
- `-YumiPermissions mixed|granted` pretends permissions are in that state, without asking macOS.
- `-YumiStatus startingUp|ready|listening|working|paused` sets the menu's status line.
- `-YumiOverlayDemo <dir>` shows sample cursors and a helper chip, writes each display's overlay over white and over black as PNG files, then quits.
- `-YumiSnapshotDir <dir>` makes the opened window the key, active window, writes it as PNG files at 1x and 2x, then quits.
  If the window never becomes key, it writes nothing and says so on standard error.
  It needs no Screen Recording permission.
  The yellow and green title bar buttons render gray in these files even when the window is key.

## Code layout

| Path | What |
|---|---|
| `Yumi/App/` | App entry, app delegate, shared model, status, window handling, Debug launch arguments |
| `Yumi/MenuBar/` | The menu bar menu |
| `Yumi/Permissions/` | Permission states and "Open settings" behavior |
| `Yumi/Onboarding/` | The permission onboarding window |
| `Yumi/Settings/` | Settings, their local storage, and the harness settings hand-off |
| `Yumi/GUI/` | Controlling other apps: the trimmed tree reader, element actions, tagged keystrokes, the direct tools, and the GUI debug window |
| `Yumi/Overlay/` | The click-through cursor overlay: panels per display, the placeholder cursor drawing, motion, helper chips, and the cursor debug actions |
| `Yumi/Harness/` | Harness launcher and supervisor, the Unix socket, the JSON-RPC client, and event handling |
| `Yumi/Errors/` | Error copy (the only place user-facing error text lives), the error presenter, and the error window |
| `YumiTests/` | Unit tests (Swift Testing) |

## Stand-ins in the app today

- The menu bar icon is the SF Symbol `cat` until the Rive cat ([OBJ-19](../objectives/OBJ-19-rive-cat-cursor.md)) exists.
- Settings changes go to `PendingHarnessSettingsSink`, which only logs.
  The protocol has no method for settings yet.
- Model readiness is a placeholder that is always unknown (`ModelReadiness`).
  The protocol cannot report it yet; this is open with the protocol and harness owners.
- Error buttons whose feature comes in a later objective are shown disabled: for example "Try again", "Stop", and "Type instead".
- `showApprovalCard` and `moveToTrash` answer "method not found" until [OBJ-45](../objectives/OBJ-45-mac-approval-cards.md).
- Cursors are a placeholder drawing (a black and white pointer, ghosts outlined in their color) until the Rive cat ([OBJ-19](../objectives/OBJ-19-rive-cat-cursor.md)).
- A cursor moving to an element whose path does not resolve goes to the center of the target window, or the app's frontmost window.
- Vision clicks (`clickAt`) are refused until the p1 vision fallback.
- Helper chips say "Helper working": the protocol's `routeDecided` event has no subtask title.
- The status line follows task events. "Listening" waits for voice intake ([OBJ-15](../objectives/OBJ-15-mac-voice-intake.md)).

## Specs

- [SPEC-01 Voice intake and confirmation](../specs/01-voice-intake.md)
- [SPEC-03 Lane routing and handoff](../specs/03-lane-routing.md) (tiling)
- [SPEC-04 Cursor presence](../specs/04-cursor-presence.md)
- [SPEC-08 Device bridge](../specs/08-device-bridge.md) (pairing screen)
- [SPEC-05 Mac GUI control](../specs/05-mac-gui-control.md) (native execution)
- [SPEC-06 User control](../specs/06-user-control.md) (stop shortcut, take-over, paused state)
- [SPEC-07 Safety](../specs/07-safety.md) (approval cards, moving files to the Trash)
- Always follows [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md).

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-14](../objectives/OBJ-14-mac-app-shell.md) | Mac app shell, permissions, and harness link | Patrick | done |
| [OBJ-15](../objectives/OBJ-15-mac-voice-intake.md) | Mac voice intake | Patrick | todo |
| [OBJ-16](../objectives/OBJ-16-mac-wake-word.md) | Mac wake word | Patrick | todo |
| [OBJ-17](../objectives/OBJ-17-goal-confirmation.md) | Goal confirmation loop | Patrick | todo |
| [OBJ-18](../objectives/OBJ-18-cursor-overlay-and-motion.md) | Cursor overlay and motion | Patrick | done |
| [OBJ-19](../objectives/OBJ-19-rive-cat-cursor.md) | Rive cat cursor | Patrick | todo |
| [OBJ-20](../objectives/OBJ-20-window-tiling.md) | Window tiling with consent | Patrick | in-progress |
| [OBJ-27](../objectives/OBJ-27-mac-native-services.md) | Mac native services for the harness | Patrick | done |
| [OBJ-40](../objectives/OBJ-40-mac-stop-and-take-over.md) | Stop and take over on the Mac | Patrick | todo |
| [OBJ-44](../objectives/OBJ-44-mac-gui-execution.md) | Mac GUI execution | Patrick | in-progress |
| [OBJ-45](../objectives/OBJ-45-mac-approval-cards.md) | Approval and blocked-action cards on the Mac | Patrick | todo |
<!-- generated:product-objectives:end -->

Related: [OBJ-21](../objectives/OBJ-21-mac-bridge-client-and-pairing.md) (Jepoy's bridge client; its pairing screen and connection state are built here in OBJ-27).
Related: the harness side of GUI control, pausing, and safety is Brent's [OBJ-41](../objectives/OBJ-41-gui-act-sub-agent.md), [OBJ-42](../objectives/OBJ-42-permission-gate-and-file-tools.md), and [OBJ-43](../objectives/OBJ-43-approvals-pause-and-action-log.md).
