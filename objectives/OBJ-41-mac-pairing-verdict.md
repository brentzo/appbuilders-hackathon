---
id: OBJ-41
title: Mac pairing waits for the relay's verdict
product: harness
assignee: Brent
touches: []
specs: [SPEC-08]
status: todo
priority: p0
depends-on: [OBJ-21, OBJ-33]
integrates-with: [OBJ-13, OBJ-23]
tags: [objective, p0, harness, bridge, pairing]
---

# OBJ-41 Mac pairing waits for the relay's verdict

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

[OBJ-33](OBJ-33-pairing-response-timeout-contract.md) made the relay the only judge of whether the Mac answered a pairing request within 30 seconds.
The Mac bridge client from [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) still stores the phone and uses up the offer as soon as it sends `pairAccept`.
If that answer arrives too late, the Mac would list a phone the relay never paired, which breaks SPEC-08 "Mac answers pairing too late".
This objective makes the Mac wait for the relay's `paired` or `pairExpired` verdict.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), the pairing scenarios and the "Pairing answer window" decision.
- [protocol/docs/pairing.md](../protocol/docs/pairing.md), "Pairing" and "The answer window".
- `PairedFrame`, `PairExpiredFrame`, and `PairingAnswerSeconds` in [protocol/schemas/bridge.json](../protocol/schemas/bridge.json).
- The Outcomes of [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) and [OBJ-33](OBJ-33-pairing-response-timeout-contract.md).
- `harness/src/bridge-client/client.ts` and the relay stand-in in `harness/test/support/fake-relay.ts`.

## Tasks

- [ ] **OBJ-41.1** On a valid `pairRequest`, keep the phone as pending and reserve the offer for it, instead of storing the phone and deleting the offer.
- [ ] **OBJ-41.2** On `paired` for the pending phone, store the phone, use up the offer, and emit what the Mac app needs to show "Paired with <device name>".
- [ ] **OBJ-41.3** On `pairExpired` for the pending phone, forget it and make the offer usable again until it expires. Ignore a verdict for any other device, since a held verdict can arrive more than once.
- [ ] **OBJ-41.4** Keep the pending phone through a short reconnect, so a verdict the relay held is still applied.
- [ ] **OBJ-41.5** Teach the relay stand-in the answer window: the verdicts, `pairCancel`, and refusing a late `pairAccept`, matching `bridge/src/relay.ts`.
- [ ] **OBJ-41.6** Tests through the stand-in: answer in time, answer too late, cancel from the phone, verdict after a reconnect, and a repeated `pairExpired` after pairing.

## Expectations

- [ ] SPEC-08 scenarios pass from the Mac side: "Pair the phone with the Mac", "Mac answers pairing too late".
- [ ] `listPairedDevices` never lists a phone the relay did not pair.

## Expected outcomes

- `harness/src/bridge-client/client.ts` applying the relay's pairing verdicts, with tests.
- `harness/test/support/fake-relay.ts` matching the relay's answer window.

## Out of scope

- The relay side of the answer window: done in [OBJ-33](OBJ-33-pairing-response-timeout-contract.md).
- The phone side: [OBJ-23](OBJ-23-android-bridge-client.md).
- The Mac app's pairing screen: [OBJ-27](OBJ-27-mac-native-services.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
