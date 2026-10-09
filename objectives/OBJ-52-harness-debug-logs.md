---
id: OBJ-52
title: Debug mode keeps full local logs
product: harness
assignee: Brent
touches: [mac]
specs: [SPEC-07]
status: in-progress
priority: p0
depends-on: []
integrates-with: [OBJ-53]
tags: [objective, p0, harness, safety, debug]
---

# OBJ-52 Debug mode keeps full local logs

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

When a goal fails today, the logs drop what was said and what the model saw, so nobody can tell why.
In Brent's run, his "yes" was read as a correction and nobody could see what was transcribed.
SPEC-07 requirement 22 adds a Debug mode that keeps full, local logs, and requirement 23's thoughts panel ([OBJ-53](OBJ-53-mac-thoughts-panel.md)) reads from them.

## Read first

- SPEC-07 requirements 20, 22, and 23, and its Decisions.
- `harness/src/log.ts` and `harness/src/config.ts`.
- `harness/src/model/client.ts` (model requests and replies), `harness/src/confirm/` (transcripts and answers), `harness/src/planner/`, and `harness/src/worker/`.
- [harness/README.md](../harness/README.md), where the log files live.

## Tasks

- [ ] **OBJ-52.1** Add a Debug mode setting to the harness config: on by default for development, off for release builds, and controllable from the Mac app's settings.
- [ ] **OBJ-52.2** In Debug mode, write a separate detailed log in the support folder: transcripts and the user's spoken answers, each model request (messages, schema name) and reply (content, timing, tokens), plans, and each step's observation summary and decision.
- [ ] **OBJ-52.3** Never write text typed into password fields or secure field values, and test it (SPEC-07 r20).
- [ ] **OBJ-52.4** Delete detailed logs older than 7 days at startup.
- [ ] **OBJ-52.5** Expose a step's decision and the model's reasoning in a form the Mac can read for the thoughts panel (through `getTask` or an event), as a non-breaking protocol addition, coordinated with OBJ-53.
- [ ] **OBJ-52.6** Document where the logs are and how to read them in harness/README.md, and add a short how-to for debugging a failed goal.

## Expectations

- [ ] With Debug mode on, a failed goal can be explained from the detailed log alone: what was heard, what the model was asked, and what it answered.
- [ ] With Debug mode off, the detailed log is not written.
- [ ] No password text appears in any log.

## Expected outcomes

- The detailed debug log, its retention, the setting, the reasoning data for OBJ-53, and docs.

## Out of scope

- The panel that shows the reasoning: [OBJ-53](OBJ-53-mac-thoughts-panel.md).
- The user-facing action log: [OBJ-38](OBJ-38-approvals-pause-and-action-log.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
