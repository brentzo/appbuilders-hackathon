# Yumi for Mac

The native macOS app.
It is everything the user sees and hears on the Mac, and every native capability the harness needs: microphone, speech, wake word, screen capture, accessibility, mouse and keyboard, and the cat cursors drawn over the screen.

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

## Specs

- [SPEC-01 Voice intake and confirmation](../specs/01-voice-intake.md)
- [SPEC-03 Lane routing and handoff](../specs/03-lane-routing.md) (tiling)
- [SPEC-04 Cursor presence](../specs/04-cursor-presence.md)
- [SPEC-08 Device bridge](../specs/08-device-bridge.md) (pairing screen)
- Not finalized yet: [SPEC-05 Mac GUI control](../specs/05-mac-gui-control.md), [SPEC-06 User control](../specs/06-user-control.md), [SPEC-07 Safety](../specs/07-safety.md).
- Always follows [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md).

## Objectives

| ID | Objective | Status |
|---|---|---|
| [OBJ-14](../objectives/OBJ-14-mac-app-shell.md) | Mac app shell, permissions, and harness link | todo |
| [OBJ-15](../objectives/OBJ-15-mac-voice-intake.md) | Mac voice intake | todo |
| [OBJ-16](../objectives/OBJ-16-mac-wake-word.md) | Mac wake word | todo |
| [OBJ-17](../objectives/OBJ-17-goal-confirmation.md) | Goal confirmation loop | todo |
| [OBJ-18](../objectives/OBJ-18-cursor-overlay-and-motion.md) | Cursor overlay and motion | todo |
| [OBJ-19](../objectives/OBJ-19-rive-cat-cursor.md) | Rive cat cursor | todo |
| [OBJ-20](../objectives/OBJ-20-window-tiling.md) | Window tiling with consent | todo |

Related: [OBJ-21](../objectives/OBJ-21-mac-bridge-client-and-pairing.md) (harness objective that includes the Mac pairing screen).
