---
id: SPEC-12
title: Yumi on iPhone
priority: p2
devices: [iphone]
status: draft
tags: [spec, p2, iphone, bridge]
---

# SPEC-12 Yumi on iPhone

## Summary

The iPhone app is a stretch goal, built after the Mac and Android work end to end.
iOS does not let apps control other apps or stay connected in the background, so the iPhone is a voice remote and a tool provider with a small set of tools, not a second full Yumi.
Because every phone is a tool provider ([SPEC-09](09-cross-device-routing.md)), adding the iPhone needs no change to the Mac brain. The iPhone just advertises fewer tools.

## Requirements

1. The user can speak a goal in our iPhone app. It is transcribed on the device with WhisperKit, so Taglish works, and delegated to the Mac.
2. Audio never leaves the iPhone. Apple's speech recognizers are not used, since they have no Filipino.
3. The app's tools are exposed as App Intents, so Siri and Shortcuts can call them without opening the app, for example "Hey Siri, ask Yumi to export my deck".
4. The iPhone offers only tools iOS allows our app: location, photos the user picks, calendar, contacts, and alarms through AlarmKit or a Shortcut.
5. Commands from the Mac reach the iPhone through a visible push notification. The push carries no content; it only wakes the app, which then fetches the encrypted message over the bridge. Silent pushes are not used, since iOS throttles them and drops them after the user force-quits the app.
6. Push needs a paid Apple Developer account and an APNs sender on the VPS.
7. Photos requested by the Mac go through the system photo picker: notification, then open the app, then the user picks.
8. Approvals, progress, and Stop follow [SPEC-09](09-cross-device-routing.md) when the iPhone is the origin device.
9. Risky actions and permission requests follow [SPEC-07](07-safety.md) and [SPEC-11](11-user-facing-errors.md).

## Scenarios

```gherkin
@p2 @iphone
Feature: Yumi on iPhone

  Scenario: Voice remote for the Mac
    Given the iPhone and Mac are paired
    When the user says in the iPhone app "export my Keynote deck as a PDF"
    And confirms the goal
    Then the goal is delegated to the Mac
    And a cursor spawns on the Mac and does it
    And the iPhone says "Done. Your deck is exported as a PDF on your Mac."

  Scenario: Taglish on the iPhone
    Given the iPhone app is open
    When the user says "pakiexport yung Keynote deck ko as PDF"
    Then the goal is transcribed with WhisperKit on the iPhone
    And no audio leaves the iPhone

  Scenario: Goal through Siri
    Given the iPhone and Mac are paired
    When the user says "Hey Siri, ask Yumi to export my deck"
    Then the goal is delegated to the Mac without the user opening the app

  Scenario: Mac asks the iPhone for data while the app is closed
    Given the iPhone app is closed
    When the Mac asks for the iPhone's location
    Then the iPhone shows a notification "Your Mac wants your location. Tap to share."
    And the location is sent after the user taps it

  Scenario: Mac asks for photos
    Given the Mac asks the iPhone for photos
    When the user taps the notification
    Then the app opens the system photo picker
    And only the photos the user picks are sent

  Scenario: Unsupported request with an Android phone paired
    Given an Android phone is also paired
    When the user asks the Mac to "tap through Instagram on my iPhone"
    Then the Mac says "I can't control other apps on an iPhone. Apple doesn't allow it. I can do this on your Android phone instead."
    And shows "Use Android" and "Cancel" buttons

  Scenario: Unsupported request with no Android phone
    Given no Android phone is paired
    When the user asks the Mac to "tap through Instagram on my iPhone"
    Then the Mac says "I can't control other apps on an iPhone. Apple doesn't allow it."
    And shows only a "Cancel" button
```
