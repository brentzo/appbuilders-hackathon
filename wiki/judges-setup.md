# Setup for judges

How to run Yumi on your own machine.
Written 2026-10-10 against `main`.

Yumi runs on the Mac, with an optional Android phone.
All AI runs on your Mac: the language model, speech recognition, and the wake word.
The only network traffic is downloading the models once, and the end-to-end encrypted bridge between the Mac and the phone.

Yumi is a hackathon build, and some parts are still being finished.
[Demo readiness](demo-readiness.md) lists what works end to end and what does not yet.
The paths below say plainly what you will and will not see.

## Choose a path

| Path | Needs | Time | What you see |
|---|---|---|---|
| [1. The Mac app with the scripted harness](#path-1-the-mac-app-with-the-scripted-harness) | A Mac with Xcode | About 15 minutes | The full interface: menu bar, voice, the cat cursors, the repeat-back, window tiling, and error messages, driven by a scripted stand-in for the AI |
| [2. The real harness and model](#path-2-the-real-harness-and-model) | Path 1, plus Python and about 10 GB of free memory | About 30 minutes, mostly the model download | The local model choosing real actions, and the real harness behind the Mac app |
| [3. The Android app](#path-3-the-android-app) | An Android 12+ phone and the Android SDK | About 20 minutes | The phone app: setup, push-to-talk, and the wake word, without the link to the Mac yet |
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
Path 3 needs JDK 17 or later and the Android SDK with platform 36, which Android Studio installs.

## Get the code

```sh
git clone https://github.com/brentzo/appbuilders-hackathon.git
cd appbuilders-hackathon
(cd protocol && npm install)
(cd harness && npm install)
```

The Mac app starts the harness from this checkout, so keep it where it is after building.

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

2. Build and open it:

   ```sh
   xcodebuild -project Yumi.xcodeproj -scheme Yumi -configuration Release -derivedDataPath build build
   open build/Build/Products/Release/Yumi.app --args -YumiMockHarness YES
   ```

   Yumi appears in the menu bar as a cat; it has no Dock icon.

3. Follow the setup window.
   It asks for Microphone, Accessibility, and Screen Recording, which Yumi needs to hear you, control apps, and see the screen.

4. Try it:
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

The wake word is on by default, but its model is not in git.
Fetch it once:

```sh
sh mac/scripts/fetch-wake-word-models.sh
```

The custom "Hey Yumi" model is still being trained, so the stand-in listens for **"Hey Jarvis"**.
Without the models, push-to-talk still works.

### Taglish

Turn on "I speak Taglish" in Settings to use Whisper instead of Apple's on-device recognizer.
Yumi downloads the Whisper model (about 630 MB) the first time.

## Path 2: the real harness and model

The harness is the part that plans and acts.
It talks to Qwen3.5-9B, running on your Mac through mlx-vlm.
Nothing leaves the Mac: the model server listens on `127.0.0.1` only.

1. Install the model server in its own Python environment:

   ```sh
   python3 -m venv ~/.venvs/yumi-model
   ~/.venvs/yumi-model/bin/pip install mlx-vlm==0.7.6
   ```

2. Start it, and leave it running in its own terminal:

   ```sh
   ~/.venvs/yumi-model/bin/mlx_vlm.server --model mlx-community/Qwen3.5-9B-4bit --host 127.0.0.1 --port 8080
   ```

   The first start downloads the model from Hugging Face, which takes a while.

3. Check that it is up, and that the harness gets a valid action back from it:

   ```sh
   curl http://127.0.0.1:8080/health
   cd harness && npm run model:check
   ```

   `model:check` sends a real Keynote step and prints the action the model chose, already checked against the protocol.

4. Open Yumi without the mock flag, and it starts the real harness:

   ```sh
   open mac/build/Build/Products/Release/Yumi.app
   ```

   The menu's status line says "Yumi is getting ready" until the harness answers.

What works with the real harness today:

- The harness starts, connects to the app, keeps its task history, and connects to the bridge.
- "Pair your phone…" in the menu shows a pairing code.
- `npm run model:check` and the harness tests show the model's actions and the planner.

What does not work yet: a spoken goal does not start a task with the real harness.
The harness side of goal confirmation ([OBJ-17](../objectives/OBJ-17-goal-confirmation.md)) and the step that drives other apps ([OBJ-36](../objectives/OBJ-36-gui-act-sub-agent.md)) are still being built.
Use path 1 to see the whole flow.

The model needs about 9 GB while it runs.
Close other heavy apps, such as the Android emulator or a large build, or every step slows to minutes.

## Path 3: the Android app

The Android app is the phone half of Yumi.
Today it has setup, the home screen, settings, the background service, push-to-talk, and the wake word, all on the phone.
Its connection to the Mac is still being built, so a goal stays on the phone, and Settings lists every stand-in in the build.
As on the Mac, the wake word is the stand-in **"Hey Jarvis"**; its model ships inside the app.

1. Tell Gradle where the Android SDK is, from `android/`:

   ```sh
   cd android
   echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
   ```

2. Build it:

   ```sh
   ./gradlew assembleDebug
   ```

   The app is `app/build/outputs/apk/debug/app-debug.apk`.

3. Install it, either way:
   - Over USB, with USB debugging on: `./gradlew installDebug`.
   - Without a computer: copy the APK to the phone, open it in the Files app, and allow "Install unknown apps" when Android asks.

4. Follow the in-app setup: microphone, notifications, and battery use.

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

- The language model, speech recognition, and the wake word run on your Mac.
  Audio stays in memory and is dropped once transcribed.
- The model server listens on `127.0.0.1` only.
- The Mac and phone talk through our relay at `wss://yumibridge.studiokova.co`.
  Every message is encrypted end to end and signed, so the relay can route messages but never read them ([SPEC-08](../specs/08-device-bridge.md)).
  To use your own relay, deploy it from `bridge/` behind TLS (see its README) and set `YUMI_BRIDGE_URL` for the harness to its `wss://` address.
- Downloads: the language model (Hugging Face), the Whisper model when Taglish is on, and the wake word models (GitHub).

## If something goes wrong

| What you see | What to do |
|---|---|
| Yumi asks for Accessibility or Screen Recording again after a rebuild | Set up `Signing.local.xcconfig` (path 1, step 1) and rebuild. A build signed ad hoc changes its signature every time, so macOS forgets it. |
| The status line stays on "Yumi is getting ready" | Run `npm install` in `protocol/` and `harness/`, and check that `node --version` in a new terminal shows 24 or later. Yumi finds `node` through your login shell. |
| An error that the protocol folder does not exist | The app was moved away from its checkout. Rebuild from the checkout, or set `YUMI_REPO_ROOT` to it. |
| The wake word does nothing | Run `mac/scripts/fetch-wake-word-models.sh`, and say "Hey Jarvis". |
| Every step takes minutes with the real model | Close other heavy apps; the model needs about 9 GB of free memory. |
| You want to start the permissions over | `tccutil reset All <bundle identifier>`, using the bundle identifier from your signing settings. |

To see what Yumi is doing, stream its log:

```sh
/usr/bin/log stream --level info --predicate 'subsystem == "ph.appbuilders.yumi"'
```
