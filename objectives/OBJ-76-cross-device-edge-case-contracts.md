---
id: OBJ-76
title: Contracts for SPEC-09 edge cases and waking the Mac
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-09]
status: todo
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

- [ ] **OBJ-76.1** Add an optional `wakeAddresses` to `toolList`: the hardware addresses of the sender's network interfaces, which the Mac sends so the phone can wake it with Wake-on-LAN on the same Wi-Fi (SPEC-09 r19).
- [ ] **OBJ-76.2** Add `waitingForUnlock` to `GoalAcceptanceStatus`, for a Mac that is awake but locked: the goal starts by itself once the user unlocks it, and `progress` follows (SPEC-09 r20).
- [ ] **OBJ-76.3** Write the edge cases into `protocol/README.md` as message sequences: presence (a `toolList` on connect, and a `ping` answered by `targetOffline` while the Mac is away), a queued goal on the phone, a busy Mac (`goalAccepted` with `queued`), no reply, Stop with the Mac unreachable, the 5-minute approval timeout, and waking a locked Mac.
- [ ] **OBJ-76.4** Add examples and message sequences in `protocol/examples/sequences/` for "Mac is offline", "Mac is busy", "No answer to an approval", and "Mac wakes up locked", checked by the sequence test.
- [ ] **OBJ-76.5** Regenerate the TypeScript, Swift, and Kotlin types and run the tests.

## Expectations

- [ ] Every message in the new sequences validates against the contract.
- [ ] Generated types compile in TypeScript, Swift, and Kotlin.

## Expected outcomes

- `protocol/schemas/messages.json` changes, sequences, examples, README notes, and regenerated types.

## Out of scope

- Running these sequences: [OBJ-77](OBJ-77-harness-cross-device-edge-cases.md), [OBJ-78](OBJ-78-android-cross-device-edge-cases.md), [OBJ-79](OBJ-79-android-wake-the-mac.md), and [OBJ-80](OBJ-80-harness-wake-and-lock.md).
- p1 photo and share goals (SPEC-09 "Fetch photos from the phone", "Goal that needs both devices"): no objectives yet.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
