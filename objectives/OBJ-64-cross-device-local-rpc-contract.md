---
id: OBJ-64
title: Local RPC for cross-device routing on the Mac
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-09]
status: todo
priority: p0
depends-on: [OBJ-25]
integrates-with: [OBJ-68, OBJ-70, OBJ-72]
tags: [objective, p0, protocol, bridge, contracts]
---

# OBJ-64 Local RPC for cross-device routing on the Mac

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

[OBJ-25](OBJ-25-cross-device-messages.md) defined the messages that cross the bridge, but the local RPC between the harness and the Mac app has two gaps for SPEC-09.
The Mac app sends `mac-local` as `originDeviceId` because nothing tells it its bridge device id (the follow-up recorded in [OBJ-17](OBJ-17-goal-confirmation.md)).
And when a goal from the phone needs an approval, the Mac must show "Waiting for your OK on your phone" with no buttons (SPEC-09 r10), which no RPC event carries.
This small contract unblocks the harness ([OBJ-68](OBJ-68-harness-delegated-goals.md), [OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md)) and the Mac app ([OBJ-72](OBJ-72-mac-cross-device-routing.md)).

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 3, 8, and 10.
- [protocol/schemas/rpc.json](../protocol/schemas/rpc.json): `HelloResult`, `BridgeStateChanged`, `SubmitGoalParams`, and the `x-rpc` lists.
- [OBJ-17](OBJ-17-goal-confirmation.md) "Out of scope", the `originDeviceId` follow-up.
- The contracts-and-stand-ins skill.

## Tasks

- [ ] **OBJ-64.1** Add an optional `deviceId` (this Mac's bridge device id) to `HelloResult` and `BridgeStateChanged`, documented as the value the app sends as `originDeviceId`.
- [ ] **OBJ-64.2** Add the events `approvalWaitingElsewhere` (approval id, task id, asking device, approval kind) and `approvalAnsweredElsewhere` (approval id), and say in `x-rpc` that the harness never calls `showApprovalCard` for a task from another device.
- [ ] **OBJ-64.3** Examples for each change and a mock harness script `delegated-approval.json` that plays a phone goal reaching an approval and the phone answering.
- [ ] **OBJ-64.4** Regenerate the TypeScript, Swift, and Kotlin types, run the tests, and update `protocol/README.md`.

## Expectations

- [ ] The Mac app can learn its bridge device id from the harness without a new method call.
- [ ] Generated types compile in TypeScript, Swift, and Kotlin.

## Expected outcomes

- `protocol/schemas/rpc.json` changes, examples, a mock script, and regenerated types.

## Out of scope

- Messages across the bridge: done in [OBJ-25](OBJ-25-cross-device-messages.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
