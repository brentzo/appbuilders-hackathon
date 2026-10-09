---
id: OBJ-07
title: Lane router core
product: harness
assignee: Brent
touches: []
specs: [SPEC-03]
status: in-progress
priority: p0
depends-on: [OBJ-01, OBJ-04]
integrates-with: [OBJ-27]
tags: [objective, p0, harness, gui]
---

# OBJ-07 Lane router core

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-03](../specs/03-lane-routing.md) · **Assignee:** Brent

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
- The `probeAppCapability` contract from [OBJ-01](OBJ-01-task-record-schemas.md). Patrick implements it in the Mac app in [OBJ-27](OBJ-27-mac-native-services.md); use the mock Mac app until then.

## Tasks

- [x] **OBJ-07.1** Implement the router interface from the design doc: `route(subtask, proposed) -> RouteDecision` with `lane`, `reason`, and an optional lock (locks come in [OBJ-08](OBJ-08-locks-busy-windows-cap.md)).
- [x] **OBJ-07.2** Rule: a subtask with no target app is a `helper`, reason `noUI`.
- [ ] **OBJ-07.3** Call the Mac app's `probeAppCapability(bundleId)` to learn whether the app has an actionable accessibility tree and whether Chromium DevTools control is available. Develop against the mock Mac app; verify against the real one once [OBJ-27](OBJ-27-mac-native-services.md) is done.
- [ ] **OBJ-07.4** Cache probe results per app bundle id and version in the task store. Re-probe only when the version changes.
- [x] **OBJ-07.5** Rule: a UI subtask goes to `ghost` only if the app is background-capable; otherwise `main` with reason `appNotBackgroundCapable`. `main` always accepts work.
- [x] **OBJ-07.6** Enforce lane tool sets: only `main` gets keystroke tools (`type`, `key`); ghosts set text through accessibility or DevTools.
- [x] **OBJ-07.7** Record every decision and its reason on the subtask, and emit it as an event for the dashboard.
- [ ] **OBJ-07.8** Plug the router into the scheduler from [OBJ-05](OBJ-05-planner-and-scheduler.md), replacing the "everything is a helper" stand-in.
- [x] **OBJ-07.9** Tests with a fake probe: each rule, the wrong-lane proposal, cache reuse.

## Expectations

- [x] SPEC-03 scenarios pass: "Subtask with no UI runs as a helper", "Background-capable app gets a ghost cursor" (lane decision only), "App without background control goes to the main cursor", "Planner proposes the wrong lane".
- [x] A ghost can never receive a keystroke tool.
- [x] Every routed subtask has a stored reason.

## Expected outcomes

- Router module, capability cache, the probe call, and routing events.

## Out of scope

- Window locks, busy windows, and the cursor cap: [OBJ-08](OBJ-08-locks-busy-windows-cap.md).
- Ghost failure and handoff: [OBJ-09](OBJ-09-ghost-handoff.md).
- Actually driving apps (clicks, presses, DevTools): SPEC-05, not finalized.
- Drawing ghost cursors: [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) and [OBJ-19](OBJ-19-rive-cat-cursor.md).

## Outcome

- **Result:** In progress. The router, the capability cache, the probe call, lane tool sets, and routing events are built and tested. Three tasks are open:
  - OBJ-07.8 waits for the OBJ-05 scheduler, which is being built on another branch. The orchestrator plugs the router in after both merge (see "For the next objectives").
  - OBJ-07.4: results are cached per bundle id and version, but the harness cannot tell that an app's version changed without probing it, because only the probe reports the version. See "Decisions and deviations" and the open question there.
  - OBJ-07.3: the call works against the protocol's mock Mac app. It is not yet run against the real Mac app (OBJ-27 is done); see "Not verified".
