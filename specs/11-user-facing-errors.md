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
9. Every button can also be triggered by voice, by saying its label, except approval buttons on delete cards and unclassified-action cards, which only a tap approves ([SPEC-07](07-safety.md) requirements 6 and 11).
10. Errors are shown on the origin device ([SPEC-09](09-cross-device-routing.md)).
11. Long copy: Yumi speaks the first sentence, and the full text is shown on screen.
12. `{permission}` is the plain name of what the permission lets Yumi use, for example "location", "camera", or "contacts".
13. "Type instead" opens a text box that accepts a goal the same way as speech.
14. `{step}` is the title of the subtask that could not finish, as the user would say it, for example "Export the deck as a PDF".

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
| Couldn't finish a step | "I couldn't finish this step: {step}. I stopped there before anything else ran on top of it. I can try it again, skip it and keep going, or stop." | Try again, Skip this step, Stop |
| Stuck on screen | "I'm stuck. I tried a few times but couldn't find what I need on this screen. Can you show me, or should I stop?" | I'll show you, Skip this step, Stop |
| Task took too long | "This is taking longer than it should, so I stopped. Here's what I finished so far." | Keep going, Stop |
| Unsupported request | "I can't do that on {device}. Here's what I can do instead." | Depends on the request, Cancel |
| Screen permission missing (Mac) | "I need permission to see your screen before I can help with this." | Open settings, Not now |
| Accessibility permission missing (Mac) | "I need permission to control your Mac before I can help with this." | Open settings, Not now |
| Microphone permission missing | "I need permission to use the microphone so I can hear you." | Open settings, Type instead |
| Permission missing (Android) | "I need permission to use your {permission} for this." | Allow, Not now |
| Accessibility service off (Android, p1) | "I need you to turn on my accessibility access before I can use other apps on your phone." | Open settings, Not now |
| Phone too hot or battery low (p1) | "Your phone is getting hot, so I paused to let it cool down." | Keep going, Stop |
| Language not supported on this phone | "I can only understand English on this phone for now. Try saying it in English, or say it to your Mac." | Try again, Type instead |
| Speech recognition not set up on this phone | "I can't understand speech on this phone yet because its offline English speech pack isn't installed. Download it in your phone's speech settings, then try again." | Open settings, Type instead |
| Didn't catch speech | "Sorry, I didn't catch that. Could you say it again?" | Try again, Type instead |
| Model failed to load | "I couldn't start my brain on this device. Closing other apps usually helps." | Try again |
| Voice didn't load (Mac) | "I couldn't start my voice, so I'll stay quiet for now. Everything else still works. Closing other apps usually helps, then try again." | Try again, Not now |
| Unpaired device | "Your phone isn't paired with your Mac yet." | Pair now |
| Pairing code expired | "That pairing code expired. Codes only last a few minutes to keep your devices safe. Show a new code on your Mac and scan it again." | Scan again, Cancel |
| Not a pairing code | "That doesn't look like a Yumi pairing code. On your Mac, open Yumi and show the pairing code, then scan it again." | Scan again, Cancel |
| Pairing versions differ | "Yumi on your phone and your Mac are different versions, so they can't pair yet. Update Yumi on both, then try again." | Okay |
| Mac didn't answer pairing | "Your Mac didn't answer, so pairing didn't finish. Make sure Yumi is open on your Mac and showing a new code, then scan it again." | Scan again, Cancel |
| Unexpected | "Something went wrong and I stopped to be safe. Here's the last thing I did: {last action}." | Show what I did, Try again, Stop |

Notes:

