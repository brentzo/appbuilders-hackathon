---
id: OBJ-72
title: Mac app side of cross-device routing
product: mac
assignee: Patrick
touches: []
specs: [SPEC-09]
status: in-progress
priority: p0
depends-on: [OBJ-14]
integrates-with: [OBJ-64, OBJ-68, OBJ-70]
tags: [objective, p0, mac, bridge, ux]
---

# OBJ-72 Mac app side of cross-device routing

**Product:** [Yumi Mac](../mac/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The harness does the routing, but the Mac app has two jobs in SPEC-09.
It must send its bridge device id as `originDeviceId` instead of `mac-local` (the follow-up in [OBJ-17](OBJ-17-goal-confirmation.md)), and show "Waiting for your OK on your phone" with no buttons while a goal from the phone waits for approval (SPEC-09 r10).
Build against the mock harness script from [OBJ-64](OBJ-64-cross-device-local-rpc-contract.md).

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 8 and 10, and the scenario "Approval is asked on the phone".
- [protocol/schemas/rpc.json](../protocol/schemas/rpc.json) after [OBJ-64](OBJ-64-cross-device-local-rpc-contract.md).
- `mac/Yumi/Harness/HarnessClient.swift`, `mac/Yumi/Harness/HarnessEvent.swift`, `mac/Yumi/Approvals/`.

## Tasks

- [x] **OBJ-72.1** Read this Mac's bridge device id from `hello` and `bridgeStateChanged`, and send it as `originDeviceId` in `submitGoal`; keep `mac-local` only until the harness reports one.
- [ ] **OBJ-72.2** Show the "Waiting for your OK on your phone" banner, with no buttons, on `approvalWaitingElsewhere`, and close it on `approvalAnsweredElsewhere`, `approvalCancelled`, or the task leaving the approval.
- [x] **OBJ-72.3** Make sure a task from the phone shows its cursor as usual but no repeat-back or summary card on the Mac.
- [x] **OBJ-72.4** Tests against the mock harness, and an update to [mac/README.md](../mac/README.md).

## Expectations

- [ ] Against the mock harness script, the banner shows during a phone approval and closes when the phone answers.
- [x] After the harness reports a device id, every `submitGoal` carries it.

## Expected outcomes

- Changes in `mac/Yumi/Harness/` and `mac/Yumi/Approvals/`, with tests.

## Out of scope

- The approval cards themselves: [OBJ-40](OBJ-40-mac-approval-cards.md).
- Stop on the Mac for its own tasks: [OBJ-35](OBJ-35-mac-stop-and-take-over.md).

## Outcome

- **Result:** In progress.
  OBJ-72.1, OBJ-72.3, and OBJ-72.4 are done; OBJ-72.2 was cut for the demo by Brent's decision (approvals on the phone are out of the demo).
- **Delivered:** `mac/Yumi/Harness/HarnessClient.swift` (`onDeviceId`, from `hello`), `mac/Yumi/Harness/HarnessLink.swift` (reads the id from `hello` and `bridgeStateChanged`, sends it as `originDeviceId`, falls back to `mac-local`), tests in `mac/YumiTests/HarnessClientTests.swift` and `mac/YumiTests/AutoModeTests.swift`, and the `mac/README.md` note.
- **Commits:** `994614d feat(mac): send this Mac's bridge device id as originDeviceId`.
- **Expectations:** "After the harness reports a device id, every `submitGoal` carries it" is verified by `AutoModeTests.everyGoalCarriesThisMacsBridgeDeviceIdOnceKnown` and `HarnessClientTests.helloReportsThisMacsBridgeDeviceId`. OBJ-72.3 holds because the harness withholds the repeat-back and summary events for a phone task, so the cursor shows as usual and nothing else appears.
- **Not verified:** the banner expectation needs OBJ-72.2, which is cut; the live run on the demo Mac is not done.
- **Decisions and deviations:** OBJ-72.2 (the "Waiting for your OK on your phone" banner) was cut for the demo by Brent's decision.
- **For the next objectives:** when OBJ-72.2 returns, the Mac app reads the `approvalWaitingElsewhere` and `approvalAnsweredElsewhere` events from OBJ-64.2.
