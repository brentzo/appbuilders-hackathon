---
id: OBJ-25
title: Cross-device message kinds
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-09, SPEC-06, SPEC-07, SPEC-08, SPEC-10]
status: todo
priority: p0
depends-on: [OBJ-01, OBJ-02]
integrates-with: []
tags: [objective, p0, protocol, bridge]
---

# OBJ-25 Cross-device message kinds

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md), [SPEC-06](../specs/06-user-control.md), [SPEC-07](../specs/07-safety.md), [SPEC-08](../specs/08-device-bridge.md), [SPEC-10](../specs/10-android-companion.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

All three demo moments cross the bridge: the alarm set on the phone from the Mac, the Keynote export spoken on the phone and run on the Mac, and Stop on the phone pausing the Mac.
[OBJ-02](OBJ-02-bridge-envelope-and-crypto.md) defines the encrypted envelope.
This objective defines what goes inside it, so the harness, the Android app, and later the iPhone app send and read the same messages.

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), all requirements. It is the source of truth for routing.
- [docs/device-bridge.md](../docs/device-bridge.md), "Message kinds" table.
- [SPEC-06](../specs/06-user-control.md) requirements 5, 8, and 13 (pause cancels approvals, cancel drops everything, the 10-second rule in p1).
- [SPEC-07](../specs/07-safety.md) requirements 10-15 (approval text from real data, tap-only delete).
- [SPEC-10](../specs/10-android-companion.md) requirements 2, 3, and 8 (phone tools, templates).
- The `Approval`, `ErrorKind`, and typed tool schemas from [OBJ-01](OBJ-01-task-record-schemas.md), and the envelope from OBJ-02.

## Tasks

- [ ] **OBJ-25.1** Write a `Payload` tagged union for everything inside the envelope, and document which envelope `type` each kind uses and its expiry, matching the table in [docs/device-bridge.md](../docs/device-bridge.md).
- [ ] **OBJ-25.2** Tools:
  - `toolList` (event, sent on connect): device id, and each tool's name, one-line description, and argument schema.
  - `toolCall` (command) and `toolResult` (result): success with optional data, or a failure with an `ErrorKind`, never raw error text.
  - Argument schemas for the p0 phone tools: `set_alarm` (local time, optional label, optional repeat days), `set_timer` (seconds, optional label), `open_app` (app name or package).
- [ ] **OBJ-25.3** Delegated goals:
  - `delegateGoal` (command, origin device to Mac): goal id, confirmed goal text, origin device id, spoken-at time. The goal id becomes the Mac's task id.
  - `goalAccepted` (result): started now, or `queued` behind another task with that task's title, for the busy message (SPEC-09 r14).
  - `progress` (event): goal id, task status, current subtask title. Sent on every change and at least every 30 seconds while running, so the origin device can tell "slow" from "gone" (SPEC-09 r17).
  - `goalFinished` (event): goal id, final status, spoken summary.
- [ ] **OBJ-25.4** Approvals:
  - `approvalRequest` (command, executing device to origin device, 5-minute expiry): the `Approval` from OBJ-01 without the decision.
  - `approvalResponse` (result): approval id and `ApprovalDecision`, including `method`. The executing device rejects a delete approved by `voice` (SPEC-07 r11).
  - `approvalCancelled` (event): sent when a pause cancels pending approvals (SPEC-06 r5).
- [ ] **OBJ-25.5** Control:
  - `pause`, `resume`, and `cancel` (commands, either direction) with the goal id.
  - `pauseConfirmed` and `cancelConfirmed` (results). The origin device shows "Paused" only after `pauseConfirmed` (SPEC-09 r12).
- [ ] **OBJ-25.6** Write example JSON for every kind, covering the three demo moments end to end: the alarm from the Mac, the Keynote export from the phone with progress and a finish, and Stop from the phone with the pause confirmed.
- [ ] **OBJ-25.7** Tests: every example validates, a kind sent with the wrong envelope type is rejected, an approval request gets the 5-minute expiry and every other command gets 2 minutes, and a delete `approvalResponse` with `method: voice` is marked invalid by the helper the apps use.
- [ ] **OBJ-25.8** Regenerate TypeScript, Swift, and Kotlin types, and update `protocol/README.md`.

## Expectations

- [ ] Every requirement in SPEC-09 that sends something across the bridge maps to a message kind, listed in a table in `protocol/README.md`.
- [ ] The three demo moments can be written as message sequences using only these kinds.
- [ ] No payload carries raw error text.
- [ ] Generated types compile in TypeScript, Swift, and Kotlin.

## Expected outcomes

- `protocol/schemas/` payload schemas and phone tool argument schemas, with generated types.
- Example sequences for the three demo moments.
- An updated `protocol/README.md`.

## Out of scope

- Sending and receiving these messages: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Mac), [OBJ-23](OBJ-23-android-bridge-client.md) (Android).
- The 10-second liveness rule (SPEC-06 r13) is p1. The 30-second `progress` keepalive is enough for p0.
- p1 phone tools (`get_location`, `read_recent_photos`, `phone_gui_act`) and Wake-on-LAN.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
