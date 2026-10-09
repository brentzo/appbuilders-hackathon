---
id: SPEC-01
title: Voice intake and confirmation
priority: p0
devices: [mac, android]
status: draft
tags: [spec, p0, voice, ux, mac, android]
---

# SPEC-01 Voice intake and confirmation

## Summary

The user speaks a goal on the Mac or the phone.
Yumi transcribes it on the device, repeats it back in its own words, and waits for a yes or a correction before doing anything.

## Requirements

1. All speech-to-text runs on the device. Audio never leaves the device it was recorded on.
2. English commands may use the native on-device recognizer. It must be forced on-device, and must fail rather than fall back to a cloud service.
3. Taglish and long dictation use Whisper on the Mac. On Android, Whisper comes with [SPEC-10](10-android-companion.md) Part B (p1). Until then the phone understands English only, and other languages get the "Language not supported on this phone" error from [SPEC-11](11-user-facing-errors.md).
4. Before any work starts, Yumi repeats the goal back by voice and on screen, unless Auto mode is on (requirement 14). On Android in p0 there is no model to restate it, so the phone uses fixed templates ([SPEC-10](10-android-companion.md) requirement 8).
5. The user can confirm, correct, or cancel by voice or with a button.
6. A correction replaces the goal and is repeated back again.
7. The confirmed goal is stored on the task record as `confirmedGoal`, separate from the raw transcript.
8. An on-device indicator is visible whenever the microphone is listening.
9. The user can start speaking in two ways, on both devices:
   - **Wake word:** saying "Hey Yumi" starts listening, hands-free.
   - **Push-to-talk:** a global keyboard shortcut on the Mac, or the mic button in the phone app.
10. Wake word detection runs on the device with a small dedicated detector (see "Wake word detector" below). Audio before the wake word is never transcribed, stored, or sent anywhere. For the hackathon demo, the Mac instead spots "Hey Yumi" with its on-device speech recognizer, and the phone with an offline Vosk recognizer limited to that phrase until OBJ-12's model is ready (see Decisions): what it hears before the wake word is checked for the phrase and thrown away at once, never stored or sent.
11. The user can turn the wake word off on each device. Push-to-talk always works.
12. On Android, wake word listening in the background runs inside the foreground service from [SPEC-10](10-android-companion.md), with its persistent notification.
13. On the Mac, the recognizer follows an "I speak Taglish" setting, off by default:
    - **On:** Whisper transcribes every goal, with the native on-device recognizer as the fallback.
    - **Off:** the native on-device recognizer goes first, with Whisper as the fallback once it is loaded.
    - A fallback is used only when the first recognizer fails, never when it heard silence.
14. On the Mac, an "Auto mode" setting, off by default, skips the repeat-back: the goal starts right away, Yumi shows what it heard on screen and says a short acknowledgement such as "On it." Approvals for sends and deletes ([SPEC-07](07-safety.md)) still always ask.

## Scenarios

```gherkin
@p0 @voice @mac @android
Feature: Listening modes

  Scenario: Wake word starts listening
    Given the wake word is on
    And Yumi is idle
    When the user says "Hey Yumi"
    Then the listening indicator turns on
    And Yumi plays a short listening sound

  Scenario: Push-to-talk on the Mac
    Given Yumi is idle on the Mac
    When the user holds the push-to-talk shortcut and speaks a goal
    Then the goal is transcribed when the user releases the shortcut

  Scenario: Push-to-talk on the phone
    Given the Yumi app is open on the Android phone
    When the user taps the mic button and speaks a goal
    Then the goal is transcribed when the user stops speaking

  Scenario: Wake word turned off
    Given the user turned the wake word off on the Mac
    When the user says "Hey Yumi"
    Then nothing happens
    And push-to-talk still works

  Scenario: Speech before the wake word is ignored
    Given the wake word is on
    When the user says "remind me to call Ana" and then "Hey Yumi"
    Then "remind me to call Ana" is not transcribed or stored
```