- "Keep going" gives the subtask another 25 steps, once. A second breach marks it failed.
- "Show what I did" opens the action log ([SPEC-07](07-safety.md)) at that task.
- "Unexpected" never claims nothing changed, because a step may have run halfway.
- "Unexpected" before Yumi has done anything in the task drops the second sentence and "Show what I did": "Something went wrong and I stopped to be safe." with Try again, Stop.
- "Voice didn't load (Mac)" is shown, never spoken, in a small panel that does not take focus, so the user can keep working. "Try again" loads the voice again.
- "Open settings" on "Speech recognition not set up on this phone" opens the screen where the on-device language pack is installed if Android exposes one, otherwise the general speech settings.

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

  Scenario: Unexpected error before any action
    Given an error with no known type is thrown before Yumi has done anything in the task
    Then the user sees "Something went wrong and I stopped to be safe."
    And the buttons are "Try again" and "Stop"

  Scenario: Permission copy names the permission
    Given pairing needs the camera and the camera is not allowed
    Then the user sees "I need permission to use your camera for this."
    And the buttons are "Allow" and "Not now"

  Scenario: Missing screen permission
    Given the Mac has not granted Screen Recording permission
    When a task needs a screenshot
    Then the user sees the "Screen permission missing (Mac)" copy
    And "Open settings" opens the Screen Recording pane

  Scenario: Voice that did not load stays quiet
    Given Yumi's voice could not start on the Mac
    When Yumi has something to say
    Then nothing is spoken, not even with the system voice
    And a panel that does not take focus shows "I couldn't start my voice, so I'll stay quiet for now. Everything else still works. Closing other apps usually helps, then try again."
    And the buttons are "Try again" and "Not now"
    And the reason is written to the local log

  Scenario: Copy table matches the code
    When the error copy test runs
    Then every row in this table has the same text and buttons in code
```

## Decisions

- **Pairing failures** have their own copy, shown on the phone: expired code, not a Yumi code, different versions, and no answer from the Mac. The Mac silently drops a bad pairing request, so the phone shows "Mac didn't answer pairing" after waiting 30 seconds, which also covers a code that was already used. Decided 2026-10-09.
- **Android permission copy** is one row with a `{permission}` placeholder instead of one row per permission, so new tools only add a plain name. Decided 2026-10-09.
- **"Unexpected" with nothing done yet** drops "Here's the last thing I did" and the "Show what I did" button, instead of showing a blank. Decided 2026-10-09.
- **Couldn't finish a step** has its own row with a `{step}` placeholder (requirement 14), so a subtask that fails tells the user which step stopped and offers to retry it, skip it, or stop. The duplicate requirement number 12 is fixed. Decided 2026-10-09.
- **Speech recognition not set up on this phone** has its own row, separate from "Language not supported on this phone". It covers a phone with no on-device recognizer or without the offline English pack, where telling the user to speak English would be wrong; the fix is downloading the pack. "Language not supported on this phone" stays for speech in another language. Decided 2026-10-09.
- **Voice on a delete card:** "Delete" is the one button that cannot be said, because a delete is approved only by a tap (SPEC-07 requirement 11). Requirement 9 names the exception. Decided 2026-10-10, closing gap G3.
- **Voice on unclassified-action approvals:** SPEC-11 requirement 9 generally allows button labels by voice, while SPEC-07 requirement 6 makes approval of an unclassified risky action tap-only. SPEC-07 wins for these cards: a voice reply cannot approve the action. Requirement 9 names the exception. Decided 2026-10-10 by the lead.
- **The blocked-action message** stays in [SPEC-07](07-safety.md) requirement 5 instead of becoming a row here, so its copy lives in one place. The Mac's copy test reads it from there, the same way it reads this table, and the phone never shows it in p0, since it does not control apps. Decided 2026-10-10, closing gap G5's SPEC-11 part.
- **"Show what I did"** opens the action log of the task in the error, read from `getTask`'s `actionLog`. That view is p0, because the button is; only opening the log from the menu bar is p1 (SPEC-07 requirement 19). Decided 2026-10-10, closing gap G13.
- **Voice didn't load (Mac)** has its own row. Yumi stays quiet instead of falling back to the robotic system voice ([SPEC-04](04-cursor-presence.md) requirement 20), so the copy is shown in a panel that does not take focus rather than spoken, and "Try again" loads the voice again. Decided 2026-10-10 by Brent.

## Open questions

- **A goal spoken while the model loads (OBJ-46.3).** Proposal, waiting for Brent's yes: the Mac holds the goal, Yumi says "I'm still waking up. I'll start on that as soon as I'm ready.", and the goal starts by itself once the model is ready.
  Only the latest goal is kept: a second one replaces the first.
  If the model fails instead, the held goal is dropped and "Model failed to load" shows; a goal spoken while it has failed shows that error again.
  The other option is to say so and drop the goal, which makes the user say it again.
  Recommended: hold it, because a demo that starts right after launch then just works a little later instead of looking frozen or ignoring the user.
  The Mac does this now, so changing it is a small edit in `mac/Yumi/App/ModelReadiness.swift`.
