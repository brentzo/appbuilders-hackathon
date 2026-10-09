---
id: SPEC-06
title: User control and interrupts
priority: p0
devices: [mac, android]
status: draft
tags: [spec, p0, p1, ux, safety, voice, mac, android]
---

# SPEC-06 User control and interrupts

## Summary

The user is always in charge.
They can stop, pause, take over, or resume at any time, by voice or by touching their own mouse, keyboard, or screen.

## Requirements

1. Pressing Control-Option-Escape on the Mac, or choosing "Stop" in Yumi's menu bar menu, pauses every lane and checkpoints the task. Yumi then says "Paused. Say continue when you're ready, or cancel to stop for good."
2. If the user takes over their own mouse or keyboard, every UI lane on the Mac pauses immediately. Helpers keep running. This pause is silent: Yumi shows the paused panel and says nothing.
   - Taking over is a real click, a key press, a scroll, or a deliberate pointer move: more than about 80 points within about half a second. Small jiggles and trackpad bumps never count.
   - Pointer movement over, and clicks and typing in, Yumi's own bubbles, thoughts panels, helper chips, cards, and windows never count as taking over.
   - While Yumi is waiting for the user and no UI lane is acting, the user's input never pauses anything. This covers a password field Yumi handed to the user ([SPEC-05](05-mac-gui-control.md) requirement 7).
3. Yumi tags every mouse and keyboard event it sends. Tagged events never cause a pause; untagged events pause whenever they are a take-over (requirement 2).
4. Pausing takes effect before the next action is sent, never after. Text is typed in short chunks, and the pause is checked between chunks.
5. Pausing cancels every pending approval. After resuming, a risky action asks again ([SPEC-07](07-safety.md)).
6. A paused task shows "Resume" and "Cancel" buttons. Saying "continue" or "resume" resumes it, and saying "cancel" cancels it.
7. Resuming always re-captures the screen first, since the user may have changed things.
8. Cancelling stops every lane, including helpers, and drops every queued subtask and every command not yet run. Nothing runs after "cancel".
9. While macOS Secure Input is on (for example in a password field), Yumi cannot see the user's keystrokes. A click or a deliberate mouse move still pauses Yumi.
10. `p1` Saying "stop" pauses every lane on every device. It uses a fast keyword detector, not the full speech pipeline, and works while Yumi is talking. It also accepts "teka", "tama na", and "hinto".
11. `p1` If the user touches the phone screen while Yumi is controlling it, phone UI control pauses immediately.
12. `p1` A persistent notification action on Android stops everything.
13. `p1` A device doing work for the other device pauses itself if it cannot reach that device for 10 seconds, so a lost connection never leaves work running unattended. Needs [SPEC-08](08-device-bridge.md).

### Changing the goal mid-task (p1)

14. `p1` Saying the wake word or holding push-to-talk on the Mac while a task runs is an interruption: every UI lane pauses before its next action, as in requirement 2, helpers keep running, and Yumi stops speaking at once.
    The wake word stays live while Yumi is talking.
15. `p1` If no speech starts within 5 seconds of an interruption, the task resumes without a word.
    If speech starts but cannot be understood, Yumi says the SPEC-11 "Didn't catch speech" copy and the task stays paused.
16. `p1` Saying "stop", "cancel", or "continue" after an interruption acts on the paused task as in requirements 6 and 8.
    Anything else becomes one revised goal, which the model writes from the original goal, what is already done, and what the user just said, whether they replaced the goal, added to it, or asked for something separate.
17. `p1` A revised goal is repeated back and waits for a yes, a correction, or a cancel, as a new goal does in [SPEC-01](01-voice-intake.md) requirements 4 to 6, with the task paused until then.
    In Auto mode it is shown on screen with a short spoken acknowledgement, and the task resumes.
    "Cancel" cancels the task.
