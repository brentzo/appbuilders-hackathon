---
id: OBJ-07
title: Lane router core
product: harness
touches: [mac]
specs: [SPEC-03]
status: todo
priority: p0
depends-on: [OBJ-01, OBJ-04]
tags: [objective, p0, harness, gui]
---

# OBJ-07 Lane router core

**Product:** [Yumi Harness](../harness/README.md) · **Also touches:** [mac](../mac/README.md) · **Specs:** [SPEC-03](../specs/03-lane-routing.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Each subtask runs in one of three lanes: `helper` (no UI, invisible), `ghost` (an extra cursor working in a background-capable app), or `main` (the real mouse and keyboard).
The planner only proposes a lane.
The router checks what the target app actually supports and picks the cheapest lane that passes, because a small model will guess wrong.

## Read first

- [SPEC-03](../specs/03-lane-routing.md), requirements 1-4, 7, 10, and the "Lane routing" scenarios.
- [docs/lane-router.md](../docs/lane-router.md): lanes, routing flow, checks, router signature.
- [mac/README.md](../mac/README.md): the Mac app performs the capability probe.

## Tasks

- [ ] **OBJ-07.1** Implement the router interface from the design doc: `route(subtask, proposed) -> RouteDecision` with `lane`, `reason`, and an optional lock (locks come in [OBJ-08](OBJ-08-locks-busy-windows-cap.md)).
- [ ] **OBJ-07.2** Rule: a subtask with no target app is a `helper`, reason `noUI`.
- [ ] **OBJ-07.3** Add an RPC request to the Mac app, `probeAppCapability(bundleId)`, returning whether the app has an actionable accessibility tree and whether Chromium DevTools control is available. Implement the Mac side as a minimal probe.
- [ ] **OBJ-07.4** Cache probe results per app bundle id and version in the task store. Re-probe only when the version changes.
- [ ] **OBJ-07.5** Rule: a UI subtask goes to `ghost` only if the app is background-capable; otherwise `main` with reason `appNotBackgroundCapable`. `main` always accepts work.
- [ ] **OBJ-07.6** Enforce lane tool sets: only `main` gets keystroke tools (`type`, `key`); ghosts set text through accessibility or DevTools.
- [ ] **OBJ-07.7** Record every decision and its reason on the subtask, and emit it as an event for the dashboard.
- [ ] **OBJ-07.8** Plug the router into the scheduler from [OBJ-05](OBJ-05-planner-and-scheduler.md), replacing the "everything is a helper" stand-in.
- [ ] **OBJ-07.9** Tests with a fake probe: each rule, the wrong-lane proposal, cache reuse.

## Expectations

- [ ] SPEC-03 scenarios pass: "Subtask with no UI runs as a helper", "Background-capable app gets a ghost cursor" (lane decision only), "App without background control goes to the main cursor", "Planner proposes the wrong lane".
- [ ] A ghost can never receive a keystroke tool.
- [ ] Every routed subtask has a stored reason.

## Outcomes

- Router module, capability cache, the Mac probe RPC, and routing events.

## Out of scope

- Window locks, busy windows, and the cursor cap: [OBJ-08](OBJ-08-locks-busy-windows-cap.md).
- Ghost failure and handoff: [OBJ-09](OBJ-09-ghost-handoff.md).
- Actually driving apps (clicks, presses, DevTools): SPEC-05, not finalized.
- Drawing ghost cursors: [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) and [OBJ-19](OBJ-19-rive-cat-cursor.md).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
