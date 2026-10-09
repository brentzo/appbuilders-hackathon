---
id: OBJ-32
title: Deploy the bridge relay to the VPS
product: bridge
assignee: Brent
touches: []
specs: [SPEC-08]
status: done
priority: p0
depends-on: []
integrates-with: [OBJ-30]
tags: [objective, p0, bridge, deployment]
---

# OBJ-32 Deploy the bridge relay to the VPS

**Product:** [Yumi Bridge](../bridge/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

OBJ-13 builds and packages the relay locally.
This objective deploys that image on Brent's VPS behind the existing nginx and verifies the public WSS endpoint.
Brent runs the deployment unless he grants Jepoy SSH access.
Reassigned from Jepoy to Brent on 2026-10-09, because the deployment needs Brent's VPS.
It deploys OBJ-13's current relay before OBJ-13 is closed: its open items (unpair acknowledgement, OBJ-31, and the pairing timeout, OBJ-33) are redeployed the same way when they land.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), especially "VPS cannot read messages".
- [Bridge deployment notes](../bridge/README.md).
- [OBJ-13](OBJ-13-bridge-relay-server.md) Outcome.

## Tasks

- [x] **OBJ-32.1** Deploy the pinned relay commit to `/opt/yumi-bridge` using Docker Compose and preserve the existing SQLite data directory. Deployed to `/root/dev/brent/yumi-bridge` instead, because the VPS's Snap Docker cannot read `/opt`.
- [x] **OBJ-32.2** Verify nginx WebSocket proxying, TLS, authenticated test-client connection, and service restart behavior.
- [x] **OBJ-32.3** Record the deployed commit, protocol version, endpoint checks, and log/storage plaintext checks in the deployment report.

## Expectations

- [x] `wss://yumibridge.studiokova.co` accepts a valid protocol test client and rejects invalid authentication.
- [x] Docker publishes the relay only on `127.0.0.1:8787`; public TLS terminates at nginx.
- [x] Persistent data survives a container restart, and relay logs/storage contain no plaintext payloads.
- [x] Deployment is run by Brent or with his explicit VPS access handoff.

## Expected outcomes

- The production relay is running on Brent's VPS with its data mounted outside the container.
- A deployment report with reproducible checks and no secrets.

## Out of scope

- Implementing relay behavior: [OBJ-13](OBJ-13-bridge-relay-server.md).
- Real-device client scenarios: [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md).

## Outcome

Done on 2026-10-09 by Brent's orchestrator session, with Brent's VPS access.
The relay runs from commit `5f00ac9` at `/root/dev/brent/yumi-bridge`, and `https://yumibridge.studiokova.co/health` answers `ok`.
Brent's Mac harness connected and authenticated with protocol version 3 within a minute of the deploy.
Two changes were needed for the VPS's Snap Docker: the folder moved out of `/opt`, and `no-new-privileges` was removed from the Compose file (tested one option at a time; `init`, dropped capabilities, and the read-only filesystem all work).
The checks, commands, and results are in [wiki/bridge-deployment.md](../wiki/bridge-deployment.md), and the deploy steps in [bridge/README.md](../bridge/README.md).

Not verified: plaintext checks on real messages, since no phone is paired yet. The stored frames are sealed by design; [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md) checks real traffic.
