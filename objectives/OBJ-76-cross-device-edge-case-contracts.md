---
id: OBJ-76
title: Contracts for SPEC-09 edge cases and waking the Mac
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-09]
status: done
priority: p0
depends-on: [OBJ-25]
integrates-with: [OBJ-77, OBJ-78, OBJ-79, OBJ-80]
tags: [objective, p0, protocol, bridge, contracts]
---

# OBJ-76 Contracts for SPEC-09 edge cases and waking the Mac

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

Every SPEC-09 objective so far left the edge cases out: an offline or busy device, no reply, the approval timeout, and the p1 wake and lock cases.
Most of them need no new message, but two do: the phone needs the Mac's hardware address to wake it (SPEC-09 r19), and the Mac needs a way to say it is awake but locked (r20).
This objective adds those two, and writes down how each edge case uses the messages that already exist, so the harness and Android objectives build against one contract.

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 10 and 13 to 20, and every scenario of the "Phone to Mac" and "Later cross-device goals" features.
- [SPEC-11](../specs/11-user-facing-errors.md), the rows "Other device offline", "Other device busy", "Other device locked", and "No reply".
- [protocol/schemas/messages.json](../protocol/schemas/messages.json) and [protocol/schemas/bridge.json](../protocol/schemas/bridge.json) (`targetOffline`).
- The contracts-and-stand-ins skill.

## Tasks

- [x] **OBJ-76.1** Add an optional `wakeAddresses` to `toolList`: the hardware addresses of the sender's network interfaces, which the Mac sends so the phone can wake it with Wake-on-LAN on the same Wi-Fi (SPEC-09 r19).
- [x] **OBJ-76.2** Add `waitingForUnlock` to `GoalAcceptanceStatus`, for a Mac that is awake but locked: the goal starts by itself once the user unlocks it, and `progress` follows (SPEC-09 r20).
- [x] **OBJ-76.3** Write the edge cases into `protocol/README.md` as message sequences: presence (a `toolList` on connect, and a `ping` answered by `targetOffline` while the Mac is away), a queued goal on the phone, a busy Mac (`goalAccepted` with `queued`), no reply, Stop with the Mac unreachable, the 5-minute approval timeout, and waking a locked Mac.
- [x] **OBJ-76.4** Add examples and message sequences in `protocol/examples/sequences/` for "Mac is offline", "Mac is busy", "No answer to an approval", and "Mac wakes up locked", checked by the sequence test.
- [x] **OBJ-76.5** Regenerate the TypeScript, Swift, and Kotlin types and run the tests.

## Expectations

- [x] Every message in the new sequences validates against the contract.
- [x] Generated types compile in TypeScript, Swift, and Kotlin.

## Expected outcomes

- `protocol/schemas/messages.json` changes, sequences, examples, README notes, and regenerated types.

## Out of scope

- Running these sequences: [OBJ-77](OBJ-77-harness-cross-device-edge-cases.md), [OBJ-78](OBJ-78-android-cross-device-edge-cases.md), [OBJ-79](OBJ-79-android-wake-the-mac.md), and [OBJ-80](OBJ-80-harness-wake-and-lock.md).
- p1 photo and share goals (SPEC-09 "Fetch photos from the phone", "Goal that needs both devices"): no objectives yet.

## Outcome

- **Result:** Done.
- **Delivered:**
  - `protocol/schemas/messages.json`: an optional `wakeAddresses` on `toolList` (a `HardwareAddress` type, six lower-case hex pairs), `waitingForUnlock` in `GoalAcceptanceStatus`, a `resumeConfirmed` result, and an optional `error` (`UserError`) on a failed `goalFinished`.
  - `protocol/schemas/rpc.json`: the harness-to-app method `getScreenLock`, answered with `ScreenLockState`, so the harness learns the lock from the Mac app and runs nothing itself (SPEC-07 r3); the mock Mac app answers unlocked.
  - Sequences in `protocol/examples/sequences/` for "Mac is offline", "Mac is busy", "No answer to an approval", "Stop when the Mac cannot be reached", and "Mac wakes up locked". A step may be a relay frame, such as `targetOffline`.
  - Examples for each change, regenerated types, and the edge cases written under "Cross-device messages" in `protocol/README.md`.
- **Commits:**
  - `617d9cd feat(protocol): add Mac wake addresses, a locked-Mac goal status, and SPEC-09 edge case sequences (OBJ-76)`
  - `15fbe55 feat(protocol): confirm a resumed goal and add the error kind to a failed goal's finish`
  - `a300569 feat(protocol): let the harness ask the Mac app whether the screen is locked (OBJ-80)`
- **Expectations:**
  - Every message in the new sequences validates: `protocol/test/message-sequences.test.ts`, which also checks each relay frame answers a command in its sequence.
  - Generated types compile: `npm run verify` in `protocol/` (404 tests), and `npm run compile:swift` and `npm run compile:kotlin` round-trip all 203 examples.
- **Not verified:** Nothing.
- **Decisions and deviations:**
  - No presence frame: a peer is back when its `toolList` arrives or a `ping` is answered instead of `targetOffline`, so the relay needs no redeploy.
  - `goalFinished.summary` stays required: Brent's Android `GoalRouter` speaks it, so a failed goal sends both the line and its `error`.
  - The protocol had no result for `resume`; `resumeConfirmed` adds one, and the harness answers with it instead of `goalAccepted`.
  - Everything is additive, so the protocol version stays 4.
- **For the next objectives:** OBJ-78 and OBJ-79 (Android) treat `targetOffline` for `delegateGoal` or `pause` as the Mac being away, keep the queued goal on the phone, send it on the Mac's `toolList` or a `pingResult`, keep the Mac's latest `wakeAddresses`, and show the "Other device locked" copy on `waitingForUnlock`. The Android `when` blocks have an `else`, so the new kinds change nothing until they are handled.