```gherkin
@p0 @voice @mac
Feature: Voice intake and confirmation

  Scenario: User gives a goal and confirms it
    Given Yumi is idle on the Mac
    When the user says "rename the invoices in Downloads by date"
    Then a cursor spawns near the user's pointer
    And Yumi says "You want me to rename the invoices in your Downloads folder by date. Should I go ahead?"
    When the user says "yes"
    Then a task is created with that confirmed goal
    And the task status is "planning"

  Scenario: User corrects the goal
    Given Yumi has repeated back a goal
    When the user says "no, only the ones from October"
    Then Yumi says "Got it. You want me to rename only the October invoices in your Downloads folder by date. Should I go ahead?"
    And no task work has started

  Scenario: User cancels before work starts
    Given Yumi has repeated back a goal
    When the user says "never mind"
    Then Yumi says "Okay, I won't do anything."
    And the cursor fades out
    And no task is created

  Scenario: Taglish goal is transcribed locally
    Given Yumi is idle on the Mac
    When the user says "pakihanap yung latest na resume ko and send it to Ana"
    Then the goal is transcribed with Whisper on the Mac
    And Yumi repeats the goal back in English

  Scenario: Audio stays on the device
    Given network traffic from the Mac is being recorded
    When the user speaks a goal
    Then no audio leaves the Mac
```

```gherkin
@p0 @voice @android
Feature: Voice intake on Android

  Scenario: User speaks a goal in the phone app
    Given the Yumi app is open on the Android phone
    When the user taps the mic and says "set an alarm for 6:30 am tomorrow"
    Then the goal is transcribed on the phone
    And the phone says "You want an alarm at 6:30 am tomorrow. Should I set it?"

  Scenario: Native recognizer has no on-device model for the language
    Given the native recognizer has no on-device model for the spoken language
    When the user speaks a goal
    Then the phone shows the "Language not supported on this phone" error from SPEC-11
    And no audio is sent to a cloud recognizer
```

```gherkin
@p1 @voice @android
Feature: Whisper on Android

  Scenario: Taglish on the phone uses Whisper
    Given the phone model and Whisper are loaded (SPEC-10 Part B)
    When the user speaks a Taglish goal
    Then the goal is transcribed with Whisper on the phone
    And no audio is sent to a cloud recognizer
```

## Whisper model options

To be decided during development by testing real Taglish recordings on the Mac (p0) and the 12 GB demo phone (p1, for SPEC-10 Part B).

Sizes are confirmed file sizes from the model repositories (MB is 10^6 bytes), checked in [OBJ-11](../objectives/OBJ-11-whisper-bake-off.md) on 2026-10-09.
whisper.cpp quantized sizes are the q5 files in `ggerganov/whisper.cpp`; WhisperKit sizes are the Core ML folders in `argmaxinc/whisperkit-coreml`.
Results on our Taglish recordings are in [models/whisper/RESULTS.md](../models/whisper/RESULTS.md).

| Option | Params | whisper.cpp size (full / quantized) | WhisperKit size (full / compressed) | Notes |
|---|---|---|---|---|
| small | 244M | 488 MB / 190 MB | 486 MB / 217 MB | Fast everywhere. Too weak for Taglish in OBJ-11: errors changed numbers and nouns |
| medium | 769M | 1,534 MB / 539 MB | 1,530 MB / none | Stronger on Tagalog than small, slower. In OBJ-11 it still got verbs and a stop word wrong |
| large-v3-turbo | 809M | 1,625 MB / 574 MB | 1,638 MB / 646 MB | Large-v3 encoder with a much smaller decoder (4 layers instead of 32). Close to medium speed with near large-v3 accuracy in many languages. Recommended for the Mac by OBJ-11 |
| large-v3 | 1.55B | 3,095 MB / 1,081 MB | 3,090 MB / 948 MB | Most accurate. Probably too slow and heavy next to Qwen3.5-9B on the 16 GB Mac. Tight on the 12 GB phone next to Qwen3.5-4B, so test memory carefully. Not run in OBJ-11: large-v3-turbo was already good enough |
| Tagalog fine-tunes | varies | varies | varies | Community Whisper models fine-tuned on Tagalog. May beat stock models on Taglish. Check license and quality. In OBJ-11, none was published in a format either Mac runtime loads |

Not an option: `distil-whisper` models, which are English only.

Runtimes to test:

- **Mac:** WhisperKit (Core ML, uses the Neural Engine) and whisper.cpp.
- **Android:** whisper.cpp.

How to decide:

1. Record about 20 real Taglish goals from the team, including names, numbers, and app names.
2. Write the correct transcript for each.
3. For each option and runtime, measure word error rate and time from end of speech to transcript.
4. Measure memory while Qwen3.5 is also loaded, since both share the device.
5. Pick the smallest option whose errors do not change what Yumi repeats back.

