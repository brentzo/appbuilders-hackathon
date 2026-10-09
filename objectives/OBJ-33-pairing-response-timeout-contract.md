---
id: OBJ-33
title: Align the pairing response timeout contract
product: protocol
assignee: Jepoy
touches: [bridge]
specs: [SPEC-08]
status: in-progress
priority: p0
depends-on: [OBJ-02]
integrates-with: [OBJ-13, OBJ-21, OBJ-23]
tags: [objective, p0, protocol, bridge, pairing]
---

# OBJ-33 Align the pairing response timeout contract

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-08 says the phone gives up when the Mac does not answer a pairing request within 30 seconds.
The pairing protocol asks the relay to retain that request for 5 minutes.
This objective defines cancellation and late-accept behavior so a pairing cannot complete after the phone has told the user it failed.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), especially "Mac does not answer pairing".
- [Pairing and relay protocol](../protocol/docs/pairing.md).
- [Bridge schema](../protocol/schemas/bridge.json).
- [OBJ-13](OBJ-13-bridge-relay-server.md), [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md), and [OBJ-23](OBJ-23-android-bridge-client.md).

## Tasks

- [x] **OBJ-33.1** Define how the phone cancels a pending pairing and how the relay rejects a late `pairAccept` while preserving the QR offer's five-minute lifetime.
- [x] **OBJ-33.2** Align SPEC-08, pairing documentation, frame schema, examples, and generated protocol types with that behavior.
- [x] **OBJ-33.3** Add relay coverage for acceptance before the deadline, cancellation, expiry, reconnect, and a late response. Client coverage belongs to each client's owner: the Mac in [OBJ-41](OBJ-41-mac-pairing-verdict.md), the phone in [OBJ-23](OBJ-23-android-bridge-client.md).
- [x] **OBJ-33.4** Update OBJ-13 and OBJ-23 acceptance criteria to match the contract. OBJ-21 is done, so the Mac's change is the new [OBJ-41](OBJ-41-mac-pairing-verdict.md).

## Expectations

- [ ] A pairing cannot complete after the phone has shown the 30-second timeout error.
- [x] The pairing offer can remain valid for up to five minutes without keeping an abandoned request actionable.

## Expected outcomes

- A protocol contract that removes the mismatch between client timeout and relay pending-request lifetime.

## Out of scope

- Production relay deployment: [OBJ-32](OBJ-32-production-bridge-deployment.md).
- Live device acceptance: [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md).

## Outcome

In progress: the contract and the relay are done.
The first expectation also needs both clients to follow the contract, which is [OBJ-41](OBJ-41-mac-pairing-verdict.md) for the Mac and [OBJ-23](OBJ-23-android-bridge-client.md) for the phone.

- **Delivered:**
  - `protocol/schemas/bridge.json`: `PairCancelFrame`, `PairedFrame`, `PairExpiredFrame`, `PairingOfferSeconds` (300), and `PairingAnswerSeconds` (30), with examples and generated types.
  - `protocol/docs/pairing.md`: the new section "The answer window", with the relay, phone, and Mac rules.
  - `bridge/src/relay.ts` and `bridge/src/store.ts`: the relay keeps each request open for 30 seconds by its own clock and decides alone.
    It pairs, forwards, and sends `paired` in one step, sends `pairExpired` otherwise, handles `pairCancel`, holds verdicts for 2 minutes, and closes open requests on unpair.
  - SPEC-08: the "Pairing answer window" decision and the scenario "Mac answers pairing too late".
- **Commits:** e5f20eb feat(protocol): add the pairing answer window, verdict frames, and pairCancel; e566c82 feat(bridge): close pairing requests after 30 seconds and send pairing verdicts; 6ce8beb docs(spec-08): decide the pairing answer window and align its objectives.
- **Expectations:**
  - "A pairing cannot complete after the phone has shown the 30-second timeout error": the relay side passes in `bridge/test/e2e.test.ts` "pairing answer window (OBJ-33)" (late answer, cancel, phone offline, unpair while open).
    The client side waits on OBJ-41 and OBJ-23, so the box stays open.
  - "The pairing offer can remain valid for up to five minutes without keeping an abandoned request actionable": `PairingOfferSeconds` stays 300, and the relay closes every request after 30 seconds, on cancel, or on unpair (same tests).
- **Not verified:** the Mac and phone behavior, until OBJ-41 and OBJ-23 are done.
- **Decisions and deviations:**
  - No protocol version bump: the frames and constants are additions, which protocol/README "Versioning" calls not breaking.
    A Mac built on OBJ-21 still stores the phone when it sends `pairAccept`, so OBJ-41 must land before pairing is demoed.
  - The phone gives up on its own only after 60 seconds without a verdict, and undoes a pairing it missed with an `unpair`, recorded in the SPEC-08 decision.
  - The relay now holds a request for a Mac that is offline, so a short reconnect still gets it, instead of dropping it.
  - Client coverage moved to each client's owner, and the Mac's change became OBJ-41 because OBJ-21 is done.
  - OBJ-30's tasks were renumbered from `OBJ-29.x` to `OBJ-30.x`, fixing a copy error.
- **For the next objectives:** devices act on a held verdict only while they wait for that device, because a held verdict is sent again on every reconnect within 2 minutes.
  `paired` and `pairExpired` name the other device in `device`.
