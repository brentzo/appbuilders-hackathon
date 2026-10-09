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

- [ ] **OBJ-74.1** In the repeat-back, when the goal asks for a list, add the offer "Want me to put the list in a new note too?" and read "yes, in a note" (or similar) as yes with the note, and a plain yes as without.
- [ ] **OBJ-74.2** With the note, plan a second subtask after the listing that opens Notes, makes a new note titled after the goal, and types the full list from the steps' real tool output, not from the model's memory.
- [ ] **OBJ-74.3** Send the full list with the summary (a non-breaking protocol addition) so the Mac card shows all of it, scrollable, with the spoken sentence unchanged.
- [ ] **OBJ-74.4** Mac: a "Save to Notes" button on the summary card when the task produced a list, and the spoken "save it" while the card is up; either starts a short follow-up task that writes the note.
- [ ] **OBJ-74.5** In Auto mode, skip the offer; the card's button is the way to save.
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

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
