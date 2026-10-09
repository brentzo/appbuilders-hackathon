---
id: OBJ-49
title: Mac answers ping and has bridge test hooks
product: harness
assignee: Brent
touches: []
specs: [SPEC-08]
status: todo
priority: p0
depends-on: [OBJ-21, OBJ-25]
integrates-with: [OBJ-23, OBJ-30]
tags: [objective, p0, harness, bridge, e2e]
---

# OBJ-49 Mac answers ping and has bridge test hooks

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

[OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md) runs SPEC-08 on the real Mac and phone through the deployed relay.
The Mac's bridge client from [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) is running, but `harness/src/main.ts` gives it no message handler, so a command from the phone gets no result, not even for the `ping` that [OBJ-25](OBJ-25-cross-device-messages.md) defined for connection tests.
And three SPEC-08 scenarios cannot be produced by hand on real devices: a duplicate delivery, a command that arrives after it expired, and a message signed by a device the Mac does not know.
This objective gives the person running OBJ-30 a way to trigger each from the Mac.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), the "Message delivery" scenarios.
- `Payload` (`ping`, `pingResult`, `commandExpired`) in [protocol/schemas/messages.json](../protocol/schemas/messages.json).
- `harness/src/bridge-client/client.ts` (`onMessage`, `sendMessage`, the outbox) and `harness/src/main.ts`.
- [wiki/bridge-acceptance.md](../wiki/bridge-acceptance.md), the runbook these hooks serve.

## Tasks

- [ ] **OBJ-49.1** Pass the bridge client an `onMessage` that answers `ping` with `pingResult`, and answers any kind the Mac does not handle yet with a structured failure, never silence.
- [ ] **OBJ-49.2** A way to send a `ping` to the paired phone from the Mac and print the round trip, for example `npm run bridge:ping` in `harness/` or a Debug menu item in the Mac app.
- [ ] **OBJ-49.3** Debug-only hooks, off in normal runs:
  - Send the last command again with the same id (duplicate delivery).
  - Hold the next incoming command for N seconds before anything checks it, including its expiry, so it is handled as if it arrived late (expired on arrival), and the Mac can drop off while it holds one (result after a short reconnect).
  - Send one envelope signed by a throwaway key (unknown device).
  - Hold the next `pairRequest` for N seconds before answering it, so the Mac can answer after the 30-second window (SPEC-08 "Mac answers pairing too late").
  - Authenticate with another protocol version until the next restart (SPEC-08 "Protocol versions").
- [ ] **OBJ-49.4** Document the hooks in `harness/README.md` and in the runbook.
- [ ] **OBJ-49.5** Tests through the relay stand-in for each hook.

## Expectations

- [ ] A `ping` from the phone gets a `pingResult` from the real Mac within 2 seconds.
- [ ] With the hooks, the person running OBJ-30 can produce "Duplicate delivery runs once", "Expired command is not run", "Message from an unknown device is dropped", "Mac answers pairing too late", and "Device needs an update" on the real Mac.
- [ ] No hook is reachable in a normal run.

## Expected outcomes

- The Mac's message handler for `ping`, and debug-only bridge test hooks with tests.

## Out of scope

- The phone's side: [OBJ-23](OBJ-23-android-bridge-client.md) task 10.
- Real cross-device goals and tools: [OBJ-65](OBJ-65-harness-phone-tool-lane.md), [OBJ-68](OBJ-68-harness-delegated-goals.md), and [OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md), which build on this handler.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
