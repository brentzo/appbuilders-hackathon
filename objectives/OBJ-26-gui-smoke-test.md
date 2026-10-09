---
id: OBJ-26
title: Qwen3.5-9B smoke test on the demo tasks
product: models
assignee: Brent
touches: []
specs: [SPEC-05]
status: in-progress
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, models, gui]
---

# OBJ-26 Qwen3.5-9B smoke test on the demo tasks

**Product:** [Yumi Models](../models/README.md) · **Specs:** [SPEC-05](../specs/05-mac-gui-control.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The demo depends on Qwen3.5-9B at 4-bit choosing the right element from a trimmed accessibility tree.
Nobody has checked that yet.
The public scores used to pick the model (ScreenSpot-Pro, OSWorld) measure vision, and p0 uses no vision.
The full model comparison in SPEC-05 requirement 14 is p1, so this objective answers the p0 question early and cheaply: does 9B work on our three demo tasks, and how often does its output fail validation?
If the answer is no, the team needs to know before building the harness around it.

## Read first

- [SPEC-05](../specs/05-mac-gui-control.md), requirements 1-6 and 10, and "Demo tasks".
- [docs/task-record-schema.md](../docs/task-record-schema.md), "What the model sees" and "Actions".
- [OBJ-01](OBJ-01-task-record-schemas.md), if done: use its `Observation` and `ModelAction` schemas. If not, follow the design doc.
- [models/README.md](../models/README.md).

## Tasks

- [x] **OBJ-26.1** Run Qwen3.5-9B at 4-bit with an OpenAI-compatible MLX server on the 16 GB Mac. Record the server, version, and whether it supports schema-constrained decoding.
- [x] **OBJ-26.2** Write a throwaway script (Python with pyobjc is fine) that reads the target window's accessibility tree, trims it as in SPEC-05 requirement 2, numbers the elements, and presses or sets the chosen element. No cursor animation, no harness.
- [x] **OBJ-26.3** Write the prompt: confirmed goal, subtask instruction, last 3-5 steps, the trimmed tree, and the allowed actions. The model answers with one `ModelAction` as JSON.
- [ ] **OBJ-26.4** Run each demo task 5 times from the same starting state: Keynote export to PDF, Mail draft to Ana with the PDF attached (stop before Send), and a new note in Notes with a summary.
- [ ] **OBJ-26.5** For every run, record: success, steps used (limit 10), seconds per step, how many outputs failed validation, how many steps had no effect, and peak memory.
- [ ] **OBJ-26.6** Repeat with constrained decoding on and off, if the server supports it.
- [ ] **OBJ-26.7** Write `models/gui/SMOKE-TEST.md` with the numbers, the prompt, and a plain verdict.

## Expectations

- [ ] Each demo task has 5 recorded runs.
- [x] The verdict uses SPEC-05's bar: a task passes with 4 or more successful runs out of 5.
- [x] If any task fails, the doc names the failure pattern (wrong element, invalid output, no effect, too many elements) and suggests a fix to try.
- [x] Peak memory with the model loaded is recorded, for the Whisper choice in [OBJ-11](OBJ-11-whisper-bake-off.md).

## Expected outcomes

- `models/gui/SMOKE-TEST.md` with results and the verdict.
- The throwaway script, committed under `models/gui/` for reruns, clearly marked as not product code.

## Out of scope

- Comparing Qwen3.5-4B and UI-TARS-1.5-7B. That is the p1 bake-off in SPEC-05 requirement 14. UI-TARS is a vision model, so it only matters for the p1 vision fallback.
- Vision, coordinates, and screenshots (p1).
- Building `gui_act` in the harness.

## Outcome

- **Result:** In progress. Keynote has three rounds. Rounds 1 (baseline) and 2 (fixes 1-3) failed 0 of 5 in both decoding modes. Round 3, on the protocol v3 contract with fix 1, exported the PDF in 5 of 5 constrained and 4 of 5 unconstrained runs, which passes SPEC-05's 4-of-5 bar on the file check, but no run ended with `finish done`: the model never knew the export had worked. Mail and Notes are parked by Brent, so the objective stays `in-progress`.
- **Delivered:** `models/gui/SMOKE-TEST.md` (numbers, prompt, verdict, fixes to try), `models/gui/smoke.py` (throwaway script, marked as not product code), `models/gui/results/runs.jsonl` (30 counted Keynote runs, tagged `baseline`, `fixes-1-3`, or `v3-fix-1`), `models/gui/results/pilot.jsonl` (1 uncounted pilot run), `models/gui/results/bench.jsonl` (model-only latency and memory benchmark).
- **Commits:** `5c7da69 docs(objectives): start OBJ-26`, `9d8efe2 feat(models): add throwaway OBJ-26 GUI smoke test script`, `6ccd46d fix(models): keep smoke test fixtures in ~/Yumi smoke test`, `d966873 feat(models): use SPEC-05 menu bar item, text area, and radio button roles in the smoke test`, `949470a feat(models): add model-only benchmark to the smoke test and record first numbers`, `2617194 fix(models): use Keynote's real bundle id com.apple.Keynote in the smoke test`, `10b5ce0 fix(models): keep the window title while a Keynote sheet is open, and record the pilot run`, `a15ce36 docs(models): add OBJ-26 smoke test results for the Keynote task`, `ebbec29 docs(objectives): record OBJ-26 Keynote results, Mail and Notes parked`, `5afbbe9 feat(models): add --fixes to the smoke test for the first round's fixes 1-3`, the round 2 results commit, `c3aa3ff feat(models): send focus and the front layer in the GUI smoke test observation`, and the round 3 results commit `docs(models): add OBJ-26 round 3 results on protocol v3`.
- **Expectations:**
  - Each demo task has 5 recorded runs: not met. Keynote has 5 constrained and 5 unconstrained runs per round, three rounds, in `results/runs.jsonl`; Mail and Notes have none.
  - Verdict uses SPEC-05's bar: met. SMOKE-TEST.md "Verdict" applies 4 of 5 to Keynote: rounds 1 and 2 fail in both modes, round 3 passes in both modes on the file check, with the caveat that the model never finished.
  - Failure pattern and fix: met. Round 1 is "no effect" (a wrong action type: typing a file name into the export options dialog instead of pressing Save…). Round 2, with fixes 1-3, is "invalid output": the model then picks the right element but calls the action `click`. Round 3 is a new pattern, not finishing: a stale screen read 1 second after Export (8 runs) and no sign on screen that the file was saved (all 9 exporting runs), plus 3 no-effect clicks on a text field in one run. SMOKE-TEST.md "Fixes to try next" lists 4 fixes for round 3.
  - Peak memory: met. 7.2 GiB during the Keynote runs (7.3 GiB in round 3) and 8.6 GiB at 200 elements in the benchmark, measured as physical footprint with `proc_pid_rusage`.
- **Not verified:**
  - Mail and Notes runs. Parked by Brent: Mail account and Notes location not decided. To run them: decide both, open Mail and Notes in their starting state, then `smoke.py run --task mail|notes --run N --mode constrained|free` 5 times per mode. The Mail fixture is `~/Yumi smoke test/Q3 Report.pdf`. The Mail and Notes success checks in `smoke.py` have never run against real windows, so check them on the first run.
  - The round 3 fixes in SMOKE-TEST.md "Fixes to try next" (settle until the tree is stable, report new files, explain a click on a text field) were not tried. To measure them, add them to `smoke.py` and rerun `smoke.py run --task keynote --mode constrained|free --fixes 1` with new run numbers (31 on).
  - Whether the Mac app can send key events into an out-of-process save panel: `CGEventPostToPid` to Keynote did not reach it during setup. Patrick can check on the demo Mac with a `key` action while a save panel is open.
  - Round 3 ran under heavy memory pressure ("critical" during runs 23 to 26, swap nearly full), and another agent's Gradle build was running when runs 26 and 29 started. Step times up to 69 seconds came from that; the success counts likely did not depend on it, since the same steps happened in every run.
- **Decisions and deviations:**
  - Server: `mlx_vlm.server` (mlx-vlm 0.7.6), because Qwen3.5 is a vision-language model converted with mlx-vlm and `mlx_lm.server` has no `response_format`. Model `mlx-community/Qwen3.5-9B-4bit` at revision `8b2b98c00a6b4d291155e4890773ca8f769aee53`. Python 3.14.5.
  - Thinking mode off, temperature 0.7, top_p 0.8, top_k 20 (Qwen3.5 model card, instruct mode).
  - `ModelAction` is encoded as one JSON object tagged by an `action` field. `tool` and `click` are left out. `type` and `key` are allowed, as on the main lane.
  - The subtask instruction gives the file name ("Q3 Report run N") so runs never replace each other's files. This likely triggered the failure; see SMOKE-TEST.md fix 4.
  - Safety is stricter than SPEC-07 for running on a real Mac: Send stops the run, and Delete, Replace, Quit, Share, Print, and similar labels and delete keys are blocked. Nothing was blocked in the runs.
  - The deck was made with AppleScript as a setup step, not by the model. Fixtures live in `~/Yumi smoke test/`, because `~/Downloads` is not readable from the agent sandbox. In round 3 Keynote refused an AppleScript `save` to that folder, so the deck was saved through Keynote's Save panel, driven by the accessibility API.
  - Round 3 measures the protocol v3 contract (Brent, through OBJ-29): the nested `WorkerOutput` reply, `click {element}`, and `app`, `focused`, and `layer` in the observation, shown as the harness worker prompt shows them, with the harness's rule "When a sheet, dialog, or menu is in front, act in it first." Its numbers are not directly comparable with rounds 1 and 2. Fix 1 is on and fixes 2 and 3 are off. `Title` is now the plain window title; the "(dialog open: ...)" and "(menu open)" suffixes are gone, since the layer replaces them.
- **For the next objectives:**
  - Harness and Mac app (round 3): read the screen only after it settles (two equal reads 0.3 to 0.5 seconds apart, up to a few seconds), and treat an AX error from an action (`-25202` invalid element, `-25206` action unsupported) as a failed step with its own explanation, never as `ok`. Give the model evidence that a save or export worked, for example a "new file" note in the step outcome, from the files `gui_act` already reports. Keynote's save panel has no `AXDefaultButton`, and its export sheet has no `AXTitle`.
  - OBJ-03 (harness): 9B navigates menus reliably and never produced malformed JSON, but it repeats an action that had no effect. Explaining why a step had no effect (fix 1) got it to the right element in round 2, so keep that. It then said `click` instead of `axPress`; under constrained decoding it could not say `click` at all and fell back to typing.
  - OBJ-01 (schemas): naming the element-press action `click` with an `element` field (the model's own verb) was done in OBJ-29 (protocol v3), and round 3 confirms it: the model pressed the right button in every dialog step that round 2 failed. Latency is mostly prompt processing: about 4 seconds per step at 1,000 prompt tokens and 11 seconds at 3,200, so keep the tree and history short. llguidance 1.9.1 rejects `uniqueItems`; strip it from schemas sent for constrained decoding and validate against the full schema.
  - OBJ-11 (Whisper): plan for about 7.2 to 8.6 GiB for the 9B server, leaving roughly 7 GiB for macOS, the apps, and Whisper on 16 GB.
  - Demo Mac: the 9B model cannot run next to Gradle and the Android emulator. A 618-token prompt took 3 minutes 41 seconds and then timed out.
