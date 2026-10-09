---
id: OBJ-70
title: Harness takes approvals and Stop from the phone
product: harness
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-06, SPEC-07]
status: todo
priority: p0
depends-on: [OBJ-38, OBJ-68]
integrates-with: [OBJ-64, OBJ-69, OBJ-71, OBJ-72]
tags: [objective, p0, harness, bridge, safety, control]
---

# OBJ-70 Harness takes approvals and Stop from the phone

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md), [SPEC-06](../specs/06-user-control.md), [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

[OBJ-38](OBJ-38-approvals-pause-and-action-log.md) asks approvals and pauses on the Mac, and left the other device out of scope.
For a goal from the phone, risky actions ask on the phone while the Mac shows only a banner (SPEC-09 r10), and Stop on the phone pauses the Mac, which confirms before the phone shows "Paused" (r11, r12).

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 10 to 12, and the scenarios "Approval is asked on the phone" and "Stop from the phone pauses the Mac".
- [SPEC-07](../specs/07-safety.md) requirement 11 (deletes need a tap).
- [protocol/schemas/messages.json](../protocol/schemas/messages.json): `approvalRequest`, `approvalResponse`, `pause`, `resume`, `cancel`, `pauseConfirmed`, `cancelConfirmed`.
- `harness/src/approvals/approval-flow.ts`, `harness/src/control/run-control.ts`, `harness/src/scheduler/task-control.ts`.
- [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) and [OBJ-68](OBJ-68-harness-delegated-goals.md) Outcomes, and [OBJ-64](OBJ-64-cross-device-local-rpc-contract.md).

## Tasks

- [ ] **OBJ-70.1** For a task from the phone, send the approval as `approvalRequest` instead of calling `showApprovalCard`, and tell the Mac app with `approvalWaitingElsewhere`.
- [ ] **OBJ-70.2** Handle `approvalResponse`: match the approval, reject a delete approved by `voice` (SPEC-07 r11), continue or skip the action, and send `approvalAnsweredElsewhere` to the app.
- [ ] **OBJ-70.3** Handle `pause`, `resume`, and `cancel` from the phone through the same task control as the Mac's own Stop: the action in progress finishes and no new one starts.
- [ ] **OBJ-70.4** Answer `pauseConfirmed` only once the task is really paused, and `cancelConfirmed` once cancelled.
- [ ] **OBJ-70.5** Tests with a scripted phone, and an update to `harness/README.md`.

## Expectations

- [ ] The Mac side passes with a scripted phone: "Approval is asked on the phone", "Stop from the phone pauses the Mac".
- [ ] `pauseConfirmed` is never sent while an action is still running.

## Expected outcomes

- Cross-device approval and control handling in `harness/src/approvals/` and `harness/src/control/`, with tests.

## Out of scope

- The phone's approval cards and Stop button: [OBJ-71](OBJ-71-android-approvals.md) and [OBJ-69](OBJ-69-android-delegated-goal-screen.md).
- Edge cases not planned yet: the 5-minute approval timeout (SPEC-09 r10, "No answer to an approval").

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
