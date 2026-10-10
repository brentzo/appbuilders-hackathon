# Yumi for Mac

The native macOS app.
It is everything the user sees and hears on the Mac, and every native capability the harness needs: microphone, speech, wake word, screen capture, accessibility, mouse and keyboard, and the cat cursors drawn over the screen.

Owner: Patrick.

Status: the app shell is built ([OBJ-14](../objectives/OBJ-14-mac-app-shell.md)): menu bar item, status line, permission onboarding, settings, harness supervision, the harness RPC client, and the error presenter.
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
- Speech output: Kokoro-82M on MLX Swift, behind the `SpeechOutput` interface (see "Yumi's voice"). Never the system voice.
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
`mac/Yumi.xcodeproj` is a plain Xcode project.
It also needs Xcode's Metal Toolchain, because MLX (Yumi's voice) compiles its GPU kernels during the build. Install it once with `xcodebuild -downloadComponent MetalToolchain` (about 840 MB).
Fetch Yumi's voice once with `scripts/fetch-voice-model.sh` (see "Yumi's voice"); without it Yumi stays quiet and says so on screen.
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
The status line says "Yumi is getting ready" until the harness answers `hello` and `ping` and its model is ready (OBJ-46, `Yumi/App/ModelReadiness.swift`).
The model's state comes in `hello`'s answer and then as `modelStateChanged`.
A goal spoken or typed while the model loads is held: Yumi says "I'm still waking up. I'll start on that as soon as I'm ready." and starts it once the model is ready (a proposal in SPEC-11's open questions).
When the model fails, Yumi shows SPEC-11 "Model failed to load", whose "Try again" restarts the harness so it checks the model server again.
The harness's socket, pid file, task store, and log live in its folder, `~/Library/Application Support/Yumi` (`HarnessFolder`), which Yumi passes to the harness as `YUMI_SUPPORT_DIR`.
When Yumi starts, it stops a harness left in that folder's pid file by an earlier Yumi.
The unit test host starts no harness and uses a temporary folder, so running the tests never stops or replaces the harness of a Yumi that is running.
With a paired phone, the harness reports this Mac's bridge device id in `hello` and `bridgeStateChanged`; the app sends it as `originDeviceId` in every `submitGoal`, falling back to `mac-local` until it is known ([SPEC-09](../specs/09-cross-device-routing.md), [OBJ-72](../objectives/OBJ-72-mac-cross-device-routing.md)).

Launch arguments, in Debug and Release:

- `-YumiMockScript <name>` plays a script from `protocol/mocks/scripts` (default `keynote-export`, which starts on `submitGoal`).
- `-YumiMockFail method=kind,...` makes harness methods fail with an `ErrorKind`, to see the error presenter.
- `-YumiSendSampleGoal YES` submits a sample goal once connected. The menu has the same action: "Send sample goal to the mock".
- The menu's "Cursor debug" submenu, shown while the mock is in use, sends each cursor command by hand: spawn, move, move to the next display, three cursors at once, every state, label, a helper chip, and fade.
- `YUMI_REPO_ROOT` (environment) points at another checkout of the repo.
- `YUMI_SUPPORT_DIR` (environment) moves the harness folder, for Yumi and the harness together.

What happens is logged under the subsystem `ph.appbuilders.yumi`, including the mock's own output:

```sh
/usr/bin/log stream --level info --predicate 'subsystem == "ph.appbuilders.yumi"'
```

### Controlling other apps

Yumi reads and presses other apps' windows through the Accessibility API ([OBJ-39](../objectives/OBJ-39-mac-gui-execution.md)).
The harness calls `observeWindow`, `executeAction`, and `readFieldValues`; `Yumi/GUI/` answers them.

- The trimmed tree keeps visible, actionable elements and the containers that scroll, numbered from 1, at most 200.
  An open menu is read instead of the window, followed by any open submenu.
  So is the open menu of a pop-up button, combo box, or menu button, such as "Where:" in a save panel, whether it hangs off the button or off the app (`PopUpMenus`); a closed pop-up has no children, so nothing changes until it opens.
  A sheet is read instead of the window.
  Otherwise the window comes first and the app's menu bar items last.
- Each element has an accessibility path such as `AXWindow/AXSheet[0]/AXButton[2]`; it never leaves the Mac except as `ResolvedElement.path`.
- A password field is listed with no value, never read, and never filled.
- `setValue` on a pop-up button or menu button chooses the item with that title (ignoring case and a trailing "…"): it opens the menu, presses the item, or closes the menu again and answers with the items there are.
- Pop-up buttons, like menus, first bring their app to the front, since a menu only opens in the active app.
- `type` and `key` run only for the main cursor, and every event carries the tag `0x59554D49` ("YUMI") in `kCGEventSourceUserData`.
- `open_app`, `open_file`, `open_url`, and `reveal_in_finder` go through `NSWorkspace`. There is no shell or AppleScript anywhere in `Yumi/GUI/`.
- `resolveApp` (`Yumi/Native/AppResolver.swift`) turns the app name a plan uses into the installed app's bundle id, without launching it, so the harness's router can probe it.
  It searches the application folders (`/Applications`, `/System/Applications`, their `Utilities`, `~/Applications`, and `/System/Library/CoreServices` for Finder) and matches the name the user sees, ignoring case and accents: the name in Finder, `CFBundleName`, `CFBundleDisplayName`, or the file name.
  It answers only with apps whose bundle id Launch Services knows, and an empty result when none matches. `open_app` by name finds apps the same way.

Debug builds have "GUI debug…" in the menu: a floating window that shows the trimmed tree of any running app's front window and runs real `executeAction` calls on it, as the main cursor.
Clicking it does not activate Yumi, so a menu Yumi opened stays open while you press the next item.
Yumi needs Accessibility permission for it, like for any task.

### Goal confirmation

Before any work starts, Yumi repeats the goal back ([OBJ-17](../objectives/OBJ-17-goal-confirmation.md)).

- When a goal is submitted (`HarnessLink.submitGoal`, which voice intake calls), the main cursor appears next to the pointer right away.
- The harness's `goalRestated` sentence is spoken and shown in a small panel with "Go ahead", "Change it", and "Cancel". The app never writes the sentence itself.
- Every answer goes to the harness with `replyToConfirmation`: a button, or what the user said after the sentence (listened for at most twice per sentence, then only the buttons work).
- "Cancel", or the harness cancelling the task while it waits, says "Okay, I won't do anything." and fades the cursor.
- While a goal waits for its answer and no task is confirmed, `executeAction` does nothing.
- Everything Yumi says goes through `SpeechOutput` (`NeuralSpeech`, Yumi's voice), including the harness's `speak` events and the tiling question. The first repeat-back of a goal is the conversation's opening line, so it starts with a meow.

With "Auto mode" on in Settings (off by default), the goal starts without the repeat-back ([OBJ-50](../objectives/OBJ-50-mac-auto-mode.md), SPEC-01 r14).

- Every `submitGoal` carries `autoMode`, read from the setting when the goal is submitted.
- Once the harness has started the task, `AutoModeAcknowledgement` shows "On it." and what Yumi heard in the repeat-back panel, without buttons, and says "On it.".
  The panel closes after 3 seconds, or when the task ends.
- Approvals for sends and deletes still show their cards, and the stop shortcut works as always.

### Debug mode and the thoughts panels

"Debug mode" in Settings (Troubleshooting) is on by default in Debug builds and off in release builds ([OBJ-53](../objectives/OBJ-53-mac-thoughts-panel.md), SPEC-07 r22 and r23).

- Yumi sends it to the harness with `setDebugMode` after every hello and on every change (`HarnessLink+DebugMode.swift`). The harness turns its detailed debug log, its `workerThought` events, and the model's reasons on and off with it.
- In Debug mode, clicking a cat's bubble or a helper chip opens its thoughts panel: the subtask, the lane and the time of its last thought, what it sees, its last action, and the model's last decision and why. Clicking the panel again closes it.
- The panel updates with every `workerThought`, and closes when its subtask is done or failed, when its cat or chip leaves, or when Debug mode turns off.
- The main cat has no label, so in Debug mode its bubble shows the title of the subtask it is thinking about, once a thought arrives, to have something to click.
- A cat's panel takes the bubble's place, moves sideways to stay on the display, and goes below the paws near the top. A chip's panel opens under the chip and pushes the chips below it down.
- The overlay panels stay click-through (SPEC-04 r7). While the pointer is over a bubble, chip, or open panel, a small transparent panel the size of that target sits under it and takes the click (`ThoughtsClickTarget`); anywhere else there is nothing to click. It never activates Yumi, and a cat stays put while the pointer is on its bubble.
- Reaching for a bubble mid-task and clicking it does not pause the task (SPEC-06 r2).
- Panels use the design tokens (`surface`, `line`, `ink`, `muted`) for the system's light or dark appearance, with a dot in the cat's or chip's coat.
- The pieces: `WorkerThoughts.swift` (the view model and the panel's words), `ThoughtsCard.swift` (drawing), `ThoughtsClickTarget.swift` (clicks), `CursorOverlay+Thoughts.swift` (the overlay glue), and `ThoughtsDemo.swift` (the demo part and the snapshot).

### Task summary

When a task finishes, the harness sends its summary as a `speak` event with the task's id (SPEC-02 r9).
Yumi says it in its own voice and shows it in a small card in the top-right corner of the display with the pointer, under the menu bar (`Yumi/Summary/`).
The card has a close button, closes on its own about 4 to 12 seconds after the line is said (longer for longer summaries), and goes when a new goal starts.
Whatever summary text arrives is shown as is, for any way a task ends. A `speak` without a task id is only said.

When the task found a list, the `speak` event carries it (`FoundList`), and the card shows all of it under the line, scrolling past 12 rows (SPEC-02 r13, [OBJ-74](../objectives/OBJ-74-save-list-to-note.md)).
Only the sentence is said.
In Auto mode the harness already put the list in a new note, so the card says so. Otherwise the card has "Save to Notes", and saying "save it" while the card is up does the same (`TaskSummary.takeSpokenSave`, checked before a new goal in `HarnessLink.submitSpeech`): both call `saveListToNote`, and the harness starts a short task that writes the note.
A card with a list stays until it is closed, saved, or a new goal starts.

### Voice intake

Push-to-talk turns speech into a goal on the Mac ([OBJ-15](../objectives/OBJ-15-mac-voice-intake.md)).

- Hold the shortcut from settings (default ⌥Space) to talk, from any app, and release it to stop.
  It is a Carbon hot key, so it needs no Accessibility permission.
- While the microphone is on, the main cursor shows its listening state next to the pointer and the menu says "Yumi is listening".
- The transcript goes to the harness with `HarnessLink.submitGoal`. Silence shows "Didn't catch speech", whose "Type instead" opens a box to type the goal.
- Right after the repeat-back (and an approval card), the same path listens hands-free for the answer and stops after a short silence (`SpeechEndpoint`).
- While a repeat-back waits for an answer, push-to-talk and the wake word answer it instead of starting a new goal (`HarnessLink.submitSpeech`). The typed-goal box always starts a new goal.
- Recognizers, both on the device:
  - Apple's: SpeechAnalyzer on macOS 26, which works with Siri and Dictation off and downloads its English model once; `SFSpeechRecognizer` forced on-device on macOS 15.
  - Whisper large-v3-turbo through WhisperKit (`openai_whisper-large-v3-v20240930_turbo_632MB`), downloaded once to `~/Library/Application Support/Yumi/Models` and loaded when "I speak Taglish" is on.
  - The rule is in `RecognizerRule`: "I speak Taglish" uses Whisper first, otherwise Apple's recognizer first; the other one is the fallback when the first fails, never when it heard silence.
- Audio stays in memory and is dropped once transcribed.

### Wake word

With the wake word on in Settings (on by default), Yumi listens for "Hey Yumi" hands-free ([OBJ-16](../objectives/OBJ-16-mac-wake-word.md), [OBJ-58](../objectives/OBJ-58-mac-hey-yumi-recognizer.md)).

- For the demo, Apple's on-device speech recognizer spots the phrase (`PhraseSpotter`), as SPEC-01's Decisions allow: SpeechAnalyzer on macOS 26, `SFSpeechRecognizer` forced on-device on macOS 15.
  It accepts sound-alikes on purpose ("hey you me", "hey yummy", "hey umi", "a yumi"); the list is `WakePhrase`.
- Each guess is checked for the phrase and dropped at once; nothing heard before it is logged or stored.
  The recognizer session is replaced every 8 seconds, and the last 2 seconds of audio stay in memory.
- On the phrase, the same microphone goes on into the push-to-talk capture path, starting with those 2 seconds, so "Hey Yumi, open Notes" in one breath keeps "open Notes".
  Only the words after the phrase become the goal.
- The wake word pauses while Yumi speaks (`TrackedSpeech` sets `AppModel.isSpeaking`) or listens, and for 0.8 seconds after, so Yumi never wakes itself.
- It costs about 2 to 5% of one core in Yumi plus about 5% in macOS's `localspeechrecognition`, measured with `PhraseSpotterTests.cpuWhileSpotting`.
- `-YumiWakeWordEngine openWakeWord` uses the openWakeWord detector below instead.

The openWakeWord detector:

- Detection is openWakeWord through ONNX Runtime: `WakeWordFeatures` is a Swift port of openWakeWord 0.6.0's feature step and matches the Python output on a fixed clip.
- The models are not in git. Fetch them once with `scripts/fetch-wake-word-models.sh`, which checks their checksums and puts them in `~/Library/Application Support/Yumi/Models/WakeWord`.
  Without them the wake word is off, and push-to-talk still works.
- The wake word model is a stand-in: openWakeWord's pre-trained "hey jarvis", so say "Hey Jarvis" with this detector.
  Dropping OBJ-12's `hey_yumi.onnx` into the same folder switches to "Hey Yumi" with no code change.
- On a detection Yumi plays a short sound and listens for the goal on the push-to-talk path, until the user stops speaking.
- Audio lives only in the detector's rolling buffers in memory; nothing is transcribed or stored before the wake word.
- With the setting off, the microphone is not opened for the wake word at all.

### Yumi's voice

Yumi speaks with a neural voice made on this Mac ([OBJ-51](../objectives/OBJ-51-mac-neural-voice.md), [SPEC-04](../specs/04-cursor-presence.md) requirement 20). Measurements are in [the voice report](../wiki/mac-neural-voice.md).

- The model is Kokoro-82M (Apache-2.0) with the af_heart voice, run by MLX through `Packages/KokoroSwift`, a copy of kokoro-ios (MIT) at upstream commit `4d6d1d8`, just after 1.0.9, with three changes marked "Yumi": loading errors throw instead of crashing, `KokoroSpeaker` keeps MLX out of the app target, and `generateAudio` can shift the predicted pitch curve.
  Pronunciation is MisakiSwift (Apache-2.0), with no espeak.
- The sound Brent picked: speed 1.1, pitch up 4 semitones inside the model with livelier intonation, then 3 more on playback with `AVAudioUnitTimePitch`, which also lifts the formants a little. The settings are in `KokoroVoice`.
- The files are not in git and the app never downloads them. `scripts/fetch-voice-model.sh` copies them from `~/Developer/vendor/kokoro-82m`, or downloads them from a pinned Hugging Face revision, checks their SHA-256, and puts them in `~/Library/Application Support/Yumi/Models/Voice`.
  After that the voice works with the network off; nothing about speech leaves the Mac.
- Lines are said in the order they were asked for, one sentence at a time, so the first sentence plays while the next is made.
- The opening line (the first repeat-back of a goal) starts with the cat's meow (`Overlay/Sounds/cat-meow.mp3`) while the voice gets ready, unless "Play sounds" is off. Asking again after an unclear answer does not meow.
- If the voice cannot load, Yumi stays quiet instead of using the system voice (Brent's decision) and shows "Voice didn't load (Mac)" from SPEC-11 in a panel that does not take focus. "Try again" loads it again. Why it failed is in the `speech` log.
- The voice uses about 490 MB while loaded, and about 1.3 GB for a moment while loading.

### Approval cards and the Trash

Sending and deleting ask every time ([OBJ-40](../objectives/OBJ-40-mac-approval-cards.md)).
The protocol contract defines tap-only `action` approvals for unclassified risky clicks and key presses; Mac card support is tracked in [OBJ-40.10](../objectives/OBJ-40-mac-approval-cards.md) and is implemented: the card shows the harness summary with Allow and Don't allow, and only a tap approves it.

- `showApprovalCard` shows the harness's `Approval` text as is, with "Send" and "Don't send", or "Delete" and "Don't delete" plus the folder, the first 5 names, and "and N more".
  Yumi says the first sentence and the card waits; the cursor shows "waiting for the user".
- A send is approved by a tap or by saying "send it"; anything with a "don't" or "no" never approves.
  A delete is approved only by a tap: voice does nothing on a delete card.
- After a "Don't", Yumi says the matching line from `ApprovalCopy`, the one place for this draft copy.
- `approvalCancelled` closes the card at once; a late tap does nothing.
- `moveToTrash` moves only exact paths that a tapped delete approval listed, each approval once, with `FileManager.trashItem`.
  A wildcard or relative path is refused before anything moves.
- The blocked-action card is the error window: "Keep going" calls `resumeTask` and "Stop" calls `cancelTask`.

### Stop and take-over

The user can always stop Yumi ([OBJ-35](../objectives/OBJ-35-mac-stop-and-take-over.md)).

- Control-Option-Escape (a Carbon hot key, no permission needed) and "Stop" in the menu pause every lane.
  Yumi says "Paused. Say continue when you're ready, or cancel to stop for good." and listens for the answer.
- A click, a scroll, a key press, or a deliberate pointer move while a cursor works in a running task pauses silently (SPEC-06 r2).
  A listen-only event tap watches for it; events tagged as Yumi's own, input on Yumi's own windows, cards, cats, bubbles, thoughts panels, and helper chips, and input while Yumi waits for the user (a card, a handed-over password) never count.
- A pointer move is deliberate when it goes more than 80 points from where the pointer was within the last half second (`PointerReach`), so jiggles and trackpad bumps never count.
  It is judged once the pointer rests (0.15 seconds still, or at most 0.8 seconds), so a reach that ends on a bubble, chip, panel, or card is the user using Yumi. Clicks, scrolls, and key presses count at once.
  Moves in the 1.5 seconds after the pointer was on Yumi's own things are the hand leaving Yumi, such as after pressing Resume, and never count.
- Every take-over is logged with what triggered it and where the pointer was, in screen points, for example "The user took over: a click at 812, 455".
- The stop is local first: typing stops before its next chunk, and `executeAction` refuses everything, checked again right before acting.
  Then the harness gets `pause`, open approval cards close, and every cursor freezes in the paused state.
- The paused panel has "Resume" and "Cancel".
  Resume calls `resumeTask` and lifts the local stop once the harness reports the task running.
  Cancel calls `cancelTask`, fades every cursor, and says "Okay, I stopped. Nothing else will happen."
- While macOS Secure Input is on, key presses do not reach the tap; Yumi logs when it turns on and off.

### Window tiling

When the harness sends `tilingSuggested`, Yumi asks "Want me to arrange your windows so you can watch all of us work?" out loud and in a small panel at the top of the task's display, with "Arrange windows" and "Leave them" ([OBJ-20](../objectives/OBJ-20-window-tiling.md)).

- "Arrange windows" saves every window's frame first, then tiles them in a grid on the display with the main cursor: 2 side by side, 3 and 4 in two rows.
- "Leave them" moves nothing.
- When the task is done, failed, or cancelled, every moved window goes back to its exact frame.
- The saved frames are kept in Yumi's preferences (`tiling.savedLayouts`), so they survive a restart: after reconnecting, Yumi asks the harness for its tasks and puts back the windows of any task that is no longer running.
- While windows are tiled, the menu has "Put windows back".
- With "Demo mode" on in Settings, Yumi tiles without asking.

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
- `-YumiOpen settings|onboarding|pairing|pairing-code|type-goal|menu|menu-busy|approval-send|approval-delete|paused|tiling|confirmation|heard|chips|panels|error:<ErrorKind>` opens that window at launch (`pairing-code` shows a sample pairing code).
- `-YumiVoiceFile <path>` makes push-to-talk transcribe that recording instead of the microphone (Debug builds).
- `-YumiReplyFile <path>` makes the spoken answer after a repeat-back, or the goal after the wake word, transcribe that recording (Debug builds).
- `-YumiWakeWordFile <path>` feeds that recording to the wake word detector at real-time pace instead of the microphone, and `-YumiWakeWordLoop YES` repeats it (Debug builds).
  With the recognizer, the goal after "Hey Yumi" comes from the rest of the same recording.
  An error window uses the sample last action "Clicked Export in Keynote".
- `-YumiPermissions mixed|granted` pretends permissions are in that state, without asking macOS.
- `-YumiStatus startingUp|ready|listening|working|paused` sets the menu's status line.
- `-YumiOverlayDemo <dir>` shows sample cursors and a helper chip, writes each display's overlay over white and over black as PNG files, then quits.
- `-YumiSay "<line>"` says the line once Yumi's voice is ready, `-YumiSayOpening YES` says it as an opening line with the meow, and `-YumiVoiceFolder <path>` loads the voice from another folder, for example an empty one to see the warning. Timings are in the `speech` log (Debug builds).
- `-YumiCursorDemo YES` plays a cursor demo of about a minute on screen: the main cat drops out of the island and goes through its states, three ghosts follow it out and leap around, the cats fade in place when the pointer comes at them (and stay solid beside a still pointer), the ghosts finish and leap back into the island with a meow, and the main cat does the same last (Debug builds).
  In the middle, the four cats line up idle, thinking, paused, and acting, and the demo moves your pointer onto each one: each fades in place, never moving away, and the first three lay their ears back; each fades back after the pointer leaves.
  Then the cats wait about 7 seconds for you to try it with your own pointer.
  Moving the pointer needs Accessibility; without it, only the hands-on part works.
  Then, with Debug mode turned on for this part, the cats and a helper chip get made-up thoughts, and the demo opens the main cat's panel, a ghost's, and the helper's in turn, updates each one, and closes the helper's when its subtask ends.
  Then the cats wait about 6 seconds for you to click a bubble yourself.
- `-YumiOpen thoughts -YumiSnapshotDir <dir>` opens thoughts panels on the main cat, a ghost at the right edge, a ghost under the top of the display, and a helper chip, writes the overlay as PNG files over white and black, then quits. Add `-YumiAppearance dark` for the dark panels.
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
| `Yumi/Approvals/` | Send and delete approval cards, their copy, and `moveToTrash` |
| `Yumi/Control/` | The stop shortcut, the take-over watcher, the local stop, and the paused panel |
| `Yumi/WakeWord/` | The wake word: the "Hey Yumi" phrase spotter, ONNX Runtime models, the openWakeWord feature port, and the listener |
| `Yumi/Speech/` | Yumi's voice: `NeuralSpeech` (order, meow, failed load), `KokoroVoice` (the model on its own queue), `SpeechPlayback` (the audio engine), and the voice warning panel |
| `Packages/KokoroSwift/` | Kokoro for MLX Swift, copied from kokoro-ios with Yumi's changes (MIT) |
| `Yumi/Voice/` | Voice intake: the push-to-talk hot key, the microphone, the recognizers and their rule, the silence endpoint, and the typed-goal box |
| `Yumi/Confirmation/` | Goal confirmation: the repeat-back panel, the `speak` interface, and listening for the answer |
| `Yumi/Summary/` | The finished task's summary: said, and shown in a card |
| `Yumi/Tiling/` | Window tiling: the consent panel, the grid, and saving and restoring window frames |
| `Yumi/Overlay/` | The click-through cursor overlay: panels per display, the cat cursor and its poses (`CursorCat.xcassets`, made by `scripts/render-cursor-cat.py`, plus the ears-back pose by `scripts/render-ears-back-cat.py`), motion, cats avoiding the user's pointer (`PointerAvoidance.swift`), helper chips, and the cursor debug actions |
| `Yumi/Harness/` | Harness launcher and supervisor, the Unix socket, the JSON-RPC client, and event handling |
| `Yumi/Errors/` | Error copy (the only place user-facing error text lives), the error presenter, and the error window |
| `YumiTests/` | Unit tests (Swift Testing) |

## Stand-ins in the app today

- The menu bar icon is the SF Symbol `cat` until the Rive cat ([OBJ-19](../objectives/OBJ-19-cat-cursor.md)) exists.
- Settings changes go to `PendingHarnessSettingsSink`, which only logs.
  The protocol has no method for settings yet, except Debug mode, which goes to the harness with `setDebugMode`.
  The protocol cannot report it yet; this is open with the protocol and harness owners.
- Error buttons whose feature comes in a later objective are shown disabled: for example "Try again" outside "Didn't catch speech", "Voice didn't load", and "Model failed to load", and "Stop" or "Keep going" when the error names no task.
- "Hey Yumi" is spotted by the speech recognizer for the demo ([OBJ-58](../objectives/OBJ-58-mac-hey-yumi-recognizer.md)) until a trained model is good enough. With `-YumiWakeWordEngine openWakeWord`, the model is openWakeWord's "hey jarvis" until "Hey Yumi" from [OBJ-12](../objectives/OBJ-12-hey-yumi-wake-word.md), with openWakeWord's default threshold, 0.5.
- Cursors are the cat as static poses, one per state, with small Core Animation motion: ginger for the main cursor, mint, sky, and slate for ghosts. The Rive cat ([OBJ-19](../objectives/OBJ-19-cat-cursor.md)) replaces them.
- A cursor moving to an element whose path does not resolve goes to the center of the target window, or the app's frontmost window.
- Vision clicks (`clickAt`) are only for a window whose content has nothing actionable in its accessibility tree, such as Spotify's ([OBJ-75](../objectives/OBJ-75-vision-fallback.md)): `WindowReader` then sends no elements, only a ScreenCaptureKit screenshot and the window's frame, and `GuiExecutor` turns the model's pixel into a screen point, refuses if the window moved since the screenshot, and clicks with the real mouse. Their live check in Spotify (OBJ-75.7) is not done yet.
- The tiling question is answered with its buttons only, and its answer stays in the app: the protocol has no method to tell the harness.
- Helper chips say "Helper working": the protocol's `routeDecided` event has no subtask title.
- Whisper is large-v3-turbo until the bake-off ([OBJ-11](../objectives/OBJ-11-whisper-bake-off.md)) picks the Mac model.

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
| [OBJ-15](../objectives/OBJ-15-mac-voice-intake.md) | Mac voice intake | Patrick | done |
| [OBJ-16](../objectives/OBJ-16-mac-wake-word.md) | Mac wake word | Patrick | in-progress |
| [OBJ-17](../objectives/OBJ-17-goal-confirmation.md) | Goal confirmation loop | Brent | in-progress |
| [OBJ-18](../objectives/OBJ-18-cursor-overlay-and-motion.md) | Cursor overlay and motion | Patrick | done |
| [OBJ-19](../objectives/OBJ-19-cat-cursor.md) | Cat cursor without Rive | Patrick | in-progress |
| [OBJ-20](../objectives/OBJ-20-window-tiling.md) | Window tiling with consent | Patrick | in-progress |
| [OBJ-27](../objectives/OBJ-27-mac-native-services.md) | Mac native services for the harness | Patrick | done |
| [OBJ-35](../objectives/OBJ-35-mac-stop-and-take-over.md) | Stop and take over on the Mac | Patrick | todo |
| [OBJ-39](../objectives/OBJ-39-mac-gui-execution.md) | Mac GUI execution | Patrick | in-progress |
| [OBJ-40](../objectives/OBJ-40-mac-approval-cards.md) | Approval and blocked-action cards on the Mac | Patrick | todo |
| [OBJ-44](../objectives/OBJ-44-mac-version-mismatch-copy.md) | Mac app shows the version mismatch copy | Patrick | todo |
| [OBJ-46](../objectives/OBJ-46-mac-model-readiness.md) | Mac app shows whether the model is ready | Patrick | in-progress |
| [OBJ-50](../objectives/OBJ-50-mac-auto-mode.md) | Auto mode skips the repeat-back | Brent | in-progress |
| [OBJ-51](../objectives/OBJ-51-mac-neural-voice.md) | Yumi's neural voice on the Mac | Brent | done |
| [OBJ-53](../objectives/OBJ-53-mac-thoughts-panel.md) | Expand a cursor to see what it is thinking | Brent | in-progress |
| [OBJ-54](../objectives/OBJ-54-mac-cats-avoid-pointer.md) | Cats avoid the user's pointer | Brent | in-progress |
| [OBJ-58](../objectives/OBJ-58-mac-hey-yumi-recognizer.md) | "Hey Yumi" on the Mac with the on-device recognizer | Brent | done |
| [OBJ-62](../objectives/OBJ-62-mac-voice-interruption.md) | Mac listens for interruptions during a task | Patrick | todo |
| [OBJ-72](../objectives/OBJ-72-mac-cross-device-routing.md) | Mac app side of cross-device routing | Patrick | in-progress |
| [OBJ-75](../objectives/OBJ-75-vision-fallback.md) | Vision fallback for apps without accessibility content | Patrick | in-progress |
<!-- generated:product-objectives:end -->

Related: [OBJ-21](../objectives/OBJ-21-mac-bridge-client-and-pairing.md) (Jepoy's bridge client; its pairing screen and connection state are built here in OBJ-27).
Related: the harness side of GUI control, pausing, and safety is Brent's [OBJ-36](../objectives/OBJ-36-gui-act-sub-agent.md), [OBJ-37](../objectives/OBJ-37-permission-gate-and-file-tools.md), and [OBJ-38](../objectives/OBJ-38-approvals-pause-and-action-log.md).
