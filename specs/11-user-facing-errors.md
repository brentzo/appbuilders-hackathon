---
id: SPEC-11
title: User-facing errors
priority: p0
devices: [mac, android]
status: draft
tags: [spec, p0, ux, mac, android]
---

# SPEC-11 User-facing errors

## Summary

The user is not a developer.
Every error they can hit tells them, in plain language, what happened, why, and what to do next.
Where a next step exists, it is a button, not a sentence telling them to go find it.

## Requirements

1. No status codes, exception messages, stack traces, transport errors, or vendor wording ever reach the user, in speech or on screen.
2. Technical details go to the local log on the device, where the team can read them.
3. Each expected failure below has its own copy and buttons.
4. Anything unexpected gets the generic copy at the end of the table, never the raw error.
5. Failures are detected from structured data (error types, codes, response fields), never by matching error text.
6. Tests use the same error objects the real code throws, not simplified mocks.

## Error copy

| Failure | What the user hears and sees | Buttons |
|---|---|---|
| Other device offline | "I can't reach your Mac right now. It might be asleep or off the internet. I can run this as soon as it's back." | Run it when it's back, Cancel |
| Bridge down | "I can't connect your phone and Mac right now because the connection between them is down. Things on this device still work." | Try again, Work on this device only |
| Command expired | "That request waited too long, so I didn't run it in case it's no longer what you want." | Run it now, Cancel |
| Stuck on screen | "I'm stuck. I tried a few times but couldn't find what I need on this screen. Can you show me, or should I stop?" | I'll show you, Skip this step, Stop |
| Task took too long | "This is taking longer than it should, so I stopped. Here's what I finished so far." | Keep going, Stop |
| Permission missing (Mac) | "I need permission to see your screen before I can help with this." | Open settings, Not now |
| Permission missing (Android) | "I need permission to use your location for this." | Allow, Not now |
| Didn't catch speech | "Sorry, I didn't catch that. Could you say it again?" | Try again, Type instead |
| Model failed to load | "I couldn't start my brain on this device. Closing other apps usually helps." | Try again, Use a lighter model |
| Unpaired device | "Your phone isn't paired with your Mac yet." | Pair now |
| Unexpected | "Something went wrong on my side and I stopped to be safe. Nothing else was changed." | Try again, Stop |

## Scenarios

```gherkin
@p0 @ux @mac @android
Feature: User-facing errors

  Scenario: Raw error never reaches the user
    Given the bridge client throws a connection error with code "ECONNRESET"
    When the error is shown to the user
    Then the user sees the "Bridge down" copy
    And the words "ECONNRESET" do not appear anywhere in the UI or speech
    And the error code is written to the local log

  Scenario: Recovery is a button
    Given the Mac is offline
    When the user asks the phone for a Mac task
    Then the "Other device offline" copy is shown
    And the "Run it when it's back" button queues the task

  Scenario: Unexpected error uses generic copy
    Given an error with no known type is thrown during a task
    Then the user sees the "Unexpected" copy
    And the task is paused, not left half-running

  Scenario: Missing screen permission
    Given the Mac has not granted Screen Recording permission
    When a task needs a screenshot
    Then the user sees the "Permission missing (Mac)" copy
    And "Open settings" opens the Screen Recording pane
```
