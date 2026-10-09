---
id: OBJ-48
title: Bind unpair to the pairing instead of device clocks
product: protocol
assignee: Jepoy
touches: [bridge]
specs: [SPEC-08]
status: todo
priority: p1
depends-on: [OBJ-31]
integrates-with: [OBJ-13, OBJ-23, OBJ-30, OBJ-41]
tags: [objective, p1, protocol, bridge, pairing]
---

# OBJ-48 Bind unpair to the pairing instead of device clocks

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

The [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md) live check found that the deployed relay silently drops an unpair sent right after pairing.
The relay compares the unpair's `at`, written by the sending device's clock, with `pairedAt`, written by its own clock, and refuses an unpair that is not later.
The receiving device does the same with its own clock (`protocol/docs/pairing.md` "Unpairing", step 5).
So a device whose clock runs behind cannot unpair until the clocks catch up, its retries are never acknowledged, and SPEC-08 requirement 9 ("revokes its keys immediately") fails.

Reproduced 2026-10-10 against `wss://yumibridge.studiokova.co`: with this PC's clock a fraction of a second behind the VPS, an unpair sent as soon as pairing finished got no `ack`; the same unpair with `at` 5 seconds later was acknowledged at once.
The `at` check exists only so an old unpair cannot end a newer pairing of the same two devices.

## Read first

- [SPEC-08](../specs/08-device-bridge.md) requirement 9, the "Unpair a device" scenario, and the "Unpair delivery" decision.
- [protocol/docs/pairing.md](../protocol/docs/pairing.md) "Pairing" and "Unpairing", and [protocol/docs/crypto.md](../protocol/docs/crypto.md).
- `unpair` and `acknowledge` in `bridge/src/relay.ts`, and the [OBJ-31](OBJ-31-unpair-delivery-ack-contract.md) Outcome.

## Tasks

- [ ] **OBJ-48.1** Settle the SPEC-08 open question "Unpair and device clocks" with Brent: what an unpair is bound to. Proposal: a `pairingId`, the SHA-256 of the Mac's `pairAccept` signature, which the Mac, the phone, and the relay all already see. An unpair signs it, and anyone ignores an unpair whose `pairingId` is not their current pairing's. Record the decision in SPEC-08.
- [ ] **OBJ-48.2** Change `UnpairFrame` and the signed unpair fields, bump the protocol version, regenerate, and update the crypto vectors, examples, and `pairing.md`.
- [ ] **OBJ-48.3** Change the relay to compare the `pairingId` instead of the times, and keep `at` only for the logs. Redeploy the relay, as the git-workflow skill requires for a version bump.
- [ ] **OBJ-48.4** Add the clock-skew case to the relay tests and to `npm run live-check`: an unpair whose `at` is a minute behind the relay is still acknowledged, and an unpair from an earlier pairing is still ignored.
- [ ] **OBJ-48.5** Tell the client owners: the Mac's bridge client (Brent, harness) and the phone ([OBJ-23](OBJ-23-android-bridge-client.md)) compare the `pairingId` too.

## Expectations

- [ ] SPEC-08 "Unpair a device" passes when the devices' clocks differ from the relay's by minutes, in either direction.
- [ ] An unpair from an earlier pairing never ends a newer pairing of the same two devices.

## Expected outcomes

- A clock-free unpair contract, the relay following it, and tests that cover clock skew.

## Out of scope

- The client changes themselves: the Mac's bridge client (harness) and [OBJ-23](OBJ-23-android-bridge-client.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
