---
id: OBJ-21
title: Mac bridge client and pairing
product: harness
assignee: Jepoy
touches: []
specs: [SPEC-08]
status: done
priority: p0
depends-on: [OBJ-02]
integrates-with: [OBJ-03, OBJ-13, OBJ-27]
tags: [objective, p0, harness, mac, bridge]
---

# OBJ-21 Mac bridge client and pairing

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The Mac's side of the bridge lives in the harness, because the harness shares the TypeScript crypto and types with the bridge.
The Mac app only shows the pairing QR code and the connection state; Patrick builds those screens in [OBJ-27](OBJ-27-mac-native-services.md).
This objective is built as a self-contained module so it does not wait on the harness skeleton, then wired in.
After this objective, the Mac can pair with a phone and exchange encrypted, signed messages with it.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), all requirements, scenarios, and Decisions.
- `protocol/docs/pairing.md` and [OBJ-02](OBJ-02-bridge-envelope-and-crypto.md) Outcome.
- [OBJ-13](OBJ-13-bridge-relay-server.md) contract and [bridge/README.md](../bridge/README.md) (bridge URL and auth flow; deployed-relay integration is deferred to [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md)).

## Tasks

- [x] **OBJ-21.1** Build the client as a self-contained module in `harness/src/bridge-client/` with its own tests, using the protocol types and reference crypto.
- [x] **OBJ-21.2** Generate the Mac's device keys and store them in the macOS Keychain through the Mac app's `storeSecret` and `loadSecret` (mock Mac app until OBJ-27 is done), never in plain files.
- [x] **OBJ-21.3** Implement the Mac side of pairing from `pairing.md` and expose `startPairing`, `listPairedDevices`, and `unpair` over RPC.
- [x] **OBJ-21.4** Connect to the bridge over WebSocket, authenticate, and reconnect with backoff.
- [x] **OBJ-21.5** Send and receive envelopes. Verify signatures, ack accepted messages, and drop messages from unpaired or revoked devices, recording them in the local log.
- [x] **OBJ-21.6** At-most-once execution. Remember processed message ids and their results; on a duplicate, resend the stored result instead of running again.
- [x] **OBJ-21.7** Never run an expired command. Surface `expired` and `targetOffline` events from the bridge to the task that sent the command, as structured errors.
- [x] **OBJ-21.8** Emit `bridgeStateChanged` (connected, reconnecting, offline) and structured `userError` kinds for "Bridge down" and "Unpaired device". The Mac app shows them (OBJ-27).
- [x] **OBJ-21.9** When [OBJ-03](OBJ-03-harness-skeleton.md) is done, wire the module into the harness (coordinate with Brent) and expose its RPC methods on the harness socket.
- [x] **OBJ-21.10** Run local end-to-end tests through a protocol-compliant relay stand-in and Mac RPC stand-in: pairing, authenticated reconnect, encrypted round trip, unknown device dropped, duplicate delivery, expiry, and an offline queued unpair delivered after restart. The sender reuses its signed UUID until the relay ACKs durable receipt; the receiving device ACKs the same UUID after idempotently deleting the peer.

## Expectations

- [x] SPEC-08 scenarios pass from the Mac side: "Pair the phone with the Mac", "Unpair a device", "Message from an unknown device is dropped", "Duplicate delivery runs once", "Expired command is not run".
- [x] Keys never appear in files, logs, or the task store.
- [x] The Mac uses the shared protocol crypto implementation covered by the protocol v4 test vectors.
- [x] End-to-end flows pass against the local relay and Mac RPC stand-ins; deployed Mac and phone acceptance is tracked by [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md).

## Expected outcomes

- The bridge client module in the harness, pairing RPC methods, and connection state events.

## Out of scope

- Which commands the Mac sends to the phone and how goals are routed between devices: [SPEC-09](../specs/09-cross-device-routing.md), with the message kinds in [OBJ-25](OBJ-25-cross-device-messages.md).
- The phone side: [OBJ-23](OBJ-23-android-bridge-client.md).

## Outcome

Complete for local stand-in coverage. The harness now starts the bridge client after the Mac RPC handshake, exposes the pairing methods, and closes the client during shutdown. Device acceptance against the deployed relay is tracked in OBJ-30.
