---
id: SPEC-03
title: Lane routing and handoff
priority: p0
devices: [mac]
status: draft
tags: [spec, p0, harness, gui, mac]
---

# SPEC-03 Lane routing and handoff

## Summary

Each subtask runs in one of three lanes: `helper` (no UI), `ghost` (background UI control with its own visible cursor), or `main` (the real mouse and keyboard).
The planner proposes a lane.
The harness verifies it and picks the cheapest lane that passes every check.
Design: [lane-router](../docs/lane-router.md).

## Requirements

1. Lane cost order is `helper` < `ghost` < `main`. `main` always accepts work.
2. Subtasks with no target app go to `helper`.
3. A subtask goes to `ghost` only if the target app supports background control (actionable accessibility tree, or Chromium DevTools protocol).
4. App capability is probed once per app version and cached.
5. Only one cursor may work in a window at a time. Window locks are stored with the task record and expire, so a crashed worker cannot block a window.
6. Visible cursors are capped at 3, including `main`. Extra subtasks queue.
7. Only `main` sends keystrokes. Ghosts set text through the accessibility API or DevTools.
8. A ghost is handed off to `main` after 2 consecutive invalid outputs or 3 consecutive no-effect steps.
9. Handoff keeps the step log. `main` resumes from the last good step.
10. Every routing decision records a reason that is shown on the dashboard.

## Scenarios

```gherkin
@p0 @harness @mac
Feature: Lane routing

  Scenario: Subtask with no UI runs as a helper
    Given a subtask "extract totals from 20 spreadsheets" with no target app
    When the router routes it
    Then its lane is "helper"
    And no cursor is spawned for it

  Scenario: Background-capable app gets a ghost cursor
    Given a subtask targets a Chrome window
    And Chrome supports DevTools control
    And the window is not locked
    And fewer than 3 cursors are visible
    When the router routes it
    Then its lane is "ghost"
    And a ghost cursor spawns in that window

  Scenario: App without background control goes to the main cursor
    Given a subtask targets an app with no actionable accessibility tree
    When the router routes it
    Then its lane is "main"
    And its route reason is "appNotBackgroundCapable"

  Scenario: Planner proposes the wrong lane
    Given the planner proposes "ghost" for a subtask in a canvas app
    When the router checks the app capability
    Then its lane is "main"

  Scenario: Window is already locked
    Given a ghost cursor holds the lock on a Mail window
    When another subtask targets the same window
    Then the second subtask is queued
    And it starts after the lock is released

  Scenario: Cursor cap is reached
    Given 3 cursors are visible
    When a new ghost-capable subtask is ready
    Then it is queued until a cursor finishes

  Scenario: Parallel goal splits into lanes
    Given the user confirmed "pull this month's numbers from my sheets, fill the expense form in Chrome, and put the chart in Keynote"
    When routing finishes
    Then the sheets subtask runs as a helper
    And the Chrome form runs as a ghost
    And the Keynote subtask runs on the main cursor
```

```gherkin
@p0 @harness @mac
Feature: Ghost handoff

  Scenario: Stuck ghost hands off to the main cursor
    Given a ghost cursor is filling a form
    When 3 steps in a row have no effect
    Then the subtask status is "handoff"
    And the window lock is released
    And the ghost cursor fades out
    And the main cursor moves to that window
    And the main cursor continues from the last good step

  Scenario: Main cursor also gets stuck
    Given the main cursor is running a handed-off subtask
    When 3 steps in a row have no effect
    Then the companion asks the user for help with the error from SPEC-11 for "stuck on screen"
```

## Open questions

- How long should a subtask wait for a window lock before going to `main`?
- Should the harness tile windows automatically so every ghost is visible?
