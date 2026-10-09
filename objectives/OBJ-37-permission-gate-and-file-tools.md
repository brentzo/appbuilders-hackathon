---
id: OBJ-37
title: Permission gate and typed file tools
product: harness
assignee: Brent
touches: []
specs: [SPEC-07]
status: in-progress
priority: p0
depends-on: [OBJ-03]
integrates-with: []
tags: [objective, p0, harness, safety]
---

# OBJ-37 Permission gate and typed file tools

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Yumi can read and write files and click anything, so every action needs a check the model cannot talk its way past.
This objective builds that check: one gate that puts every action into allowed, ask every time, or blocked, from the action itself and never from model text.
It also builds the typed file tools that replace any shell, with their no-replace and strict-delete rules.
The approval flow that runs when the gate says "ask" is [OBJ-38](OBJ-38-approvals-pause-and-action-log.md).

## Read first

- [SPEC-07](../specs/07-safety.md), requirements 1-9, 12, and 16, and the "Permission levels", "Strict delete", and "Screen content is data" scenarios.
- [docs/task-record-schema.md](../docs/task-record-schema.md), "Actions" and "Typed tools".
- [OBJ-01](OBJ-01-task-record-schemas.md): `RecordedAction`, `ResolvedElement`, `PermissionLevel`, the typed tool schemas, and `FileSummary`.
- The Outcome of [OBJ-03](OBJ-03-harness-skeleton.md) (tool registry) and [OBJ-05](OBJ-05-planner-and-scheduler.md) (test-only file tools), when done.
- The open questions for OBJ-35 to OBJ-40 in the [objectives README](README.md).

## Tasks

- [ ] **OBJ-37.1** One gate function, `checkAction(recordedAction, context) -> PermissionLevel`. Every action from every lane goes through it before it runs, including typed tools and phone tools. It reads only the resolved action and the real file system, never model text, and stores the level on the `RecordedAction`.
- [ ] **OBJ-37.2** Encode the SPEC-07 r1 permission table as data in one file, with the secret locations from r2 (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/Library/Keychains`, and browser profile folders). Write one test per row.
- [ ] **OBJ-37.3** Risk from the action itself (SPEC-07 r6). Element labels: "Send", "Delete", and "Move to Trash" ask; "Empty Trash", "Buy", "Pay", "Install", "Quit", and "Force Quit" are blocked. Key combos per app: Return in Messages, Command-Return and Command-Shift-D in Mail, and Command-Delete in Finder ask; Command-Shift-Delete in Finder is blocked; Command-Q and Command-Option-Escape are blocked in every app. Anything the gate cannot classify asks, but only for key presses and for clicks in the risky apps (Mail, Messages, WhatsApp, Finder, System Settings); other clicks are allowed. How unlisted clicks in risky apps are handled during the Mail demo is still open in SPEC-07; settle it before building this task.
- [ ] **OBJ-37.4** Typed file tools: `read_file`, `list_dir`, `write_new_file`, `copy`, and `move`, each with only its schema arguments. Resolve symlinks and `..` before the check. Anything outside the home folder, in `~/Library`, a dotfile, or a secret location is blocked. Replace the test-only file tools from [OBJ-05](OBJ-05-planner-and-scheduler.md) with these.
- [ ] **OBJ-37.5** No-replace: `write_new_file`, `copy`, and `move` never replace a file, and a taken name gets a numbered name ("Report.pdf" becomes "Report 2.pdf") (SPEC-07 r4). There is no edit tool in p0.
- [ ] **OBJ-37.6** `move_to_trash` checks: exact paths only, with wildcard characters rejected before anything else runs (SPEC-07 r8); the home folder, Desktop, Documents, Downloads, the Library folders themselves, app bundles, dotfiles, and anything outside the home folder blocked (r9); folders expanded and every file counted; and a `FileSummary` (folder, count, first 5 names, all paths) built from the real file list (r10). The level is always "ask".
- [ ] **OBJ-37.7** Screen content is data (SPEC-07 r16): make it structural. Approvals come only from the approval card or the user's own reply, subtasks only from the planner, whose input never includes screen text, and levels only from the rule table.
- [ ] **OBJ-37.8** Tests on the real file system in a temporary home folder, not mocks: every table row, every label and key from r6, each strict-delete rule, symlinks into secret locations, and a shell command from the model.

## Expectations

- [ ] SPEC-07 "Permission levels" scenarios pass: "Reading and writing need no approval" (the gate part; the log is [OBJ-38](OBJ-38-approvals-pause-and-action-log.md)), "Model asks for a shell command", "Blocked action is refused even with a yes", "Copy never replaces a file", "Secret folders cannot be read".
- [ ] SPEC-07 "Strict delete" scenarios pass: "Protected folder cannot be deleted", "Wildcards are rejected", "Emptying the Trash is blocked", "Quitting an app is blocked".
- [ ] SPEC-07 scenario "Web page tries to give orders" passes.
- [ ] Nothing in the harness can run a shell command or AppleScript.
- [ ] The level is decided only by the gate, never by the model.

## Expected outcomes

- The permission gate and its rule table in the harness.
- The typed file tools and the `move_to_trash` checks.

## Out of scope

- Asking, approving, re-checking, and moving to the Trash: [OBJ-38](OBJ-38-approvals-pause-and-action-log.md). The cards: [OBJ-40](OBJ-40-mac-approval-cards.md) (Patrick).
- Phone tool risk levels: SPEC-09 and SPEC-10, not reviewed yet.
- The injection warning (SPEC-07 r17, p1).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
