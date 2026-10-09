---
id: OBJ-63
title: Decide when an answer to a task question changes its goal
product: harness
assignee: Brent
touches: []
specs: [SPEC-06]
status: todo
priority: p1
depends-on: [OBJ-61]
integrates-with: [OBJ-36]
tags: [objective, p1, harness, voice, ux]
---

# OBJ-63 Decide when an answer to a task question changes its goal

**Product:** [Yumi Harness](../harness/README.md) · **Specs:** [SPEC-06](../specs/06-user-control.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone.
> The harness owns task state, planning, and safety, while the Mac and phone control it through the protocol.

## Why this objective

SPEC-06 requirement 20 says that while Yumi waits for an answer to a task question, only an answer that says "stop", "cancel", or clearly changes the goal interrupts the task.
The current `QuestionBroker.answer` treats every answer as data for the waiting subtask, so the interruption rule needs its own behavior and decision.
This was found while implementing [OBJ-61](OBJ-61-harness-goal-revision.md).

## Read first

- [SPEC-06](../specs/06-user-control.md) requirement 20 and its task-question scenario.
- [OBJ-61](OBJ-61-harness-goal-revision.md), especially its revision and question-answer behavior.
- [QuestionBroker](../harness/src/gui/questions.ts) and `answerQuestion` in the harness RPC handlers.

## Tasks

- [ ] **OBJ-63.1** Decide how to distinguish a direct answer from "stop", "cancel", and a clear goal change, without treating ordinary answer text as an interruption.
- [ ] **OBJ-63.2** Route only interruption intents into the pause/cancel/revise flow and deliver ordinary answers to the waiting subtask unchanged.
- [ ] **OBJ-63.3** Add end-to-end tests for ordinary answers, stop, cancel, and goal changes while Yumi waits for an answer.
- [ ] **OBJ-63.4** Update the protocol or user-facing decision docs if the chosen behavior changes the message sequence.

## Expectations

- [ ] Ordinary answers resolve the open question and do not pause or revise the task.
- [ ] Stop, cancel, and clear goal changes follow the SPEC-06 control flow.
- [ ] Ambiguous answers do not silently discard the waiting question or start revised work.

## Expected outcomes

- A documented intent boundary and tested routing for spoken answers while a subtask is waiting on the user.

## Out of scope

- Goal revision from general task interruption, covered by [OBJ-61](OBJ-61-harness-goal-revision.md).
- Capturing the interruption on the Mac, covered by [OBJ-62](OBJ-62-mac-voice-interruption.md).

## Outcome

_Not finished yet._
