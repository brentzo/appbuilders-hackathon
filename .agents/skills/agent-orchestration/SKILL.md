---
name: agent-orchestration
description: Coordinate objective work across Codex agents when parallel agents are available. Use when starting, monitoring, stopping, reviewing, or integrating worker agents. Keep each worker isolated in its own Git worktree and follow the objective and product ownership rules.
---

# Agent orchestration

The orchestrator coordinates objective work and owns integration into `main`.
Use the repository's available Codex agent tools when they are enabled; do not assume an agent CLI or terminal manager exists.
Read [git-workflow](../git-workflow/SKILL.md) and [objective-lifecycle](../objective-lifecycle/SKILL.md) first.

## Before starting a worker

1. Confirm the objective with the lead, or choose the assignee's earliest `todo` objective whose hard dependencies are all `done`.
2. Check whether another person or agent is already working on it.
3. Confirm the base branch contains the latest objective and spec files.
4. Check required toolchains and devices. Do not install system tools unless asked.

## Isolate and brief

Create a dedicated worktree and objective branch from the agreed base, following [git-workflow](../git-workflow/SKILL.md).
Give the worker a complete brief using [brief-template.md](brief-template.md).
Include the worktree, branch, base commit, objective, specs and docs to read, allowed product folders, stand-ins, available tools, missing tools, and verification steps.
Workers must not push or modify `main`.

## Monitor and stop

Use available agent controls to inspect the worker's progress and final report.
If blocked, answer only from repository sources; raise unresolved product decisions to the lead.
Before stopping a worker, inspect its branch commits and working tree.
Keep useful work for review; remove the worktree and branch only after confirming the work is not needed or has been integrated.

## Review and integrate

1. Read the final report and objective Outcome.
2. Review the diff against the objective, product boundaries, and specs.
3. Rebase onto the agreed current `main`; resolve conflicts with [git-workflow](../git-workflow/SKILL.md).
4. Run the objective index/check and the product's documented build and tests.
5. Fast-forward local `main` only after review and verification. Push only when explicitly asked.
6. Remove the worktree and branch only after the commits are safely integrated.
7. Report what landed and what was or was not verified.
