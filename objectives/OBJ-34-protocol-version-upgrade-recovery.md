---
id: OBJ-34
title: Define protocol version upgrade recovery
product: protocol
assignee: Jepoy
touches: [bridge, harness]
specs: [SPEC-08, SPEC-11]
status: in-progress
priority: p1
depends-on: [OBJ-31]
integrates-with: [OBJ-21, OBJ-23, OBJ-30, OBJ-42, OBJ-43, OBJ-44]
tags: [objective, p1, protocol, compatibility]
---

# OBJ-34 Define protocol version upgrade recovery

**Product:** Protocol · **Specs:** [SPEC-08](../specs/08-device-bridge.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Jepoy

## Project context

The bridge connects the Mac and Android clients through a versioned protocol and reports connection state to each app.

## Read first

- [SPEC-08](../specs/08-device-bridge.md) and [SPEC-11](../specs/11-user-facing-errors.md).
- [Protocol pairing and relay contract](../protocol/docs/pairing.md).
- [OBJ-31](OBJ-31-unpair-delivery-ack-contract.md) outcome and [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md), [OBJ-23](OBJ-23-android-bridge-client.md) acceptance criteria.

## Why this objective

The protocol contract refuses clients that authenticate with a different protocol version.
Protocol v4 makes that behavior user-visible for devices upgraded at different times, but SPEC-08 and SPEC-11 do not say how either app explains or recovers from this state.

## Tasks

- [x] **OBJ-34.1** Define the structured client state and user-facing recovery guidance when the relay refuses an older or newer protocol version.
  The relay names its own version in `refused` and sends `targetNeedsUpdate` for a device that is behind; `protocol/docs/pairing.md` "Another protocol version" says what each device does.
  The copy itself is proposed in [OBJ-42](OBJ-42-version-mismatch-copy.md).
- [x] **OBJ-34.2** Align SPEC-08 and the Mac and Android bridge objectives.
  The SPEC-11 rows move to [OBJ-42](OBJ-42-version-mismatch-copy.md), because they have to land together with the Android and Mac copy.
- [x] **OBJ-34.3** Add stand-in coverage for version mismatch and successful recovery after both devices use a compatible version.
  The relay is tested with stand-in devices here; the Mac's relay stand-in follows in [OBJ-43](OBJ-43-mac-bridge-client-version-refusal.md).

## Expectations

- [ ] A version mismatch is distinguishable from a network outage.
- [ ] The user can understand what needs updating and the existing pairing is preserved unless the protocol explicitly requires otherwise.

## Expected outcomes

- A version compatibility and recovery contract implemented consistently by both clients.

## Out of scope

- Protocol negotiation or backward-compatible wire formats unless the updated specs require them.

## Outcome

Not started.
