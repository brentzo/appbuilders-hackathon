---
id: OBJ-70
title: Harness takes approvals and Stop from the phone
product: harness
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-06, SPEC-07]
status: blocked
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

- [x] **OBJ-70.1** For a task from the phone, send the approval as `approvalRequest` instead of calling `showApprovalCard`, and tell the Mac app with `approvalWaitingElsewhere`.
- [x] **OBJ-70.2** Handle `approvalResponse`: match the approval, reject a delete approved by `voice` (SPEC-07 r11), continue or skip the action, and send `approvalAnsweredElsewhere` to the app.
- [x] **OBJ-70.3** Handle `pause`, `resume`, and `cancel` from the phone through the same task control as the Mac's own Stop: the action in progress finishes and no new one starts.
- [x] **OBJ-70.4** Answer `pauseConfirmed` only once the task is really paused, and `cancelConfirmed` once cancelled.
- [x] **OBJ-70.5** Tests with a scripted phone, and an update to `harness/README.md`.

## Expectations

- [x] The Mac side passes with a scripted phone: "Approval is asked on the phone", "Stop from the phone pauses the Mac".
- [x] `pauseConfirmed` is never sent while an action is still running.

## Expected outcomes

- Cross-device approval and control handling in `harness/src/approvals/` and `harness/src/control/`, with tests.

## Out of scope

- The phone's approval cards and Stop button: [OBJ-71](OBJ-71-android-approvals.md) and [OBJ-69](OBJ-69-android-delegated-goal-screen.md).
- The 5-minute approval timeout (SPEC-09 r10, "No answer to an approval"): [OBJ-77](OBJ-77-harness-cross-device-edge-cases.md).

## Outcome

- **Result:** Blocked.
  Every task and expectation is done and verified, but its hard dependencies [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) (`in-progress`) and [OBJ-68](OBJ-68-harness-delegated-goals.md) (`blocked`) are not `done`. It is done once they are. Brent cut approvals on the phone from the demo; these land after the cut, at Jepoy's request.
- **Delivered:** `harness/src/bridge-client/phone-approvals.ts` asks a phone goal's approvals on the phone as `approvalRequest` commands, with an envelope that expires with the approval, and tells the Mac app with `approvalWaitingElsewhere` and `approvalAnsweredElsewhere`. `src/approvals/approval-flow.ts` uses it for a task whose origin is the paired phone, never calling `showApprovalCard` then, and sends `approvalCancelled` to the phone when it closes an open approval. Pause, resume, and cancel are Brent's from OBJ-68; resume is now confirmed with `resumeConfirmed`.
- **Commits:** `6a442db feat(harness): add phone tools, approvals asked on the phone, a busy-Mac queue, and a locked-Mac hold to cross-device goals`.
- **Expectations:**
  - "Approval is asked on the phone" passes in `harness/test/cross-device.test.ts` (the banner, no card on the Mac, the move after a tap), and a delete answered by voice is asked again. "Stop from the phone pauses the Mac" passes in `harness/test/delegated-goals.test.ts`; `npm run verify` in `harness/` on Linux (36 test files, lint, and format).
  - `pauseConfirmed` is never sent while an action runs: it is sent after `TaskControl.pause`, which returns once the step in progress has its outcome.
- **Not verified:** The phone's approval card, which is [OBJ-71](OBJ-71-android-approvals.md).
- **Decisions and deviations:** A command the harness refuses, such as control of a goal the phone did not send, gets no result instead of the bridge client's old `{ ok: true }`, which was not a valid payload; the phone's own timeout covers it.
- **For the next objectives:** OBJ-71 answers `approvalRequest` with an `approvalResponse` result naming the request as `replyTo`, and closes its card on `approvalCancelled`.
