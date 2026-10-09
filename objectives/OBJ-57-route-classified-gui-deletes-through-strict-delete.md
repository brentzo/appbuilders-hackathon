---
id: OBJ-57
title: Route classified GUI delete asks through strict delete
product: harness
assignee: Brent
touches: []
specs: [SPEC-07]
status: todo
priority: p0
depends-on: [OBJ-37, OBJ-38]
integrates-with: [OBJ-36, OBJ-40]
tags: [objective, p0, harness, safety, approval]
---

# OBJ-57 Route classified GUI delete asks through strict delete

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps.
> The Mac and phone control each other through an end-to-end encrypted bridge on our VPS.
> All AI runs on the devices.
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-07 classifies accessibility actions labelled "Delete" or "Move to Trash" and Finder Command-Delete as asks.
The harness strict-delete flow approves only exact file paths and performs deletion through `move_to_trash`.
These GUI actions currently have no supported route into that flow, leaving a gap between the safety spec and the implementation objectives.

## Read first

- [SPEC-07](../specs/07-safety.md), requirement 6, "Strict delete" scenarios, and the Finder key-press rules.
- [harness/README.md](../harness/README.md), especially file tools and approvals.
- [OBJ-37](OBJ-37-permission-gate-and-file-tools.md), the permission gate and typed file tools.
- [OBJ-38](OBJ-38-approvals-pause-and-action-log.md), strict-delete behavior and the documented gap.
- [OBJ-36](OBJ-36-gui-act-sub-agent.md) and [OBJ-40](OBJ-40-mac-approval-cards.md), GUI execution and Mac approval cards.

## Tasks

- [ ] **OBJ-57.1** Agree with the harness and Mac owners how a classified GUI delete request maps to the existing strict-delete flow; record any needed spec clarification before implementation.
- [ ] **OBJ-57.2** Ensure direct accessibility Delete/Move to Trash and Finder Command-Delete never execute as GUI actions.
- [ ] **OBJ-57.3** Route a supported request through exact-path resolution, a strict-delete approval, a fresh path recheck, and `move_to_trash`; refuse safely when exact paths cannot be established.
- [ ] **OBJ-57.4** Add end-to-end tests for classified labels and Finder Command-Delete, covering approval, decline, changed paths, and prevention of direct GUI deletion.
- [ ] **OBJ-57.5** Document the supported routing and refusal behavior in the Harness README and the linked objective outcomes.

## Expectations

- [ ] Classified deletion asks use the existing strict-delete safeguards and exact-path tool.
- [ ] Direct GUI deletion does not run, including after approval or a stale observation.
- [ ] Declines and stale file lists do not delete files.
- [ ] Scenarios and user-facing behavior match SPEC-07, with any unclear copy resolved in the spec before implementation.

## Expected outcomes

- Classified GUI deletion asks safely routed through the existing exact-path strict-delete flow, with tests and documentation.

## Out of scope

- The contract for unclassified risky actions, tracked by [OBJ-50](OBJ-56-unclassified-action-approval-contract.md).
- The underlying permission levels and typed file tools, tracked by [OBJ-37](OBJ-37-permission-gate-and-file-tools.md).
- Mac approval card implementation, tracked by [OBJ-40](OBJ-40-mac-approval-cards.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
