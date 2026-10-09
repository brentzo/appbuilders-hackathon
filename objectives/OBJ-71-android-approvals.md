---
id: OBJ-71
title: Approvals on the phone for goals running on the Mac
product: android
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-07]
status: todo
priority: p0
depends-on: [OBJ-69]
integrates-with: [OBJ-70]
tags: [objective, p0, android, bridge, safety, ux]
---

# OBJ-71 Approvals on the phone for goals running on the Mac

**Product:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md), [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Risky actions in a goal sent from the phone ask for approval on the phone (SPEC-09 r10).
For "email the Q3 deck to Ana", the phone says the approval and shows "Send" and "Don't send".
Until the harness side ([OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md)) lands, drive it with a scripted Mac.

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirement 10 and the scenario "Approval is asked on the phone".
- [SPEC-07](../specs/07-safety.md), the approval copy and requirement 11.
- [protocol/schemas/approval.json](../protocol/schemas/approval.json) and the examples `protocol/examples/Payload.approvalRequest-send.json` and `protocol/examples/Payload.approvalResponse.json`.
- [OBJ-69](OBJ-69-android-delegated-goal-screen.md) Outcome.

## Tasks

- [ ] **OBJ-71.1** On `approvalRequest`, show an approval card over the working state with the approval's `text` and the buttons SPEC-07 names for its kind, and speak the text.
- [ ] **OBJ-71.2** If the app is in the background, post a notification that opens the card.
- [ ] **OBJ-71.3** Send `approvalResponse` with the decision and `method`; for deletes, accept only a tap.
- [ ] **OBJ-71.4** Close the card on `approvalCancelled` or when the task leaves the approval.
- [ ] **OBJ-71.5** Tests with a scripted Mac.

## Expectations

- [ ] The phone side of SPEC-09 "Approval is asked on the phone" passes with a scripted Mac.
- [ ] A delete can only be approved with a tap.

## Expected outcomes

- The phone's approval card and answer flow in `android/app/src/main/java/ai/yumi/android/`, with tests.

## Out of scope

- The Mac's "Waiting for your OK on your phone" banner: [OBJ-72](OBJ-72-mac-cross-device-routing.md).
- Edge cases not planned yet: the 5-minute approval timeout ("No answer to an approval").

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
