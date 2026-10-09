---
id: OBJ-37
title: Permission gate and typed file tools
product: harness
assignee: Brent
touches: []
specs: [SPEC-07]
status: done
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

- [x] **OBJ-37.1** One gate function, `checkAction(recordedAction, context) -> PermissionLevel`. Every action from every lane goes through it before it runs, including typed tools and phone tools. It reads only the resolved action and the real file system, never model text, and stores the level on the `RecordedAction`.
- [x] **OBJ-37.2** Encode the SPEC-07 r1 permission table as data in one file, with the secret locations from r2 (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/Library/Keychains`, and browser profile folders). Write one test per row.
- [x] **OBJ-37.3** Risk from the action itself (SPEC-07 r6). Element labels: "Send", "Delete", and "Move to Trash" ask; "Empty Trash", "Buy", "Pay", "Install", "Quit", and "Force Quit" are blocked. Key combos per app: Return in Messages, Command-Return and Command-Shift-D in Mail, and Command-Delete in Finder ask; Command-Shift-Delete in Finder is blocked; Command-Q and Command-Option-Escape are blocked in every app. Anything the gate cannot classify asks, but only for key presses and for clicks in the risky apps (Mail, Messages, WhatsApp, Finder, System Settings); other clicks are allowed. How unlisted clicks in risky apps are handled during the Mail demo is still open in SPEC-07; settle it before building this task.
- [x] **OBJ-37.4** Typed file tools: `read_file`, `list_dir`, `write_new_file`, `copy`, and `move`, each with only its schema arguments. Resolve symlinks and `..` before the check. Anything outside the home folder, in `~/Library`, a dotfile, or a secret location is blocked. The orchestrator replaces the test-only file tools from [OBJ-05](OBJ-05-planner-and-scheduler.md) with these after both branches merge.
- [x] **OBJ-37.5** No-replace: `write_new_file`, `copy`, and `move` never replace a file, and a taken name gets a numbered name ("Report.pdf" becomes "Report 2.pdf") (SPEC-07 r4). There is no edit tool in p0.
- [x] **OBJ-37.6** `move_to_trash` checks: exact paths only, with wildcard characters rejected before anything else runs (SPEC-07 r8); the home folder, Desktop, Documents, Downloads, the Library folders themselves, app bundles, dotfiles, and anything outside the home folder blocked (r9); folders expanded and every file counted; and a `FileSummary` (folder, count, first 5 names, all paths) built from the real file list (r10). The level is always "ask".
- [x] **OBJ-37.7** Screen content is data (SPEC-07 r16): make it structural. Approvals come only from the approval card or the user's own reply, subtasks only from the planner, whose input never includes screen text, and levels only from the rule table.
- [x] **OBJ-37.8** Tests on the real file system in a temporary home folder, not mocks: every table row, every label and key from r6, each strict-delete rule, symlinks into secret locations, and a shell command from the model.

## Expectations

- [x] SPEC-07 "Permission levels" scenarios pass: "Reading and writing need no approval" (the gate part; the log is [OBJ-38](OBJ-38-approvals-pause-and-action-log.md)), "Model asks for a shell command", "Blocked action is refused even with a yes", "Copy never replaces a file", "Secret folders cannot be read".
- [x] SPEC-07 "Strict delete" scenarios pass: "Protected folder cannot be deleted", "Wildcards are rejected", "Emptying the Trash is blocked", "Quitting an app is blocked".
- [x] SPEC-07 scenario "Web page tries to give orders" passes.
- [x] Nothing in the harness can run a shell command or AppleScript.
- [x] The level is decided only by the gate, never by the model.

## Expected outcomes

- The permission gate and its rule table in the harness.
- The typed file tools and the `move_to_trash` checks.

## Out of scope

- Asking, approving, re-checking, and moving to the Trash: [OBJ-38](OBJ-38-approvals-pause-and-action-log.md). The cards: [OBJ-40](OBJ-40-mac-approval-cards.md) (Patrick).
- Phone tool risk levels: SPEC-09 and SPEC-10, not reviewed yet.
- The injection warning (SPEC-07 r17, p1).

## Outcome

- **Result:** Done.
- **Delivered:**
  - `harness/src/safety/gate.ts`: `checkAction(action, { home, app })`, the one gate. It returns a `GateDecision` with the `level`, the `rule` that decided it, the `RecordedAction` with the level stored on it, the `FileSummary` for a delete, and the resolved paths for an allowed file tool.
  - `harness/src/safety/rules.ts`: the SPEC-07 table as data: one rule id per level reason, the secret locations (r2, with the Safari, Chrome, Chromium, Firefox, Brave, Edge, Arc, Opera, and Vivaldi profile folders), protected folders, packages, script and installer extensions, shell and installer apps, the r6 labels and key combos, the risky apps with their safe labels, and the phone tool stand-in.
  - `harness/src/safety/paths.ts`: resolution through `..` and every symlink, one component at a time so a dangling link is followed too, and the home, `~/Library`, dotfile, and secret checks, compared without regard to case or Unicode form.
  - `harness/src/safety/trash.ts`: the `move_to_trash` checks (r8, r9) and the `FileSummary` from the real file list (r10).
  - `harness/src/tools/file-tools.ts`: `read_file`, `list_dir`, `write_new_file`, `copy`, and `move`, registered with `registerFileTools(registry, { home, logger })`. Their argument schemas come from the protocol's call types. Each handler runs the gate itself, so a direct call is refused too.
  - Tests: `harness/test/permission-gate.test.ts`, `file-tools.test.ts`, `strict-delete.test.ts`, and `safety-helpers.ts` (a temporary home laid out like a Mac's).
  - `harness/README.md`: layout rows and a Safety section.
- **Commits:**
  - `30fc345 docs(objectives): start OBJ-42` (written before the renumbering to OBJ-37)
  - `6bbf26c feat(harness): add the permission gate, typed file tools, and strict delete checks`
  - `docs(objectives): finish OBJ-42`, and `docs(objectives): renumber OBJ-42 to OBJ-37` (this Outcome and the new ids)
- **Expectations:**
  - "Permission levels": `test/permission-gate.test.ts`, "Feature: Permission levels", has "Scenario: Reading and writing need no approval (the gate part)", "Scenario: Blocked action is refused even with a yes", and "Scenario: Secret folders cannot be read". "Scenario: Model asks for a shell command" runs a worker step against the mock model server: both shell replies are refused as `invalidOutput`, the gate blocks the action and the tool call, and the file is still there. "Scenario: Copy never replaces a file" is in `test/file-tools.test.ts` and runs the real copy: the new file is `Report 2.pdf` and the original is unchanged.
  - "Strict delete": `test/strict-delete.test.ts` has "Scenario: Protected folder cannot be deleted" and "Scenario: Wildcards are rejected", each checking that nothing in the temporary home changed. `test/permission-gate.test.ts` has "Scenario: Emptying the Trash is blocked" and "Scenario: Quitting an app is blocked".
  - "Web page tries to give orders": `test/permission-gate.test.ts`, "Scenario: Web page tries to give orders". A Safari page shows the text as a link; a model that obeys it asks to trash `~/Documents`, which the step does not offer, so the reply is refused and the retry continues the user's task. Where `move_to_trash` is offered, Documents is blocked and files only ask; nothing is deleted. No model output can add a subtask, approve, or carry a level (schema checks in the same file).
  - No shell or AppleScript: "nothing in the harness can run a shell command or AppleScript" scans `src/` and `scripts/` for `child_process`, `osascript`, exec and spawn calls, `eval`, and `new Function`, and finds none. Shell apps (Terminal, iTerm, Script Editor, Automator) are blocked to open, to open files with, and to act in.
  - Level only from the gate: every decision's level is `RULE[rule]` from the table; the gate takes only the action, its resolved element, the app the Mac app reported, and the home folder, and drops anything else a caller passes ("ignores anything a caller passes besides the action and its element").
  - OBJ-37.3 with Brent's decision: one test per r6 label and key combo, one per risky app, and the tests `"New Message" in Mail is allowed`, `"Attach" in Mail is allowed`, and `another unlisted Mail click still asks`.
  - `python3 scripts/verify.py` passes: docs, protocol, harness (typecheck, lint, format, and 221 tests), Mac, and Android. The harness suite passed 20 runs in a row.
- **Not verified:**
  - The gate is not yet called by the step loop, because the loop that runs actions does not exist yet ([OBJ-36](OBJ-36-gui-act-sub-agent.md) and [OBJ-38](OBJ-38-approvals-pause-and-action-log.md)). The file tools call it themselves.
  - Label and key matching was tested with labels written by hand, not read from real Mail, Finder, or Messages windows. When OBJ-39 reads real trees, check that Mail's Send button and "New Message" and "Attach" really carry those labels.
  - Swapping OBJ-05's test-only file tools for these was done on the OBJ-05 branch ("feat(harness): run every task action through the permission gate with the typed file tools"): the helper lane uses `registerFileTools`, and every task action goes through `checkAction` before it runs.
- **Decisions and deviations:**
  - Unlisted clicks in risky apps: Brent chose option (a) on 2026-10-09 (SPEC-07 Decisions). Mail's safe labels are exactly "New Message" and "Attach"; a safe label matches only as the whole label and only in its own app.
  - OBJ-37.4's last sentence now says the orchestrator does the OBJ-05 swap, as the orchestrator briefed, so the objective can be done without it.
  - `checkAction` returns a `GateDecision` rather than a bare `PermissionLevel`, so OBJ-38 also gets the rule, the record, and the delete summary from one call. Only the gate builds one.
  - Labels match as the word or the word followed by a space, ignoring case and a trailing ellipsis, so "Quit Keynote" and "Empty Trash…" match and "Sending Options" does not. "Delete Slide" in Keynote therefore asks. When several rules match, blocked wins.
  - Rules added because they are other ways to do what the table already blocks: Command-Option-Shift-Escape (force quit) in every app; Finder's "Delete Immediately", Command-Option-Delete, and Command-Option-Shift-Delete (r7: nothing is deleted permanently).
  - Shell and installer apps (Terminal, iTerm, Script Editor, Automator, Installer) are blocked to open, to open a file with, and to act in, as "shell commands" and "installing software" by another route. Opening any script, installer, app bundle, or executable file is blocked, because Yumi cannot tell whether a file was downloaded.
  - A click whose app the Mac app did not report asks, because the gate cannot tell whether it is a risky app. A vision click (`clickAt`, p1) has no label, so it asks in risky apps and is allowed elsewhere.
  - `move` never moves the home folder, Desktop, Documents, Downloads, or Library itself. Copying or moving a folder that contains dotfiles (such as `.DS_Store`) is allowed; the dotfile rule applies to the path named.
  - Moves never copy or delete data: a file gets its new name as a hard link and then loses the old one, and a folder is renamed onto an empty folder that holds the new name. Moving between disks is refused. The OBJ-04 source scan now lists `tools/file-tools.ts` next to the RPC server for this.
  - Delete summaries: a document package (`.key`, `.pages`, `.numbers`, and others in `PACKAGE_EXTENSIONS`) counts as one file, an empty folder is listed as one entry, a link is listed as itself, and a folder with an app bundle inside is blocked. `folder` is the shared parent of the requested paths. A path with nothing at it is blocked as `missingPath`.
  - `read_file` returns at most 64 KB of text and says when a file is not text. `list_dir` leaves out dotfiles. A taken name is numbered on the last extension only.
  - Phone tools (`set_alarm`, `set_timer`, `open_app`) are allowed, as a stand-in in `PHONE_TOOL_LEVELS` until SPEC-09 and SPEC-10 give their levels.
  - The flaky bridge test in `test/nonfunctional.test.ts` ("does not tell the user the bridge is down when no phone is paired") failed about one run in six here. Main fixed it in `712e727` before this branch was rebased, so this branch's own fix was dropped.
- **Questions for Brent:**
  - SPEC-07 r1 allows reading files in the home folder, but OBJ-37.4 blocks every file tool in `~/Library` and on dotfiles, including reads. The gate follows the objective, which is stricter. Should SPEC-07 r1 say so?
  - SPEC-07 r6 makes every unlisted key press ask, in every app, so Tab, Escape, and Command-S in Keynote ask. Is that intended, or should there be a short list of safe keys like the safe labels?
  - The table blocks "changing system settings", but r6 puts System Settings on the risky-app list, where unlisted clicks ask. The gate follows r6. Should clicks there be blocked instead?
  - Should the shell and installer apps above be written into SPEC-07, since they are an interpretation of the table?
- **Note, 2026-10-09, after this objective was done:** Brent answered all four questions (SPEC-07 Decisions), and the gate follows.
  - Reading dotfiles and `~/Library` is blocked in the SPEC-07 r1 table, as the gate already did.
  - Unlisted key presses ask only in the risky apps, like clicks; elsewhere they are allowed, so Tab, Escape, and Command-S in Keynote no longer ask. Command-Q and Command-Option-Escape stay blocked everywhere.
  - System Settings left the risky-app list. Every action in it is blocked with the new rule `changeSystemSettings`. For OBJ-36 and OBJ-38, `ask` decisions are still `send`, `delete`, or `unclassified`.
  - The shell and installer apps are now in SPEC-07 r3.
- **For the next objectives:**
  - OBJ-36 and OBJ-38: call `checkAction({ action, element }, { home: os.homedir(), app: observation.app })` on every action before it runs, and run it only when `level` is `allowed`. Store `decision.recorded` as the step's action. For `ask`, `decision.rule` is `send`, `delete`, or `unclassified`, and a delete carries `decision.files`. For `blocked`, never ask: show the r5 card. `missingPath` and `notATypedAction` are blocked too, but the r5 "keep your Mac safe" copy may not fit them; OBJ-38 should decide their copy.
  - OBJ-38: run `checkTrash(paths, home)` again right before trashing and compare `allPaths` (r12). It does not hash file contents, so a changed file is not caught yet.
  - Register the file tools with `registerFileTools(registry, { home, logger })`. They return plain text for the model and log only the tool, the rule, or the error code.
  - A new label, key, safe label, or secret location is one line in `src/safety/rules.ts`, plus a test, and needs a SPEC-07 change first.
  - Tests: `test/safety-helpers.ts` has `tempHome()`, `tool`, `click`, `key`, `gui`, and `element`. The temporary home sits under `/var`, a link to `/private/var` on macOS, so compare tool paths with `realpathSync(home)`.
