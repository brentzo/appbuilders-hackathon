# Yumi for Mac

The native macOS app.
It is everything the user sees and hears on the Mac, and every native capability the harness needs: microphone, speech, wake word, screen capture, accessibility, mouse and keyboard, and the cat cursors drawn over the screen.

Owner: Patrick.

Status: empty scaffold, nothing built yet.

## Responsibilities

- **App shell:** menu bar app, settings, permission onboarding (Microphone, Accessibility, Screen Recording), starting and supervising the harness.
- **Voice:** push-to-talk, "Hey Yumi" wake word, on-device speech recognition, speaking replies ([SPEC-01](../specs/01-voice-intake.md)).
- **Goal confirmation:** repeat the goal back, and handle confirm, correct, and cancel.
- **Cursor overlay:** transparent click-through overlay on every display, smooth motion, the Rive cat, ghost colors and labels, helper chips ([SPEC-04](../specs/04-cursor-presence.md)).
- **Window tiling:** ask before arranging windows, restore them afterward, demo mode ([SPEC-03](../specs/03-lane-routing.md)).
- **Native execution:** when the harness asks, capture a window, read its accessibility tree, and perform clicks, presses, and text input. This is defined by SPEC-05, which is not finalized yet.
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

## Specs

- [SPEC-01 Voice intake and confirmation](../specs/01-voice-intake.md)
- [SPEC-03 Lane routing and handoff](../specs/03-lane-routing.md) (tiling)
- [SPEC-04 Cursor presence](../specs/04-cursor-presence.md)
- [SPEC-08 Device bridge](../specs/08-device-bridge.md) (pairing screen)
- Not finalized yet: [SPEC-05 Mac GUI control](../specs/05-mac-gui-control.md), [SPEC-06 User control](../specs/06-user-control.md), [SPEC-07 Safety](../specs/07-safety.md).
- Always follows [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md).

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-14](../objectives/OBJ-14-mac-app-shell.md) | Mac app shell, permissions, and harness link | Patrick | todo |
| [OBJ-15](../objectives/OBJ-15-mac-voice-intake.md) | Mac voice intake | Patrick | todo |
| [OBJ-16](../objectives/OBJ-16-mac-wake-word.md) | Mac wake word | Patrick | todo |
| [OBJ-17](../objectives/OBJ-17-goal-confirmation.md) | Goal confirmation loop | Patrick | todo |
| [OBJ-18](../objectives/OBJ-18-cursor-overlay-and-motion.md) | Cursor overlay and motion | Patrick | todo |
| [OBJ-19](../objectives/OBJ-19-rive-cat-cursor.md) | Rive cat cursor | Patrick | todo |
| [OBJ-20](../objectives/OBJ-20-window-tiling.md) | Window tiling with consent | Patrick | todo |
| [OBJ-27](../objectives/OBJ-27-mac-native-services.md) | Mac native services for the harness | Patrick | todo |
<!-- generated:product-objectives:end -->

Related: [OBJ-21](../objectives/OBJ-21-mac-bridge-client-and-pairing.md) (Jepoy's bridge client; its pairing screen and connection state are built here in OBJ-27).
