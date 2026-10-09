---
id: OBJ-73
title: Live cross-device routing acceptance
product: bridge
assignee: Jepoy
touches: []
specs: [SPEC-09]
status: todo
priority: p0
depends-on: [OBJ-30, OBJ-65, OBJ-66, OBJ-67, OBJ-68, OBJ-69, OBJ-70, OBJ-71, OBJ-72]
integrates-with: []
tags: [objective, p0, bridge, e2e]
---

# OBJ-73 Live cross-device routing acceptance

**Product:** [Yumi Bridge](../bridge/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Each SPEC-09 objective is tested against scripted peers; this one proves the demo moments on the real Mac and phone through the deployed relay, as [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md) does for SPEC-08.

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), the "Mac to phone" and "Phone to Mac" features.
- [wiki/bridge-acceptance.md](../wiki/bridge-acceptance.md), the runbook to extend.
- [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md) Outcome.

## Tasks

- [ ] **OBJ-73.1** Add a "Cross-device routing" section to the runbook: setup (paired devices, a Keynote deck, a Mail account with a test "Ana") and steps for each scenario below.
- [ ] **OBJ-73.2** Run each scenario on the demo Mac and demo phone, and record pass or fail with times in a wiki report.
- [ ] **OBJ-73.3** File each failure as a note on the objective that owns it, with steps to reproduce.

## Expectations

- [ ] Recorded as passed on real devices through the deployed relay: "Set an alarm on the phone from the Mac", "Phone-only goal runs on the phone", "Phone goal is delegated to the Mac", "Approval is asked on the phone", "Stop from the phone pauses the Mac".

## Expected outcomes

- An extended [wiki/bridge-acceptance.md](../wiki/bridge-acceptance.md) and a wiki report of the run.

## Out of scope

- Fixing failures: the owning objective.
- SPEC-09 edge cases and the wake and lock scenarios, built in [OBJ-77](OBJ-77-harness-cross-device-edge-cases.md) to [OBJ-80](OBJ-80-harness-wake-and-lock.md): a later run, once they are done. p1 photo and share goals: no objectives yet.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
