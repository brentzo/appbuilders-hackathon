---
id: OBJ-74
title: Save a list into a new note
product: harness
assignee: Brent
touches: [mac, protocol]
specs: [SPEC-02, SPEC-01]
status: done
priority: p0
depends-on: []
integrates-with: [OBJ-17, OBJ-36, OBJ-50]
tags: [objective, p0, harness, mac, ux]
---

# OBJ-74 Save a list into a new note

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-02](../specs/02-task-lifecycle.md), [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

When Brent asked Yumi to list his Downloads folder, the answer only flashed by in a card and a spoken sentence.
SPEC-02 requirement 13 lets Yumi put a list into a new note: offered in the repeat-back, and automatically in Auto mode.
It also shows the cats working in Notes during the demo.

## Read first

- SPEC-02 requirements 9 and 13, and SPEC-01 requirements 4, 5, and 14.
- `harness/src/confirm/` (the repeat-back), `harness/src/planner/` (plans and the information summary), and `harness/src/gui/gui-act.ts`.
- The Outcomes of OBJ-17, OBJ-36, and OBJ-50.
- The Mac summary card (`TaskSummary` in `mac/Yumi/`) and `Speak` and the summary events in [protocol/schemas/rpc.json](../protocol/schemas/rpc.json).

## Tasks

- [x] **OBJ-74.1** In the repeat-back, when the goal asks for a list, add the offer "Want me to put the list in a new note too?" and read "yes, in a note" (or similar) as yes with the note, and a plain yes as without.
- [x] **OBJ-74.2** With the note, plan a second subtask after the listing that opens Notes, makes a new note titled after the goal, and types the full list from the steps' real tool output, not from the model's memory.
- [x] **OBJ-74.3** Send the full list with the summary (a non-breaking protocol addition) so the Mac card shows all of it, scrollable, with the spoken sentence unchanged.
- [x] **OBJ-74.4** Mac: a "Save to Notes" button on the summary card when the task produced a list, and the spoken "save it" while the card is up; either starts a short follow-up task that writes the note.
- [x] **OBJ-74.5** In Auto mode, skip the offer and put the list in a new note automatically (SPEC-02 r13, changed 2026-10-10 by Brent). The card's "Save to Notes" stays for a list that is not in a note.
- [x] **OBJ-74.6** Tests across the harness and the Mac, then a live check: "list the files in my Downloads folder", say "yes, in a note", and see the note in Notes.

## Expectations

- [x] Saying yes to the note leaves a new note in Notes with the full list.
- [x] In Auto mode, asking for a list leaves a new note in Notes with the full list, with no question and no button.
- [x] "Save to Notes" on a card whose list is not in a note leaves a new note with the full list.
- [x] The card shows the full list.

## Expected outcomes

- The offer in the repeat-back, the note subtask, the full list in the summary event, and the Mac card button, with tests.

## Out of scope

- Saving to other apps or files.

## Outcome

- **Result:** Done. Brent confirmed both live Notes runs on 2026-10-10: with Auto mode off, he answered "Yes" and got a new note with the full list; with Auto mode on, the note was written with no question. He accepted the last expectation ("Save to Notes") on the harness and Mac tests, with no live run.
- **Delivered:**
  - Protocol (still version 4): `Speak.list` (`FoundList`: title, items, optional `more`, `inNote`) and the app-to-harness method `saveListToNote` (`TaskRef` to `SubmitGoalResult`) in `protocol/schemas/rpc.json`, with examples and a test.
  - Harness: `harness/src/planner/list-note.ts` (list goals, the offer, the title, the list, the note subtask and its fixed script `scriptedNoteAction`, the `NOTE_TEXT` placeholder); the offer and `confirmWithNote` in `harness/src/confirm/`; the `list_to_note` task column (migration 10), set by a yes to the offer or by Auto mode; the note phase and the list on the summary in `harness/src/scheduler/run-task.ts`; `TaskControl.saveListToNote` and its RPC handler; in `harness/src/gui/gui-act.ts`, the scripted note steps, the placeholder expansion, and a wait for a window that is briefly unreadable after any action.
  - Mac: the full list, "Save to Notes", and "save it" on the summary card (`mac/Yumi/Summary/`, wired in `mac/Yumi/Harness/HarnessLink.swift`); hands-free answers that wait up to 8 s for the first word and ignore short blips (`mac/Yumi/Voice/SpeechEndpoint.swift`); the confirmation and question cards stay answerable by "Hey Yumi" or the shortcut after a silent listen (`GoalConfirmation.swift`, `TaskQuestions.swift`).
  - Spec: SPEC-02 r13 and its Decisions updated with Brent's Auto mode decision.
- **Commits:** on main as `a66faae docs(objectives): start OBJ-74`, `c5cfb15 feat(protocol): send a task's found list with its summary and add saveListToNote`, `9f088a6 feat(harness): offer to put a list in a new note and send the full list with the summary`, `05109b2 feat(mac): show a task's full list on the summary card with save to notes`, `dc84854 docs(objectives): record OBJ-74 progress before its live check`, `ffdd432 fix(mac): keep listening for an answer and keep its card answerable when nothing is heard`, `70bf19f fix(harness): wait for an opened app's window and never say it tried a few times when it could not read one`, `5391353 docs(spec-02): in Auto mode put a found list into a new note automatically`, `9857869 feat(harness): put a list in a new note automatically in Auto mode and shorten the offer`, `54f10f9 fix(harness): write the list note with a fixed script and wait for a window that is briefly unreadable`, `c3887d7 fix(harness): read a yes to "Want it in a note too?" as yes to the note`, and the orchestrator's `7337549 fix(harness): use the one-argument localVoice in the OBJ-74 list-note test`; then this objective's outcome commit.
- **Expectations:**
  - Saying yes to the note leaves a new note in Notes with the full list: Brent's live run with Auto mode off, 2026-10-10; also `harness/test/list-note.test.ts` ("offers the note, and "yes" leaves the full list in a new note after the listing") and `harness/test/gui-act.test.ts` ("writes the note with a fixed script and no model").
  - In Auto mode, asking for a list leaves a new note with the full list, with no question and no button: Brent's live run with Auto mode on, 2026-10-10; also `list-note.test.ts` ("In Auto mode there is no offer and no button").
  - The card shows the full list: seen in Brent's live runs (screenshot of the 102-item Downloads list); also `mac/YumiTests/TaskSummaryTests.swift`, with snapshots in light and dark.
  - "Save to Notes" on a card whose list is not in a note leaves a new note: accepted by Brent on 2026-10-10 on the harness and Mac tests, with no live run (`harness/test/list-note.test.ts` ""Save to Notes" on a list that is not in a note starts a short task that writes the note", and `mac/YumiTests/TaskSummaryTests.swift` for the button and "save it").
  - `python3 scripts/verify.py` passes on the branch (protocol, harness, bridge, Mac, Android, docs). The Swift and Kotlin compile checks did not run because Docker was not running.
- **Not verified:** "Save to Notes" and "save it" were not run live; Brent accepted them on the tests. To check live: with Auto mode off, say "List the files in my Downloads folder", answer "no thanks", then press "Save to Notes" (or say "Hey Yumi, save it"); a new note with the full list should appear.
- **Decisions and deviations:**
  - Brent changed SPEC-02 r13 on 2026-10-10: in Auto mode the list goes into a new note automatically ("The goal why we're building this is to literally automate things."). "Save to Notes" shows only on a card whose list is not in a note, in any mode.
  - The offer is "Want it in a note too?", shorter than the objective's example, so the turn is quicker.
  - A yes to the offer means yes to the note, since that is the question asked (Brent's run, task e11a8346: "Yes." got no note). "No", "no thanks", "just list them", or the Go ahead button lists without it. This replaces OBJ-74.1's "a plain yes as without".
  - The note subtask runs a fixed script in `gui_act` (cmd+n, type the list, finish) with no model: in task e59c3d8f the model clicked "New Note", Notes rebuilt its window, and the note failed. The list is typed from `list_dir`'s real output through the `NOTE_TEXT` placeholder, never written out by the model.
  - Every look after an action waits up to the settle timeout for a window that cannot be read for a moment (task 44b6e3c6: Notes' window was unreadable 187 ms after `open_app`). A window that still cannot be read says "Couldn't finish a step" with the subtask's title, not the "Stuck on screen" copy, since it tried once. An OBJ-08 test was updated to match.
  - Hands-free answers: a sound counts as speech only after 0.25 s, and the user gets 8 s to start (task 4ecaff1c: a blip ended the listen within 1.5 s). After a silent listen, the confirmation card and the worker's question card stay up, and "Hey Yumi" or the shortcut answers them; before, "Hey Yumi, <answer>" on the question card started a new goal.
  - A card with a list stays until it is closed, saved, or a new goal starts.
  - The summary with a note is the answer's first sentence plus "I put the full list in a new note called {title}.", so it stays two sentences. The title keeps folder names capitalized ("Downloads"); in Auto mode it comes from what the user said ("Files in my Downloads folder").
- **For the next objectives:** `foundListOf(store, task)` in `run-task.ts` rebuilds a finished task's list from the store; note subtasks are recognized with `isNoteSubtask`. Only `list_dir` output becomes a list, and a task that also changed something sends no list. `scriptedNoteAction` in `list-note.ts` is the pattern for other fixed, model-free UI steps. `ApprovalKind.action` still has no SPEC-07 declined copy (main's Mac fix covers the card).
