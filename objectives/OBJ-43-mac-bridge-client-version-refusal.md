---
id: OBJ-43
title: Mac bridge client recovers from a version refusal
product: harness
assignee: Brent
touches: []
specs: [SPEC-08]
status: todo
priority: p1
depends-on: [OBJ-21, OBJ-34]
integrates-with: [OBJ-13, OBJ-42]
tags: [objective, p1, harness, bridge, compatibility]
---

# OBJ-43 Mac bridge client recovers from a version refusal

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

[OBJ-34](OBJ-34-protocol-version-upgrade-recovery.md) made the relay refuse another protocol version with its own version, and answer a command for a device that is behind with `targetNeedsUpdate`.
The Mac bridge client from [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) treats every `refused` as "Bridge down" and keeps reconnecting with backoff, so a Mac that is behind looks like a network outage.
This objective makes the Mac follow `protocol/docs/pairing.md` "Another protocol version", so it says what needs updating and keeps its pairing.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), the "Protocol versions" scenarios and the "Another protocol version" decision.
- [protocol/docs/pairing.md](../protocol/docs/pairing.md), "Connecting" and "Another protocol version".
- `RefusedFrame`, `TargetNeedsUpdateFrame`, and `UnsupportedVersionRetrySeconds` in [protocol/schemas/bridge.json](../protocol/schemas/bridge.json).
- The Outcomes of [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) and [OBJ-34](OBJ-34-protocol-version-upgrade-recovery.md).
- `harness/src/bridge-client/client.ts` and the relay stand-in in `harness/test/support/fake-relay.ts`.

## Tasks

- [ ] **OBJ-43.1** On `refused` with `unsupportedVersion`, compare the relay's `protocolVersion` with `PROTOCOL_VERSION`, and treat a refusal without one as the relay being behind.
- [ ] **OBJ-43.2** Emit `bridgeStateChanged` offline with a `userError` for the side that needs an update: `bridgeDown` until [OBJ-42](OBJ-42-version-mismatch-copy.md) adds the kinds, then the new kinds.
- [ ] **OBJ-43.3** Stop reconnecting with backoff, and try again every `UNSUPPORTED_VERSION_RETRY_SECONDS` and when the harness starts.
- [ ] **OBJ-43.4** Keep every key, paired device, and unsent unpair through the refusal, and send held unpairs once connected again.
- [ ] **OBJ-43.5** Once OBJ-42 lands, report `targetNeedsUpdate` with its own kind instead of `otherDeviceOffline`.
  The client already drops the command from its outbox and reports `otherDeviceOffline` ([OBJ-34](OBJ-34-protocol-version-upgrade-recovery.md)).
- [ ] **OBJ-43.6** Teach the relay stand-in to refuse another version with its own version and to send `targetNeedsUpdate`, matching `bridge/src/relay.ts`.
- [ ] **OBJ-43.7** Tests through the stand-in: refused while behind, refused while ahead, recovery with the same pairing after an update, and a command to a phone that is behind.

## Expectations

- [ ] SPEC-08 scenarios pass from the Mac side: "Device needs an update" (with the Mac as the device that is behind), "Command to a device that needs an update", "Devices reconnect after an update".
- [ ] A refusal for another version never deletes a key or a paired device (`listPairedDevices` is unchanged).

## Expected outcomes

- `harness/src/bridge-client/client.ts` following "Another protocol version", with tests.
- `harness/test/support/fake-relay.ts` matching the relay's version refusal.

## Out of scope

- The SPEC-11 copy and the new error kinds: [OBJ-42](OBJ-42-version-mismatch-copy.md).
- The Mac app's copy: [OBJ-44](OBJ-44-mac-version-mismatch-copy.md).
- The phone side: [OBJ-23](OBJ-23-android-bridge-client.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
