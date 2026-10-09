---
id: OBJ-17
title: Goal confirmation loop
product: mac
assignee: Brent
touches: [harness]
specs: [SPEC-01]
status: in-progress
priority: p0
depends-on: [OBJ-04, OBJ-15, OBJ-18]
integrates-with: []
tags: [objective, p0, mac, harness, voice, ux]
---

# OBJ-17 Goal confirmation loop

**Product:** [Yumi for Mac](../mac/README.md) · **Also touches:** [harness](../harness/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Reassigned from Patrick to Brent on 2026-10-09, because Patrick is busy elsewhere; the Mac code still follows Patrick's conventions in `mac/README.md`.

Yumi never acts on a goal it might have misheard.
It repeats the goal back in its own words, by voice and on screen, and waits for yes, a correction, or cancel.
This is also the moment the cat cursor appears, so it is the start of every demo.

## Read first

- [SPEC-01](../specs/01-voice-intake.md), requirements 4-7 and the "Voice intake and confirmation" scenarios with their exact copy.
- [OBJ-04](OBJ-04-task-store.md), [OBJ-15](OBJ-15-mac-voice-intake.md), and [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) Outcome.

## Tasks

- [x] **OBJ-17.1** Harness: on `submitGoal`, create a task in `awaitingConfirmation` with the raw transcript as `goal`.
- [x] **OBJ-17.2** Harness: ask the model to restate the goal as a short repeat-back sentence ending in a question, matching the SPEC-01 copy style ("You want me to ... Should I go ahead?"). Taglish goals are repeated back in English.
- [x] **OBJ-17.3** Mac: when a goal arrives, spawn the main cursor near the user's pointer.
- [x] **OBJ-17.4** Mac: speak the repeat-back through a `speak` interface backed by `AVSpeechSynthesizer`, and show it in a small panel with "Go ahead", "Change it", and "Cancel" buttons.
- [x] **OBJ-17.5** Listen for the reply right after speaking. Classify it as confirm, cancel, or correction (a short model call in the harness is fine).
- [x] **OBJ-17.6** Confirm: save `confirmedGoal` and move the task to `planning`. Cancel: say "Okay, I won't do anything.", fade the cursor out, and do not keep the task as work. Correction: combine it with the goal, restate, and ask again.
- [x] **OBJ-17.7** Make sure no planning or action happens before confirmation, even if the reply is unclear. Unclear replies get asked again once, then the panel waits for a button.
- [x] **OBJ-17.8** Tests for the harness flow with a mocked model; manual checks of the full voice loop on the Mac.

## Expectations

- [x] SPEC-01 scenarios pass with their exact copy: "User gives a goal and confirms it", "User corrects the goal", "User cancels before work starts".
- [x] `confirmedGoal` and the raw `goal` are stored separately.
- [x] Nothing runs before a confirm.

## Expected outcomes

- The confirmation flow in the harness, the confirmation panel and `speak` interface on the Mac, and reply classification.

## Out of scope

- Confirmation on Android: needs the phone model (SPEC-10, not finalized).
- Kokoro voice: later, behind the same `speak` interface.
- Follow-up before phone routing (SPEC-09): the Mac app must send its bridge device id as `originDeviceId` instead of `mac-local`, and the harness must use the same id for its task records and action log (Brent's decision, 2026-10-10).

## Outcome

- **Result:** In progress (Brent, 2026-10-10).
  Built and tested, but three checks wait for the next live run on the real Mac: push-to-talk as the answer by voice, why a spoken "yes" was read as a correction (the OBJ-52 debug log will show the transcript), and a confirmed goal running end to end.
- **Delivered:**
  - `harness/src/confirm/`: the confirmation loop (`confirmation.ts`, `GoalConfirmation` and `abandonUnconfirmed`), the repeat-back prompt, checks, and SPEC-01 sentences (`restate.ts`), and reading the answer (`classify.ts`: fixed answers without the model, else one short model call).
  - `harness/src/rpc/confirmation.ts`: the `submitGoal` and `replyToConfirmation` methods. `harness/src/harness.ts` wires them; `harness/src/main.ts` now gives the shipped harness the model, the file helper lane, and `mac-local` as this Mac's device id, so a confirmed goal runs.
  - `harness/src/store/task-store.ts`: `listTasks` and `searchTasks` leave out tasks cancelled before they were confirmed.
  - Mac, on Patrick's half (`mac/Yumi/Confirmation/`, `e710904` and `10c8a8d`): `GoalConfirmation.userError` so a cancel that comes with an error says only the error copy, and `takeSpokenAnswer` with `HarnessLink.submitSpeech`, so push-to-talk and the wake word answer a waiting repeat-back instead of starting a new goal.
  - Tests: `harness/test/goal-confirmation.test.ts` (20) and four new tests in `mac/YumiTests/GoalConfirmationTests.swift`. `harness/README.md` and `mac/README.md` document it.
- **Commits:**
  - `4276f6f feat(harness): repeat goals back and start them only after the user confirms`
  - `e4c68a3 docs(objectives): start OBJ-17`
  - `601df19 fix(harness): leave the listening state, cancel line, and fade to the Mac app`
  - `bb86d6e docs(objectives): record OBJ-17 progress`
  - `3a2e7be feat(harness): hide never-confirmed tasks from history and send a confirmation error before the cancel`
  - `815b870 feat(mac): say only the error copy when a confirmation is cancelled with an error`
  - `4cc6e6a docs(objectives): record Brent's OBJ-17 decisions and the device id follow-up`
  - `76cecf1 fix(mac): take push-to-talk as the answer while a repeat-back waits`
  - `docs(objectives): finish OBJ-17` (this Outcome)
- **Expectations:**
  - SPEC-01 scenarios with their exact copy, mocked model: `test/goal-confirmation.test.ts`, "Scenario: User gives a goal and confirms it" (cursor spawn with no position, "You want me to rename the invoices in your Downloads folder by date. Should I go ahead?", then planning and the run), "Scenario: User corrects the goal" ("Got it. You want me to rename only the October invoices in your Downloads folder by date. Should I go ahead?", no model request for planning, no subtasks), and "Scenario: User cancels before work starts" (cancelled, no confirmed goal, no plan, left out of history; the Mac's line and fade are checked in `GoalConfirmationTests`).
  - Live on the Mac, 2026-10-10, signed build from this branch with Qwen3.5-9B: Brent ran the steps by voice (harness log from 17:00 UTC). The repeat-back, the correction after Change it (`0e168993`), cancelling by voice ("never mind", `d69df860`) and by button, the unclear answer asked once more and then waiting for a button (`890b4833`), and a confirm moving the task to planning with its plan accepted (`2cae5f2b`) all behaved as Brent expected. The task then failed at routing because the Mac app does not serve `resolveApp` yet (OBJ-36). Repeat-backs took about 1.5 s once memory was freed. Against the real model before the run, the repeat-back, the correction, Taglish into English, and the four answer kinds were all right.
  - `confirmedGoal` and the raw `goal` are stored separately: the tests, and the shipped `npm start` run (`goal` "rename the invoices in Downloads by date", `confirmedGoal` "Rename only the October invoices in your Downloads folder by date").
  - Nothing runs before a confirm: the only call that starts work is in `confirm`; tests check no planner request after corrections, unclear answers, invalid model replies, cancels, and failures.
  - `python3 scripts/verify.py` passes: docs, harness, and the Mac build and tests.
- **Not verified:**
  - The push-to-talk fix live: in the run, "no, only the ones from October" was said with the shortcut after the hands-free listen had ended (app log: "No spoken answer" at 01:00:33 local, shortcut at 01:00:37) and became a new goal. The fix is tested in `GoalConfirmationTests` but was not rerun by voice. To check: say a goal, wait until the cursor stops listening, hold ⌥Space and say a correction; Yumi should answer "Got it. ..." for the same goal.
  - Why the confirm in step 6 took three tries: Brent said "yes" each time, but the app heard answers of 31, 32, and 22 characters, read as a correction, unclear, and confirm. The logs keep only lengths, so what was heard is unknown; a likely cause is the microphone hearing Yumi's own voice or other speech. The full local debug logs from another objective will show it.
  - A whole confirmed task on the Mac: blocked by `resolveApp` (OBJ-36), not by this objective.
- **Decisions and deviations:**
  - Tasks the user cancelled before confirming them are kept, as every record is (SPEC-02 r10), but `listTasks` and `searchTasks` leave them out, so "no task is created" holds for history (Brent's decision, 2026-10-10).
  - When a confirmation ends with an error (the model could not repeat the goal back or read the answer), the harness sends the `userError` before the `cancelled` status, and the Mac says only the error copy, not "Okay, I won't do anything." (Brent's decision, 2026-10-10).
  - The Mac keeps sending `mac-local` as its `originDeviceId`, and the harness uses `mac-local` for this Mac's task records and action log. Moving to the bridge device id is a follow-up before phone routing (see "Out of scope") (Brent's decision, 2026-10-10).
  - The Mac app spawns the cursor, shows the listening state, says the cancel line, and fades the cursor; the harness sends no listening state, cancel line, or fade, so nothing comes twice. It sends the thinking state while the model works (SPEC-04 r4) and waiting for the user once Yumi waits for a button.
  - The model writes only the clause after "You want me to"; the harness builds the SPEC-01 sentences, so the question is always worded the same. `confirmedGoal` is that clause with a capital first letter. The raw `goal` stays the first transcript; corrections are not stored on the task.
  - Unclear answers are asked again by sending the same repeat-back once more, since SPEC-01 has no copy for asking again; the Mac listens twice per repeat-back to match.
  - "Change it" makes the next spoken answer the correction without asking the model what it means.
  - A model failure while confirming ends it: the task is cancelled with nothing run, and the user gets "Model failed to load" when the server is not running, otherwise "Unexpected". An invalid classification counts as unclear. A question a restart cut off is cancelled at startup.
- **For the next objectives:**
  - OBJ-48 (Auto mode): the place to skip the repeat-back is `GoalConfirmation.submit`; a task may start in `planning` with a `confirmedGoal` (`INITIAL_TASK_STATUSES`). Approvals are unaffected.
  - Several goals at once share the one model server: a plan that runs while another goal is repeated back slows the repeat-back (90 s in the first live run, under heavy memory pressure). If that matters, hold background model requests while a question to the user is open. Brent has not decided this.
  - Debug logging: the confirmation flow logs only lengths, kinds, and ids (`confirm.*` events), never what was said.
