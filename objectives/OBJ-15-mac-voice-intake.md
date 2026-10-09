---
id: OBJ-15
title: Mac voice intake
product: mac
assignee: Patrick
touches: []
specs: [SPEC-01]
status: todo
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

- [ ] **OBJ-15.1** Global push-to-talk: hold the shortcut from settings to record, release to stop. Works from any app.
- [ ] **OBJ-15.2** Show the listening indicator whenever the microphone is on, and only then.
- [ ] **OBJ-15.3** Integrate Whisper, loading the model once and keeping it ready. Start with large-v3-turbo on WhisperKit, behind a setting, and switch to OBJ-11's choice when it lands.
- [ ] **OBJ-15.4** Integrate the native recognizer forced on-device: `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`, or SpeechAnalyzer on macOS 26. If on-device recognition is unavailable for the language, it must fail, never use the cloud.
- [ ] **OBJ-15.5** Choose which recognizer runs: decide and document a rule (for example, a "I speak Taglish" setting that always uses Whisper, otherwise native first with Whisper as fallback). Record the decision in SPEC-01.
- [ ] **OBJ-15.6** Send the transcript to the harness over RPC as a new goal (`submitGoal`), tagged with the source device.
- [ ] **OBJ-15.7** Handle silence or unusable audio with the "Didn't catch speech" copy and its "Try again" and "Type instead" buttons, including a small text box for typing a goal.
- [ ] **OBJ-15.8** Verify no network traffic carries audio while speaking a goal (watch traffic during the test) and record how it was checked.

## Expectations

- [ ] SPEC-01 scenarios pass: "Push-to-talk on the Mac", "Taglish goal is transcribed locally", "Audio stays on the device".
- [ ] The native recognizer never sends audio to Apple's servers, verified by the forced on-device setting and the traffic check.
- [ ] Time from releasing the shortcut to the transcript is measured and written in the Outcome.

## Expected outcomes

- Push-to-talk, both recognizers, the recognizer rule, the typed-goal fallback, and the `submitGoal` RPC call.

## Out of scope

- The wake word: [OBJ-16](OBJ-16-mac-wake-word.md).
- Repeating the goal back and confirming: [OBJ-17](OBJ-17-goal-confirmation.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
