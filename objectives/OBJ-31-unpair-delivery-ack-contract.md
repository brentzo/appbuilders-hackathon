---
id: OBJ-31
title: Define unpair delivery acknowledgement
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-08]
status: todo
priority: p0
depends-on: [OBJ-02]
integrates-with: [OBJ-13, OBJ-21, OBJ-23]
tags: [objective, p0, protocol, bridge]
---

# OBJ-31 Define unpair delivery acknowledgement

**Product:** Protocol · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Jepoy

## Project context

The bridge protocol defines pairing and encrypted message delivery for the Mac and Android clients.

## Read first

- [SPEC-08](../specs/08-device-bridge.md).
- [Pairing and relay protocol](../protocol/docs/pairing.md).
- [Bridge schema](../protocol/schemas/bridge.json).

## Why this objective

`protocol/docs/pairing.md` requires the recipient to acknowledge an `unpair` frame and says the relay holds it until acknowledgement.
The current `UnpairFrame` has no message id, while `AckFrame` requires one.
The protocol therefore cannot correlate the acknowledgement or reliably remove a queued unpair frame.

## Tasks

- [ ] Decide the stable acknowledgement identifier and replay behavior for unpair frames.
- [ ] Align SPEC-08, pairing documentation, schema, examples, and generated protocol types.
- [ ] Add protocol validation vectors and relay/client coverage for online delivery, offline queueing, reconnect, duplicate delivery, and re-pairing.
- [ ] Update OBJ-13, OBJ-21, and OBJ-23 acceptance criteria to use the finalized contract.

## Expectations

- The schema provides enough information to correlate each unpair acknowledgement and reject stale acknowledgements.
- Offline delivery, reconnection, duplicate delivery, and re-pairing behavior are explicitly specified.

## Expected outcomes

- Updated specification and protocol contract with generated types and coverage.

## Out of scope

- Device UI and deployed relay rollout.

## Outcome

An unpair acknowledgement contract that senders, recipients, and relays can implement consistently.
