---
id: OBJ-15
title: Mac voice intake
product: mac
assignee: Patrick
touches: []
specs: [SPEC-01]
status: in-progress
priority: p0
depends-on: [OBJ-14]
integrates-with: [OBJ-11]
tags: [objective, p0, mac, voice]
---

# OBJ-15 Mac voice intake

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Voice is how users give Yumi goals.
This objective makes push-to-talk work end to end on the Mac: capture audio, transcribe it on the device, and hand the text to the harness.
Audio never leaves the Mac, and the native recognizer can never fall back to the cloud.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), requirements 1-3, 8, 9, and the "Push-to-talk on the Mac", "Taglish goal is transcribed locally", and "Audio stays on the device" scenarios.
- [OBJ-11](OBJ-11-whisper-bake-off.md) results (Jepoy), when available: which Whisper option and runtime to use on the Mac. Do not wait for them; start with the default below.
- [SPEC-11](../specs/11-user-facing-errors.md), "Didn't catch speech".

## Tasks

- [x] **OBJ-15.1** Global push-to-talk: hold the shortcut from settings to record, release to stop. Works from any app.
- [x] **OBJ-15.2** Show the listening indicator whenever the microphone is on, and only then.
- [x] **OBJ-15.3** Integrate Whisper, loading the model once and keeping it ready. Start with large-v3-turbo on WhisperKit, behind a setting, and switch to OBJ-11's choice when it lands.
- [x] **OBJ-15.4** Integrate the native recognizer forced on-device: `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`, or SpeechAnalyzer on macOS 26. If on-device recognition is unavailable for the language, it must fail, never use the cloud.
- [ ] **OBJ-15.5** Choose which recognizer runs: decide and document a rule (for example, a "I speak Taglish" setting that always uses Whisper, otherwise native first with Whisper as fallback). Record the decision in SPEC-01.
- [x] **OBJ-15.6** Send the transcript to the harness over RPC as a new goal (`submitGoal`), tagged with the source device.
- [x] **OBJ-15.7** Handle silence or unusable audio with the "Didn't catch speech" copy and its "Try again" and "Type instead" buttons, including a small text box for typing a goal.
- [x] **OBJ-15.8** Verify no network traffic carries audio while speaking a goal (watch traffic during the test) and record how it was checked.

## Expectations

- [ ] SPEC-01 scenarios pass: "Push-to-talk on the Mac", "Taglish goal is transcribed locally", "Audio stays on the device".
- [x] The native recognizer never sends audio to Apple's servers, verified by the forced on-device setting and the traffic check.
- [x] Time from releasing the shortcut to the transcript is measured and written in the Outcome.

## Expected outcomes

- Push-to-talk, both recognizers, the recognizer rule, the typed-goal fallback, and the `submitGoal` RPC call.

## Out of scope

- The wake word: [OBJ-16](OBJ-16-mac-wake-word.md).
- Repeating the goal back and confirming: [OBJ-17](OBJ-17-goal-confirmation.md).

## Outcome

- **Result:** In progress. Push-to-talk works end to end with both recognizers, and spoken answers after the repeat-back work too. Left:
  - OBJ-15.5 asks to record the recognizer rule in SPEC-01, which was outside this brief's scope (mac/ and this file only). The rule is below, under Decisions.
  - The SPEC-01 scenarios expectation needs Patrick's hand check with a real voice and keyboard (below).
