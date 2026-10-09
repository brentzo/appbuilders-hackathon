---
id: OBJ-50
title: Auto mode skips the repeat-back
product: mac
assignee: Brent
touches: [harness, protocol]
specs: [SPEC-01]
status: in-progress
priority: p0
depends-on: [OBJ-17]
integrates-with: []
tags: [objective, p0, mac, harness, voice, ux]
---

# OBJ-50 Auto mode skips the repeat-back

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Brent found confirming every goal slows him down.
SPEC-01 requirement 14 adds an "Auto mode" setting, off by default, that starts the goal right away while still showing what Yumi heard and saying a short acknowledgement.
Approvals for sends and deletes are unchanged.

## Read first

- SPEC-01 requirements 4, 5, and 14, and its Decisions.
- [OBJ-17](OBJ-17-goal-confirmation.md) and its Outcome: the confirmation loop this setting bypasses.
- `harness/src/confirm/confirmation.ts` and `mac/Yumi/Confirmation/`.
- `mac/Yumi/Settings/SettingsView.swift` and `mac/Yumi/Settings/YumiSettings.swift`.
- `SubmitGoalParams` in [protocol/schemas/rpc.json](../protocol/schemas/rpc.json).

## Tasks

- [ ] **OBJ-50.1** Add an optional, non-breaking field to `SubmitGoalParams` that asks for Auto mode. The protocol stays at version 4; regenerate the types and add an example.
- [ ] **OBJ-50.2** Harness: in Auto mode, create the task straight in planning with the transcript as the confirmed goal, skipping the repeat-back.
- [ ] **OBJ-50.3** Mac: an "Auto mode" toggle in Settings, off by default, saved with the other settings and sent with every goal.
- [ ] **OBJ-50.4** Mac: in Auto mode, show what Yumi heard on screen and say a short acknowledgement such as "On it." before work starts.
- [ ] **OBJ-50.5** Tests for both modes in the harness and the Mac app, including that a send or delete still asks for approval in Auto mode.
- [ ] **OBJ-50.6** Run the live check on the real Mac app with the real model: one goal with Auto mode off, one with it on.

## Expectations

- [ ] With Auto mode off, every goal is repeated back as before (SPEC-01 "User gives a goal and confirms it").
- [ ] With Auto mode on, the goal starts without a repeat-back, and Yumi shows what it heard and acknowledges it.
- [ ] A send or delete in Auto mode still shows its approval card.

## Expected outcomes

- The Auto mode field in the protocol, the harness path, and the Mac setting, with tests.

## Out of scope

- The Android phone's confirmation ([SPEC-10](../specs/10-android-companion.md)): unchanged.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
