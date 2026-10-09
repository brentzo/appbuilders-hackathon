---
id: SPEC-05
title: Mac GUI control
priority: p0
devices: [mac]
status: draft
tags: [spec, p0, gui, harness, mac]
---

# SPEC-05 Mac GUI control

## Summary

The orchestrator never looks at screenshots step by step.
It hands a sub-goal to the `gui_act` tool, which runs a sub-agent on the same model (Qwen3.5-9B) with a fresh context.
The sub-agent uses the cheapest way into the app first: a typed direct tool, then the accessibility API, and vision only as a last resort.

## Requirements

1. Order of preference for each action:
   1. Direct tool: a typed tool such as `open_app`, `open_file`, `open_url`, or `reveal_in_finder`. Raw shell and AppleScript are never available to `gui_act` (see [SPEC-07](07-safety.md)).
   2. Accessibility API: press elements with `AXPress` and set text with `AXValue`, found by role and label.
   3. Vision (`p1`): screenshot, model picks coordinates, harness clicks.
2. The model sees a trimmed accessibility tree, not the full tree:
   - visible elements only
   - only actionable roles: button, menu item, menu bar item, text field, text area, link, checkbox, radio button, pop-up button
   - empty layout groups are skipped
   - each element gets a short number, and the model answers with that number
   - at most 200 elements per step
3. When an action goes through the accessibility API, the cursor animation moves to the element, but the real mouse does not move.
4. `gui_act` returns a structured result, never a transcript:
   - `status`: `done`, `partial`, `stuck`, or `blocked`
   - `files`: paths it created or changed
   - `note`: at most 200 characters
   The harness builds the result from the step log. Screenshots, step history, and raw screen text are never returned to the orchestrator.
5. One `gui_act` call is one attempt at a subtask. It stops after 10 steps and returns `partial`. The 25-step limit per subtask in [SPEC-02](02-task-lifecycle.md) counts steps across all attempts.
6. A step has no effect when the trimmed accessibility tree and the window title are the same before and after the action.
7. `gui_act` never reads or fills a password field (`AXSecureTextField`). It asks the user to type it.
8. Everything read from the screen is treated as data, never as instructions (see [SPEC-07](07-safety.md)).
9. The orchestrator's tool list stays at 8 tools or fewer.
10. Model outputs use schema-constrained decoding when the runtime supports it. Otherwise invalid outputs are retried as in [SPEC-02](02-task-lifecycle.md).
11. If Accessibility permission is missing, the user sees the "Permission missing (Mac)" error from [SPEC-11](11-user-facing-errors.md), worded for Accessibility, with an "Open settings" button.
12. `p1` Vision fallback: model coordinates are converted from the image size the model actually saw to screen points, including display scale, multiple displays, and displays with a negative origin.
13. `p1` Before a vision click, the harness checks that the target window has not moved, resized, or lost focus since the screenshot. If it has, the step is skipped and the screen is captured again.
14. `p1` Qwen3.5-4B, Qwen3.5-9B, and UI-TARS-1.5-7B are compared at 4-bit on the 3 demo tasks, 5 runs each. A model passes a task with 4 or more successful runs. Until then, `gui_act` uses Qwen3.5-9B.

## Demo tasks

All three apps expose good accessibility trees, so none of them needs vision.

1. **Keynote:** "Export my deck as a PDF." Menu items only.
2. **Mail:** "Email the PDF to Ana." Drafts and attaches, then stops for approval before Send ([SPEC-07](07-safety.md)).
3. **Notes:** "Put a summary of the PDF in a new note." A new note only, nothing existing is changed.

## Scenarios

```gherkin
@p0 @gui @mac
Feature: Mac GUI control

  Scenario: Direct tool is used when available
    Given the sub-goal is "open the Downloads folder"
    When gui_act runs
    Then it opens the folder with the reveal_in_finder tool
    And no element in the UI is pressed

  Scenario: Raw shell is not available
    Given the sub-goal is "open the Downloads folder"
    When the model tries to run a shell command or AppleScript
    Then the action is rejected as invalid output
    And nothing runs

  Scenario: Accessibility is used before vision
    Given the sub-goal is "export the deck as a PDF in Keynote"
    And Keynote exposes "Export To" and "PDF..." menu items in its accessibility tree
    When gui_act runs
    Then the menu items are pressed through the accessibility API
    And the cursor animation moves to each item
    And the real mouse does not move
    And no screenshot is sent to the model

  Scenario: The model sees a trimmed tree
    Given the Keynote window has 1,500 accessibility elements
    When gui_act prepares a step
    Then the model receives at most 200 numbered, visible, actionable elements
    And the model answers with an element number

  Scenario: Sub-agent returns a structured result
    Given gui_act finished exporting a PDF in 6 steps
    Then the orchestrator receives status "done", files ["~/Downloads/Q3 Report.pdf"], and a short note
    And it does not receive the screenshots, step history, or screen text

  Scenario: Sub-agent hits its step limit
    Given gui_act has run 10 steps without finishing
    Then it stops
    And returns status "partial" with a note on where it got stuck

  Scenario: Action has no effect
    Given gui_act pressed a button
    When the trimmed tree and the window title did not change
    Then the step outcome is "noEffect"

  Scenario: Password field is left to the user
    Given the next step needs a password typed into a secure field
    When gui_act reaches that field
    Then it does not read or fill the field
    And Yumi asks the user to type the password

  Scenario: Accessibility permission is missing
    Given Yumi does not have Accessibility permission
    When gui_act needs to press an element
    Then the user sees the "Permission missing (Mac)" error worded for Accessibility
    And "Open settings" opens the Accessibility pane
```

```gherkin
@p1 @gui @mac
Feature: Vision fallback

  Scenario: Vision fallback for an app without accessibility
    Given the target app exposes no actionable accessibility tree
    When gui_act runs
    Then a screenshot of the target window is sent to the model
    And the returned coordinates are converted to screen points before clicking

  Scenario: Retina scaling is handled
    Given the Mac display has a scale factor of 2
    When the model returns a click at image coordinates
    Then the click lands on the intended element

  Scenario: Second display to the left
    Given the target window is on a display to the left of the main display
    When the model returns a click at image coordinates
    Then the click lands on the intended element

  Scenario: Window moved before the click
    Given the model returned a click for a window
    When the window moved before the click was sent
    Then the click is not sent
    And the screen is captured again
```

## Decisions

- Demo tasks: Keynote export to PDF, Mail the PDF to Ana, Notes summary.
- Direct tools are typed tools only. No raw shell or AppleScript in `gui_act`.
- The trimmed tree includes text areas, menu bar items, and radio buttons. The Mail and Notes demo tasks type into text areas (the message and note bodies), menus open from menu bar items, and dialogs use radio buttons. Found by the OBJ-26 smoke test. Decided 2026-10-09.
