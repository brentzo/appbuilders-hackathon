---
id: SPEC-09
title: Cross-device routing
priority: p0
devices: [mac, android]
status: draft
tags: [spec, p0, harness, bridge, mac, android]
---

# SPEC-09 Cross-device routing

## Summary

Each device advertises the tools it offers.
A goal spoken on either device runs on whichever device can do it, and the result comes back to where the user spoke.

## Requirements

1. On connect, each device sends its tool list to the other through the bridge.
2. The Mac brain sees its own tools plus the phone's tools, prefixed by device.
3. A goal spoken on the Mac is planned on the Mac and may call phone tools.
4. A goal spoken on the phone is classified by the phone model as phone, laptop, or both.
   - Phone goals run on the phone.
   - Laptop and both goals are sent to the Mac as a goal, and the Mac plans them.
5. The result is spoken on the device where the user spoke.
6. A goal from the phone that runs on the Mac spawns the visible cursor on the Mac.
7. If the target device is offline, the user is told, and the goal is queued until it reconnects or the user cancels it.

## Scenarios

```gherkin
@p0 @harness @mac @android
Feature: Mac to phone

  Scenario: Set an alarm on the phone from the Mac
    Given the Mac and phone are paired and connected
    When the user says on the Mac "set an alarm on my phone for 6:30 am"
    And confirms the goal
    Then the Mac calls the phone's set_alarm tool
    And an alarm for 6:30 am exists on the phone
    And the Mac says "Your alarm is set for 6:30 am on your phone."

  Scenario: Fetch data from the phone
    Given the Mac and phone are paired and connected
    When the user says on the Mac "send me the last 3 photos from my phone"
    And confirms the goal
    Then the phone sends the 3 most recent photos to the Mac
    And they appear in a folder on the Mac
```

```gherkin
@p0 @harness @mac @android
Feature: Phone to Mac

  Scenario: Phone goal runs on the phone
    Given the Yumi app is open on the phone
    When the user says "turn on do not disturb for an hour"
    Then the phone model classifies it as a phone goal
    And it runs on the phone

  Scenario: Phone goal runs on the Mac with a visible cursor
    Given the Mac and phone are paired and connected
    When the user says on the phone "export my Keynote deck as a PDF"
    And confirms the goal
    Then the phone model classifies it as a laptop goal
    And the goal is sent to the Mac
    And a cursor spawns on the Mac and exports the deck
    And the phone says "Done. Your deck is exported as a PDF on your Mac."

  Scenario: Goal that needs both devices
    Given the Mac and phone are paired and connected
    When the user says on the phone "send the PDF I just made on my laptop to Ana on WhatsApp"
    Then the goal is sent to the Mac to plan
    And the Mac fetches the PDF and sends it to the phone
    And the phone opens WhatsApp and prepares the message to Ana
    And the phone asks before sending, as in SPEC-07

  Scenario: Mac is offline
    Given the Mac is asleep
    When the user says on the phone "export my Keynote deck as a PDF"
    Then the phone says the offline error from SPEC-11
    And shows "Run it when my Mac is back" and "Cancel" buttons
```

## Open questions

- When the Mac is busy with another task, should a phone goal queue or run in parallel?
