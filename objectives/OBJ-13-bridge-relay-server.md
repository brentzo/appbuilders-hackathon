---
id: OBJ-13
title: Bridge relay server
product: bridge
assignee: Jepoy
touches: []
specs: [SPEC-08]
status: in-progress
priority: p0
depends-on: [OBJ-02]
integrates-with: [OBJ-31, OBJ-33]
tags: [objective, p0, bridge]
---

# OBJ-13 Bridge relay server

**Product:** [Yumi Bridge](../bridge/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The bridge is the only path between the Mac and the phone.
It authenticates paired devices, routes encrypted messages, tells senders when a target is offline, and drops expired messages.
It never sees plaintext, which keeps the "local AI" claim honest.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), all requirements, scenarios, and Decisions.
- [bridge/README.md](../bridge/README.md).
- [OBJ-02](OBJ-02-bridge-envelope-and-crypto.md) Outcome and `protocol/docs/pairing.md`.

## Tasks

- [x] **OBJ-13.1** Set up `bridge/` as a TypeScript project on Node.js LTS, using the envelope types and reference crypto from `protocol/`.
- [x] **OBJ-13.2** Implement the device registry in SQLite: device id, public signing key, and the pairings between two devices. Implement the pairing steps from `protocol/docs/pairing.md`: remember a `pairRequest` for 5 minutes, and record the pairing when the matching `pairAccept` passes through. The interaction between this 5-minute window and SPEC-08's 30-second Mac response scenario is tracked in [OBJ-33](OBJ-33-pairing-response-timeout-contract.md).
- [x] **OBJ-13.3** Accept WebSocket connections and authenticate each device with a signed challenge, as in `pairing.md` "Connecting". Register a new device id on first use when it is derived from its key, and refuse with the `RefusedReason` values otherwise.
- [x] **OBJ-13.4** Route each envelope to its `to` device if online. Only allow routing between paired devices, and answer anything else with `notPaired`.
- [x] **OBJ-13.5** Commands are never queued. If a command's target is offline, send the sender a `targetOffline` event at once. Hold results and events for a device that dropped off in SQLite until they expire, deliver them in order on reconnect, and delete each one after the receiver acknowledges it.
- [x] **OBJ-13.6** Expiry: never deliver an expired envelope. Send the sender an `expired` event for it (when the sender is online, or queued for it).
- [ ] **OBJ-13.7** Unpairing, as in `pairing.md` "Unpairing": remove the pairing at once, delete every message held between the two devices, and hold the signed `unpair` frame until the other device acks it. The current frame has no correlatable acknowledgement id; finish ACK deletion against the contract in [OBJ-31](OBJ-31-unpair-delivery-ack-contract.md).
- [x] **OBJ-13.8** Logging: routing fields, connection events, and errors only. Never log payloads.
- [x] **OBJ-13.9** Package the relay in a Docker image and Compose service that binds only `127.0.0.1:8787`, persists SQLite in a mounted `data/` folder, and restarts unless stopped. Document configuration, deploy steps, and log access in `bridge/README.md`. The VPS rollout and live check are tracked in [OBJ-32](OBJ-32-production-bridge-deployment.md).
- [x] **OBJ-13.10** Tests: auth success and failure, routing, cross-group routing refused, offline notice for commands, result held through a short reconnect, expiry with sender notice, revocation.

## Expectations

- [ ] SPEC-08 scenarios pass at the bridge level: "VPS cannot read messages", "Message from an unknown device is dropped" (bridge refuses it; the device-side check is in client objectives), "Command to an offline device fails at once", "Result survives a short reconnect", "Expired command is not run", "Unpair a device".
- [x] A test client using the protocol's test vectors can authenticate, pair, send, and receive through a local relay. Production endpoint acceptance is tracked in [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md).
- [x] Database and logs contain no plaintext payloads.

## Expected outcomes

- A locally tested, packaged bridge with registry, routing, queue, expiry, and revocation.
- VPS deployment and public endpoint acceptance, tracked by [OBJ-32](OBJ-32-production-bridge-deployment.md) and [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md).
- Deploy and operations notes in `bridge/README.md`.

## Out of scope

- Client connections: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Mac), [OBJ-23](OBJ-23-android-bridge-client.md) (Android).
- Push notifications for iPhone: SPEC-12, later.
- At-most-once execution: done on the receiving device, in the client objectives.

## Outcome

In progress. The local relay implementation, container build, and bridge-level test suite are complete. Unpair acknowledgement correlation is tracked in OBJ-31, the pairing response timeout mismatch is tracked in OBJ-33, and VPS deployment acceptance is tracked in OBJ-32. The relay has not been deployed to the VPS.