- **Delivered:**
  - `mac/Yumi/Voice/`:
    - `PushToTalkHotKey`: a Carbon hot key that follows the settings shortcut.
    - `VoiceIntake`: push-to-talk, the listening indicator, `submitGoal`, "Didn't catch speech", and `listenForReply` for OBJ-17.
    - `Recognition` (microphone capture, `SFSpeechRecognizer` forced on-device) and `AnalyzerRecognition` (SpeechAnalyzer on macOS 26).
    - `WhisperRecognition` (WhisperKit) and `RecognizerRule` (the rule, plus a session that feeds every recognizer and falls back).
    - `SpeechEndpoint` (end of a hands-free answer) and `TypeGoalWindow` ("Type instead").
  - WhisperKit 1.1.1 as a Swift package. `Package.resolved` is committed.
  - Settings: "I speak Taglish". Info.plist: `NSSpeechRecognitionUsageDescription`.
  - "Type instead" opens the typed-goal box on any error that offers it. "Try again" on "Didn't catch speech" closes the error.
  - The menu says "Yumi is listening" while the microphone is on.
  - VoiceIntake is `harness.confirmation.listener`, so the repeat-back and the approval cards hear spoken answers.
  - Debug test aids: `-YumiVoiceFile` and `-YumiReplyFile` play a recording in place of the microphone. The distributed notification `ph.appbuilders.yumi.debug.pushToTalk` (`press` or `release`) holds push-to-talk.
  - Tests: `mac/YumiTests/VoiceIntakeTests.swift`.
- **Commits:**
  - `2845ce4 docs(objectives): start OBJ-15`
  - `f513103 feat(mac): push-to-talk with the on-device recognizer, sending the goal to the harness`
  - `ba2fa3d feat(mac): add Whisper large-v3-turbo through WhisperKit, and the recognizer rule with an "I speak Taglish" setting`
  - `5674bde feat(mac): listen for the spoken answer after the repeat-back, with the main cursor as the listening indicator`
  - `1965f9b docs(mac): document voice intake`
  - `3d5b954 docs(objectives): record the OBJ-15 outcome so far`
  - `d140940 fix(mac): let other hot keys through the push-to-talk handler`
  - `docs(objectives): update the OBJ-15 outcome after the rebase` (this commit)
- **Expectations:**
  - "Push-to-talk on the Mac", live against the mock harness:
    - Holding ⌥Space (synthetic key events) turned the microphone on (the macOS microphone indicator showed), with the listening cursor next to the pointer.
    - Releasing it transcribed, and the mock received `submitGoal` with `originDeviceId` "mac-local".
    - A recording through the same path ("Export my keynote deck as a PDF and send it to Anna.") reached the mock the same way.
    - Not checked with a physical key and a real voice; see the hand check.
  - "Taglish goal is transcribed locally":
    - With "I speak Taglish" on, the goal was transcribed with Whisper on the Mac, and the log says "Transcribed with whisper".
    - The only Taglish audio available was the English system voice reading the sentence, which came out as "Pekinap young latest now resume co and send it to Anna."
    - A real speaker is needed. The English repeat-back is the harness's job.
  - "Audio stays on the device", and the native recognizer never sends audio to Apple's servers:
    - It is forced by construction: SpeechAnalyzer always runs on the device, `requiresOnDeviceRecognition = true` on macOS 15, and Whisper runs in process.
    - Traffic check: per-process network byte counters from `nettop`, compared before and after transcribing a 16-second recording.
    - Native: Yumi had no network traffic at all. Everything else on the Mac sent 12.6 KB out in total (mobileassetd 6.1 KB, nsurlsessiond 3.2 KB, the netbird VPN 3.2 KB), less than any encoding of 16 s of speech (over 30 KB even at 16 kbps).
    - Whisper, twice: Yumi had no network traffic either time. In the first run, nsurlsessiond downloaded 15 MB, a background download, and sent 175 KB out with it. In the second run it sent 15 KB.
    - A packet capture needs root, so it was not done.
  - Release to transcript:
    - Apple's recognizer: 169 to 365 ms.
    - Whisper: 1.6 s for a 3-second goal, and 1.8 s for a 16-second one (3.7 s on the first run after launch).
    - Whisper first load: 6 minutes (download and Core ML compile). After that, 15 to 17 s at each launch.
  - Mac tests: 102 tests in 19 suites pass, rebased on main with OBJ-17, OBJ-40, and OBJ-35. `verify.py` passes. `aSpokenAnswerReachesTheHarness` runs the real `GoalConfirmation` with `VoiceIntake` as its listener, and "Yes, go ahead." is transcribed and sent as the spoken answer.
