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
The companion transcribes it on the device, repeats it back in its own words, and waits for a yes or a correction before doing anything.

## Requirements

1. All speech-to-text runs on the device. Audio never leaves the device it was recorded on.
2. English commands may use the native on-device recognizer. It must be forced on-device, and must fail rather than fall back to a cloud service.
3. Taglish and long dictation use Whisper on the device.
4. Before any work starts, the companion repeats the goal back by voice and on screen.
5. The user can confirm, correct, or cancel by voice or with a button.
6. A correction replaces the goal and is repeated back again.
7. The confirmed goal is stored on the task record as `confirmedGoal`, separate from the raw transcript.
8. An on-device indicator is visible whenever the microphone is listening.

## Scenarios

```gherkin
@p0 @voice @mac
Feature: Voice intake and confirmation

  Scenario: User gives a goal and confirms it
    Given the companion is idle on the Mac
    When the user says "rename the invoices in Downloads by date"
    Then a cursor spawns near the user's pointer
    And the companion says "You want me to rename the invoices in your Downloads folder by date. Should I go ahead?"
    When the user says "yes"
    Then a task is created with that confirmed goal
    And the task status is "planning"

  Scenario: User corrects the goal
    Given the companion has repeated back a goal
    When the user says "no, only the ones from October"
    Then the companion says "Got it. You want me to rename only the October invoices in your Downloads folder by date. Should I go ahead?"
    And no task work has started

  Scenario: User cancels before work starts
    Given the companion has repeated back a goal
    When the user says "never mind"
    Then the companion says "Okay, I won't do anything."
    And the cursor fades out
    And no task is created

  Scenario: Taglish goal is transcribed locally
    Given the companion is idle on the Mac
    When the user says "pakihanap yung latest na resume ko and send it to Ana"
    Then the goal is transcribed with Whisper on the Mac
    And the companion repeats the goal back in English

  Scenario: Audio stays on the device
    Given network traffic from the Mac is being recorded
    When the user speaks a goal
    Then no audio leaves the Mac
```

```gherkin
@p0 @voice @android
Feature: Voice intake on Android

  Scenario: User speaks a goal in the phone app
    Given the companion app is open on the Android phone
    When the user taps the mic and says "set an alarm for 6:30 am tomorrow"
    Then the goal is transcribed on the phone
    And the phone says "You want an alarm at 6:30 am tomorrow. Should I set it?"

  Scenario: Native recognizer has no on-device model for the language
    Given the native recognizer has no on-device model for the spoken language
    When the user speaks a goal
    Then the phone transcribes it with Whisper instead
    And no audio is sent to a cloud recognizer
```

## Open questions

- Wake word, push-to-talk, or both?
- Which Whisper size on the Mac and the phone, after testing Taglish recordings?
