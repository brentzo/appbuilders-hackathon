---
id: OBJ-38
title: Approvals, pause, and action log in the harness
product: harness
assignee: Brent
touches: []
specs: [SPEC-07, SPEC-06]
status: in-progress
priority: p0
depends-on: [OBJ-06, OBJ-37]
integrates-with: [OBJ-35, OBJ-39, OBJ-40]
tags: [objective, p0, harness, safety, ux]
---

# OBJ-38 Approvals, pause, and action log in the harness

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-07](../specs/07-safety.md), [SPEC-06](../specs/06-user-control.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

When the gate from [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) says "ask", the harness must stop, build the approval from real data, wait for the user, and check again right before acting.
When the user stops Yumi or takes the mouse, the harness must pause before the next action, cancel every pending approval, and on cancel drop everything still queued.
Every action, including blocked and declined ones, goes into a plain-language action log.
Build against the mock Mac app from [OBJ-01](OBJ-01-task-record-schemas.md) until [OBJ-39](OBJ-39-mac-gui-execution.md), [OBJ-40](OBJ-40-mac-approval-cards.md), and [OBJ-35](OBJ-35-mac-stop-and-take-over.md) are done.

## Read first

- [SPEC-07](../specs/07-safety.md), requirements 5, 10-15, and 18-20, and the "Strict delete", "Sending", and "Action log" scenarios.
- [SPEC-06](../specs/06-user-control.md), requirements 1, 2, 4, 5, 7, and 8.
- [docs/task-record-schema.md](../docs/task-record-schema.md), "Approvals", "Action log", and "Checkpointing".
- [OBJ-01](OBJ-01-task-record-schemas.md): `Approval`, `ApprovalDecision`, `ActionLogEntry`, `ErrorKind.blockedAction`, the RPC methods `showApprovalCard`, `readFieldValues`, `moveToTrash`, `pause`, `resumeTask`, and `cancelTask`, and the `approvalCancelled` and `userError` events.
- The Outcome of [OBJ-04](OBJ-04-task-store.md) (store), [OBJ-06](OBJ-06-resume-and-limits.md) (resume and cancel), and [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) (gate), when done.
- The open questions for OBJ-35 to OBJ-40 in the [objectives README](README.md).

## Tasks

- [x] **OBJ-38.1** Approval flow: an "ask" action sets the subtask to `needsApproval` and the task to `waitingForUser`, writes an `Approval`, and calls `showApprovalCard`. An approval covers exactly one action, once. A delete counts as approved only with `method: tap` (SPEC-07 r11); a send with a tap or the reply "send it" (r15).
- [x] **OBJ-38.2** Sending: build the approval text from the real To and Cc fields read with `readFieldValues`, never from model text, in the form "I'm about to send this email to Ana. Should I send it?" (SPEC-07 r13), and the SPEC-07 "Draft copy" forms for Messages, several recipients, and Cc. Right before pressing Send, read them again; if they changed, drop the approval and ask again (r14).
- [x] **OBJ-38.3** Deleting: build the text from the [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) `FileSummary`, in the form "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?", and the SPEC-07 "Draft copy" forms for one file and for files in several folders. Right before acting, list the files again; if any was added, removed, or changed, ask again with the new list (r12). Then call `moveToTrash` with the exact paths.
- [x] **OBJ-38.4** Blocked actions never run, even after a yes: record the step as `blocked`, emit a `userError` of kind `blockedAction`, and on the user's choice either continue ("Keep going", which the app sends as `resumeTask`) or cancel the task ("Stop", `cancelTask`) (SPEC-07 r5, gap G6 as resolved in OBJ-45).
- [x] **OBJ-38.5** Pause: one `pause(taskId, scope)` path ([OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md): `scope` is `everyLane`, the default, or `uiLanes`), with scope every lane (stop shortcut, menu bar "Stop") or UI lanes only (the user took over; helpers keep running). A UI-lanes pause while the task waits for the user and no UI lane is acting is ignored, as a second guard behind the Mac app (SPEC-06 r2). It sets the pause state the [OBJ-36](OBJ-36-gui-act-sub-agent.md) step loop checks before every action, checkpoints, sets the task to `paused`, cancels every pending approval, and emits `approvalCancelled` (SPEC-06 r1, r2, r4, r5). After resume, a risky action goes through the gate and asks again.
- [x] **OBJ-38.6** Cancel: extend the [OBJ-06](OBJ-06-resume-and-limits.md) `cancelTask` so it stops every lane, helpers included, drops every queued subtask and every command not yet run, and sets the task to `cancelled`. Nothing runs after cancel (SPEC-06 r8).
- [x] **OBJ-38.7** Action log: write an `ActionLogEntry` for every action that ran, was blocked, or was declined, with time (am/pm), device, lane, a plain-language description, and every path for deletes (SPEC-07 r18). Write it to a text file as lines like "3:42 pm, Mac, main cursor: Clicked Export in Keynote", plus a count line per task such as "Read 3 files and clicked 12 times". Record the file's location in `harness/README.md`.
- [x] **OBJ-38.8** (p1) Add a test that text typed into a password field never reaches the action log (SPEC-07 r20).
- [x] **OBJ-38.9** Run the mock Mac app tests for send and delete re-checks, a voice "yes" on a delete, a blocked action after a yes, pausing with an open approval, cancel with a queued helper, and the log lines.
- [ ] **OBJ-38.10** Run the approval, stop, take-over, resume, cancel, and action-log scenarios with the real Mac app after [OBJ-40](OBJ-40-mac-approval-cards.md) and [OBJ-35](OBJ-35-mac-stop-and-take-over.md) are done.

## Expectations

- [x] At the harness level, SPEC-07 "Strict delete" scenarios pass: "Delete needs a tap", "Saying yes is not enough to delete", "User declines a delete", "File list changed after approval".
- [ ] The real Mac app shows the delete approval, enforces tap-only approval, and says the decline copy from SPEC-07.
- [x] At the harness level, SPEC-07 "Sending" scenarios pass: "Sending an email needs approval", "Approval text comes from the real recipients", "Recipients changed after approval".
- [ ] The real Mac app shows the send approval, accepts "send it", and says the decline copy from SPEC-07.
- [x] SPEC-07 "Action log" scenarios pass: "Every action is logged", "Task summary includes activity counts".
- [x] SPEC-06 scenarios pass at the harness level: "Pause cancels a pending approval", "User resumes", "User cancels a paused task".
- [x] No approval text, file name, or recipient comes from model output.
- [x] No action runs after a pause is set.

## Expected outcomes

- The approval flow with send and delete re-checks, the blocked-action path, the pause and cancel paths, and the action log in the harness.

## Out of scope

- Deciding levels and the file tools: [OBJ-37](OBJ-37-permission-gate-and-file-tools.md).
- The cards, `moveToTrash`, the stop shortcut, and the input watcher: [OBJ-40](OBJ-40-mac-approval-cards.md) and [OBJ-35](OBJ-35-mac-stop-and-take-over.md) (Patrick).
- Approvals on the other device and the 5-minute approval timeout: SPEC-09, not reviewed yet.
- Asking after a crash whether an approved step happened (SPEC-07 r21, p1).
- Deleting screenshots after 7 days (SPEC-07 r20, p1). It conflicts with SPEC-02 r10 (kept forever), an open question in [docs/task-record-schema.md](../docs/task-record-schema.md), and p0 takes no screenshots for the model.

## Outcome

- **Result:** In progress.
  OBJ-38.1 to OBJ-38.8 are built and tested in the harness against the protocol's mock Mac app.
  OBJ-38.9's mock-app test matrix passes in the full Harness suite.
  OBJ-38.10, which runs the scenarios with the real Mac UI, waits for [OBJ-40](OBJ-40-mac-approval-cards.md) and [OBJ-35](OBJ-35-mac-stop-and-take-over.md), which are not started.
- **Delivered:**
  - `harness/src/approvals/`: `ApprovalFlow`, which implements the `ApprovalGate` seam (`request` for an ask, `blocked` for a blocked action, `moveToTrash`), the card text in `copy.ts`, and `findRecipientFields` and `parseRecipients` in `recipients.ts`.
  - `harness/src/control/run-control.ts`: `RunControl`, one run's pause state; `mayAct(lane)` is the check before every action.
  - `harness/src/scheduler/task-control.ts`: `pause(taskId, scope)` with the `everyLane` and `uiLanes` scopes, `resume` after a take-over in the same run, and `cancel` extended to every lane, queued subtasks, and open cards.
  - `harness/src/scheduler/scheduler.ts` and `subtask-runner.ts`: per-subtask signals, UI subtasks held during a take-over and started again in the same attempt, the pause check before each action, and the ask and blocked paths. `move_to_trash` is offered on the helper lane (`withTrash` in `lanes.ts`) and only runs through an approval.
  - `harness/src/action-log/text-log.ts`: the action log file, `Action log/<yyyy-mm-dd>.txt` in the support folder, with a count line per task. The location is in `harness/README.md`, "Action log".
  - `harness/src/scheduler/describe.ts`: log lines for UI actions (`describeGuiAction`), Trash moves (`describeTrashed`), and actions not done (`describeNotDone`). None includes typed text.
  - Task store: migration 6 adds the `approvals` table (kept forever), with `addApproval`, `decideApproval`, `closeApproval`, `getApproval`, `listOpenApprovals`, plus `onActionLogged` and `getStepActionLog`. Startup recovery closes open approvals as cancelled. `paused -> done` is now allowed, because helpers keep running during a take-over.
  - RPC: the harness serves `pause`, and `resumeTask` answers an open blocked-action card with "Keep going" (`harness/src/rpc/tasks.ts`).
  - Protocol: `PauseParams.scope` came from Jepoy's OBJ-45, so this objective adds no contract. The mock Mac app's `moveToTrash` answers for the paths it was given and moves nothing, and tests can script its answers (`answers`).
  - Tests: `harness/test/approvals-send.test.ts`, `approvals-delete.test.ts`, `pause-and-cancel.test.ts`, and `action-log-file.test.ts`, with helpers in `harness/test/support/`. They run the protocol's mock Mac app in process on a real socket, so every scripted answer is checked against the contract.
- **Commits:**
  - `ddd951f docs(objectives): start OBJ-38`
  - `16923cd feat(protocol): add the pause scope and the blocked-action reply`
  - `c8a7d96 feat(harness): add approvals, pause, cancel, and the action log file`
  - and the commit that records this outcome.
- **Expectations:**
  - SPEC-07 "Strict delete": "Delete needs a tap", "Saying yes is not enough to delete", "User declines a delete", and "File list changed after approval" pass at the harness level in `approvals-delete.test.ts`, end to end through the planner, the scheduler, the gate, and the mock Mac app, with files moved into a test Trash folder. The real Mac UI part remains open under OBJ-38.10 and OBJ-40.
  - SPEC-07 "Sending": "Sending an email needs approval", "Approval text comes from the real recipients", and "Recipients changed after approval" pass at the harness level in `approvals-send.test.ts`, through the approval seam with a fake `gui_act` step. The real UI part remains open under OBJ-38.10 and OBJ-40.
  - SPEC-07 "Action log": "Every action is logged" and "Task summary includes activity counts" pass in `action-log-file.test.ts`, reading the real file.
  - SPEC-06 at the harness level: "Pause cancels a pending approval" passes in `pause-and-cancel.test.ts` for a delete card through the `pause` method and resume, and in `approvals-send.test.ts` for the Send card at the seam. "User resumes" and "User cancels a paused task" pass in `pause-and-cancel.test.ts` (fresh observation, same attempt, the queued helper never runs). The cursors fading and the spoken lines are the Mac app's (OBJ-35).
  - No approval text, file name, or recipient comes from model output: the flow reads only the gate's decision, `readFieldValues`, and the real file system; "Approval text comes from the real recipients" names `mallory@example.com` while the goal says Ana.
  - No action runs after a pause is set: `pause-and-cancel.test.ts` counts every action on a UI lane and the helper after `uiLanes` and `everyLane` pauses, and checks that no model request, step, or `moveToTrash` happens after a pause or cancel, including after a late tap.
  - Focused OBJ-38 tests passed: 37 tests across `approvals-delete.test.ts`, `approvals-send.test.ts`, `pause-and-cancel.test.ts`, and `action-log-file.test.ts`. The full Harness verification passed: typecheck, lint, format check, and all 390 tests, run with Node 24 in WSL so the mock Mac RPC server can use Unix sockets.
- **Not verified:**
  - The run with the real Mac app (OBJ-38.10). When OBJ-40 and OBJ-35 are done, Patrick or Brent: start the harness with work, run the delete scenarios from a goal such as "delete the old invoices in Downloads", answer the card by voice and by tap, take the mouse and press Control-Option-Escape while a card is open, then resume and cancel; check the action log file in `~/Library/Application Support/Yumi/Action log/`.
  - Mail's real To and Cc fields. `findRecipientFields` matches text fields, text areas, and combo boxes labelled "To" or "Cc" (with or without a colon), and `parseRecipients` splits on commas, semicolons, and new lines, following `GuiExecutor.fieldText`, which joins Mail's tokens with ", ". Neither was checked against a real Mail draft. Check with OBJ-39's GUI debug window on a draft to Ana with a Cc.
  - Messages in an existing conversation has no To field, so a send there answers `unavailable` (`noRecipients`) and does not run until the conversation's recipient can be read.
- **Decisions and deviations:**
  - G6 follows Jepoy's resolution in OBJ-45, which landed on main first: `pause` takes an optional `scope`, and the blocked-action card has no method of its own. "Keep going" calls `resumeTask`, which answers the task's open card, and "Stop" calls `cancelTask`, so Stop cancels rather than pauses. This branch first added `replyToBlockedAction` and `UserError.stepId`; both were dropped in the rebase on 2026-10-10.
  - Only sends and typed `move_to_trash` deletes can be approved, because `ApprovalKind` has only those. Unclassified risky-app clicks and key presses lack an approval contract; [OBJ-56](OBJ-56-unclassified-action-approval-contract.md) tracks that gap. SPEC-07-classified GUI Delete/Move to Trash labels and Finder Command-Delete also lack a safe route through exact-path `move_to_trash`; [OBJ-58](OBJ-57-route-classified-gui-deletes-through-strict-delete.md) tracks that separate gap.
  - A pause is ignored for `uiLanes` only while the task waits for the user and no UI lane acts, as written. During planning, a `uiLanes` pause stops the planner too, since no lane exists yet, and the resume plans again.
  - While the user has taken over, nothing asks: a helper that needs an approval or the blocked card waits for the resume, because a pause cancels every pending approval.
  - A voice "yes" on a delete shows the same approval again rather than closing it, so the card stays until a tap.
  - A changed file is one whose identity, size, or modification time changed since the card was built.
  - `moveToTrash` gets the expanded file list the user approved, not the folders the model named, so a file added to a folder after the last check is never moved. A deleted folder's empty shell stays behind.
  - Cancel now fails subtasks that never started, with "Cancelled before it started.", where OBJ-06 left them as they were.
  - The action log file is one file a day, `Action log/<yyyy-mm-dd>.txt`, rather than one file for everything, so each file stays readable and the date need not be on every line. The count line is written when a task ends: done, stopped (failed), or cancelled.
  - The action log names a line's device "Mac" when it is this Mac's device id and "phone" otherwise.
  - Approvals expire 5 minutes after they are asked, as the contract requires, but nothing acts on `expiresAt` yet (SPEC-09, out of scope).
- **Follow-up fix (2026-10-10, found in Brent's first live run, made on the OBJ-36 branch):**
  - A take-over pause arrived while the plan was saved; the scheduler still routed and started the subtask, and its failure set the paused task to failed and showed "Stuck on screen".
  - The scheduler now routes and starts nothing once the run is stopped: it checks before routing, after routing (giving back the lock and cursor), and when a routing check fails after the stop (`notStarted` in `harness/src/scheduler/scheduler.ts`).
  - A subtask that ends in any way but done after a pause or cancel leaves its statuses to the pause and cancel flow, and a pause or cancel wins over a failure when the schedule ends.
  - `fail` in `harness/src/scheduler/run-task.ts` never overwrites a paused or cancelled task and shows no error then (`task.failureAfterStop` in the log).
  - gui_act starts no attempt on a stopped run, and a first look that fails after a stop ends as stopped (OBJ-36).
  - Tests: "a pause or cancel always wins over work that was still being routed" in `harness/test/pause-and-cancel.test.ts`.
  - Still open for the Mac app (OBJ-35): it saw a take-over right after the confirmation click, before any cursor acted.
- **For the next objectives:**
  - OBJ-36 (`gui_act`): call `checkAction`, then `if (!control.mayAct(lane)) stop` right before `beginStep`. For an `ask`, call `approvals.request(decision, { subtask, step, lane, control, send }, signal)` with `send` from `findRecipientFields(observation)` resolved to element paths, and press Send only on `approved`. For a `blocked` action, record the step as blocked, then `approvals.blocked(...)` and stop the attempt unless it answers `keepGoing`. Write log lines with `describeGuiAction` and `describeNotDone`. The run's `RunControl` and the subtask's signal reach `runSubtask`. If OBJ-36 landed its own approval seam, reconcile it with `ApprovalGate` here.
  - OBJ-35 (Patrick): the stop shortcut and menu bar "Stop" call `pause` with no scope (or `everyLane`); a take-over calls `pause` with `scope: "uiLanes"`; Resume calls `resumeTask`; Cancel calls `cancelTask`. The harness ignores a `uiLanes` pause while it waits for the user and no UI lane acts.
  - OBJ-40 (Patrick): on `approvalCancelled`, close the card; a late answer is ignored. On a `userError` of kind `blockedAction`, show the card; "Keep going" calls `resumeTask` and "Stop" calls `cancelTask`. A delete answered by voice comes back to the card: the harness shows the same approval again. Implement `moveToTrash` for the exact paths.
  - OBJ-56 (Jepoy): define the protocol representation for an approval of an unclassified risky GUI action, as required by SPEC-07 r6. Then update the harness and Mac card flows against the contract.
  - OBJ-58 (Brent): route classified GUI deletion asks through the strict delete flow. Direct GUI deletion must remain blocked; use the exact-path `move_to_trash` flow when the requested files can be resolved safely.
  - OBJ-17: the harness needs `work` to create the approval flow; without it there are no approvals.