18. `p1` Nothing already done is undone.
    The repeat-back names anything left behind that the revised goal no longer needs, and the new plan starts from the screen as it is; anything the user wants undone goes through [SPEC-07](07-safety.md).
19. `p1` Once a revised goal is confirmed, the plan is redone from it: running helpers and queued subtasks still in the new plan carry on, and the others are cancelled.
20. `p1` While Yumi waits for the user, an answer is not an interruption.
    On an approval card, anything other than the card's own answers declines the card and becomes an interruption; a delete is still approved only by a tap ([SPEC-07](07-safety.md) requirement 11).
    An answer to a question from the model is an interruption only if it says "stop", "cancel", or clearly changes the goal.
21. `p1` Only the Mac takes voice interruptions. The phone keeps "Stop" and "Cancel" for a task it sent to the Mac; revising that task from the phone comes later.

## Scenarios

```gherkin
@p0 @ux @mac
Feature: User control on the Mac

  Scenario: Stop shortcut
    Given a task is running with a main cursor and a ghost cursor
    When the user presses Control-Option-Escape
    Then both cursors freeze in the paused state
    And no further actions are sent
    And Yumi says "Paused. Say continue when you're ready, or cancel to stop for good."

  Scenario: Stop from the menu bar
    Given a task is running
    When the user chooses "Stop" in Yumi's menu bar menu
    Then every lane pauses

  Scenario: User takes the mouse
    Given the main cursor is moving to a button
    When the user moves their own mouse across the screen
    Then every UI lane pauses before its next action
    And helpers keep running
    And Yumi says nothing
    And the paused panel shows "Resume" and "Cancel" buttons

  Scenario: A small bump of the mouse is not taking over
    Given the main cursor is moving to a button
    When the user nudges their own mouse a few points
    Then the task does not pause

  Scenario: Reaching for a cat's bubble is not taking over
    Given Debug mode is on and the main cursor is working
    When the user moves their pointer onto a cat's bubble and clicks it
    Then the cat's thoughts panel opens
    And the task does not pause

  Scenario: Clicking Yumi's own card is not taking over
    Given Yumi is waiting for approval to send an email
    When the user clicks "Send" on the approval card
    Then the task does not pause
    And the email is sent

  Scenario: Typing a password Yumi asked for is not taking over
    Given Yumi asked the user to type a password
    And no UI lane is acting
    When the user clicks into the password field and types
    Then the task does not pause

  Scenario: Yumi's own input does not pause it
    Given the main cursor is typing into a text field
    When Yumi sends its own keystrokes
    Then the task does not pause

  Scenario: Typing stops mid-sentence
    Given the main cursor is typing a long sentence
    When the user clicks with their own mouse
    Then typing stops before the next chunk is sent

  Scenario: Pause cancels a pending approval
    Given Yumi is waiting for approval to send an email
    When the user presses the stop shortcut
    And then resumes the task
    Then Yumi asks for approval to send again

  Scenario: User resumes
    Given a task is paused
    When the user says "continue"
    Then the screen is captured again
    And the task continues from its last checkpoint

  Scenario: User resumes by saying resume
    Given a task is paused
    When the user says "resume"
    Then the task continues from its last checkpoint

  Scenario: User cancels a paused task
    Given a task is paused
    And a helper subtask is still queued
    When the user says "cancel"
    Then the task status is "cancelled"
    And the queued helper subtask never runs
    And every cursor fades out
    And Yumi says "Okay, I stopped. Nothing else will happen."
```

```gherkin
@p1 @ux @mac
Feature: Voice stop

  Scenario: User says stop
    Given a task is running with a main cursor and a ghost cursor
    When the user says "stop"
    Then both cursors freeze in the paused state
    And no further actions are sent

  Scenario: User says stop while Yumi is talking
    Given Yumi is speaking
    When the user says "teka"
    Then every lane pauses
```

