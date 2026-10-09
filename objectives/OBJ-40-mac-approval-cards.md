---
id: OBJ-40
title: Approval and blocked-action cards on the Mac
product: mac
assignee: Patrick
touches: []
specs: [SPEC-07, SPEC-11]
status: todo
priority: p0
depends-on: [OBJ-17]
integrates-with: [OBJ-38]
tags: [objective, p0, mac, safety, ux]
---

# OBJ-40 Approval and blocked-action cards on the Mac

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-07](../specs/07-safety.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Sending and deleting ask every time, and blocked actions never run.
The harness decides which is which and builds the text ([OBJ-37](OBJ-37-permission-gate-and-file-tools.md), [OBJ-38](OBJ-38-approvals-pause-and-action-log.md)); this objective is what the user sees and taps: the send card, the delete card, and the card for a blocked action.
It also moves files to the Trash, the only way Yumi deletes anything.
The Mail demo task stops at the send card, so it is on the demo path.
Until OBJ-38 exists, drive the cards from the mock harness in [OBJ-01](OBJ-01-task-record-schemas.md).

## Read first

- [SPEC-07](../specs/07-safety.md), requirements 5, 7, 10, 11, 13, and 15, and the "Strict delete" and "Sending" scenarios.
- [SPEC-06](../specs/06-user-control.md) requirement 5: pausing cancels every pending approval.
- [SPEC-11](../specs/11-user-facing-errors.md) requirements 9 and 11.
- [docs/task-record-schema.md](../docs/task-record-schema.md), "Approvals".
- [OBJ-01](OBJ-01-task-record-schemas.md): `Approval`, `FileSummary`, `ApprovalDecision`, `ApprovalMethod`, `ErrorKind.blockedAction`, the RPC methods `showApprovalCard` and `moveToTrash`, and the `approvalCancelled` and `userError` events.
- The Outcome of [OBJ-17](OBJ-17-goal-confirmation.md) (`speak` and listening for a reply) and [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) (cursor states).
- The open questions for OBJ-35 to OBJ-40 in the [objectives README](README.md).

## Tasks

- [ ] **OBJ-40.1** `showApprovalCard` for a send: show the `Approval` text built by the harness, for example "I'm about to send this email to Ana. Should I send it?", with "Send" and "Don't send" buttons. Never build or change the text on the Mac. Return an `ApprovalDecision` with `method: tap` for a button.
- [ ] **OBJ-40.2** `showApprovalCard` for a delete: show the text, for example "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?", the folder, the first 5 names from the `FileSummary`, "and 7 more" for the rest (N is the count minus 5), and "Delete" and "Don't delete" buttons.
- [ ] **OBJ-40.3** Voice on the cards: speak the first sentence and show the full text (SPEC-11 r11), then listen for a reply. Saying "send it" approves a send with `method: voice`. A voice "yes" on a delete does nothing, and the card stays open until the user taps a button (SPEC-07 r11). SPEC-11 r9 says every button also works by voice, which clashes with this; follow SPEC-07 until the team settles it.
- [ ] **OBJ-40.4** After "Don't delete", say "Okay, I left the files alone. Want me to do anything else with them?" Build the other cases from the SPEC-07 "Draft copy" table (one file, files in several folders, a declined send, Messages, several recipients, Cc), and keep all of this copy in the app's one copy file so the draft can change in one place.
- [ ] **OBJ-40.5** Blocked-action card: on a `userError` with kind `blockedAction`, show "I can't do that. It's blocked to keep your Mac safe, so I skipped it. Want me to keep going with the rest?" with "Keep going" and "Stop" buttons, and send the choice back to the harness.
- [ ] **OBJ-40.6** While a card is open, the cursor shows the "waiting for the user" state. On `approvalCancelled`, close the card at once and ignore any late tap.
- [ ] **OBJ-40.7** `moveToTrash`: move each exact path with `FileManager.trashItem` and return a result per path. Refuse wildcard characters and relative paths as a second guard. Nothing is ever deleted permanently.
- [ ] **OBJ-40.8** Check the cards in light and dark mode, on every display and scale, with long file names and long recipient lists. Test every card against the mock harness, then against the real harness when [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) is done.

## Expectations

- [ ] SPEC-07 scenarios pass with the real harness: "Delete needs a tap", "Saying yes is not enough to delete", "User declines a delete", "Sending an email needs approval", "Blocked action is refused even with a yes".
- [ ] No card text comes from anywhere but the harness's `Approval` or the copy above.
- [ ] A delete is never approved by voice.
- [ ] A card closes when its approval is cancelled, and a tap after that does nothing.
- [ ] `moveToTrash` only ever moves files to the Trash.

## Expected outcomes

- The send, delete, and blocked-action cards in the Mac app, with voice replies.
- The `moveToTrash` method.

## Out of scope

- Deciding the permission level and building the approval text: [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) and [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) (Brent).
- Approvals asked on the phone and the "Waiting for your OK on your phone" banner: SPEC-09, not reviewed yet.
- Opening the action log from the menu bar (SPEC-07 r19, p1).
- The injection warning (SPEC-07 r17, p1).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