- **Delivered:**
  - `harness/src/router/router.ts`: `LaneRouter.route(subtask, proposed)` returns a `RouteDecision` (`lane`, `reason`, and an optional `lock` for OBJ-08), stores the lane and reason on the subtask, logs `router.decided` with the proposal, and emits `routeDecided`.
  - `harness/src/router/capability.ts`: `macAppProbe` (calls `probeAppCapability` and maps failures to a `UserError`), `AppCapabilities` (the cache over the task store's `app_capabilities`, one probe in flight per app), `ProbeFailure`, and `isBackgroundCapable`.
  - `harness/src/router/lanes.ts`: lane cost order and each lane's actions. Only `main` gets `type` and `key`.
  - `harness/src/router/index.ts`: `createLaneRouter({ store, server, logger })` for the running harness.
  - `harness/src/worker/`: `runWorkerStep` now takes `{ lane }`. The schema sent to the model, the system prompt, and the validation offer and accept only that lane's actions.
  - `harness/README.md`: the `src/router/` layout row and a "Lane router" section.
  - Tests: `harness/test/lane-router.test.ts` and `harness/test/lane-tools.test.ts`.
- **Commits:**
  - `cd5e676 docs(objectives): start OBJ-07`
  - `d2d7174 feat(harness): add the lane router, the app capability cache, and lane tool sets`
  - `8fa6565 fix(harness): drop schema conditionals from the grammar sent to the model`
  - `0fce3ea test(harness): wait for the bridge client to retry before checking it went offline`
  - `docs(objectives): record the OBJ-07 outcome so far` (this Outcome)
- **Expectations:**
  - SPEC-03 scenarios, in `test/lane-router.test.ts` with a fake probe: "Scenario: Subtask with no UI runs as a helper" (lane `helper`, reason `noUI`, no probe, and only a `routeDecided` event, so no cursor command), "Scenario: Background-capable app gets a ghost cursor (lane decision only)" (Chrome with DevTools is `ghost`, `backgroundCapable`), "Scenario: App without background control goes to the main cursor" (`main`, `appNotBackgroundCapable`), and "Scenario: Planner proposes the wrong lane" (a `ghost` proposal for a canvas app is `main`). Four more cases override wrong proposals in both directions.
  - A ghost never receives a keystroke: `test/lane-tools.test.ts`. `type` and `key` are only in the main lane's set, a ghost's schema and prompt do not offer them, validation rejects them, and a ghost step whose model sends `type` and then `key` ends as `invalidOutput` without running either.
  - Every routed subtask has a stored reason: "stores every routed subtask's lane and reason, and emits each decision as a valid routeDecided event", which also validates each stored subtask and event against the protocol, and "keeps the decision after the store is closed and reopened".
  - Over the local RPC with the protocol's mock Mac app (`npm run mock:mac`): the router probes once, stores the capability, stores the decision, and the mock receives `routeDecided`. With `--fail probeAppCapability=accessibilityPermissionMissing`, `route` rejects with that `UserError` and stores nothing.
  - Cache reuse: one probe for three subtasks on the same app, one probe for two routed at the same time, and with an installed version source, no probe after a restart and one new probe after a version change.
  - `python3 scripts/verify.py` passes (docs, and the harness typecheck, lint, format, and 140 tests). The full harness suite passed 10 repeated runs after the flaky-test fix below.
- **Not verified:**
  - OBJ-07.3 against the real Mac app. It needs a team-signed Yumi build with Accessibility granted (see OBJ-27's Outcome). With Yumi running the real harness, route a subtask whose target is `com.google.Chrome` and one whose target is an app with no accessibility tree (OBJ-27 used WezTerm). Expect `ghost` with `backgroundCapable` and `main` with `appNotBackgroundCapable`, a `router.probed` line for each in `harness.log`, and one row each in `app_capabilities` in `tasks.db`.
- **Decisions and deviations:**
  - The planner's proposal is logged, not used: the router always picks the cheapest lane that passes (SPEC-03 r1 and the design doc). `RouteReason` has no value for "kept the planner's more expensive lane". Note that SPEC-03 "Scenario: Parallel goal splits into lanes" expects the Keynote subtask on the main cursor, but Keynote has an actionable accessibility tree (OBJ-27, the protocol's Keynote example), so this router sends it to a ghost. That scenario is not one of this objective's expectations; it is raised with Brent.
  - App version: the protocol has no way to read an app's version without probing it (`probeAppCapability` takes only a bundle id, and `WindowInfo` has no version). So `AppCapabilities` probes each app once per harness run and stores the result per bundle id and version. It takes an optional `installedVersion(bundleId)` source; with one, it reuses stored results across restarts and probes again only when the version changes (tested). Open question for Brent: add a cheap version lookup to the protocol, served by the Mac app without launching the app (recommended), or accept one probe per app per run.
  - A failed probe is not cached and is not routed to `main`: `route` rejects with `ProbeFailure`, carrying the Mac app's `UserError` (for example `accessibilityPermissionMissing`, or `unsupportedRequest` for an app that is not installed), since the main cursor cannot work in that app either. Anything else (no Mac app connected, a method the app does not serve, a broken reply) is `unexpected`, with the detail in the log.
  - The router refuses a probe answer for a different bundle id. The protocol's mock Mac app answers every probe with its Keynote example, so tests against the mock use Keynote.
  - Lane actions: `ghost` also loses `clickAt`, because a click at screen coordinates moves the real mouse (the design doc's lane table: ghosts use the accessibility API and DevTools). `helper` gets only `tool`, `ask`, and `finish`, because helpers never touch the UI. Typed tools are not split by lane here; the permission gate (OBJ-42) governs them.
  - Found along the way: since protocol version 3, the schema sent to the model contains `if`, `then`, and `else`, which llguidance 1.9.1 (mlx-vlm 0.7.6) refuses, so any real step offering `open_app` would fail. `scripts/check-grammar.py` reproduced it on the example step without loading a model. The bundler now drops those keywords for the model, the same way it drops `uniqueItems`; replies are still validated against the full schema. All three lanes' schemas compile.
  - Also fixed a flaky bridge client test (`test/nonfunctional.test.ts`, about 1 failure in 10 full runs): it waited for the `offline` state the client starts in.
- **For the next objectives:**
  - Plugging the router into the OBJ-05 scheduler (OBJ-07.8): create it once in `startHarness` with `createLaneRouter({ store, server, logger })`. Where the scheduler's stand-in makes every subtask a helper, call `await router.route(subtask, subtask.proposedLane)` for each `ready` subtask, then run it on `decision.lane`. Pass that lane to `runWorkerStep(input, deps, { lane })`, and build `allowedTools` for it. On `ProbeFailure`, fail the subtask and send `error.userError` as the `userError` event; never show its message.
  - The router does not change subtask status; the scheduler moves the subtask from `ready` to `running` or `queued`. Routing again (after a pause) overwrites the lane and reason.
  - OBJ-08: add the window lock, busy window, and cursor cap checks in `LaneRouter.decide`, after the capability check, and return `lock` in the decision. The reasons `windowLocked`, `openedSecondWindow`, and `atCapacity` already exist.
  - OBJ-09: handoff sets `lane: "main"` and `routeReason: "promotedAfterFailure"` on the subtask; the main step then gets keystrokes through `{ lane: "main" }`.
  - OBJ-41: `LANE_ACTIONS` in `src/router/lanes.ts` is the single place to change what a lane may do.
