---
id: OBJ-07
title: Lane router core
product: harness
assignee: Brent
touches: [protocol]
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
- [x] **OBJ-07.4** Cache probe results per app bundle id and version in the task store. Re-probe only when the version changes.
- [x] **OBJ-07.5** Rule: a UI subtask goes to `ghost` only if the app is background-capable; otherwise `main` with reason `appNotBackgroundCapable`. `main` always accepts work.
- [x] **OBJ-07.6** Enforce lane tool sets: only `main` gets keystroke tools (`type`, `key`); ghosts set text through accessibility or DevTools.
- [x] **OBJ-07.7** Record every decision and its reason on the subtask, and emit it as an event for the dashboard.
- [x] **OBJ-07.8** Plug the router into the scheduler from [OBJ-05](OBJ-05-planner-and-scheduler.md), replacing the "everything is a helper" stand-in.
- [x] **OBJ-07.9** Tests with a fake probe: each rule, the wrong-lane proposal, cache reuse.
- [x] **OBJ-07.10** Add `getAppVersion` to the protocol, served by the Mac app without launching the target app, so the cache can tell when an app's version changed. Make the mock Mac app answer probes for the app asked. (Added by the orchestrator; Brent leads protocol changes for now.)
- [x] **OBJ-07.11** Rule (SPEC-03 r17): a subtask the planner marks `needsKeyboard` goes to `main` with reason `needsKeyboard`. Add `needsKeyboard` to `Subtask` and `RouteReason` in the protocol. (Added after Brent's SPEC-03 decision.)

## Expectations

- [x] SPEC-03 scenarios pass: "Subtask with no UI runs as a helper", "Background-capable app gets a ghost cursor" (lane decision only), "App without background control goes to the main cursor", "Planner proposes the wrong lane".
- [x] A ghost can never receive a keystroke tool.
- [x] Every routed subtask has a stored reason.
- [x] SPEC-03 scenario "Parallel goal splits into lanes" passes (lane decisions only).

## Expected outcomes

- Router module, capability cache, the probe call, and routing events.

## Out of scope

- Window locks, busy windows, and the cursor cap: [OBJ-08](OBJ-08-locks-busy-windows-cap.md).
- Ghost failure and handoff: [OBJ-09](OBJ-09-ghost-handoff.md).
- Actually driving apps (clicks, presses, DevTools): [OBJ-39](OBJ-39-mac-gui-execution.md) (Mac) and [OBJ-36](OBJ-36-gui-act-sub-agent.md) (harness).
- Drawing ghost cursors: [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) and [OBJ-19](OBJ-19-rive-cat-cursor.md).

## Outcome

- **Result:** In progress. Everything is built and tested except one check, which stays open: OBJ-07.3 works against the protocol's mock Mac app but has not been run against the real Mac app; see "Not verified".
  - OBJ-07.8 was done on the OBJ-05 branch: `startHarness` creates the router once (`harness.router`), and the scheduler routes each ready subtask with `routeWith(harness.router)` (`harness/src/scheduler/lanes.ts`), which calls `router.route(subtask, subtask.proposedLane)`. A `ProbeFailure` fails the subtask with its `UserError`, sent as the `userError` event. The planner's `needsKeyboard` is saved on the subtask.
- **Delivered:**
  - `harness/src/router/router.ts`: `LaneRouter.route(subtask, proposed)` returns a `RouteDecision` (`lane`, `reason`, and an optional `lock` for OBJ-08), stores the lane and reason on the subtask, logs `router.decided` with the proposal, and emits `routeDecided`. Checks in order: no target app is `helper` (`noUI`); `needsKeyboard` is `main` (`needsKeyboard`), with no probe; a background-capable app is `ghost` (`backgroundCapable`); anything else is `main` (`appNotBackgroundCapable`).
  - `harness/src/router/capability.ts`: `macAppProbe` (calls `probeAppCapability` and maps failures to a `UserError`), `macAppVersion` (calls `getAppVersion`), `AppCapabilities` (the cache over the task store's `app_capabilities`, keyed by bundle id and installed version, one probe in flight per app), `ProbeFailure`, and `isBackgroundCapable`.
  - `harness/src/router/lanes.ts`: lane cost order and each lane's actions. Only `main` gets `type` and `key`.
  - `harness/src/router/index.ts`: `createLaneRouter({ store, server, logger })` for the running harness.
  - `harness/src/worker/`: `runWorkerStep` now takes `{ lane }`. The schema sent to the model, the system prompt, and the validation offer and accept only that lane's actions.
  - `harness/src/store/`: migration 2 adds `subtasks.needs_keyboard`; `addSubtask` takes `needsKeyboard`.
  - `protocol/schemas/rpc.json`: the `getAppVersion` method (`GetAppVersionParams`, `AppVersionResult`), with examples. `protocol/schemas/common.json` and `task.json`: `needsKeyboard` in `RouteReason` and an optional `needsKeyboard` on `Subtask`, with examples. `AppCapability.appVersion` now documents its format. Types regenerated. The protocol stays at version 3: every change is an addition.
  - `protocol/mocks/mock-mac-app.ts`: probes and version lookups answer for the app asked, from one `AppCapability` example per installed app (Chrome, Keynote, WezTerm, with the real versions of the apps on this Mac; Keynote is "Keynote Creator Studio", `15.2.1 (7048.0.3)`). Any other app fails the probe with `unsupportedRequest` and has no version, as on the real Mac app.
  - `harness/README.md`: the `src/router/` layout row and a "Lane router" section.
  - Tests: `harness/test/lane-router.test.ts`, `harness/test/lane-tools.test.ts`, and new cases in `protocol/test/mocks.test.ts` and `protocol/test/validation.test.ts`.
- **Commits:**
  - `9a47bd1 docs(objectives): start OBJ-07`
  - `e613c5a feat(harness): add the lane router, the app capability cache, and lane tool sets`
  - `61f9894 fix(harness): drop schema conditionals from the grammar sent to the model`
  - `f9b00bd docs(objectives): record the OBJ-07 outcome so far`
  - `86b48ee feat(protocol): add getAppVersion and make the mock Mac app probe the app asked`
  - `4c24976 feat(protocol): add needsKeyboard to Subtask and RouteReason`
  - `9e9f840 feat(harness): route keyboard subtasks to main and look up app versions before probing`
  - `a51d56f docs(objectives): update the OBJ-07 outcome`
  - `598f15e test(harness): run the permission gate's worker steps on the main lane`
  - `bd1cc43 fix(protocol): use Keynote's real version in the examples`
  - `665c41d docs(objectives): update the OBJ-07 outcome after merging OBJ-37`
  - `3db6f3d feat(harness): route each subtask through the lane router (OBJ-07.8)` (on the OBJ-05 branch)
  - `docs(objectives): record OBJ-07.8` (this Outcome, on the OBJ-05 branch)
- **Expectations:**
  - SPEC-03 scenarios, in `test/lane-router.test.ts` with a fake probe: "Scenario: Subtask with no UI runs as a helper" (lane `helper`, reason `noUI`, no probe, and only a `routeDecided` event, so no cursor command), "Scenario: Background-capable app gets a ghost cursor (lane decision only)" (Chrome with DevTools is `ghost`, `backgroundCapable`), "Scenario: App without background control goes to the main cursor" (`main`, `appNotBackgroundCapable`), and "Scenario: Planner proposes the wrong lane" (a `ghost` proposal for a canvas app is `main`). Four more cases override wrong proposals in both directions.
  - "Scenario: Parallel goal splits into lanes": the sheets subtask is `helper`, the Chrome form is `ghost`, and the Keynote subtask the planner marked `needsKeyboard` is `main` with reason `needsKeyboard`. Over the socket, the mock Mac app test routes Chrome to `ghost`, Keynote to `ghost`, WezTerm to `main` (`appNotBackgroundCapable`), and a `needsKeyboard` Keynote subtask to `main`.
  - A ghost never receives a keystroke: `test/lane-tools.test.ts`. `type` and `key` are only in the main lane's set, a ghost's schema and prompt do not offer them, validation rejects them, and a ghost step whose model sends `type` and then `key` ends as `invalidOutput` without running either.
  - Every routed subtask has a stored reason: "stores every routed subtask's lane and reason, and emits each decision as a valid routeDecided event", which validates each stored subtask and event against the protocol, and "keeps the decision after the store is closed and reopened".
  - OBJ-07.4, re-probe only on a version change: with the mock Mac app over the socket, three apps are probed once each, and a new router over the same database (a restart) reads each version with `getAppVersion` and probes nothing. With a fake version source, an updated version is probed once and both versions stay stored. A Mac app that answers "method not found" to `getAppVersion` falls back to one probe per app per run.
  - Failures: a probe the Mac app fails (`--fail probeAppCapability=accessibilityPermissionMissing`, or an app the mock does not have) rejects `route` with that `UserError` and stores nothing. Raw errors become `unexpected`, with the detail only in the log.
  - `python3 scripts/verify.py` passes after rebasing onto OBJ-37: docs, protocol (264 tests), harness (263 tests), bridge, and the Mac build and tests. Android and whisper passed on an earlier run; nothing in them changed.
  - OBJ-07.8: `harness/test/scheduler.test.ts`, "routing through the lane router (OBJ-07.8)": every subtask of the 5-PDF task is routed before it runs and the app receives one valid `routeDecided` per subtask; the planner's `needsKeyboard` is stored on the subtask; and a `ProbeFailure` fails the task with `accessibilityPermissionMissing` sent as `userError`.
- **Not verified:**
  - The Swift and Kotlin compile checks in Docker (Docker is not running here; CI runs them on push). The Mac app builds and its tests pass with the regenerated Swift.
  - The real Mac app (Patrick, OBJ-27): it does not serve `getAppVersion` yet and answers "method not found", so until then the harness probes each app once per run. To add it in `mac/Yumi/Native/AppMethodServer.swift`: decode `GetAppVersionParams`; find the app with `NSWorkspace.shared.urlForApplication(withBundleIdentifier:)` without launching it; answer `AppVersionResult(appVersion: AppCapabilityProbe.version(of: url))`, so the string is exactly the probe's `appVersion`; answer `AppVersionResult()` with no version when the app is not installed.
  - OBJ-07.3 and OBJ-07.4 against the real Mac app. This needs a team-signed Yumi build with Accessibility granted (see OBJ-27's Outcome). With Yumi running the real harness, route a subtask whose target is `com.google.Chrome` and one whose target is WezTerm (`com.github.wez.wezterm`). Expect `ghost` with `backgroundCapable` and `main` with `appNotBackgroundCapable`, a `router.probed` line for each in `harness.log`, and one row each in `app_capabilities` in `tasks.db`. After `getAppVersion` ships, restart the harness, route both again, and expect `router.capabilityCached` lines and no new `router.probed` lines.
- **Decisions and deviations:**
  - The planner's proposed lane is logged, not used: the router picks the cheapest lane that passes (SPEC-03 r1). The planner's only way to ask for `main` is `needsKeyboard` (SPEC-03 r17, Brent's decision of 2026-10-09).
  - A `needsKeyboard` subtask goes to `main` without probing its app, so its reason is `needsKeyboard` even when the app is not background-capable. A `needsKeyboard` subtask with no target app is still a `helper` (requirement 2), because there is no app to type into; the orchestrator confirmed this.
  - A failed probe is not cached and is not routed to `main`: `route` rejects with `ProbeFailure`, carrying the Mac app's `UserError` (for example `accessibilityPermissionMissing`, or `unsupportedRequest` for an app that is not installed), since the main cursor cannot work in that app either. The orchestrator confirmed this. Anything else (no Mac app connected, a method the app does not serve, a broken reply) is `unexpected`, with the detail in the log.
  - `getAppVersion` returns no version for an app that is not installed, instead of an error, because it is a lookup; the probe that follows reports the failure. If the two methods ever format the version differently, the router logs `router.versionMismatch` and probes once per run.
  - The router refuses a probe answer for a different bundle id.
  - Lane actions: `ghost` also loses `clickAt`, because a click at screen coordinates moves the real mouse (the design doc's lane table: ghosts use the accessibility API and DevTools). `helper` gets only `tool`, `ask`, and `finish`, because helpers never touch the UI. Typed tools are not split by lane here; the permission gate (OBJ-37) governs them.
  - Found along the way: since protocol version 3, the schema sent to the model contains `if`, `then`, and `else`, which llguidance 1.9.1 (mlx-vlm 0.7.6) refuses, so any real step offering `open_app` would fail. `scripts/check-grammar.py` reproduced it on the example step without loading a model. The bundler now drops those keywords for the model, the same way it drops `uniqueItems`; replies are still validated against the full schema. All three lanes' schemas compile.
  - A fix for the flaky bridge client test was dropped in the rebase, because `main` fixed it the same way in `712e727`.
  - `runWorkerStep` requires the lane, so OBJ-37's two worker step tests in `test/permission-gate.test.ts` now pass `{ lane: "main" }`, the lane that offers every action, as when they were written.
- **For the next objectives:**
  - Plugging the router into the OBJ-05 scheduler (OBJ-07.8): create it once in `startHarness` with `createLaneRouter({ store, server, logger })`. Where the scheduler's stand-in makes every subtask a helper, call `await router.route(subtask, subtask.proposedLane)` for each `ready` subtask, then run it on `decision.lane`. Pass that lane to `runWorkerStep(input, deps, { lane })`, and build `allowedTools` for it. On `ProbeFailure`, fail the subtask and send `error.userError` as the `userError` event; never show its message.
  - OBJ-05: pass the planner's `needsKeyboard` to `store.addSubtask({ ..., needsKeyboard })`; the router reads it from the subtask.
  - The router does not change subtask status; the scheduler moves the subtask from `ready` to `running` or `queued`. Routing again (after a pause) overwrites the lane and reason.
  - OBJ-08: add the window lock, busy window, and cursor cap checks in `LaneRouter.decide`, after the capability check, and return `lock` in the decision. The reasons `windowLocked`, `openedSecondWindow`, and `atCapacity` already exist.
  - OBJ-09: handoff sets `lane: "main"` and `routeReason: "promotedAfterFailure"` on the subtask; the main step then gets keystrokes through `{ lane: "main" }`.
  - OBJ-36: `LANE_ACTIONS` in `src/router/lanes.ts` is the single place to change what a lane may do.
  - OBJ-27 (Patrick): serve `getAppVersion` as described under "Not verified".
