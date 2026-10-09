---
id: OBJ-80
title: Harness wake addresses and a locked Mac
product: harness
assignee: Brent
touches: []
specs: [SPEC-09]
status: todo
priority: p1
depends-on: [OBJ-76]
integrates-with: [OBJ-68, OBJ-79]
tags: [objective, p1, harness, bridge]
---

# OBJ-80 Harness wake addresses and a locked Mac

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

For the phone to wake the Mac, the Mac must tell it the hardware addresses to wake (SPEC-09 r19).
When a woken Mac is still locked, the cursor cannot work, so the harness holds a goal from the phone until the user unlocks it, and tells the phone why (r20).

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 19 and 20, and the scenario "Mac wakes up locked".
- [OBJ-76](OBJ-76-cross-device-edge-case-contracts.md) Outcome and [OBJ-68](OBJ-68-harness-delegated-goals.md) Outcome.

## Tasks

- [ ] **OBJ-80.1** Send `wakeAddresses` in the Mac's `toolList`: the hardware addresses of its Wi-Fi and Ethernet interfaces, never a loopback or all-zero address.
- [ ] **OBJ-80.2** Read whether the screen is locked through a small seam (on macOS, the console session's lock flag), testable with a stand-in.
- [ ] **OBJ-80.3** A `delegateGoal` that arrives while the screen is locked is answered `goalAccepted` with status `waitingForUnlock`, and starts by itself once the screen is unlocked; a `cancel` before then drops it.
- [ ] **OBJ-80.4** Tests with a scripted phone and a stand-in lock, and an update to `harness/README.md`.

## Expectations

- [ ] The Mac side of "Mac wakes up locked" passes with a scripted phone and a stand-in lock.
- [ ] The harness never reads, stores, or types a password.

## Expected outcomes

- Wake addresses and lock handling in `harness/src/`, with tests.

## Out of scope

- Sending the Wake-on-LAN packet: [OBJ-79](OBJ-79-android-wake-the-mac.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
