---
id: OBJ-77
title: Harness edge cases for cross-device routing
product: harness
assignee: Brent
touches: []
specs: [SPEC-09]
status: done
priority: p0
depends-on: [OBJ-76]
integrates-with: [OBJ-65, OBJ-68, OBJ-70, OBJ-78]
tags: [objective, p0, harness, bridge, safety]
---

# OBJ-77 Harness edge cases for cross-device routing

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The harness SPEC-09 objectives leave out what happens when the other device is away or slow.
A phone tool call to an offline phone must fail at once, a goal from the phone that arrives while the Mac is busy must queue behind the current task, and an approval asked on the phone that gets no answer for 5 minutes must pause the task.

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 10, 14, and 16, and the scenarios "Phone is offline when the Mac calls a tool", "Mac is busy", and "No answer to an approval".
- [OBJ-76](OBJ-76-cross-device-edge-case-contracts.md) Outcome and `protocol/README.md`, the edge case sequences.
- [OBJ-65](OBJ-65-harness-phone-tool-lane.md), [OBJ-68](OBJ-68-harness-delegated-goals.md), and [OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md) Outcomes.

## Tasks

- [x] **OBJ-77.1** A `phone` call to a phone the relay reports offline (`targetOffline`) fails at once with `otherDeviceOffline` and is never queued; the brain tells the user with the SPEC-11 copy (SPEC-09 r16).
- [x] **OBJ-77.2** A `delegateGoal` that arrives while another task runs is queued behind it and answered with `goalAccepted` status `queued` and the running task's title, then started when the current task ends (SPEC-09 r14).
- [x] **OBJ-77.3** An approval asked on the phone that gets no `approvalResponse` by its `expiresAt` pauses the task, sends `approvalCancelled` to the phone and the app, and `progress` with status `paused` (SPEC-09 r10).
- [x] **OBJ-77.4** Tests with a scripted phone for each case, and an update to `harness/README.md`.

## Expectations

- [x] The Mac side passes with a scripted phone: "Phone is offline when the Mac calls a tool", "Mac is busy", "No answer to an approval".
- [x] No phone call is queued, and none waits longer than 2 minutes.

## Expected outcomes

- Edge case handling in `harness/src/`, with tests.

## Out of scope

- The phone's side of these cases: [OBJ-78](OBJ-78-android-cross-device-edge-cases.md).
- Waking the Mac and the locked screen: [OBJ-80](OBJ-80-harness-wake-and-lock.md).

## Outcome

- **Result:** Done.
- **Delivered:** in `harness/src/bridge-client/`: a phone call fails at once on `targetOffline` (`phone-tools.ts`), a goal from the phone queues behind a working task (`delegated-goals.ts`), and an approval with no answer by `expiresAt` closes and pauses the task (`src/approvals/approval-flow.ts`, wired in `src/harness.ts`). The bridge client reports undelivered messages to them (`onUndelivered`).
- **Commits:** `6a442db feat(harness): add phone tools, approvals asked on the phone, a busy-Mac queue, and a locked-Mac hold to cross-device goals`.
- **Expectations:**
  - "Phone is offline when the Mac calls a tool", "Mac is busy", and "No answer to an approval" pass in `harness/test/cross-device.test.ts` with a scripted phone on the fake relay; `npm run verify` in `harness/` on Linux (36 test files, lint, and format).
  - No phone call is queued, and none waits longer than 2 minutes: an offline call fails in under a second in that test, and `PHONE_CALL_MS` ends any other wait at 2 minutes.
- **Not verified:** Nothing.
- **Decisions and deviations:**
  - The 5-minute timeout pauses a task from the Mac too, since `Approval.expiresAt` says so for every approval.
  - A paused queued goal leaves the queue and starts only on `resume`.
- **For the next objectives:** the phone sees a busy Mac as `goalAccepted` `queued` with `activeTaskTitle`, and a timed-out approval as `approvalCancelled` followed by `progress` `paused` ([OBJ-78](OBJ-78-android-cross-device-edge-cases.md)).
