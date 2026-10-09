---
id: OBJ-08
title: Window locks, busy windows, and cursor cap
product: harness
assignee: Brent
touches: []
specs: [SPEC-03]
status: done
priority: p0
depends-on: [OBJ-07]
integrates-with: [OBJ-27]
tags: [objective, p0, harness, gui]
---

# OBJ-08 Window locks, busy windows, and cursor cap

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

Two cursors in one window would fight over the same form, so each window is locked to one cursor.
When a job needs a window that is busy, Yumi opens a second window of the same app if it can, and otherwise waits, telling the user if the wait gets long.
At most 3 cursors are visible at once.

## Read first

- [SPEC-03](../specs/03-lane-routing.md), requirements 5, 6, 11-13, the "Busy window" and "Cursor cap" scenarios, and the Decisions section.
- [docs/lane-router.md](../docs/lane-router.md), "Checks" and "Lane-specific rules".
- [OBJ-07](OBJ-07-lane-router-core.md) Outcome.

## Tasks

- [x] **OBJ-08.1** Store window locks in the task store with `windowId`, `subtaskId`, `lane`, `acquiredAt`, and `expiresAt`. Expired locks are released automatically so a crashed worker cannot block a window.
- [x] **OBJ-08.2** Acquire the lock as part of routing a `ghost` or `main` subtask, and release it when the subtask ends, fails, or hands off.
- [x] **OBJ-08.3** Call the Mac app's `openNewWindow(bundleId)`, which opens a new window of the app when the app supports it (for example a new Chrome window, Finder window, or email draft) and returns its window id, or says it cannot. Develop against the mock Mac app; Patrick implements it in [OBJ-27](OBJ-27-mac-native-services.md).
- [x] **OBJ-08.4** Busy window rule: if the target window is locked, try `openNewWindow` and route to the new window. If the app cannot, queue the subtask until the lock is released.
- [x] **OBJ-08.5** After a subtask has waited 2 minutes, emit a `waitingForWindow` event with the app name and the subtask, so the Mac app can say "I'm waiting for Keynote to be free before I add the chart. It should be quick."
- [x] **OBJ-08.6** Cursor cap: count visible cursors (main plus ghosts). If 3 are visible, queue new ghost-capable subtasks until one finishes. The cap comes from config.
- [x] **OBJ-08.7** When a task is about to use more than one window at once, emit a `tilingSuggested` event listing the windows. Patrick's [OBJ-20](OBJ-20-window-tiling.md) handles it in the Mac app.
- [x] **OBJ-08.8** Tests: lock acquire and release, lock expiry, second window path, waiting path, 2-minute notice, cap queueing.

## Expectations

- [x] SPEC-03 scenarios pass: "Busy window, app supports a second window", "Busy window, app cannot open a second window", "Long wait is explained", "Cursor cap is reached".
- [x] No two cursors ever hold the same window at the same time, including after a crash and restart.
- [x] The 2-minute notice is a structured event; the spoken copy lives in the app.

## Expected outcomes

- Lock management, the `openNewWindow` call, the waiting notice and tiling suggestion events, and the cursor cap.

## Out of scope

- Window tiling: [OBJ-20](OBJ-20-window-tiling.md).
- Ghost failure and handoff: [OBJ-09](OBJ-09-ghost-handoff.md).

## Outcome

