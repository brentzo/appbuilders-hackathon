---
id: SPEC-10
title: Yumi on Android
priority: p0
devices: [android]
status: draft
tags: [spec, p0, p1, gui, harness, android]
---

# SPEC-10 Yumi on Android

## Summary

Our Android app is built in two parts.

- **Part A (p0), tool host and voice remote.** No model. It listens on the device, offers phone tools to the Mac, runs a few phone-only jobs through intents, and delegates everything else to the Mac ([SPEC-09](09-cross-device-routing.md)).
- **Part B (p1), phone brain.** A fixed local model plans phone goals, controls other apps through accessibility, and takes over as brain when the Mac is unreachable.

Demo phone: 12 GB RAM (advertised as "12 GB + 6 GB", but the extra 6 GB is extended RAM: storage used as slow swap, not real memory). Development phone: 8 GB RAM, Part A only.

## Requirements

### Part A (p0)

1. Speech is transcribed with Android's on-device recognizer (`createOnDeviceSpeechRecognizer`, Android 12+), English only. It must fail rather than fall back to a cloud recognizer.
2. Phone-only goals in the p0 rule run through standard intents, never the GUI: `AlarmClock.ACTION_SET_ALARM`, `AlarmClock.ACTION_SET_TIMER`, and the app's launch intent.
3. Phone tools offered to the Mac: `set_alarm`, `set_timer`, `open_app`.
4. A foreground service keeps the bridge connected in the background.
   - Service type `specialUse` or `connectedDevice`. Not `dataSync`, which has a daily time limit on Android 15.
   - Its persistent notification has a **Stop** button.
5. First-run setup asks to ignore battery optimization, so Doze and phone-maker battery savers do not drop the connection.
6. Each tool asks for its Android permission the first time it is needed, with a reason. If the app is in the background, it posts a notification that opens the app to ask, since Android cannot show a permission dialog from the background.
7. While a delegated goal runs, the app shows progress and Stop, as in [SPEC-09](09-cross-device-routing.md).

8. Part A confirms goals without a model, using fixed templates. Nothing runs and nothing is sent to the Mac before the user confirms.
   - Phone-only goals fill a sentence from the rule's parsed fields: "You want an alarm at 6:30 am tomorrow. Should I set it?", "You want a 10-minute timer. Should I start it?", "You want me to open Spotify. Should I open it?"
   - If the rule matches a phone-only goal but cannot parse its details (for example, no clear time), the goal is delegated to the Mac like any other goal. The Mac can still call the phone's tools.
   - Delegated goals echo the transcript: "You said: "export my Keynote deck as a PDF". Should I send it to your Mac?" The transcript is shown on screen and can be edited by tapping it.
   - Replies are matched against short fixed lists. "Yes", "go ahead", "do it", "send it", and "okay" confirm. "No", "cancel", "never mind", and "stop" cancel. Anything else is treated as a corrected goal and repeated back with the same templates. The buttons always work.
   - The confirmed text is what is delegated. The Mac does not confirm it again ([SPEC-09](09-cross-device-routing.md) requirement 5).

### Part B (p1)

9. The phone runs one fixed model, around 8 GB class (Qwen3.5-9B at 4-bit, about 6 GB plus context), through MNN or llama.cpp, chosen after benchmarking. It runs on the 18 GB demo phone only. There is no automatic switch to a smaller model.
10. The model replaces the p0 rule for deciding phone versus Mac, and is the brain when the Mac is unreachable.
11. Speech uses Whisper on the phone (whisper.cpp), so Taglish works on the phone too.
12. The app controls other apps through an Accessibility Service: read the element tree, tap, swipe, and enter text.
13. The element tree is used first. Screenshots (`takeScreenshot`, Android 11+, about one per second at most) only when the tree is not enough.
14. Phone UI control stops after 10 steps and returns what it got done.
15. Extra phone tools: `get_location`, `read_recent_photos`, `phone_gui_act`.
16. Before loading, the app checks free memory. If the model will not fit, it shows the "Model failed to load" error from [SPEC-11](11-user-facing-errors.md) instead of loading and being killed.

## Setup checklist

- Sideload the app. Accessibility Service apps face Play Store review limits.
- Android 13+: App info, then the menu, then "Allow restricted settings". Without it the Accessibility Service switch is greyed out for a sideloaded app (Part B).
- Turn on the Accessibility Service (Part B).
- Allow ignoring battery optimization.
- Test the background connection with the screen off.

## Scenarios

```gherkin
@p0 @android
Feature: Android tool host

  Scenario: Alarm uses an intent, not the GUI
    Given the goal is "set an alarm for 6:30 am"
    When the phone runs it
    Then the alarm is created with the set-alarm intent
    And no taps are made in the Clock app

  Scenario: Phone-only goal is repeated back with a template
    Given the Yumi app is open on the phone
    When the user says "set a timer for 10 minutes"
    Then the phone says "You want a 10-minute timer. Should I start it?"
    And nothing runs until the user confirms

  Scenario: Delegated goal echoes the transcript
    Given the Yumi app is open on the phone
    When the user says "export my Keynote deck as a PDF"
    Then the phone says "You said: "export my Keynote deck as a PDF". Should I send it to your Mac?"
    And the transcript is shown on screen and can be edited
    When the user says "yes"
    Then the goal is sent to the Mac

  Scenario: Reply that is not yes or no is a correction
    Given the phone repeated back a delegated goal
    When the user says "actually export it as images"
    Then the phone says "You said: "actually export it as images". Should I send it to your Mac?"

  Scenario: Rule cannot parse the details
    Given the Yumi app is open on the phone
    When the user says "set an alarm for after lunch"
    Then the goal is treated as a delegated goal
    And the phone says "You said: "set an alarm for after lunch". Should I send it to your Mac?"

  Scenario: English speech is transcribed on the phone
    Given the Yumi app is open on the phone
    When the user taps the mic and says "set a timer for 10 minutes"
    Then the goal is transcribed by the on-device recognizer
    And no audio is sent to a cloud recognizer

  Scenario: No on-device model for the language
    Given the on-device recognizer has no model for the spoken language
    When the user speaks a goal
    Then the phone shows the "Language not supported on this phone" error from SPEC-11
    And no audio is sent to a cloud recognizer

  Scenario: Stays connected in the background with the screen off
    Given the Yumi app is in the background and the screen is off
    When the Mac calls the phone tool "set_alarm"
    Then the phone runs it within 2 seconds

  Scenario: Permission asked from the background
    Given the app is in the background
    When a tool needs a permission for the first time
    Then the phone posts a notification explaining why
    And tapping it opens the app and shows the Android permission dialog
```

```gherkin
@p1 @android
Feature: Android phone brain

  Scenario: Control another app through accessibility
    Given the goal is "turn on battery saver"
    When the phone runs it
    Then it reads the Settings element tree
    And taps through to battery saver
    And no screenshot is used when the tree has the needed elements

  Scenario: Screenshot fallback
    Given the target app shows content with no useful element tree
    When the phone needs to act on it
    Then it captures a screenshot and sends it to the phone model

  Scenario: Taglish on the phone
    Given the phone model is loaded
    When the user says "pakigising yung Mac ko"
    Then the goal is transcribed with Whisper on the phone

  Scenario: Model does not fit in memory
    Given the phone does not have enough free memory for the model
    When the app tries to load it
    Then it does not load the model
    And shows the "Model failed to load" error from SPEC-11
```

## Open questions

- Which phone runtime is fastest with image input on the demo phone?
- How do we tell the user's own touches from the app's accessibility gestures, to pause on touch ([SPEC-06](06-user-control.md))? Prototype before committing.
