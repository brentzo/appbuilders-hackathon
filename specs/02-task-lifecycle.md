---
id: SPEC-02
title: Task lifecycle and resume
priority: p0
devices: [mac, android]
status: draft
tags: [spec, p0, harness, mac, android]
---

# SPEC-02 Task lifecycle and resume

## Summary

Long-running work is owned by the harness, not the model.
Every task lives in a task record on disk, so it survives crashes, stops, and reboots, and any worker can pick up the next step.
Schema: [task-record-schema](../docs/task-record-schema.md).

## Requirements

1. Each confirmed goal creates one Task, split by the planner into Subtasks, each made of Steps.
2. Task statuses: `awaitingConfirmation`, `planning`, `running`, `waitingForUser`, `paused`, `done`, `failed`, `cancelled`.
3. A step row is written before its action runs, and its outcome is written after.
4. On restart, a step with no outcome is treated as `noEffect`, and the screen is re-captured before continuing.
5. Workers receive only: the confirmed goal, the subtask instruction, the last 3-5 steps, a fresh screen capture, and the tools for their lane.
6. Workers return exactly one action, validated against a JSON schema.
7. Subtasks with no unmet dependencies may run in parallel, subject to [SPEC-03](03-lane-routing.md).
8. Limits are enforced: 25 steps per subtask, 3 attempts per subtask, subtask depth 1.
9. When a task finishes, Yumi speaks a one or two sentence summary on the device the user spoke to. If the summary cannot be written, Yumi says "Done. I finished everything you asked for."
10. Task records (tasks, subtasks, steps, the action log, and step screenshots) are kept forever. Nothing is deleted automatically.
11. The user can browse and search past tasks from the Mac menu bar and the phone app.

## Scenarios

```gherkin
@p0 @harness @mac
Feature: Task lifecycle

  Scenario: Planner splits a goal into subtasks
    Given the user confirmed "summarize the 5 PDFs in Downloads into one note"
    When planning finishes
    Then the task has subtasks for reading each PDF and one for writing the note
    And the note subtask depends on all reading subtasks
    And the task status is "running"

  Scenario: Task finishes and reports back
    Given every subtask of a task is done
    Then the task status is "done"
    And Yumi says a short summary such as "Done. I put the summary of all 5 PDFs in a new note called PDF Summary."

  Scenario: Resume after the app crashes
    Given a task is running and step 4 of a subtask has started
    When the Yumi app crashes and is reopened
    Then Yumi says "I was interrupted while working on your task. Want me to pick up where I left off?"
    When the user says "yes"
    Then step 4 is marked "noEffect"
    And the screen is captured again before the next step

  Scenario: Resume after a reboot
    Given a task was paused before the Mac restarted
    When Yumi starts after the reboot
    Then the paused task is listed with a "Resume" button
    And nothing runs until the user resumes it

  Scenario: Worker returns an invalid action
    Given a worker is running a step
    When the model output does not match the action schema
    Then the step outcome is "invalidOutput"
    And the step is retried once with the validation error in the prompt

  Scenario: Step limit is reached
    Given a subtask has run 25 steps
    When it has not finished
    Then the subtask status is "failed"
    And the user hears the error from SPEC-11 for "task took too long"

  Scenario: Finished tasks are kept
    Given a task finished 6 months ago
    When the user searches past tasks for "invoices"
    Then the task is found with its steps and action log
```

## Decisions

- If the task summary cannot be written, Yumi says "Done. I finished everything you asked for." instead of saying nothing (requirement 9). Decided 2026-10-09.

## Revisit after the hackathon

- Screenshots are kept forever for now, as a demo-phase trade-off. They are much larger than text records and can show private information. Before real users, decide on a retention period, a size limit, or a way for users to delete them.
