---
id: OBJ-64
title: Local RPC for cross-device routing on the Mac
product: protocol
assignee: Jepoy
touches: [mac]
specs: [SPEC-09]
status: done
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

- [x] **OBJ-64.1** Add an optional `deviceId` (this Mac's bridge device id) to `HelloResult` and `BridgeStateChanged`, documented as the value the app sends as `originDeviceId`.
- [x] **OBJ-64.2** Add the events `approvalWaitingElsewhere` (approval id, task id, asking device, approval kind) and `approvalAnsweredElsewhere` (approval id), and say in `x-rpc` that the harness never calls `showApprovalCard` for a task from another device.
- [x] **OBJ-64.3** Examples for each change and a mock harness script `delegated-approval.json` that plays a phone goal reaching an approval and the phone answering.
- [x] **OBJ-64.4** Regenerate the TypeScript, Swift, and Kotlin types, run the tests, and update `protocol/README.md`.

## Expectations

- [x] The Mac app can learn its bridge device id from the harness without a new method call.
- [x] Generated types compile in TypeScript, Swift, and Kotlin.

## Expected outcomes

- `protocol/schemas/rpc.json` changes, examples, a mock script, and regenerated types.

## Out of scope

- Messages across the bridge: done in [OBJ-25](OBJ-25-cross-device-messages.md).

## Outcome

- **Result:** Done.
  OBJ-64.1 is Brent's; OBJ-64.2 to OBJ-64.4, which Brent cut for the demo, were added afterwards at Jepoy's request, as optional events that change nothing for an app that ignores them.
- **Delivered:**
  - `HelloResult.deviceId` and `BridgeStateChanged.deviceId` in `protocol/schemas/rpc.json`, with the examples `HelloResult.with-device.json` and `BridgeStateChanged.connected.json` (Brent).
  - The events `approvalWaitingElsewhere` (`ApprovalWaitingElsewhere`) and `approvalAnsweredElsewhere` (`ApprovalAnsweredElsewhere`), the `x-rpc` note on `showApprovalCard` that it is never called for a task from another device, and `ApprovalCancelled` documented as also closing the banner, including after the 5-minute timeout.
  - Examples `ApprovalWaitingElsewhere.send-to-ana` and `ApprovalAnsweredElsewhere.send-to-ana`, `HelloResult.v1` with the same device id as `BridgeStateChanged.connected`, and the mock harness script `protocol/mocks/scripts/delegated-approval.json`.
  - The two decoder cases in `mac/Yumi/Harness/HarnessEvent.swift`, so the Mac app keeps building, since its switch over `RpcEvent` is exhaustive (as in OBJ-45.3).
  - Regenerated TypeScript, Swift, and Kotlin types, and `protocol/README.md` notes under "Local RPC", "Rules the schemas cannot express", and the script table.
- **Commits:**
  - `28f7ac6 feat(protocol): report this Mac's bridge device id in hello and bridgeStateChanged` (Brent)
  - `2c3d40b feat(protocol): add the approval banner events for goals from another device (OBJ-64)`
  - `1ebc1c7 docs(protocol): say the approval timeout closes the banner and list the origin-device approval rule (OBJ-64 review)`
- **Expectations:**
  - The Mac app learns its bridge device id from `hello` and `bridgeStateChanged` with no new method call: `harness/test/delegated-goals.test.ts`, `mac/YumiTests/HarnessClientTests.swift`, and `protocol/test/mocks.test.ts` "plays a goal from the phone reaching an approval", which checks the mock harness's `hello` and bridge event name the same id.
  - Generated types compile: `npm run verify` in `protocol/`, and `npm run compile:swift` and `npm run compile:kotlin` round-trip every example.
- **Not verified:** The Mac app build with the two decoder cases, since no Mac with Xcode was available. Patrick or Brent: run the Xcode build and tests on `mac/`.
- **Decisions and deviations:**
  - Every addition is optional or a new event, so the protocol version stays 4.
  - `approvalAnsweredElsewhere` carries no decision; what happens next comes as the usual task and cursor events.
  - The approval events land after Brent's demo cut. They change nothing until the harness sends them ([OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md)) and the Mac shows the banner ([OBJ-72](OBJ-72-mac-cross-device-routing.md)); Brent can revert them if they should wait.
- **For the next objectives:**
  - OBJ-72 (Mac): show the banner on `approvalWaitingElsewhere` and close it on `approvalAnsweredElsewhere` or `approvalCancelled` with the same approval id. Both events reach the `default` branch in `HarnessLink.swift` today.
  - OBJ-70 (harness): never call `showApprovalCard` for a task whose origin is another device, and send the two events instead.
  - Build the Mac side against `npm run mock:harness -- --script delegated-approval`.
