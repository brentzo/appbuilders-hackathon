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
11. When a subtask needs a window another cursor is using, Yumi opens a second window of the same app if the app supports it (for example a new Chrome window, Finder window, or email draft), and the subtask works there.
12. If the app cannot open a second window, the subtask waits for the window to be free.
13. If a subtask has waited more than 2 minutes, Yumi tells the user what it is waiting for.
14. Before tiling windows, Yumi asks the user. It never rearranges windows without a yes.
15. When the task ends or is cancelled, every window Yumi moved or resized goes back to where it was.
16. A "demo mode" setting tiles windows without asking. It is off by default.
17. The planner can mark a subtask as needing the keyboard, for example to paste or use a shortcut. Such a subtask goes to `main` even when its app supports background control, with reason `needsKeyboard`, because only `main` sends keystrokes (requirement 7).

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

  Scenario: Busy window, app supports a second window
    Given a ghost cursor holds the lock on a Chrome window
    When another subtask needs Chrome
    Then Yumi opens a new Chrome window
    And the second subtask works in the new window at the same time

  Scenario: Busy window, app cannot open a second window
    Given a cursor holds the lock on the only window of an app
    When another subtask needs that app
    Then the second subtask waits
    And it starts after the lock is released

  Scenario: Long wait is explained
    Given a subtask has waited 2 minutes for a busy window
    Then Yumi says "I'm waiting for Keynote to be free before I add the chart. It should be quick."

  Scenario: Cursor cap is reached
    Given 3 cursors are visible
    When a new ghost-capable subtask is ready
    Then it is queued until a cursor finishes

  Scenario: Parallel goal splits into lanes
    Given the user confirmed "pull this month's numbers from my sheets, fill the expense form in Chrome, and put the chart in Keynote"
    When routing finishes
    Then the sheets subtask runs as a helper
    And the Chrome form runs as a ghost
    And the Keynote subtask runs on the main cursor, because the planner marked it as needing the keyboard to paste the chart
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
    Then Yumi asks the user for help with the error from SPEC-11 for "stuck on screen"
```

```gherkin
@p0 @ux @mac
Feature: Window tiling

  Scenario: Yumi asks before tiling
    Given a task will use 3 windows at once
    When the cursors are about to start
    Then Yumi says "Want me to arrange your windows so you can watch all of us work?"
    And shows "Arrange windows" and "Leave them" buttons

  Scenario: User says yes
    Given Yumi asked to arrange windows
    When the user taps "Arrange windows"
    Then the task's windows are placed side by side so each is fully visible

  Scenario: User says no
    Given Yumi asked to arrange windows
    When the user taps "Leave them"
    Then no window is moved
    And the ghost cursors still work in covered windows

  Scenario: Layout is restored
    Given Yumi tiled the windows for a task
    When the task ends
    Then every window goes back to its original position and size

  Scenario: Demo mode tiles without asking
    Given demo mode is on
    When a task will use more than one window
    Then Yumi tiles the windows without asking
```

## Decisions

- Busy window: open a second window when the app allows it, otherwise wait, and tell the user after 2 minutes. Decided 2026-10-09.
- Tiling: ask first, restore the layout afterward, and offer a demo mode that tiles without asking. Decided 2026-10-09.
- Keyboard subtasks: the "Parallel goal splits into lanes" scenario put Keynote on `main` while requirement 3 sent it to a ghost. The planner now marks subtasks that need the keyboard, and those go to `main` with reason `needsKeyboard` (requirement 17). Brent chose this; the cheapest-lane rule stays the default. Decided 2026-10-09.