```gherkin
@p1 @ux @android
Feature: User control on Android

  Scenario: User touches the phone during control
    Given Yumi is tapping through an app on the phone
    When the user touches the screen
    Then phone UI control pauses before its next action
    And the phone shows "Paused" with "Resume" and "Cancel" buttons

  Scenario: Stop from the notification
    Given Yumi is working on the phone
    When the user taps "Stop" in Yumi's notification
    Then every lane on every device pauses

  Scenario: Connection lost during remote work
    Given the Mac is running a task the user started on the phone
    When the Mac cannot reach the phone for 10 seconds
    Then the Mac pauses the task
```

```gherkin
@p1 @voice @ux @mac
Feature: Changing the goal mid-task

  Scenario: User replaces the goal while Yumi works
    Given Yumi is typing a summary into a new note
    When the user says "Hey Yumi, sorry, not Notes, put it in Keynote"
    Then every cursor pauses before its next action
    And Yumi says it already opened a new note with some text in it and will leave it there
    And Yumi repeats back that it will put the summary in Keynote instead and waits for a yes
    And when the user says "go ahead", the task continues in Keynote

  Scenario: User adds to the goal
    Given Yumi is exporting the deck as a PDF
    When the user says "Hey Yumi, and also email it to Ana"
    Then Yumi repeats back that it will export the deck and email it to Ana
    And when the user says "go ahead", the PDF already exported is used

  Scenario: Wake word heard by mistake
    Given Yumi is working on a task
    When the wake word is heard and nobody speaks for 5 seconds
    Then the task resumes without Yumi saying anything

  Scenario: User cancels after interrupting
    Given the user interrupted a task
    When the user says "cancel"
    Then every lane stops, including helpers
    And nothing else runs

  Scenario: Interrupting an approval card
    Given Yumi shows "I'm about to send this email to Ana. Should I send it?"
    When the user says "no wait, send it to Ben instead"
    Then the card closes without sending
    And Yumi repeats back that it will send the email to Ben
    And sending to Ben asks for approval again
```

## Decisions

- The stop shortcut is Control-Option-Escape, with "Stop" in the menu bar as a backup.
- Android touch detection uses an overlay that watches for outside touches, because an Accessibility Service cannot see the user's touches.
- Clicks and typing in Yumi's own windows (approval cards and panels) never count as taking over, so the user can answer a card with their own mouse without cancelling it. Decided 2026-10-09.
- There is no take-over pause while Yumi is waiting for the user and no UI lane is acting, which also covers a password field Yumi hands to the user. Otherwise clicking into the field would pause the task Yumi is waiting on. Decided 2026-10-09.
- "Paused. Say continue when you're ready, or cancel to stop for good." is spoken only after the stop shortcut and the menu bar "Stop". A mouse take-over pauses silently and shows the paused panel, because the user is busy with their own work and speech would interrupt. Decided 2026-10-09.
- A take-over is a real click, a key press, a scroll, or a deliberate pointer move of more than about 80 points within about half a second, replacing the earlier "any mouse movement". Small jiggles and trackpad bumps never pause a task, and pointer movement over, and clicks in, Yumi's own bubbles, thoughts panels, helper chips, cards, and windows never count, so the user can reach for a cat's bubble mid-task (SPEC-07 requirement 23) without pausing it. The Mac logs which event triggered each take-over. Decided 2026-10-10 by Brent.
- The paused panel keeps the "Resume" button, and both "continue" and "resume" work by voice, so the spoken line and the button label both work. Decided 2026-10-09.
- **Changing the goal mid-task** is one revised goal rather than separate kinds of change or a second task, so the user never names a category and Yumi keeps one task at a time on the Mac.
  It pauses the UI lanes at once, because a correction usually means the next clicks are wrong; nothing done is undone automatically, because an undo is more actions on a screen Yumi may have misread.
  It is p1 and builds on the stop and take-over, confirmation, and wake word objectives. Decided 2026-10-10 by Jepoy.