- **Result:** Done against the protocol's mock Mac app, as OBJ-08.3 asks. The real Mac app's `listWindows` and `openNewWindow` were not exercised from the harness, and its spoken line for `waitingForWindow` does not exist yet; see "Not verified".
- **Delivered:**
  - `harness/src/router/windows.ts`: `WindowCoordinator`, which claims a cursor and a window for every ghost and main subtask: the cursor cap, the window choice, the lock, `openNewWindow` for a busy window or a `windowLocked` queue, the `waitingForWindow` notice after `WAIT_NOTICE_MS` (2 minutes), `tilingSuggested`, and lock renewal. `macAppWindows` calls the Mac app's `listWindows` and `openNewWindow`.
  - `harness/src/router/router.ts`: check 4, the claim, after the capability check. `RouteDecision` gains `target`, `queued` (with `wait`), and `release`; the window is stored on the subtask as `target.windowId`. `LaneRouter.close()`.
  - `harness/src/router/index.ts`: `createLaneRouter` builds the coordinator over the Mac app, with `cursorCap`.
  - `harness/src/store/`: migration 6 (`window_locks.expires_ms` and an index by subtask), and `acquireWindowLock` (one transaction, refuses a live lock another subtask holds), `renewWindowLock`, `listLiveWindowLocks`, `releaseWindowLocksOf`, and `releaseExpiredWindowLocks`. `setSubtaskStatus` releases a subtask's locks in the same transaction when it leaves `running` or `needsApproval` (`HOLDS_WINDOW`).
  - `harness/src/scheduler/scheduler.ts`: a queued subtask goes to `queued`, gives its model slot back while it waits, routes again when woken, and takes a slot again before it runs. Its cursor is released when its run ends. A pause puts a waiting subtask back to `ready`; another subtask's failure fails it ("Stopped before it started.").
  - `harness/src/scheduler/recovery.ts`: startup releases every lock left in the store.
  - `harness/src/config.ts`: `cursorCap` from `YUMI_CURSOR_CAP`, default 3. `harness/src/harness.ts` passes it to the router and closes the router on shutdown.
  - `protocol/mocks/mock-mac-app.ts`: `listWindows` answers for the app asked, and `openNewWindow` opens a window with a fresh id only for Chrome, Finder, and Mail (the real app's `NewWindowOpener.strategies`), `supported: false` for the others. Tests in `protocol/test/mocks.test.ts`, and a line in `protocol/README.md`. No schema change; the protocol stays at version 4.
  - Tests: `harness/test/window-locks.test.ts` and the crash fixture `harness/test/fixtures/crash-holding-lock.ts`. `harness/README.md` documents it under "Window locks, busy windows, and the cursor cap" and `YUMI_CURSOR_CAP`.
- **Commits:**
  - `2001322 docs(objectives): start OBJ-08`
  - `75f8100 feat(protocol): answer listWindows and openNewWindow per app in the mock Mac app`
  - `c740e86 feat(harness): lock windows, open a second window or queue, and cap visible cursors`
  - `dfa0323 test(harness): give tests room on a loaded machine`
  - `docs(objectives): finish OBJ-08` (this Outcome)
- **Expectations:**
  - The four SPEC-03 scenarios, end to end in `test/window-locks.test.ts` ("SPEC-03 busy windows and the cursor cap, with the mock Mac app"): the real planner, scheduler, and router of a running harness, `npm run mock:mac` on its socket, a mocked model server, and stand-in ghost and main lanes. Each of the four fails when the coordinator is taken out of `createLaneRouter`.
    - "Scenario: Busy window, app supports a second window": two Chrome subtasks; the mock gets `openNewWindow`, one works in window 977 (`backgroundCapable`) and the other in the new window 978 (`openedSecondWindow`), their worker steps overlap in time, and the Mac app gets one `tilingSuggested` with both windows.
    - "Scenario: Busy window, app cannot open a second window": two Keynote subtasks; `openNewWindow` answers `supported: false` once, the second subtask goes to `queued` with a `routeDecided` of reason `windowLocked`, and it starts in window 4182 only after the first is done. Their steps do not overlap.
    - "Scenario: Long wait is explained": the mock Mac app gets `waitingForWindow` `{ taskId, subtaskId, appName: "Keynote" }`, valid against the contract (the delay shortened to 300 ms here). With fake timers, the coordinator sends nothing at 119,999 ms and exactly one notice at 120,000 ms, none after the window frees before 2 minutes, and none after a cancelled wait.
    - "Scenario: Cursor cap is reached": four Chrome subtasks with four model slots; three run at once in windows 977, 978, and 979, the fourth goes to `queued` with reason `atCapacity` and starts only after one of them finished, at most 3 model requests were in flight, and no fourth window was opened. With a fake Mac app: the cap comes from the configuration, `main` counts against it, and there is one main cursor.
  - No two cursors in one window, including after a crash and restart: the store refuses a live lock another subtask holds, also from a second connection to the same database; claims run one at a time, so two concurrent claims never get the same free window; a lock expires only when nobody renews it, and a working cursor's lock stays live past three lock lifetimes. A separate process takes Keynote's window and kills itself with SIGKILL: before a restart its lock still keeps others out; after `startHarness`, recovery has released it and every leftover lock, and its subtask is `ready`. Locks are released in the same transaction as `done`, `failed`, `handoff`, and a pause back to `ready`, and kept through `needsApproval`.
  - The 2-minute notice is a structured event: `waitingForWindow` carries only the task, the subtask, and the app name, validated as `WaitingForWindow`. No copy is in the harness.
  - `python3 scripts/verify.py` passes: docs, protocol (328 tests), harness typecheck, lint, format, and 355 tests, bridge, and the Mac build and tests, at a load average of about 25 from the other agents. The window lock, scheduler, and router suites also passed three runs at once.
- **Not verified:**
  - The real Mac app's `listWindows` and `openNewWindow` from the harness. OBJ-27 serves both and checked them with its own driver, but no harness has called them yet: nothing starts a task in the shipped harness (OBJ-17), ghost and main have no lanes (OBJ-36), and running Yumi shares the harness socket with the other sessions. To check, once the orchestrator says the socket is free: build Yumi team-signed, grant Accessibility, open one Chrome window and one Keynote presentation, and run a throwaway harness on Yumi's socket as in OBJ-07's Outcome that routes two Chrome subtasks and two Keynote subtasks through `harness.router` without releasing them. Expect a new Chrome window on screen and `windows.claimed` with `openedSecondWindow` in `harness.log`, the second Keynote subtask logged as `windows.queued` with `windowLocked`, and the tiling question from OBJ-20.
  - The spoken line "I'm waiting for Keynote to be free before I add the chart. It should be quick.": the Mac app logs `waitingForWindow` as not handled yet (`mac/Yumi/Harness/HarnessLink.swift`). That is Mac work (Patrick); see the questions below.
  - Docker's Swift and Kotlin compile checks did not run (Docker is not running). No schema changed.
- **Decisions and deviations:**
  - The cursor cap is checked before the window, while docs/lane-router.md lists the window check first, so a subtask with no room never opens a window it cannot use yet.
  - Visible cursors are the ghost and main subtasks that hold a claim: every working ghost, plus `main` while a main subtask works. There is one main cursor (the real mouse and keyboard; "main queue" in docs/lane-router.md), so a second main subtask waits with reason `atCapacity`.
  - The window a subtask works in: the one it worked in before, else the app's first window from `listWindows`, else a window another subtask of the same task worked in (such as one Yumi opened earlier). The user's other windows of the app are never used: when those candidates are busy, Yumi opens a new window, as SPEC-03 r11 says.
  - An app with no window that cannot open one gets the cursor without a lock (`windows.noWindow`); the lane opens the app itself. Minimized windows are not skipped.
  - Locks last 60 seconds and working cursors renew them every 20 seconds. Startup recovery releases every lock, not only those of the subtasks it resets, since no cursor survives a restart.
  - A queued subtask gives its model slot back, so a waiting ghost does not hold up a helper. It routes again whenever a subtask stops working or a stale lock expires, and asks `openNewWindow` only once per wait. After the wait, its stored reason is the lane's own (`backgroundCapable`); the `windowLocked` or `atCapacity` decision was stored and sent before.
  - `waitingForWindow` is sent once per wait, only for a busy window, not for the cursor cap. A pause ends the wait, and a later wait starts a new 2 minutes. `appName` is the window's app name from `listWindows`, else the planner's app name, else the bundle id.
  - `tilingSuggested` is sent when a task holds more windows at once than before, and at least 2, including the main cursor's window. The Mac tiler ignores a repeat for a task it already asked about.
  - Found along the way: at a load average of about 25, three unrelated harness tests (bridge client end to end, bridge client non-functional, model client) failed on Vitest's 5-second default, and the new tests' mock Mac app start on the 10-second hook default. `harness/vitest.config.ts` now gives every test 20 seconds and every hook 30; files that set more keep theirs.
  - The mock Mac app change is in `protocol/`, because a mock that always opens a window hides the "cannot open" path (contracts-and-stand-ins: mocks must be honest). No schema change and no version bump.
- **For the next objectives:**
  - OBJ-36 (gui_act): a ghost or main lane works in `subtask.target.windowId` (the subtask passed to `observe` and the step loop has it). The lane does not take or release locks; the scheduler releases the claim when the run ends, and any status change out of `running` or `needsApproval` releases the lock in the store. If the lane cannot find the window, fail the step; do not pick another window.
  - OBJ-09 (handoff): moving a subtask to `handoff` releases its window. Routing it again on `main` claims the main cursor and the window, and may queue with `atCapacity` while another main subtask works. A `release` from an earlier decision never releases a later claim.
  - OBJ-38 (pause and cancel): a pause aborts a waiting subtask's wait and sets it back to `ready`; a cancel leaves never-started subtasks as they are.
  - OBJ-17: pass `config.cursorCap` through `startHarness` (it already reads `HarnessConfig`).
  - Mac app (Patrick): `listWindows` order matters, since the first window of an app is the one a subtask works in. Handle `waitingForWindow` in `HarnessLink`. `tilingSuggested` now arrives with real window ids (OBJ-20's hand check, step 3).
  - Tests: `FakeWindows` in `test/window-locks.test.ts` is a fake Mac app for the coordinator. `createLaneRouter({ ..., windows: { waitNoticeMs, lockTtlMs } })` shortens the times.
  - Questions for Brent: should a wait for the cursor cap also be explained after 2 minutes (SPEC-03 r13 says "what it is waiting for", but `waitingForWindow` names an app)? Is one main cursor at a time right? The scenario's sentence says what the subtask will do ("before I add the chart"), but `WaitingForWindow` carries only the app name and the subtask id, so the Mac app has to look the subtask up with `getTask` or the contract needs the subtask's title.
