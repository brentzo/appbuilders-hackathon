---
id: SPEC-12
title: iPhone companion
priority: p2
devices: [iphone]
status: draft
tags: [spec, p2, iphone, bridge]
---

# SPEC-12 iPhone companion

## Summary

The iPhone app comes after Android works end to end.
iOS does not let apps control other apps, so the iPhone is a voice remote and a limited set of tools, not a second full companion.

## Requirements

1. The user can speak a goal in our iPhone app. It is transcribed on the device and sent to the Mac.
2. Speech recognition is forced on-device. If there is no on-device model for the language, it fails rather than going to the cloud.
3. The iPhone offers only tools iOS allows our app: location, photos the user picks, calendar, contacts, and alarms through AlarmKit or a Shortcut.
4. Commands from the Mac wake the app through a push notification. The user may need to open the app to run them.
5. Risky actions and permission requests follow [SPEC-07](07-safety.md) and [SPEC-11](11-user-facing-errors.md).

## Scenarios

```gherkin
@p2 @iphone
Feature: iPhone companion

  Scenario: Voice remote for the Mac
    Given the iPhone and Mac are paired
    When the user says in the iPhone app "export my Keynote deck as a PDF"
    And confirms the goal
    Then the goal is sent to the Mac
    And a cursor spawns on the Mac and does it
    And the iPhone says "Done. Your deck is exported as a PDF on your Mac."

  Scenario: Mac asks the iPhone for data while the app is closed
    Given the iPhone app is closed
    When the Mac asks for the iPhone's location
    Then the iPhone shows a notification "Your Mac wants your location. Tap to share."
    And the location is sent after the user taps it

  Scenario: Unsupported request
    Given the user asks the Mac to "tap through Instagram on my iPhone"
    Then the Mac says "I can't control other apps on an iPhone. Apple doesn't allow it. I can do this on your Android phone instead."
    And shows "Use Android" and "Cancel" buttons
```
