---
id: OBJ-34
title: Define protocol version upgrade recovery
product: protocol
assignee: Jepoy
touches: [harness, mac, android]
specs: [SPEC-08, SPEC-11]
status: todo
priority: p1
depends-on: [OBJ-31]
integrates-with: [OBJ-21, OBJ-23, OBJ-30]
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

- [ ] Define the structured client state and user-facing recovery guidance when the relay refuses an older or newer protocol version.
- [ ] Align SPEC-08, SPEC-11, and the Mac and Android bridge objectives.
- [ ] Add stand-in coverage for version mismatch and successful recovery after both devices use a compatible version.

## Expectations

- A version mismatch is distinguishable from a network outage.
- The user can understand what needs updating and the existing pairing is preserved unless the protocol explicitly requires otherwise.

## Expected outcomes

- A version compatibility and recovery contract implemented consistently by both clients.

## Out of scope

- Protocol negotiation or backward-compatible wire formats unless the updated specs require them.

## Outcome

Not started.
