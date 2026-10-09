---
id: OBJ-38
title: Approvals, pause, and action log in the harness
product: harness
assignee: Brent
touches: []
specs: [SPEC-07, SPEC-06]
status: todo
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

- [ ] **OBJ-38.1** Approval flow: an "ask" action sets the subtask to `needsApproval` and the task to `waitingForUser`, writes an `Approval`, and calls `showApprovalCard`. An approval covers exactly one action, once. A delete counts as approved only with `method: tap` (SPEC-07 r11); a send with a tap or the reply "send it" (r15).
- [ ] **OBJ-38.2** Sending: build the approval text from the real To and Cc fields read with `readFieldValues`, never from model text, in the form "I'm about to send this email to Ana. Should I send it?" (SPEC-07 r13), and the SPEC-07 "Draft copy" forms for Messages, several recipients, and Cc. Right before pressing Send, read them again; if they changed, drop the approval and ask again (r14).
- [ ] **OBJ-38.3** Deleting: build the text from the [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) `FileSummary`, in the form "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?", and the SPEC-07 "Draft copy" forms for one file and for files in several folders. Right before acting, list the files again; if any was added, removed, or changed, ask again with the new list (r12). Then call `moveToTrash` with the exact paths.
- [ ] **OBJ-38.4** Blocked actions never run, even after a yes: record the step as `blocked`, emit a `userError` of kind `blockedAction`, and on the user's choice either continue ("Keep going") or pause the task ("Stop") (SPEC-07 r5).
- [ ] **OBJ-38.5** Pause: one `pause(taskId, scope)` path, with scope every lane (stop shortcut, menu bar "Stop") or UI lanes only (the user took over; helpers keep running). A UI-lanes pause while the task waits for the user and no UI lane is acting is ignored, as a second guard behind the Mac app (SPEC-06 r2). It sets the pause state the [OBJ-36](OBJ-36-gui-act-sub-agent.md) step loop checks before every action, checkpoints, sets the task to `paused`, cancels every pending approval, and emits `approvalCancelled` (SPEC-06 r1, r2, r4, r5). After resume, a risky action goes through the gate and asks again.
- [ ] **OBJ-38.6** Cancel: extend the [OBJ-06](OBJ-06-resume-and-limits.md) `cancelTask` so it stops every lane, helpers included, drops every queued subtask and every command not yet run, and sets the task to `cancelled`. Nothing runs after cancel (SPEC-06 r8).
- [ ] **OBJ-38.7** Action log: write an `ActionLogEntry` for every action that ran, was blocked, or was declined, with time (am/pm), device, lane, a plain-language description, and every path for deletes (SPEC-07 r18). Write it to a text file as lines like "3:42 pm, Mac, main cursor: Clicked Export in Keynote", plus a count line per task such as "Read 3 files and clicked 12 times". Record the file's location in `harness/README.md`.
- [ ] **OBJ-38.8** (p1) Add a test that text typed into a password field never reaches the action log (SPEC-07 r20).
- [ ] **OBJ-38.9** Tests with the mock Mac app: the send and delete re-checks, a voice "yes" on a delete, a blocked action after a yes, pausing with an open approval, cancel with a queued helper, and the log lines. Then run them with the real Mac app when OBJ-40 and OBJ-35 are done.

## Expectations

- [ ] SPEC-07 "Strict delete" scenarios pass: "Delete needs a tap", "Saying yes is not enough to delete", "User declines a delete", "File list changed after approval".
- [ ] SPEC-07 "Sending" scenarios pass: "Sending an email needs approval", "Approval text comes from the real recipients", "Recipients changed after approval".
- [ ] SPEC-07 "Action log" scenarios pass: "Every action is logged", "Task summary includes activity counts".
- [ ] SPEC-06 scenarios pass at the harness level: "Pause cancels a pending approval", "User resumes", "User cancels a paused task".
- [ ] No approval text, file name, or recipient comes from model output.
- [ ] No action runs after a pause is set.

## Expected outcomes

- The approval flow with send and delete re-checks, the blocked-action path, the pause and cancel paths, and the action log in the harness.

## Out of scope

- Deciding levels and the file tools: [OBJ-37](OBJ-37-permission-gate-and-file-tools.md).
- The cards, `moveToTrash`, the stop shortcut, and the input watcher: [OBJ-40](OBJ-40-mac-approval-cards.md) and [OBJ-35](OBJ-35-mac-stop-and-take-over.md) (Patrick).
- Approvals on the other device and the 5-minute approval timeout: SPEC-09, not reviewed yet.
- Asking after a crash whether an approved step happened (SPEC-07 r21, p1).
- Deleting screenshots after 7 days (SPEC-07 r20, p1). It conflicts with SPEC-02 r10 (kept forever), an open question in [docs/task-record-schema.md](../docs/task-record-schema.md), and p0 takes no screenshots for the model.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
