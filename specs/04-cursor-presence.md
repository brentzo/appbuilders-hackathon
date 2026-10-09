---
id: SPEC-04
title: Cursor presence
priority: p0
devices: [mac]
status: draft
tags: [spec, p0, ux, gui, mac]
---

# SPEC-04 Cursor presence

## Summary

Yumi is visible as a cursor that moves like a person would.
Its motion, states, and labels are the main way the user understands what it is doing.
All of it is drawn by the harness on a transparent overlay; the model only chooses actions.

## Requirements

1. The main cursor spawns near the user's pointer when the user starts speaking a goal.
2. Movement to a target uses an eased curve over about 300 ms. It never teleports.
3. Each cursor has a visible state: listening, thinking, moving, acting, waiting for the user, paused.
4. The thinking state is shown while the model works, so a 1-4 second step never looks frozen.
5. Ghost cursors have their own color and a short label with the subtask title.
6. Helpers show as small status chips, not cursors.
7. The overlay never blocks clicks meant for the user's own pointer.
8. The overlay looks correct on every connected display, at every scale factor, in light and dark mode.
9. Cursors fade in and out. No cursor stays on screen after its task ends.

## Scenarios

```gherkin
@p0 @ux @mac
Feature: Cursor presence

  Scenario: Cursor moves smoothly to a target
    Given the main cursor is idle at one point
    When the next action is a click on a button across the screen
    Then the cursor moves there along an eased path in about 300 ms
    And the click happens after the cursor arrives

  Scenario: Thinking state during a slow step
    Given the model takes 3 seconds to choose the next action
    Then the cursor shows the thinking state for those 3 seconds

  Scenario: Ghost cursors are labeled
    Given a ghost cursor is working on "Fill expense form"
    Then it is drawn in its own color
    And it shows the label "Fill expense form"

  Scenario: Overlay does not block the user
    Given cursors are visible on screen
    When the user clicks with their own pointer anywhere
    Then the click reaches the app under the pointer

  Scenario: Cursor works on a second display
    Given a task targets a window on an external display
    Then the cursor moves onto that display and is drawn at the correct size

  Scenario: Cursors leave when the task ends
    Given a task has finished
    Then every cursor for that task fades out within 1 second
```

## Open questions

- Should the main cursor have a face or character, or stay abstract?
