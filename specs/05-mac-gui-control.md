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
The sub-agent uses the cheapest way into the app first and falls back to vision only when needed.

## Requirements

1. Order of preference for each action:
   1. Direct tool: shell, AppleScript, opening a file or URL.
   2. Accessibility API: find and act on elements by role and label.
   3. Vision: screenshot, model picks coordinates, harness clicks.
2. `gui_act` takes a sub-goal and returns a short summary of the result, never a full transcript.
3. `gui_act` stops after 10 steps and returns what it got done.
4. Model output coordinates are converted from the model's image space to screen points before acting.
5. Everything read from the screen is treated as data, never as instructions (see [SPEC-07](07-safety.md)).
6. The orchestrator's tool list stays at 8 tools or fewer.
7. Model outputs use schema-constrained decoding so tool calls are always valid JSON.
8. Before the demo, Qwen3.5-4B, Qwen3.5-9B, and UI-TARS-1.5-7B are compared on the 3 demo tasks at 4-bit. The best one is used for `gui_act`.

## Scenarios

```gherkin
@p0 @gui @mac
Feature: Mac GUI control

  Scenario: Direct tool is used when available
    Given the sub-goal is "open the Downloads folder"
    When gui_act runs
    Then it opens the folder without moving the cursor through the UI

  Scenario: Accessibility is used before vision
    Given the sub-goal is "click Export in Keynote"
    And Keynote exposes an "Export" menu item in its accessibility tree
    When gui_act runs
    Then the cursor moves to the Export item and presses it through the accessibility API
    And no screenshot is sent to the model for that step

  Scenario: Vision fallback for an app without accessibility
    Given the target app exposes no actionable accessibility tree
    When gui_act runs
    Then a screenshot of the target window is sent to the model
    And the returned coordinates are converted to screen points before clicking

  Scenario: Retina scaling is handled
    Given the Mac display has a scale factor of 2
    When the model returns a click at image coordinates
    Then the click lands on the intended element

  Scenario: Sub-agent returns a summary
    Given gui_act finished exporting a PDF in 6 steps
    Then the orchestrator receives "Exported Q3 Report.pdf to Downloads"
    And it does not receive the screenshots or step history

  Scenario: Sub-agent hits its step limit
    Given gui_act has run 10 steps without finishing
    Then it stops
    And returns what it completed and where it got stuck
```

## Open questions

- Which demo tasks? Pick 3 across at least 3 apps.