- **Not verified:**
  - The hand check for Patrick, on a build where Yumi is allowed the microphone:
    1. In another app, hold ⌥Space, say "export my Keynote deck as a PDF", and release.
       Expect the cursor next to the pointer in its listening state and "Yumi is listening" while held, then the repeat-back spoken.
    2. Say "yes" right after the repeat-back. Expect the harness to get the spoken answer.
    3. Hold and release without speaking. Expect "Didn't catch speech"; "Type instead" opens the box, and Send submits the typed goal.
    4. In settings, turn on "I speak Taglish", wait for Whisper (6 minutes the first time, logged as "Whisper ready"), and say "pakihanap yung latest na resume ko and send it to Ana".
  - The silence thresholds for hands-free answers are only unit-tested, not tuned with a live microphone in a real room.
  - The real harness does not serve `submitGoal` yet. Everything here ran against the mock.
  - The macOS 15 path (`SFSpeechRecognizer`) did not run: this Mac has macOS 26. It needs Siri or Dictation turned on, and fails otherwise ("Siri and Dictation are disabled"), which falls back to Whisper if loaded.
  - Whisper's memory next to Qwen3.5-9B was not measured. OBJ-11 measures it.
  - Ad hoc builds are asked for the microphone again after every rebuild. While that prompt is open, push-to-talk does nothing.
  - Pressing push-to-talk while a task's main cursor is on screen reuses that cursor for listening.
  - Pressing ⌥Space while a task runs may count as the user taking over (OBJ-35's take-over watcher) and pause the task. Not tried.
  - The stop shortcut (OBJ-35) and push-to-talk now each handle only their own hot key; pressing both was not tried live.
- **Decisions and deviations:**
  - The recognizer rule (OBJ-15.5), for SPEC-01:
    - "I speak Taglish" (off by default) transcribes every goal with Whisper, with Apple's recognizer as the fallback.
    - Off: Apple's on-device recognizer first, with Whisper as the fallback if it is loaded.
    - Whisper loads when the setting is on and stays loaded.
    - A fallback is used only when the first recognizer fails, never when it heard silence.
    - Both are fed the same audio while it is recorded, so a fallback never asks the user to repeat.
  - On macOS 26 the native recognizer is SpeechAnalyzer, not `SFSpeechRecognizer`. On this Mac `SFSpeechRecognizer` on-device refused to run with Dictation off, and SpeechAnalyzer did not need it.
  - Whisper is the quantized large-v3-turbo build (632 MB) so it fits next to Qwen3.5-9B. The language is detected, not forced.
  - "Try again" on "Didn't catch speech" only closes the error: with push-to-talk, trying again is holding the shortcut again.
  - The listening indicator is the main cursor, the same one goal confirmation uses next, so one cursor goes from listening to thinking to the repeat-back.
  - Copy I wrote, for Patrick to review:
    - `NSSpeechRecognitionUsageDescription`: "Yumi turns what you say into text on this Mac. Your voice never leaves it." (shown on macOS 15 only).
    - The setting: "I speak Taglish" / "Yumi understands Tagalog and English mixed. It takes a moment longer."
    - The typed-goal box: title "Type your goal", "What should I do?", placeholder "For example: export my Keynote deck as a PDF", and the buttons "Cancel" and "Send".
- **For the next objectives:**
  - The wake word (OBJ-16) can start the same path: `VoiceIntake.startListening()`, then `stopListening()` when the speech ends (`SpeechEndpoint` finds that).
  - Anything that needs a spoken answer uses `ReplyListening` (`VoiceIntake.listenForReply`).
  - When OBJ-11 picks the Mac model, change `WhisperModel.modelName`.
