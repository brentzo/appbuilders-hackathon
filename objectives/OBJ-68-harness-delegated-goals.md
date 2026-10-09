---
id: OBJ-68
title: Harness runs goals sent from the phone
product: harness
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-02]
status: todo
priority: p0
depends-on: [OBJ-05, OBJ-25, OBJ-49]
integrates-with: [OBJ-23, OBJ-64, OBJ-67, OBJ-69]
tags: [objective, p0, harness, bridge, phone]
---

# OBJ-68 Harness runs goals sent from the phone

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md), [SPEC-02](../specs/02-task-lifecycle.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The second SPEC-09 demo moment is "export my Keynote deck as a PDF" spoken on the phone and done by the cursor on the Mac.
The phone sends the confirmed goal as `delegateGoal`; the Mac runs it without asking again, and progress and the result go back to the phone.
Today a task from the phone is spoken on the Mac (the stand-in in `harness/src/scheduler/run-task.ts`), and the harness records this Mac as `mac-local`.
This objective makes the harness the executing device and moves it to its bridge device id, the follow-up recorded in [OBJ-17](OBJ-17-goal-confirmation.md).

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 3 to 9, and the scenario "Phone goal is delegated to the Mac".
- [protocol/schemas/messages.json](../protocol/schemas/messages.json) (`delegateGoal`, `goalAccepted`, `progress`, `goalFinished`) and the examples `protocol/examples/Payload.delegateGoal.json` and `protocol/examples/Task.running-delegated.json`.
- `harness/src/scheduler/run-task.ts`, `harness/src/scheduler/scheduler.ts`, `harness/src/store/`, `harness/src/main.ts`.
- [OBJ-17](OBJ-17-goal-confirmation.md) Outcome and [OBJ-64](OBJ-64-cross-device-local-rpc-contract.md).

## Tasks

- [ ] **OBJ-68.1** Use this Mac's bridge device id for its tasks and action log instead of `mac-local`, keep reading older `mac-local` records as this Mac, and report the id to the app as [OBJ-64](OBJ-64-cross-device-local-rpc-contract.md) defines.
- [ ] **OBJ-68.2** Handle `delegateGoal`: create the task with the goal id as task id and the phone as origin, straight into planning with no repeat-back (SPEC-09 r5), and answer `goalAccepted`.
- [ ] **OBJ-68.3** Send `progress` to the phone on every status change and at least every 30 seconds while running, with the current subtask title.
- [ ] **OBJ-68.4** Send `goalFinished` with the spoken summary and do not speak it on the Mac; replace the stand-in in `run-task.ts`. The cursor works on the Mac as for any task.
- [ ] **OBJ-68.5** Tests with a scripted phone on the relay stand-in, and an update to `harness/README.md`.

## Expectations

- [ ] The Mac side of SPEC-09 "Phone goal is delegated to the Mac" passes with a scripted phone.
- [ ] A delegated task never shows the Mac's repeat-back and never speaks its summary on the Mac.

## Expected outcomes

- A delegated-goal handler in `harness/src/` wired to the scheduler and the bridge client, with tests.

## Out of scope

- Approvals and Stop from the phone: [OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md).
- Edge cases not planned yet: the Mac busy with another task (SPEC-09 r14, "Mac is busy").

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
