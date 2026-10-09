---
id: OBJ-01
title: Task record and action schemas
product: protocol
touches: []
specs: [SPEC-02, SPEC-03]
status: todo
priority: p0
depends-on: []
tags: [objective, p0, protocol]
---

# OBJ-01 Task record and action schemas

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-02](../specs/02-task-lifecycle.md), [SPEC-03](../specs/03-lane-routing.md)

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Every long-running behavior in Yumi depends on the task record: resuming after a crash, handing work between workers, routing to lanes, and the action log.
The harness (TypeScript), the Mac app (Swift), and the Android app (Kotlin) all read and write these shapes, so they must be defined once, as JSON Schema, with generated types for each language.
This is the first thing other objectives build on.

## Read first

- [docs/task-record-schema.md](../docs/task-record-schema.md): the draft shapes (written as Swift structs), the worker input, and the limits.
- [docs/lane-router.md](../docs/lane-router.md): lanes, route reasons, window locks.
- [SPEC-02](../specs/02-task-lifecycle.md) and [SPEC-03](../specs/03-lane-routing.md).
- [protocol/README.md](../protocol/README.md).

## Tasks

- [ ] **OBJ-01.1** Set up `protocol/` as a package: a `schemas/` folder for JSON Schema files and a `generated/` folder (or build step) for TypeScript, Swift, and Kotlin types.
- [ ] **OBJ-01.2** Write JSON Schemas for `Task`, `TaskStatus`, `Subtask`, `SubtaskStatus`, `Target`, `Step`, `StepOutcome`, `Lane`, `RouteReason`, `WindowLock`, and `AppCapability`, following the design doc. Include `confirmedGoal` separate from the raw `goal`.
- [ ] **OBJ-01.3** Write the `Action` schema as a tagged union: `click`, `axPress`, `setValue`, `type`, `key`, `scroll`, `toolCall`, `ask`. Each variant has only its own fields.
- [ ] **OBJ-01.4** Write the `WorkerInput` schema (confirmed goal, subtask instruction, last 3-5 steps, screen observation, allowed tools) and `WorkerOutput` (exactly one `Action`).
- [ ] **OBJ-01.5** Write the local RPC schemas between the harness and native apps: requests (`executeAction`, `captureWindow`, `readAccessibilityTree`), results (`ActionResult` with a one-line observation), and events (`taskStatusChanged`, `cursorCommand`).
- [ ] **OBJ-01.6** Add a `protocolVersion` field, and a versioning section in `protocol/README.md`: how to bump the version and what counts as a breaking change.
- [ ] **OBJ-01.7** Generate TypeScript, Swift, and Kotlin types with one command, and add a check that fails if generated files are out of date.
- [ ] **OBJ-01.8** Add example JSON files for each schema and a test that validates every example.
- [ ] **OBJ-01.9** Update `protocol/README.md` with the layout, the generate command, and how other products import the types.

## Expectations

- [ ] Every shape in [docs/task-record-schema.md](../docs/task-record-schema.md) has a JSON Schema, or a written reason why it changed.
- [ ] An `Action` with fields from another variant fails validation.
- [ ] A `WorkerOutput` with zero or two actions fails validation (supports SPEC-02 scenario "Worker returns an invalid action").
- [ ] Generated types compile in TypeScript, Swift, and Kotlin.
- [ ] One command regenerates all types, and the out-of-date check runs in CI or a pre-commit step.

## Outcomes

- `protocol/schemas/*.json`: the source of truth.
- Generated types for TypeScript, Swift, and Kotlin.
- Example files and a validation test.
- An updated `protocol/README.md`.

## Out of scope

- Bridge messages and crypto: [OBJ-02](OBJ-02-bridge-envelope-and-crypto.md).
- Storing records in SQLite: [OBJ-04](OBJ-04-task-store.md).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
