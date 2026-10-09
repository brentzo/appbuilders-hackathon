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
7. The copy lives in one file in code. A test checks that the table below matches it.
8. `{device}` is filled with the other device, from the user's point of view: "your Mac" on the phone, "your phone" on the Mac.
9. Every button can also be triggered by voice, by saying its label.
10. Errors are shown on the origin device ([SPEC-09](09-cross-device-routing.md)).
11. Long copy: Yumi speaks the first sentence, and the full text is shown on screen.
12. "Type instead" opens a text box that accepts a goal the same way as speech.

## Error copy

| Failure | What the user hears and sees | Buttons |
|---|---|---|
| Other device offline | "I can't reach {device} right now. It might be asleep or off the internet. I can run this as soon as it's back." | Run it when it's back, Cancel |
| Other device busy | "{device} is busy with another task. I'll start this right after." | Okay, Cancel |
| Other device locked (p1) | "{device} is awake but locked. Unlock it and I'll continue." | Okay, Cancel |
| Bridge down | "I can't connect your phone and Mac right now because the connection between them is down. Things on this device still work." | Try again, Work on this device only |
| Can't pause the other device | "I can't reach {device} to pause it. Use the stop shortcut on {device}." | Try again |
| No reply | "{device} stopped answering while working on this. It might have gone to sleep." | Wait, Cancel |
| Command expired | "That request waited too long, so I didn't run it in case it's no longer what you want." | Run it now, Cancel |
| Stuck on screen | "I'm stuck. I tried a few times but couldn't find what I need on this screen. Can you show me, or should I stop?" | I'll show you, Skip this step, Stop |
| Task took too long | "This is taking longer than it should, so I stopped. Here's what I finished so far." | Keep going, Stop |
| Unsupported request | "I can't do that on {device}. Here's what I can do instead." | Depends on the request, Cancel |
| Screen permission missing (Mac) | "I need permission to see your screen before I can help with this." | Open settings, Not now |
| Accessibility permission missing (Mac) | "I need permission to control your Mac before I can help with this." | Open settings, Not now |
| Microphone permission missing | "I need permission to use the microphone so I can hear you." | Open settings, Type instead |
| Permission missing (Android) | "I need permission to use your location for this." | Allow, Not now |
| Accessibility service off (Android, p1) | "I need you to turn on my accessibility access before I can use other apps on your phone." | Open settings, Not now |
| Phone too hot or battery low (p1) | "Your phone is getting hot, so I paused to let it cool down." | Keep going, Stop |
| Language not supported on this phone | "I can only understand English on this phone for now. Try saying it in English, or say it to your Mac." | Try again, Type instead |
| Didn't catch speech | "Sorry, I didn't catch that. Could you say it again?" | Try again, Type instead |
| Model failed to load | "I couldn't start my brain on this device. Closing other apps usually helps." | Try again |
| Unpaired device | "Your phone isn't paired with your Mac yet." | Pair now |
| Unexpected | "Something went wrong and I stopped to be safe. Here's the last thing I did: {last action}." | Show what I did, Try again, Stop |

Notes:

- "Keep going" gives the subtask another 25 steps, once. A second breach marks it failed.
- "Show what I did" opens the action log ([SPEC-07](07-safety.md)) at that task.
- "Unexpected" never claims nothing changed, because a step may have run halfway.

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

  Scenario: Copy names the other device
    Given the Mac is offline
    When the user asks the phone for a Mac task
    Then the phone says "I can't reach your Mac right now. It might be asleep or off the internet. I can run this as soon as it's back."
    And the "Run it when it's back" button queues the task

  Scenario: Buttons work by voice
    Given the "Other device offline" copy is shown
    When the user says "cancel"
    Then the task is cancelled

  Scenario: Unexpected error uses generic copy
    Given an error with no known type is thrown during a task
    And the last action was "Clicked Export in Keynote"
    Then the user sees "Something went wrong and I stopped to be safe. Here's the last thing I did: Clicked Export in Keynote."
    And the task is paused, not left half-running

  Scenario: Missing screen permission
    Given the Mac has not granted Screen Recording permission
    When a task needs a screenshot
    Then the user sees the "Screen permission missing (Mac)" copy
    And "Open settings" opens the Screen Recording pane

  Scenario: Copy table matches the code
    When the error copy test runs
    Then every row in this table has the same text and buttons in code
```
