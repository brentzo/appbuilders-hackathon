---
id: SPEC-06
title: User control and interrupts
priority: p0
devices: [mac, android]
status: draft
tags: [spec, p0, ux, safety, mac, android]
---

# SPEC-06 User control and interrupts

## Summary

The user is always in charge.
They can stop, pause, take over, or resume at any time, by voice or by touching their own mouse, keyboard, or screen.

## Requirements

1. Pressing Control-Option-Escape on the Mac, or choosing "Stop" in Yumi's menu bar menu, pauses every lane and checkpoints the task. Yumi then says "Paused. Say continue when you're ready, or cancel to stop for good."
2. If the user moves their own mouse or types, every UI lane on the Mac pauses immediately. Helpers keep running. This pause is silent: Yumi shows the paused panel and says nothing.
   - Clicks and typing in Yumi's own windows (approval cards and panels) never count as taking over.
   - While Yumi is waiting for the user and no UI lane is acting, the user's input never pauses anything. This covers a password field Yumi handed to the user ([SPEC-05](05-mac-gui-control.md) requirement 7).
3. Yumi tags every mouse and keyboard event it sends. Tagged events never cause a pause, and untagged events always do.
4. Pausing takes effect before the next action is sent, never after. Text is typed in short chunks, and the pause is checked between chunks.
5. Pausing cancels every pending approval. After resuming, a risky action asks again ([SPEC-07](07-safety.md)).
6. A paused task shows "Resume" and "Cancel" buttons. Saying "continue" or "resume" resumes it, and saying "cancel" cancels it.
7. Resuming always re-captures the screen first, since the user may have changed things.
8. Cancelling stops every lane, including helpers, and drops every queued subtask and every command not yet run. Nothing runs after "cancel".
9. While macOS Secure Input is on (for example in a password field), Yumi cannot see the user's keystrokes. Mouse movement still pauses Yumi.
10. `p1` Saying "stop" pauses every lane on every device. It uses a fast keyword detector, not the full speech pipeline, and works while Yumi is talking. It also accepts "teka", "tama na", and "hinto".
11. `p1` If the user touches the phone screen while Yumi is controlling it, phone UI control pauses immediately.
12. `p1` A persistent notification action on Android stops everything.
13. `p1` A device doing work for the other device pauses itself if it cannot reach that device for 10 seconds, so a lost connection never leaves work running unattended. Needs [SPEC-08](08-device-bridge.md).

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
    When the user moves their own mouse
    Then every UI lane pauses before its next action
    And helpers keep running
    And Yumi says nothing
    And the paused panel shows "Resume" and "Cancel" buttons

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
    When the user moves their own mouse
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

## Decisions

- The stop shortcut is Control-Option-Escape, with "Stop" in the menu bar as a backup.
- Android touch detection uses an overlay that watches for outside touches, because an Accessibility Service cannot see the user's touches.
- Clicks and typing in Yumi's own windows (approval cards and panels) never count as taking over, so the user can answer a card with their own mouse without cancelling it. Decided 2026-10-09.
- There is no take-over pause while Yumi is waiting for the user and no UI lane is acting, which also covers a password field Yumi hands to the user. Otherwise clicking into the field would pause the task Yumi is waiting on. Decided 2026-10-09.
- "Paused. Say continue when you're ready, or cancel to stop for good." is spoken only after the stop shortcut and the menu bar "Stop". A mouse take-over pauses silently and shows the paused panel, because the user is busy with their own work and speech would interrupt. Decided 2026-10-09.
- The paused panel keeps the "Resume" button, and both "continue" and "resume" work by voice, so the spoken line and the button label both work. Decided 2026-10-09.
