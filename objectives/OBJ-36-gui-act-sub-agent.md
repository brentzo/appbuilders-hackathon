---
id: OBJ-36
title: gui_act sub-agent
product: harness
assignee: Brent
touches: []
specs: [SPEC-05, SPEC-02, SPEC-11]
status: in-progress
priority: p0
depends-on: [OBJ-06, OBJ-07, OBJ-37]
integrates-with: [OBJ-26, OBJ-39]
tags: [objective, p0, harness, gui]
---

# OBJ-36 gui_act sub-agent

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-05](../specs/05-mac-gui-control.md), [SPEC-02](../specs/02-task-lifecycle.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The orchestrator never looks at the screen.
It hands a sub-goal to the `gui_act` tool, which runs a short step loop on the same model with a fresh context: observe the window, pick one action, check it, run it, and see whether anything changed.
The orchestrator gets back a small structured result, never a transcript, so its context stays small and screen text cannot steer it.
Build against the mock Mac app from [OBJ-01](OBJ-01-task-record-schemas.md) until [OBJ-39](OBJ-39-mac-gui-execution.md) is done, and start from the prompt in [OBJ-26](OBJ-26-gui-smoke-test.md) when it is done.

## Read first

- [SPEC-05](../specs/05-mac-gui-control.md), requirements 1 and 4-10, the "Demo tasks", and the "Mac GUI control" scenarios.
- [SPEC-02](../specs/02-task-lifecycle.md), requirements 3-6 and 8.
- [SPEC-03](../specs/03-lane-routing.md), requirements 7 and 8.
- [SPEC-11](../specs/11-user-facing-errors.md), the "Stuck on screen" and "Task took too long" rows.
- [docs/task-record-schema.md](../docs/task-record-schema.md), "What the model sees", "Actions", "Step", "Limits", and "Checkpointing".
- [OBJ-01](OBJ-01-task-record-schemas.md): `WorkerInput`, `WorkerOutput`, `ModelAction`, `RecordedAction`, `SubtaskResult`, and the Mac RPC methods.
- The Outcome of [OBJ-03](OBJ-03-harness-skeleton.md) (validation and retry), [OBJ-05](OBJ-05-planner-and-scheduler.md) (worker input builder), [OBJ-06](OBJ-06-resume-and-limits.md) (limits), [OBJ-07](OBJ-07-lane-router-core.md) (lane tool sets), [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) (the gate), and [OBJ-26](OBJ-26-gui-smoke-test.md) (prompt, failure patterns, constrained decoding), when done.
- The open questions for OBJ-35 to OBJ-40 in the [objectives README](README.md).

## Tasks

- [ ] **OBJ-36.1** Register `gui_act` as an orchestrator tool that takes a subtask id; the instruction and target come from the task record. One call is one attempt and increments the subtask's `attempts`.
- [ ] **OBJ-36.2** Keep the orchestrator's tool list at 8 or fewer (SPEC-05 r9). Proposed list: `gui_act`, `read_file`, `list_dir`, `write_new_file`, `copy`, `move`, `move_to_trash`, and `phone`; the `open_app`, `open_file`, `open_url`, and `reveal_in_finder` tools live inside `gui_act`. Add a test that fails past 8, and record the final list in `harness/README.md`.
- [ ] **OBJ-36.3** The step loop: observe the target window, build the `WorkerInput` with the [OBJ-05](OBJ-05-planner-and-scheduler.md) builder, set the cursor to thinking, call the model with schema-constrained decoding when the server supports it (SPEC-05 r10), resolve the `ModelAction` into a `RecordedAction`, pass it through the [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) gate, check the task is not paused or cancelled, write the step row, run the action, observe again, and write the outcome. Nothing is sent once the pause state is set ([OBJ-38](OBJ-38-approvals-pause-and-action-log.md) sets it).
- [ ] **OBJ-36.4** Cheapest path first (SPEC-05 r1): the prompt lists the direct tools first and says to use one when it fits. Shell, AppleScript, and `click` (p1) are never offered, and an output that names them is `invalidOutput`.
- [ ] **OBJ-36.5** No-effect check (SPEC-05 r6): when the trimmed tree and the window title are the same before and after an action, the outcome is `noEffect`. Count consecutive `noEffect` and `invalidOutput` for [OBJ-09](OBJ-09-ghost-handoff.md).
- [ ] **OBJ-36.6** Limits: stop after 10 steps and return `partial` with a note on where it got stuck (SPEC-05 r5). Steps count toward the 25 steps and 3 attempts per subtask from [OBJ-06](OBJ-06-resume-and-limits.md).
- [ ] **OBJ-36.7** Ending an attempt: `finish` ends it with the model's status after the harness checks it against the step log; 3 consecutive `noEffect` on `main` ends it with `stuck` and a `stuckOnScreen` error; a blocked action ends it with `blocked`. Two invalid outputs in a row on `main` is an open question; until it is settled, end with `stuck`, as the design doc suggests.
- [ ] **OBJ-36.8** Build the `SubtaskResult` from the step log (SPEC-05 r4): `status`, `files`, and a `note` of at most 200 characters. Take `files` from typed tool calls and from files created or changed in the home folder during the attempt (for example the PDF Keynote exported); the spec does not say how GUI-created files are found, so record the approach in the Outcome. Screenshots, step history, and raw screen text never go into the result.
- [ ] **OBJ-36.9** `ask` actions and password fields: when the next step needs a secure text field, never read or fill it, and ask the user to type the password (SPEC-05 r7). Set the subtask to waiting, emit the question for the Mac app to speak, and feed the answer into the next step. While it waits and no UI lane is acting, the user's typing does not pause the task (SPEC-06 r2). Use the draft password copy from the SPEC-07 "Draft copy" table. The question goes out as the `questionAsked` event and comes back through `answerQuestion` (OBJ-01).
- [ ] **OBJ-36.10** Apply the OBJ-26 round 3 lessons (see "Round 3" in [models/gui/SMOKE-TEST.md](../models/gui/SMOKE-TEST.md)): wait until two observations in a row match before showing the model the screen after an action, so a closing sheet is not mistaken for the current one; treat an accessibility error from `executeAction` as `noEffect` with the reason, never as `ok`; when a file appears in the home folder during the attempt, tell the model ("new file: Q3 Report.pdf"), so it can finish instead of exporting again; and when it clicks a text field, say to use `setValue`. Measure each against round 3 with the smoke test.
- [ ] **OBJ-36.11** Tests with a mocked model and the mock Mac app for each scenario below, the 10-step limit, a shell attempt, and a check that unique screen text never reaches the orchestrator. Then run the three demo tasks on the real Mac app 5 times each and record steps, time, and failures in the Outcome.

## Expectations

- [ ] SPEC-05 scenarios pass end to end: "Direct tool is used when available", "Raw shell is not available", "Accessibility is used before vision", "The model sees a trimmed tree", "Sub-agent returns a structured result", "Sub-agent hits its step limit", "Action has no effect", "Password field is left to the user".
- [ ] The orchestrator's tool list has 8 tools or fewer.
- [ ] Unique text put on the screen appears nowhere in what the orchestrator receives.
- [ ] Every step row is written before its action runs.
- [ ] Each demo task succeeds in 4 or more of 5 runs on the demo Mac, or the Outcome says why not.

## Expected outcomes

- The `gui_act` tool and its step loop in the harness.
- The no-effect check, attempt limits, and the result builder.
- Recorded runs of the three demo tasks.

## Out of scope

- Reading and acting on windows on the Mac: [OBJ-39](OBJ-39-mac-gui-execution.md) (Patrick).
- Permission levels: [OBJ-37](OBJ-37-permission-gate-and-file-tools.md). Approvals and pausing: [OBJ-38](OBJ-38-approvals-pause-and-action-log.md).
- Ghost handoff: [OBJ-09](OBJ-09-ghost-handoff.md).
- The smoke test: [OBJ-26](OBJ-26-gui-smoke-test.md). The model bake-off and vision fallback (SPEC-05 r12-14, p1).
- The "I'll show you" button on the stuck error: not specified yet.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
