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

- **Result:** In progress.
  The contract, the relay, and the docs are done.
  Both expectations wait for the clients and the copy: [OBJ-42](OBJ-42-version-mismatch-copy.md) (SPEC-11 copy), [OBJ-43](OBJ-43-mac-bridge-client-version-refusal.md) (Mac bridge client), [OBJ-44](OBJ-44-mac-version-mismatch-copy.md) (Mac app copy), and [OBJ-23](OBJ-23-android-bridge-client.md) (phone).
- **Delivered:**
  - `protocol/schemas/bridge.json`: `refused` takes an optional `protocolVersion` (the relay's), allowed only with `unsupportedVersion`; a new `targetNeedsUpdate` notice; `UnsupportedVersionRetrySeconds` (300). Regenerated types and new examples `BridgeFrame.refused-unsupported-version.json` and `BridgeFrame.targetNeedsUpdate.json`.
  - `protocol/docs/pairing.md`: "Another protocol version", with the relay's and the refused device's rules, and the new check order in "Connecting".
  - `protocol/README.md` "Versioning": the handshake frames only gain optional properties from version 4 on, and a new version keeps every pairing.
  - `bridge/src/relay.ts` and `bridge/src/store.ts`: the version is checked after the signature; a registered device that is behind is remembered in `devices_needing_update` until it connects on the relay's version or comes back ahead; a command for it gets `targetNeedsUpdate`.
  - `harness/src/bridge-client/client.ts`: `targetNeedsUpdate` drops the command from the outbox and reports `otherDeviceOffline`, so the deployed relay does not make the Mac resend it.
  - SPEC-08: the "Protocol versions" scenarios and the "Another protocol version" decision.
- **Commits:**
  - `02f219a docs(objectives): start OBJ-34 and add OBJ-42 to OBJ-44 for the version mismatch copy and clients`
  - `027c9ed feat(protocol): name the relay's version when it refuses another one, and add targetNeedsUpdate`
  - `1b1f659 feat(bridge): refuse another protocol version with the relay's version and tell senders a target needs an update`
  - `82086a1 fix(harness): report targetNeedsUpdate as otherDeviceOffline until it has its own copy`
  - `747dd86 docs(spec-08): decide protocol version mismatch recovery and align its objectives`
- **Expectations:**
  - Distinguishable from a network outage: the relay side is verified in `bridge/test/e2e.test.ts` "another protocol version (OBJ-34)" and `protocol/test/bridge.test.ts`; what the user sees waits for OBJ-42, OBJ-43, and OBJ-23.
  - Pairing preserved: verified at the relay ("delivers what it held once the device updates, with the same pairing and no new QR code"); what the user understands waits for the OBJ-42 copy.
- **Not verified:** the clients, which are not built yet for this (OBJ-43, OBJ-23), and the live relay, in [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md).
- **Decisions and deviations:**
  - No protocol version bump: the new frame, constant, and optional property are additions, which protocol/README "Versioning" calls not breaking.
  - The relay checks the version after the signature, so only the device itself can be marked as behind, and a forged connection on an old version gets `badSignature`.
  - A device newer than the relay is not reported to its peers: only the team can update the relay, so senders keep seeing `targetOffline`.
  - The SPEC-11 copy moved to OBJ-42, because a new row fails the Android and Mac copy tests until both apps have it.
  - Found along the way: SPEC-08 had its unpair decision inside a Gherkin block; it moved to "Decisions".
- **For the next objectives:**
  - Clients follow `protocol/docs/pairing.md` "Another protocol version". A `refused` without `protocolVersion` comes from an older relay: treat the relay as behind.
  - The relay learns that a device is behind only when that device tries to connect.
