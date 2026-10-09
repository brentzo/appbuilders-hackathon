---
id: OBJ-74
title: Save a list into a new note
product: harness
assignee: Brent
touches: [mac, protocol]
specs: [SPEC-02, SPEC-01]
status: in-progress
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
SPEC-02 requirement 13 lets Yumi put a list into a new note: offered in the repeat-back, or with a "Save to Notes" button in Auto mode.
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
- [x] **OBJ-74.5** In Auto mode, skip the offer; the card's button is the way to save.
- [ ] **OBJ-74.6** Tests across the harness and the Mac, then a live check: "list the files in my Downloads folder", say "yes, in a note", and see the note in Notes.

## Expectations

- [ ] Saying yes to the note leaves a new note in Notes with the full list.
- [ ] In Auto mode, "Save to Notes" on the card does the same.
- [ ] The card shows the full list.

## Expected outcomes

- The offer in the repeat-back, the note subtask, the full list in the summary event, and the Mac card button, with tests.

## Out of scope

- Saving to other apps or files.

## Outcome

- **Result:** Built and tested; waiting for the live check (OBJ-74.6), so the objective stays in progress.
- **Delivered:**
  - Protocol (still version 4): `Speak.list` (`FoundList`: title, items, optional `more`, `inNote`) and the app-to-harness method `saveListToNote` (`TaskRef` to `SubmitGoalResult`), in `protocol/schemas/rpc.json`, with examples and a test.
  - Harness: `harness/src/planner/list-note.ts` (the offer, list goals, the title, the list, the note subtask, the `NOTE_TEXT` placeholder); the offer and `confirmWithNote` in `harness/src/confirm/`; the `list_to_note` task column (migration 10); the note phase and the list on the summary in `harness/src/scheduler/run-task.ts`; `TaskControl.saveListToNote` and its RPC handler; one line in `gui-act.ts` that types the list in place of the placeholder.
  - Mac: the list, "Save to Notes", and "save it" in `mac/Yumi/Summary/TaskSummary.swift` and `SummaryPanel.swift`, wired in `mac/Yumi/Harness/HarnessLink.swift`.
- **Commits:** `a7fd1c4 feat(protocol): send a task's found list with its summary and add saveListToNote`, `fece5ff feat(harness): offer to put a list in a new note and send the full list with the summary`, `5a57424 feat(mac): show a task's full list on the summary card with save to notes`.
- **Expectations:** not checked yet. Covered by tests so far: `harness/test/list-note.test.ts` (the offer, "yes, in a note" adds the note subtask with list_dir's real output and says the note in the summary, a plain yes sends the list with no note, a model-read answer, Auto mode with no offer and `saveListToNote`, refusals), `harness/test/gui-act.test.ts` "OBJ-74 the note subtask" (the Mac app receives cmd+n, then the full list typed), and `mac/YumiTests/TaskSummaryTests.swift` (the full list, Save to Notes, "save it", no button once in a note, snapshots in light and dark). `python3 scripts/verify.py` passes everything except `harness/test/goal-revision.e2e.test.ts`, which also fails on `origin/main` and is being fixed by OBJ-36's agent.
- **Not verified:** the live run in Notes. Steps for Brent: (1) with Auto mode off, say "list the files in my Downloads folder"; Yumi should end with "Want me to put the list in a new note too?" (2) Say "yes, in a note". (3) Watch the cat open Notes, make a new note, and type the list; the card shows the full list with "Saved in a new note". (4) Turn Auto mode on, ask again, and press "Save to Notes" on the card (or say "save it"); a second note appears.
- **Decisions and deviations:**
  - The worker types the placeholder `NOTE_TEXT` and `gui_act` types the real list in its place, so the note can never be the model's version of the list, and a long list does not take the model a long time to write out.
  - "Save to Notes" shows on any card with a list that is not in a note yet, not only in Auto mode.
  - A card with a list does not close on its own.
  - With the offer, a bare "no" is still unclear (SPEC-01's rule); "no note" or "just list them" goes ahead without the note.
  - The summary with a note is the answer's first sentence plus "I put the full list in a new note called {title}.", so it stays two sentences.
  - In Auto mode the title comes from what the user said ("Files in my Downloads folder").
  - A note that fails fails the task with "Couldn't finish a step", naming "Put the list in a new note".
- **For the next objectives:** `foundListOf(store, task)` in `run-task.ts` rebuilds a finished task's list from the store. Note subtasks are recognized with `isNoteSubtask`. Only `list_dir` output becomes a list; a task that also changed something sends no list.
