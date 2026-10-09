---
id: OBJ-80
title: Harness wake addresses and a locked Mac
product: harness
assignee: Brent
touches: []
specs: [SPEC-09]
status: done
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

- [x] **OBJ-80.1** Send `wakeAddresses` in the Mac's `toolList`: the hardware addresses of its Wi-Fi and Ethernet interfaces, never a loopback or all-zero address.
- [x] **OBJ-80.2** Read whether the screen is locked through a small seam (on macOS, the console session's lock flag), testable with a stand-in.
- [x] **OBJ-80.3** A `delegateGoal` that arrives while the screen is locked is answered `goalAccepted` with status `waitingForUnlock`, and starts by itself once the screen is unlocked; a `cancel` before then drops it.
- [x] **OBJ-80.4** Tests with a scripted phone and a stand-in lock, and an update to `harness/README.md`.

## Expectations

- [x] The Mac side of "Mac wakes up locked" passes with a scripted phone and a stand-in lock.
- [x] The harness never reads, stores, or types a password.

## Expected outcomes

- Wake addresses and lock handling in `harness/src/`, with tests.

## Out of scope

- Sending the Wake-on-LAN packet: [OBJ-79](OBJ-79-android-wake-the-mac.md).

## Outcome

- **Result:** Done.
- **Delivered:**
  - `wakeAddresses()` in `harness/src/device.ts` (the `en` ports' hardware addresses, never loopback, virtual, or zero), sent in the Mac's `toolList` by `src/bridge-client/phone-tools.ts`.
  - `appScreenLock()` in `harness/src/device.ts`, which asks the Mac app with `getScreenLock`, and the Mac app's answer from the console session's lock flag in `mac/Yumi/Native/AppMethodServer.swift`.
  - In `src/bridge-client/delegated-goals.ts`, a goal that arrives on a locked screen is held, answered `waitingForUnlock`, started by itself once unlocked, and dropped by a `cancel` before then.
- **Commits:** `6a442db feat(harness): add phone tools, approvals asked on the phone, a busy-Mac queue, and a locked-Mac hold to cross-device goals`, `626834f feat(mac): answer whether the screen is locked, read from the console session (OBJ-80)`, and the protocol commit `a300569`.
- **Expectations:**
  - The Mac side of "Mac wakes up locked" passes in `harness/test/cross-device.test.ts` with a scripted phone and both a stand-in lock and the mock Mac app's `getScreenLock`; `npm run verify` in `harness/` on Linux (36 test files, lint, and format).
  - The harness never reads, stores, or types a password: nothing in the change touches one, and `permission-gate.test.ts` still proves the harness cannot run a shell command, so the lock is read by the Mac app.
- **Not verified:** The Mac app's `getScreenLock`, since no Mac with Xcode was available. Patrick or Brent: build and run `AppMethodServerTests`, then lock the screen (Control-Command-Q) with a phone goal sent and check it starts after unlocking. Without it, the harness counts the Mac as unlocked.
- **Decisions and deviations:** The objective asked for the console session's lock flag through a small seam; reading it in the harness needs a subprocess, which SPEC-07 r3 forbids, so the Mac app reads it and the harness asks with `getScreenLock`.
- **For the next objectives:** [OBJ-79](OBJ-79-android-wake-the-mac.md) wakes the Mac with the addresses from the Mac's `toolList`; checking that the demo Mac wakes over Wi-Fi belongs to [OBJ-73](OBJ-73-live-cross-device-routing-acceptance.md).
