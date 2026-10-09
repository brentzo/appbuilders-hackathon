---
id: OBJ-01
title: Task record schemas and cross-team contracts
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-02, SPEC-03, SPEC-05, SPEC-07, SPEC-11]
status: in-progress
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, protocol]
---

# OBJ-01 Task record schemas and cross-team contracts

**Product:** [Yumi Protocol](../protocol/README.md) · **Specs:** [SPEC-02](../specs/02-task-lifecycle.md), [SPEC-03](../specs/03-lane-routing.md), [SPEC-05](../specs/05-mac-gui-control.md), [SPEC-07](../specs/07-safety.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Every long-running behavior in Yumi depends on the task record: resuming after a crash, handing work between workers, routing to lanes, approvals, and the action log.
The harness (TypeScript), the Mac app (Swift), and the Android app (Kotlin) all read and write these shapes, so they must be defined once, as JSON Schema, with generated types for each language.
This is the first thing other objectives build on.
It also defines every contract between people's work (harness and Mac app, harness and bridge client) and ships mock stand-ins, so Brent, Patrick, and Jepoy can each build against the contract without waiting for each other.

## Read first

- [docs/task-record-schema.md](../docs/task-record-schema.md): the shapes (written as Swift sketches), what the model sees, typed tools, approvals, and limits.
- [docs/lane-router.md](../docs/lane-router.md): lanes, route reasons, window locks.
- [SPEC-02](../specs/02-task-lifecycle.md), [SPEC-03](../specs/03-lane-routing.md).
- [SPEC-05](../specs/05-mac-gui-control.md) requirements 1-6 (typed tools, trimmed tree, structured result, no-effect rule).
- [SPEC-07](../specs/07-safety.md) requirements 1-15 (permission levels, typed file tools, strict delete, sending).
- [SPEC-11](../specs/11-user-facing-errors.md), the error copy table.
- [protocol/README.md](../protocol/README.md).

## Tasks

- [ ] **OBJ-01.1** Try the type generator first. Write only the `ModelAction` tagged union and generate TypeScript, Swift, and Kotlin from it. Check that each language gets a real sum type (TypeScript discriminated union, Swift enum with associated values, Kotlin sealed class) and not a bag of optional fields. If quicktype cannot do this, pick another generator now, before writing the other schemas. Record the choice.
- [ ] **OBJ-01.2** Set up `protocol/` as a package: a `schemas/` folder for JSON Schema files and a `generated/` folder (or build step) for TypeScript, Swift, and Kotlin types.
- [ ] **OBJ-01.3** Write JSON Schemas for `Task` (with `originDeviceId`), `TaskStatus` (with `queued`), `Subtask`, `SubtaskStatus` (with `needsApproval`), `SubtaskResult`, `ResultStatus`, `Target`, `Step`, `StepOutcome` (with `blocked` and `declined`), `Lane`, `RouteReason`, `WindowLock`, and `AppCapability`, following the design doc. Keep `confirmedGoal` separate from the raw `goal`.
- [ ] **OBJ-01.4** Write the action schemas:
  - `ModelAction`, a tagged union of `axPress`, `setValue`, `type`, `key`, `scroll`, `tool`, `ask`, `finish`, and `click` (p1). Element actions refer to the element's short number, not a path. Each variant has only its own fields.
  - `RecordedAction`: the model action plus the resolved element (path, role, label) and the `PermissionLevel` the harness decided.
- [ ] **OBJ-01.5** Write the typed tool schemas, one argument schema per tool: `open_app`, `open_file`, `open_url`, `reveal_in_finder`, `read_file`, `list_dir`, `write_new_file`, `copy`, `move`, `move_to_trash`, and `phone`. `move_to_trash` takes an array of exact paths and rejects wildcard characters. There is no shell or AppleScript tool.
- [ ] **OBJ-01.6** Write the observation schemas: `Observation` (window title, trimmed elements, optional p1 screenshot path) and `TreeElement` (`n`, `role`, `label`, optional `value`, `enabled`), with at most 200 elements and only the actionable roles from SPEC-05 requirement 2.
- [ ] **OBJ-01.7** Write `WorkerInput` (confirmed goal, subtask instruction, last 3-5 steps, observation, allowed tool names) and `WorkerOutput` (exactly one `ModelAction`).
- [ ] **OBJ-01.8** Write the approval schemas: `Approval`, `ApprovalKind`, `FileSummary`, `ApprovalDecision`, and `ApprovalMethod` (`tap` or `voice`). A delete approval's text is built from `FileSummary`, never from model text.
- [ ] **OBJ-01.9** Write `ActionLogEntry` (time, device id, lane, plain-language description, paths for deletes, outcome).
- [ ] **OBJ-01.10** Write `ErrorKind`: one value per row of the SPEC-11 error table, plus `blockedAction` for SPEC-07 requirement 5. Every product maps these values to copy; nothing maps raw error text.
- [ ] **OBJ-01.11** Write the local RPC schemas between the harness and the native apps. List every method now, so later objectives implement them instead of inventing them:
  - Harness to Mac app: `executeAction`, `observeWindow` (returns `Observation`), `animateCursorTo`, `readFieldValues` (for To and Cc, SPEC-07 r13), `showApprovalCard` (returns `ApprovalDecision`), `probeAppCapability`, `openNewWindow`, `moveToTrash`.
  - Mac app to harness: `submitGoal`, `pause`, `resumeTask`, `cancelTask`, `listTasks`, `searchTasks`, `getTask`, `startPairing`, `listPairedDevices`, `unpair`.
  - Events from the harness: `taskStatusChanged`, `cursorCommand`, `progress`, `approvalCancelled`.
- [ ] **OBJ-01.12** Add a `protocolVersion` field, and a versioning section in `protocol/README.md`: how to bump the version, and what counts as a breaking change. Add the rule: an objective that adds or changes an RPC method updates the schema in `protocol/` in the same commit.
- [ ] **OBJ-01.13** Generate TypeScript, Swift, and Kotlin types with one command, and add a check that fails if generated files are out of date.
- [ ] **OBJ-01.14** Add example JSON files for each schema and a test that validates every example.
- [ ] **OBJ-01.15** Update `protocol/README.md` with the layout, the generate command, and how other products import the types.
- [ ] **OBJ-01.16** Add the contracts the parallel work split relies on that OBJ-01.11 does not list yet, each with a schema and an example:
  - Harness to Mac app: `listWindows`, `getWindowFrame`, `setWindowFrame` (window tiling and locks), and `storeSecret`, `loadSecret` (Keychain, used by the bridge client).
  - Events from the harness: `tilingSuggested`, `waitingForWindow`, `interruptedTaskFound`, `bridgeStateChanged`, the goal confirmation prompt and the user's reply, and `userError` carrying an `ErrorKind`.
- [ ] **OBJ-01.17** Build two mock stand-ins in `protocol/mocks/`: a **mock harness** that serves the local socket, answers every harness method with example data, and plays scripted event sequences; and a **mock Mac app** that answers every Mac-side method with example data. The Mac app is built against the mock harness, and the harness against the mock Mac app, until the real ones exist. Mocks return the same shapes as the real side, including errors.
- [ ] **OBJ-01.18** Document how to run each mock and how to script an event sequence.

## Expectations

- [ ] Every shape in [docs/task-record-schema.md](../docs/task-record-schema.md) has a JSON Schema, or a written reason why it changed.
- [ ] A `ModelAction` with fields from another variant fails validation.
- [ ] An element action that names a path instead of a number fails validation.
- [ ] A `WorkerOutput` with zero or two actions fails validation (supports SPEC-02 scenario "Worker returns an invalid action").
- [ ] A shell command or AppleScript action fails validation (supports SPEC-05 scenario "Raw shell is not available").
- [ ] A `move_to_trash` call with `~/Downloads/*.pdf` fails validation (supports SPEC-07 scenario "Wildcards are rejected").
- [ ] An `Observation` with 201 elements fails validation.
- [ ] Every row of the SPEC-11 table has an `ErrorKind` value.
- [ ] Generated types compile in TypeScript, Swift, and Kotlin, and unions come out as real sum types.
- [ ] One command regenerates all types, and the out-of-date check runs in CI or a pre-commit step.
- [ ] Every RPC method and event in OBJ-01.11 and OBJ-01.16 has a schema and a valid example.
- [ ] A client can connect to the mock harness, call every method, and receive a scripted event sequence. The mock Mac app answers every Mac-side method.

## Outcomes

- `protocol/schemas/*.json`: the source of truth.
- Generated types for TypeScript, Swift, and Kotlin, and the recorded generator choice.
- Example files and a validation test.
- An updated `protocol/README.md`.
- All cross-team RPC contracts, and the mock harness and mock Mac app in `protocol/mocks/`.

## Out of scope

- Bridge envelope and crypto: [OBJ-02](OBJ-02-bridge-envelope-and-crypto.md). Cross-device message kinds: [OBJ-25](OBJ-25-cross-device-messages.md).
- Storing records in SQLite: [OBJ-04](OBJ-04-task-store.md).
- Deciding permission levels at runtime and building approval text: harness objectives (not written yet for SPEC-07).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
