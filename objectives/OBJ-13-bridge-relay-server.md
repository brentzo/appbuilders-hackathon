---
id: OBJ-13
title: Bridge relay server
product: bridge
assignee: Jepoy
touches: []
specs: [SPEC-08]
status: todo
priority: p0
depends-on: [OBJ-02]
integrates-with: []
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

- [ ] **OBJ-13.1** Set up `bridge/` as a TypeScript project on Node.js LTS, using the envelope types and reference crypto from `protocol/`.
- [ ] **OBJ-13.2** Implement the device registry in SQLite: device id, public signing key, pair group, and revoked flag. Implement the pairing registration steps from `pairing.md`.
- [ ] **OBJ-13.3** Accept WebSocket connections and authenticate each device with a signed challenge using its registered key. Reject unknown or revoked devices.
- [ ] **OBJ-13.4** Route each envelope to its `to` device if online. Only allow routing between devices in the same pair group.
- [ ] **OBJ-13.5** Commands are never queued. If a command's target is offline, send the sender a `targetOffline` event at once. Hold results and events for a device that dropped off in SQLite until they expire, deliver them in order on reconnect, and delete each one after the receiver acknowledges it.
- [ ] **OBJ-13.6** Expiry: never deliver an expired envelope. Send the sender an `expired` event for it (when the sender is online, or queued for it).
- [ ] **OBJ-13.7** Revocation: on unpair, mark the device revoked, close its connection, and drop any results or events held for it.
- [ ] **OBJ-13.8** Logging: routing fields, connection events, and errors only. Never log payloads.
- [ ] **OBJ-13.9** Deploy on Brent's VPS at `wss://yumibridge.studiokova.co`, behind Caddy, which handles TLS (see "Deployment" in `bridge/README.md`). Document the deploy steps, config, and how to read logs in `bridge/README.md`.
- [ ] **OBJ-13.10** Tests: auth success and failure, routing, cross-group routing refused, offline notice for commands, result held through a short reconnect, expiry with sender notice, revocation.

## Expectations

- [ ] SPEC-08 scenarios pass at the bridge level: "VPS cannot read messages", "Message from an unknown device is dropped" (bridge refuses it; the device-side check is in client objectives), "Command to an offline device fails at once", "Result survives a short reconnect", "Expired command is not run", "Unpair a device".
- [ ] A test client with the protocol's test vectors can connect, send, and receive through the deployed bridge.
- [ ] Database and logs contain no plaintext payloads.

## Expected outcomes

- A deployed bridge on the VPS, with registry, routing, queue, expiry, and revocation.
- Deploy and operations notes in `bridge/README.md`.

## Out of scope

- Client connections: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) (Mac), [OBJ-23](OBJ-23-android-bridge-client.md) (Android).
- Push notifications for iPhone: SPEC-12, later.
- At-most-once execution: done on the receiving device, in the client objectives.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
