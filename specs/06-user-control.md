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

1. Saying "stop" pauses every lane on every device and checkpoints the task.
2. If the user moves their own mouse or types, every UI lane on the Mac pauses immediately. Helpers keep running.
3. If the user touches the phone screen while Yumi is controlling it, phone UI control pauses immediately.
4. A paused task shows "Resume" and "Cancel" buttons.
5. Resuming always re-captures the screen first, since the user may have changed things.
6. A global keyboard shortcut on the Mac and a persistent notification action on Android stop everything.
7. Pausing takes effect before the next action is sent, never after.

## Scenarios

```gherkin
@p0 @ux @mac
Feature: User control on the Mac

  Scenario: User says stop
    Given a task is running with a main cursor and a ghost cursor
    When the user says "stop"
    Then both cursors freeze in the paused state
    And no further actions are sent
    And Yumi says "Paused. Say continue when you're ready, or cancel to stop for good."

  Scenario: User takes the mouse
    Given the main cursor is moving to a button
    When the user moves their own mouse
    Then every UI lane pauses before its next action
    And helpers keep running

  Scenario: User resumes
    Given a task is paused
    When the user says "continue"
    Then the screen is captured again
    And the task continues from its last checkpoint

  Scenario: User cancels a paused task
    Given a task is paused
    When the user says "cancel"
    Then the task status is "cancelled"
    And every cursor fades out
    And Yumi says "Okay, I stopped. Nothing else will happen."

  Scenario: Emergency shortcut
    Given a task is running
    When the user presses the stop shortcut
    Then every lane on every device pauses
```

```gherkin
@p0 @ux @android
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
```
