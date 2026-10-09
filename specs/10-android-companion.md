---
id: SPEC-10
title: Android companion
priority: p0
devices: [android]
status: draft
tags: [spec, p0, gui, harness, android]
---

# SPEC-10 Android companion

## Summary

Our Android app runs its own model on the phone, controls other apps, offers phone tools to the Mac, and stays connected in the background.
Demo phone: 18 GB RAM, running Qwen3.5-4B (9B to be tested).
Development phone: 8 GB RAM, running 4B or 2B.

## Requirements

1. The model runs fully on the phone through MNN or llama.cpp, chosen after benchmarking with image input.
2. The app controls other apps through an Accessibility Service: read the element tree, tap, swipe, and enter text.
3. The element tree is used first. Screenshots are used only when the tree is not enough.
4. Common jobs use standard Android intents instead of the GUI, for example `AlarmClock.ACTION_SET_ALARM`.
5. A foreground service keeps the bridge connection alive while the app is in the background, with a persistent notification that includes "Stop".
6. Phone tools offered to the Mac at launch: `set_alarm`, `get_location`, `read_recent_photos`, `open_app`, `phone_gui_act`.
7. Each tool asks for its Android permission the first time it is needed, with an explanation of why.
8. Phone UI control stops after 10 steps and returns what it got done.
9. If memory runs short, the app falls back to the next smaller model instead of crashing.

## Scenarios

```gherkin
@p0 @android
Feature: Android companion

  Scenario: Alarm uses an intent, not the GUI
    Given the goal is "set an alarm for 6:30 am"
    When the phone runs it
    Then the alarm is created with the set-alarm intent
    And no taps are made in the Clock app

  Scenario: Control another app through accessibility
    Given the goal is "turn on dark mode in Spotify"
    When the phone runs it
    Then it reads Spotify's element tree
    And taps through to the dark mode setting
    And no screenshot is used when the tree has the needed elements

  Scenario: Screenshot fallback
    Given the target app shows content with no useful element tree
    When the phone needs to act on it
    Then it captures a screenshot and sends it to the phone model

  Scenario: Stays connected in the background
    Given the companion app is in the background
    When the Mac sends a command
    Then the phone receives and runs it within 2 seconds

  Scenario: First-time permission request
    Given the Mac calls get_location for the first time
    Then the phone shows "Your Mac asked for your location. Allow the companion to use your location?"
    And the location is sent only if the user allows it

  Scenario: Memory pressure fallback
    Given the phone is low on memory while loading the 4B model
    Then the app loads the 2B model instead
    And keeps working
```

## Open questions

- Accessibility Service apps face Play Store review limits. Sideload for the hackathon, and decide distribution later.
- Which phone runtime is fastest with image input on the demo phone?