Mac recommendation from OBJ-11, pending Jepoy's confirmation: **WhisperKit with large-v3-turbo, compressed (`large-v3-v20240930_turbo_632MB`), language forced to Tagalog, for English and Taglish alike.**
It was the smallest option whose errors did not change what Yumi repeats back, took a median 632 ms per Taglish goal and 515 ms per English command, and adds about 0.8 GiB next to Qwen3.5-9B.
Download source and checksums are in [models/manifest.json](../models/manifest.json).

## Wake word detector

Decision: **openWakeWord**, decided 2026-10-09.

| | openWakeWord | Porcupine (Picovoice) |
|---|---|---|
| Weight | Light: one Raspberry Pi 3 core runs 15-20 models in real time | Lighter: ~1 MB model, under 4% of one Raspberry Pi 3 core |
| Fully offline | Yes | No: the account key is checked online every time the engine starts |
| Cost | Free, open source | Paid: the free tier was reported discontinued on 2026-06-30 |
| Custom "Hey Yumi" | Train our own model from synthetic speech | Type the phrase in Picovoice's web console |

Porcupine is lighter, but on a Mac or a modern phone both use a tiny fraction of one core, so the difference does not matter.
Porcupine's online key check breaks the fully local promise, and the app would not start listening without internet.

Work this needs:

| Step | Estimate |
|---|---|
| 1. Train a basic "Hey Yumi" model with openWakeWord's simple Colab notebook | Under 1 hour, mostly unattended |
| 2. Run it in the Swift helper and the Android app with ONNX Runtime, porting openWakeWord's small audio feature step (a community C++ port may help) | A few hours |
| 3. Test false triggers and misses (below) | 1-2 hours |

- Training happens once, before the demo. At runtime the model runs fully on the device.
- Use synthetic speech in several voices and accents, including Filipino-accented English. Retrain with more accent variety if misses are high.
- The full training notebook makes better models but takes hours and more ML setup. Skip it for the hackathon.
- **False triggers:** play an hour of everyday Taglish talk, TV, and music, and count wake-ups.
- **Misses:** each teammate says "Hey Yumi" 20 times at different distances.
- **Fallback:** push-to-talk works without the wake word. If the wake word is not reliable by demo day, demo with push-to-talk.

## Decisions

- **Android in p0 has no Whisper.** It uses Android's on-device recognizer, English only, and shows an error for other languages. Whisper on the phone is p1, with SPEC-10 Part B. This follows SPEC-10 where the two specs disagreed. Decided 2026-10-09.
- **The phone's repeat-back in p0 uses fixed templates,** defined in SPEC-10 requirement 8. Decided 2026-10-09.
- **The Mac picks its recognizer with an "I speak Taglish" setting** (requirement 13). Whisper handles Tagalog and English mixed, and the native recognizer is faster for English commands, so the user who speaks Taglish says so once instead of Yumi guessing per goal. Decided 2026-10-09.
- **Confirming a goal is a setting.** Confirmation stays on by default; "Auto mode" (requirement 14) skips the repeat-back for users who find it slows them down. Safety approvals are unaffected. Decided 2026-10-10 by Brent.
- **"Hey Yumi" on the Mac uses the on-device speech recognizer for the demo,** because there is no time to train the openWakeWord model before submission. Sound-alikes such as "hey you me" or "hey yummy" are accepted on purpose. The phone also wakes on "Hey Yumi", never "Hey Jarvis": Jepoy's trained openWakeWord model ([OBJ-12](../objectives/OBJ-12-hey-yumi-wake-word.md)) replaces the stand-in when it is ready, and until then the phone spots "Hey Yumi" with Vosk, an offline recognizer limited to that phrase ([OBJ-59](../objectives/OBJ-59-android-hey-yumi-vosk.md)). Decided 2026-10-10 by Brent.

## Open questions

- Which Whisper option and runtime should the Mac use? OBJ-11 recommends WhisperKit with `large-v3-v20240930_turbo_632MB` and Tagalog forced (see "How to decide"). Waiting for Jepoy's confirmation.
- Which Whisper option should Android use with whisper.cpp? Decide with the p1 phone test in OBJ-28 after SPEC-10 Part B is ready.
- Confirm openWakeWord's false-trigger rate for "Hey Yumi" is acceptable, using the test in "Wake word detector".
