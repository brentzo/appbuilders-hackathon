# Setup for judges

How to run Yumi on your own machine.
Written 2026-10-10 against `main`, and checked step by step against the code that morning.
Steps marked **Not verified** were read from the code but not run end to end by a judge's route; they say what is unsure.

Yumi runs on the Mac, with an optional Android phone as a voice remote.
All AI runs on your devices: the language model, speech recognition, Yumi's voice, and the wake word.
The only network traffic is downloading the models once, and the end-to-end encrypted relay between the Mac and the phone.

Yumi is a hackathon build, and some parts are not finished.
The [README](../README.md#what-works-and-what-does-not) lists what works, what is built but not yet checked live, and what was cut.
The paths below say plainly what you will and will not see.

## Choose a path

| Path | Needs | Time | What you see |
|---|---|---|---|
| [1. The Mac app with the scripted harness](#path-1-the-mac-app-with-the-scripted-harness) | A Mac with Xcode | About 15 minutes | The full interface: menu bar, voice, the cat cursors, the repeat-back, window tiling, and error messages, driven by a scripted stand-in for the AI |
| [2. The real harness and model](#path-2-the-real-harness-and-model) | Path 1, plus Python and about 10 GB of free memory | About 30 minutes, mostly the model download | Yumi doing real goals on your Mac with the local model |
| [3. The Android phone](#path-3-the-android-phone) | Path 2, an Android 12+ phone, and the Android SDK | About 20 minutes | Goals said on the phone and run on the Mac, with progress and Stop on the phone |
| [4. The tests](#path-4-the-tests) | Node.js, on any OS | About 5 minutes | Every product's checks, including the end-to-end encryption and the relay |

## What you need

For the Mac paths:

- A Mac with Apple silicon and macOS 15 or later.
  16 GB of memory is enough; path 2 needs about 10 GB of it free.
- Xcode 26.
- A free Apple account signed in to Xcode (Settings > Accounts), so macOS remembers Yumi's permissions.
- Node.js 24 or later.
- Git.

Path 2 also needs Python 3.10 or later.
Path 3 needs JDK 17 or later, the Android SDK with platform 36 and build-tools 36 (Android Studio installs both), and `adb`.

## Get the code

```sh
git clone https://github.com/brentzo/appbuilders-hackathon.git
cd appbuilders-hackathon
(cd protocol && npm install)
(cd harness && npm install)
```

The Mac app starts the harness from this checkout, so keep the checkout where it is after building.

## Path 1: the Mac app with the scripted harness

The Mac app normally starts the real harness.
With `-YumiMockHarness YES` it starts a scripted stand-in from `protocol/mocks/` instead, which answers like the real harness and plays a recorded task.
The menu says "Using the mock harness" the whole time.

1. Set up signing once, from `mac/`:

   ```sh
   cd mac
   cp Signing.local.xcconfig.example Signing.local.xcconfig
   ```

   Open `Signing.local.xcconfig` and set:
   - `DEVELOPMENT_TEAM` to your team ID, shown in Xcode under Settings > Accounts.
   - `YUMI_BUNDLE_ID_SUFFIX` to something of your own, starting with a dot, for example `.yourname`.

   Without this the app still builds, but macOS forgets its permissions every time it is rebuilt.

2. Install Xcode's Metal Toolchain once (about 840 MB), which Yumi's voice needs to build, and fetch the voice (327 MB), still from `mac/`:

   ```sh
   xcodebuild -downloadComponent MetalToolchain
   sh scripts/fetch-voice-model.sh
   ```

   The script downloads Kokoro-82M from a pinned Hugging Face revision and checks every file's SHA-256.
   Without the voice, Yumi works but stays quiet, and shows a note that its voice didn't load.

3. Build and open it:

   ```sh
   xcodebuild -project Yumi.xcodeproj -scheme Yumi -configuration Release -derivedDataPath build build
   open build/Build/Products/Release/Yumi.app --args -YumiMockHarness YES
   ```

   Yumi appears in the menu bar as a cat; it has no Dock icon.

4. Follow the setup window.
   It asks for Microphone, Accessibility, and Screen Recording, which Yumi needs to hear you, control apps, and see the screen.

5. Try it:
   - Choose "Send sample goal to the mock" in the menu, or hold ⌥Space, say a goal, and let go.
   - Yumi repeats the goal back out loud and waits for "Go ahead", "Change it", or "Cancel", by button or by voice.
   - The cat cursor then plays the scripted Keynote export.
   - Press Control-Option-Escape at any time to stop it.

Other scripts show other parts:

```sh
open build/Build/Products/Release/Yumi.app --args -YumiMockHarness YES -YumiMockScript approval-and-question
open build/Build/Products/Release/Yumi.app --args -YumiMockHarness YES -YumiMockScript windows-and-bridge
```

`approval-and-question` shows Yumi asking you a question in the middle of a task.
`windows-and-bridge` shows the phone connection states, an interrupted task found after a restart, the window tiling question, and Yumi waiting for a busy window.
While the mock is in use, the menu also has "Cursor debug", which sends each cursor command by hand.
Debug builds add "GUI debug…", which reads any app's window and presses its elements; see [mac/README.md](../mac/README.md).

### The wake word

The wake word is on by default in Settings, and needs no download.
Say **"Hey Yumi"**, then the goal, in one breath or after a pause.
For the demo the phrase is spotted by Apple's on-device speech recognizer, which accepts a few sound-alikes on purpose ("hey yummy", "hey umi").
On macOS 26 that recognizer downloads its English model from Apple once.
A trained "Hey Yumi" model is still in progress; `-YumiWakeWordEngine openWakeWord` switches to the older openWakeWord detector, whose stand-in model listens for "Hey Jarvis" and needs `sh mac/scripts/fetch-wake-word-models.sh` first.

### Taglish

Turn on "I speak Taglish" in Settings to use Whisper instead of Apple's recognizer.
Yumi downloads the Whisper model (about 630 MB) the first time.

## Path 2: the real harness and model

The harness is the part that plans and acts.
It talks to Qwen3.5-9B, running on your Mac through mlx-vlm.
Nothing leaves the Mac: the model server listens on `127.0.0.1` only.

Start things in this order: the model server, then the Yumi app, which starts the harness itself.

1. Install the model server in its own Python environment:

   ```sh
   python3 -m venv ~/.venvs/yumi-model
   ~/.venvs/yumi-model/bin/pip install mlx-vlm==0.7.6
   ```

2. Start it, and leave it running in its own terminal:

   ```sh
   ~/.venvs/yumi-model/bin/mlx_vlm.server --model mlx-community/Qwen3.5-9B-4bit --host 127.0.0.1 --port 8080 --max-num-seqs 3
   ```

   The first start downloads the model (about 5.6 GB) from Hugging Face into `~/.cache/huggingface`, which takes a while.
   `--max-num-seqs 3` matches the 3 model requests the harness runs at once, and bounds the server's memory; without it mlx-vlm 0.7.6 does not limit them.
   The demo Mac ran the same command without that flag.

3. Check that it is up, and that the harness gets a valid action back from it:

   ```sh
   curl http://127.0.0.1:8080/health
   cd harness && npm run model:check
   ```

   The first answers `{"status":"healthy",...}`.
   `model:check` sends a real Keynote step and prints the action the model chose, already checked against the protocol.

4. Quit Yumi if it is open from path 1, then open it without the mock flag, from the checkout's root:

   ```sh
   open mac/build/Build/Products/Release/Yumi.app
   ```

   Yumi starts the harness from `harness/` with your login shell's `node`, and restarts it if it exits.
   The menu's status line says "Yumi is getting ready" until the harness answers.

5. Say a goal, for example "Hey Yumi, list the files in my Downloads folder".
   Yumi repeats it back; say "Go ahead" or press the button, and the cat does it.

Goals to try:

- **Keynote:** with a deck open in Keynote, "Export my Q3 Report deck as a PDF". This is the goal that was run most on the real Mac.
  Keynote must be installed; Yumi drives it through the Accessibility permission you already granted.
- **A list into a note:** "List the files in my Downloads folder". Yumi asks "Want it in a note too?"; say yes, and the cat makes a new note in Notes and types the list.
  **Not verified live** on the final build: built and tested, and earlier live tries were fixed ([OBJ-74](../objectives/OBJ-74-save-list-to-note.md)).
- **Stop and take over:** while a cat works, move the mouse yourself or press Control-Option-Escape; the cats freeze and a panel offers Resume and Cancel.

What you will not see yet: sending mail (approval cards exist, but a Mail draft's recipients cannot be read yet, so a send never runs), and Spotify, which is being fixed now.

The model needs about 9 GB while it runs.
Close other heavy apps, such as the Android emulator or a large build, or every step slows to minutes.

## Path 3: the Android phone

The Android app is Yumi's voice remote.
You say a goal on the phone, the phone repeats it back, and once you confirm, the goal is sent end to end encrypted to the Mac, which runs it.
The phone shows "Working on your Mac" with the current step and Stop, and says the summary when the task ends.
Approvals for a phone goal show on the Mac, not on the phone, and the phone does not run alarms, timers, or other phone-only goals yet: every goal goes to the Mac.
Path 2 must be running, because the Mac runs the goals.

1. Tell Gradle where the Android SDK is, from `android/`:

   ```sh
   cd android
   echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
   ```

2. Build the debug app:

   ```sh
   ./gradlew assembleDebug
   ```

   The first build needs internet: Gradle downloads the "Hey Yumi" Vosk model (40 MB), checks its SHA-256, and puts it inside the app.
   The app is `app/build/outputs/apk/debug/app-debug.apk`.
   Use the debug build: pairing below needs it.

3. Install it over USB, with USB debugging on, and open it:

   ```sh
   ./gradlew installDebug
   adb shell am start -n ai.yumi.android/.MainActivity
   ```

4. Follow the in-app setup: microphone, notifications, and battery use.

### Pair the phone

The phone app cannot scan the pairing QR code yet, so it reads the code's text over `adb`.
**Not verified** as a judge's route: the steps below follow `BridgeTestReceiver.kt` and the harness's pairing code, and use `zbarimg`, which was not part of our own runs.

1. On the Mac, with Yumi running the real harness, choose "Pair your phone…" in the menu.
   A QR code appears; it lasts 5 minutes.
2. Take a screenshot of the QR code (Command-Shift-4), and read its text with zbar (`brew install zbar`):

   ```sh
   offer=$(zbarimg --raw -q ~/Desktop/Screenshot*.png | head -n 1)
   ```

   The text is a JSON pairing offer that starts with `{"protocolVersion"`.
3. Send it to the phone, base64 encoded so the shell leaves it intact:

   ```sh
   adb shell am broadcast -a ai.yumi.android.debug.PAIR -p ai.yumi.android --es offer64 "$(printf '%s' "$offer" | base64)"
   ```

4. The Mac shows the phone as paired within a few seconds.
   Both devices need internet, since they meet at the relay.

### Use it

- Tap the microphone on the phone's home screen, or say "Hey Yumi", and say a goal, for example "Export my Q3 Report deck as a PDF".
- The phone repeats it back; tap Send, or say yes.
- The cat appears on the Mac and works; the phone shows each step.
- Tap Stop on the phone: it shows Paused once the Mac has stopped, with Resume and Cancel.

## Path 4: the tests

These run on macOS, Linux, or Windows, except where noted.

```sh
# Shared contracts and end-to-end crypto (any OS)
cd protocol && npm install && npm test

# The bridge relay (any OS)
cd bridge && npm install && npm test

# The harness (macOS or Linux; its file safety tests use macOS paths)
cd harness && npm install && npm test

# The Mac app (macOS with Xcode)
cd mac && xcodebuild -project Yumi.xcodeproj -scheme Yumi -derivedDataPath build test

# The Android app (any OS with the Android SDK)
cd android && ./gradlew testDebugUnitTest
```

`python3 scripts/verify.py --all` runs every check this machine can run, and says which ones it could not.

## Privacy

- The language model, speech recognition, Yumi's voice, and the wake word run on your devices.
  Audio stays in memory and is dropped once transcribed.
- The model server listens on `127.0.0.1` only.
- The Mac and phone talk through our relay at `wss://yumibridge.studiokova.co`.
  Every message is encrypted end to end and signed, so the relay can route messages but never read them ([SPEC-08](../specs/08-device-bridge.md)).
  To use your own relay, deploy it from `bridge/` behind TLS (see its README) and set `YUMI_BRIDGE_URL` for the harness to its `wss://` address.
- Downloads, once each: the language model and Yumi's voice (Hugging Face), the Whisper model when Taglish is on, Apple's English speech model on macOS 26, and the Vosk model when the Android app is built.

## If something goes wrong

| What you see | What to do |
|---|---|
| Yumi asks for Accessibility or Screen Recording again after a rebuild | Set up `Signing.local.xcconfig` (path 1, step 1) and rebuild. A build signed ad hoc changes its signature every time, so macOS forgets it. |
| The status line stays on "Yumi is getting ready" | Run `npm install` in `protocol/` and `harness/`, and check that `node --version` in a new terminal shows 24 or later. Yumi finds `node` through your login shell. |
| An error that the protocol folder does not exist | The app was moved away from its checkout. Rebuild from the checkout, or set `YUMI_REPO_ROOT` to it. |
| Yumi says the model failed to load | Start the model server (path 2, step 2) and check `curl http://127.0.0.1:8080/health`. |
| Yumi shows "I couldn't start my voice" | Run `mac/scripts/fetch-voice-model.sh`, then choose "Try again". If the files are there, close other heavy apps first. |
| "Hey Yumi" does nothing | Check the wake word is on in Settings and Yumi has the microphone, or hold ⌥Space instead. |
| Every step takes minutes with the real model | Close other heavy apps; the model needs about 9 GB of free memory. |
| The phone says the pairing code expired | Choose "Pair your phone…" again; a code lasts 5 minutes. |
| You want to start the permissions over | `tccutil reset All <bundle identifier>`, using the bundle identifier from your signing settings. |

To see what Yumi is doing, stream its log:

```sh
/usr/bin/log stream --level info --predicate 'subsystem == "ph.appbuilders.yumi"'
```
