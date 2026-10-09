---
id: OBJ-56
title: Approval contract for unclassified risky actions
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-07]
status: todo
priority: p0
depends-on: [OBJ-01]
integrates-with: [OBJ-36, OBJ-38, OBJ-40]
tags: [objective, p0, protocol, safety, approval]
---

# OBJ-56 Approval contract for unclassified risky actions

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-07](../specs/07-safety.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-07 requirement 6 says an accessibility action or key press the harness cannot classify asks in risky apps.
The current `ApprovalKind` contract only represents sends and deletes, so the harness cannot show that approval through the existing RPC.
This objective adds the shared contract that lets the harness and Mac app represent one unclassified risky action without taking its description from model text.

## Read first

- [SPEC-07](../specs/07-safety.md), requirements 1, 6, 13-15, and the "Sending" scenarios.
- [protocol/README.md](../protocol/README.md), especially the approval schema and generated types overview.
- [protocol/schemas/approval.json](../protocol/schemas/approval.json) and `ShowApprovalCardParams` in [protocol/schemas/rpc.json](../protocol/schemas/rpc.json).
- The [OBJ-38 Outcome](OBJ-38-approvals-pause-and-action-log.md), especially the documented unclassified-action gap.
- [OBJ-36](OBJ-36-gui-act-sub-agent.md) and [OBJ-40](OBJ-40-mac-approval-cards.md), which consume the contract.

## Tasks

- [ ] **OBJ-56.1** Agree with the harness and Mac owners on the safe action description and approval methods for one unclassified click or key press, using only the resolved action and SPEC-07 r6. Record any required copy or behavior decision in the appropriate spec before changing the contract.
- [ ] **OBJ-56.2** Extend the approval schema and generated TypeScript, Swift, and Kotlin types to represent the agreed generic action approval while preserving the send and delete constraints.
- [ ] **OBJ-56.3** Add valid examples and tests for the generic action approval and its decision, and reject malformed contract data.
- [ ] **OBJ-56.4** Document how the harness and Mac app use the generated contract in `protocol/README.md`.
- [ ] **OBJ-56.5** Extend the mock Mac app and its scripted responses to exercise the agreed generic approval decision end to end.

## Expectations

- [ ] The contract can represent one unclassified risky GUI action using the agreed safe description and approval methods; the harness remains responsible for building that description from the resolved action, not model text.
- [ ] Existing send and delete approval examples remain valid, and their distinct safeguards remain enforced.
- [ ] Generated TypeScript, Swift, and Kotlin types compile and are current.
- [ ] The generated mock Mac app validates and returns a scripted generic approval decision.

## Expected outcomes

- A shared approval contract for unclassified risky GUI actions, with generated types, examples, tests, and documentation.

## Out of scope

- Choosing action permission levels, which remain in [SPEC-07](../specs/07-safety.md) and [OBJ-37](OBJ-37-permission-gate-and-file-tools.md).
- Wiring generic approvals into the Harness flow: [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) and [OBJ-36](OBJ-36-gui-act-sub-agent.md).
- Presenting generic approvals in the Mac UI: [OBJ-40](OBJ-40-mac-approval-cards.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
