---
id: OBJ-79
title: Wake the Mac from the phone
product: android
assignee: Brent
touches: []
specs: [SPEC-09]
status: todo
priority: p1
depends-on: [OBJ-76, OBJ-78]
integrates-with: [OBJ-80]
tags: [objective, p1, android, bridge, voice]
---

# OBJ-79 Wake the Mac from the phone

**Product:** [Yumi for Android](../android/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

When the Mac sleeps, the relay cannot wake it, but the phone can, over the local Wi-Fi with Wake-on-LAN (SPEC-09 r19).
"Mac, gising" or "wake up my Mac" sends the packet, and a queued goal goes out once the Mac reconnects; if the Mac wakes locked, the phone says so and Yumi never touches the password (r20).

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 18 to 20, and the scenarios "Wake the Mac from the phone" and "Mac wakes up locked".
- [SPEC-11](../specs/11-user-facing-errors.md), the row "Other device locked".
- [OBJ-76](OBJ-76-cross-device-edge-case-contracts.md) and [OBJ-78](OBJ-78-android-cross-device-edge-cases.md) Outcomes.

## Tasks

- [ ] **OBJ-79.1** Keep the Mac's latest `wakeAddresses` from its `toolList`.
- [ ] **OBJ-79.2** Recognize "Mac, gising" and "wake up my Mac" in the p0 rule as a phone-only goal, repeated back like the others.
- [ ] **OBJ-79.3** On confirm, send the Wake-on-LAN magic packet for each address as UDP broadcast on the current Wi-Fi, and say that it was sent; with no known address or no Wi-Fi, say the "Other device offline" copy.
- [ ] **OBJ-79.4** On `goalAccepted` with status `waitingForUnlock`, say the "Other device locked" copy, and continue showing progress once it arrives.
- [ ] **OBJ-79.5** Unit tests for the magic packet bytes, the rule, and the locked flow, and an update to [android/README.md](../android/README.md).

## Expectations

- [ ] The phone side passes against a scripted Mac: "Wake the Mac from the phone", "Mac wakes up locked".
- [ ] The magic packet is 6 bytes of `FF` followed by the hardware address 16 times.

## Expected outcomes

- Wake-on-LAN and the locked flow in `android/app/src/main/java/ai/yumi/android/`, with tests.

## Out of scope

- Unlocking the Mac: never. Yumi never stores or types the user's password (SPEC-09 r20).
- Checking that the demo Mac really wakes over Wi-Fi: [OBJ-73](OBJ-73-live-cross-device-routing-acceptance.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
