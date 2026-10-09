---
id: OBJ-65
title: Phone tool lane in the harness
product: harness
assignee: Brent
touches: []
specs: [SPEC-09, SPEC-07]
status: blocked
priority: p0
depends-on: [OBJ-25, OBJ-37, OBJ-49]
integrates-with: [OBJ-23, OBJ-66]
tags: [objective, p0, harness, bridge, phone]
---

# OBJ-65 Phone tool lane in the harness

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-09](../specs/09-cross-device-routing.md), [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The planner already lists `phone` and the safety gate has levels for phone calls, but nothing sends a call to the phone: `harness/src/gui/orchestrator-tools.ts` says `phone` "joins when their lanes exist".
This lane makes "set an alarm on my phone for 6:30 am", spoken on the Mac, set the alarm on the phone: the first SPEC-09 demo moment.
Until the phone side ([OBJ-66](OBJ-66-android-phone-tool-host.md)) works, test with a scripted phone on the relay stand-in.

## Read first

- [SPEC-09](../specs/09-cross-device-routing.md), requirements 1 to 3 and 16, and the "Mac to phone" feature.
- [protocol/schemas/messages.json](../protocol/schemas/messages.json) (`toolList`, `toolCall`, `toolResult`) and [protocol/schemas/tools.json](../protocol/schemas/tools.json) (`PhoneCall`, `PhoneToolCall`).
- `harness/src/gui/orchestrator-tools.ts`, `harness/src/safety/gate.ts`, `harness/src/safety/rules.ts`, `harness/src/worker/prompt.ts`, `harness/src/bridge-client/client.ts`.
- [OBJ-49](OBJ-49-mac-bridge-test-support.md) Outcome, the Mac's bridge message handler.

## Tasks

- [x] **OBJ-65.1** Keep the phone's latest `toolList` from the bridge, validated against the schema, and forget it on unpair.
- [x] **OBJ-65.2** Build the single `phone(tool, args)` planner tool from that list (SPEC-09 r2), and leave it out while no phone tool list is known.
- [x] **OBJ-65.3** Run a `phone` call: pass it through the permission gate, send `toolCall`, and wait for `toolResult` until the 2-minute command expiry. A failure becomes its `ErrorKind`, never raw text.
- [x] **OBJ-65.4** Record the call in the action log under the phone's device id, and give the task summary the phone's answer, so the Mac says "Your alarm is set for 6:30 am on your phone."
- [x] **OBJ-65.5** Tests with a scripted phone on the relay stand-in, and a note in `harness/README.md` on testing without a phone.

## Expectations

- [x] SPEC-09 scenario passes with a scripted phone: "Set an alarm on the phone from the Mac".
- [x] No phone call waits longer than 2 minutes.

## Expected outcomes

- A phone tool lane in `harness/src/`, wired into the planner and the gate, with tests.

## Out of scope

- The phone running the tools: [OBJ-66](OBJ-66-android-phone-tool-host.md).
- A phone that is offline when called (SPEC-09 r16, "Phone is offline when the Mac calls a tool"): [OBJ-77](OBJ-77-harness-cross-device-edge-cases.md).

## Outcome

- **Result:** Blocked.
  Every task and expectation is done and verified, but hard dependencies are not `done`: [OBJ-49](OBJ-49-mac-bridge-test-support.md) is `todo` (cut for the demo), so the checker will not let this objective be `done`. Unblock by finishing OBJ-49 or dropping it from `depends-on`, as for [OBJ-68](OBJ-68-harness-delegated-goals.md).
- **Delivered:** `harness/src/bridge-client/phone-tools.ts`: the phone's latest `toolList` (forgotten once unpaired), the one `phone` tool on the helper lane while a list is known (`withPhone`), described from the list, and calls as `toolCall` commands that wait at most 2 minutes. `src/scheduler/describe.ts` names phone calls in the action log with am and pm, under the phone's device id (`ToolRunResult.deviceId`). The bridge client passes `replyTo` and `onConnected` for it.
- **Commits:** `6a442db feat(harness): add phone tools, approvals asked on the phone, a busy-Mac queue, and a locked-Mac hold to cross-device goals`.
- **Expectations:**
  - "Set an alarm on the phone from the Mac" passes in `harness/test/cross-device.test.ts` with a scripted phone: the planner is offered `phone` with `set_alarm`, the phone gets `toolCall`, the action log says "Set an alarm for 6:30 am on your phone" under the phone's id, and the Mac says the summary; `npm run verify` in `harness/` on Linux (36 test files, lint, and format).
  - No phone call waits longer than 2 minutes: `PHONE_CALL_MS`, and an offline call fails at once.
- **Not verified:** The real phone running the tools, which is [OBJ-66](OBJ-66-android-phone-tool-host.md) (Brent cut the phone's tools for the demo).
- **Decisions and deviations:** The Mac sends an empty tool list: in p0 the phone has no model and never calls the Mac's tools (SPEC-09 r4), and a `toolCall` from it is answered `unsupportedRequest`.
- **For the next objectives:** OBJ-66 sends `toolList` on connect and answers `toolCall` with `toolResult`; the Mac answers each phone list with its own, so the phone must not answer the Mac's.
