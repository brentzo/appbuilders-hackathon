---
id: OBJ-01
title: Task record schemas and cross-team contracts
product: protocol
assignee: Jepoy
touches: []
specs: [SPEC-02, SPEC-03, SPEC-05, SPEC-07, SPEC-11]
status: done
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

- [x] **OBJ-01.1** Try the type generator first. Write only the `ModelAction` tagged union and generate TypeScript, Swift, and Kotlin from it. Check that each language gets a real sum type (TypeScript discriminated union, Swift enum with associated values, Kotlin sealed class) and not a bag of optional fields. If quicktype cannot do this, pick another generator now, before writing the other schemas. Record the choice.
- [x] **OBJ-01.2** Set up `protocol/` as a package: a `schemas/` folder for JSON Schema files and a `generated/` folder (or build step) for TypeScript, Swift, and Kotlin types.
- [x] **OBJ-01.3** Write JSON Schemas for `Task` (with `originDeviceId`), `TaskStatus` (with `queued`), `Subtask`, `SubtaskStatus` (with `needsApproval`), `SubtaskResult`, `ResultStatus`, `Target`, `Step`, `StepOutcome` (with `blocked` and `declined`), `Lane`, `RouteReason`, `WindowLock`, and `AppCapability`, following the design doc. Keep `confirmedGoal` separate from the raw `goal`.
- [x] **OBJ-01.4** Write the action schemas:
  - `ModelAction`, a tagged union of `axPress`, `setValue`, `type`, `key`, `scroll`, `tool`, `ask`, `finish`, and `click` (p1). Element actions refer to the element's short number, not a path. Each variant has only its own fields.
  - `RecordedAction`: the model action plus the resolved element (path, role, label) and the `PermissionLevel` the harness decided.
- [x] **OBJ-01.5** Write the typed tool schemas, one argument schema per tool: `open_app`, `open_file`, `open_url`, `reveal_in_finder`, `read_file`, `list_dir`, `write_new_file`, `copy`, `move`, `move_to_trash`, and `phone`. `move_to_trash` takes an array of exact paths and rejects wildcard characters. There is no shell or AppleScript tool.
- [x] **OBJ-01.6** Write the observation schemas: `Observation` (window title, trimmed elements, optional p1 screenshot path) and `TreeElement` (`n`, `role`, `label`, optional `value`, `enabled`), with at most 200 elements and only the actionable roles from SPEC-05 requirement 2.
- [x] **OBJ-01.7** Write `WorkerInput` (confirmed goal, subtask instruction, last 3-5 steps, observation, allowed tool names) and `WorkerOutput` (exactly one `ModelAction`).
- [x] **OBJ-01.8** Write the approval schemas: `Approval`, `ApprovalKind`, `FileSummary`, `ApprovalDecision`, and `ApprovalMethod` (`tap` or `voice`). A delete approval's text is built from `FileSummary`, never from model text.
- [x] **OBJ-01.9** Write `ActionLogEntry` (time, device id, lane, plain-language description, paths for deletes, outcome).
- [x] **OBJ-01.10** Write `ErrorKind`: one value per row of the SPEC-11 error table, plus `blockedAction` for SPEC-07 requirement 5. Every product maps these values to copy; nothing maps raw error text.
- [x] **OBJ-01.11** Write the local RPC schemas between the harness and the native apps. List every method now, so later objectives implement them instead of inventing them:
  - Harness to Mac app: `executeAction` (takes a cursor id; the Mac app animates that cursor to the element and acts after it arrives, SPEC-04 and SPEC-05 r3), `observeWindow` (returns `Observation`), `readFieldValues` (for To and Cc, SPEC-07 r13), `showApprovalCard` (returns `ApprovalDecision`), `probeAppCapability`, `openNewWindow`, `moveToTrash`.
  - Mac app to harness: `hello` (protocol version check), `ping`, `submitGoal`, `replyToConfirmation` (button or spoken reply, OBJ-17), `answerQuestion` (the user's answer to a model's ask action), `pause`, `resumeTask`, `cancelTask`, `listTasks`, `searchTasks`, `getTask`, `startPairing`, `listPairedDevices`, `unpair`.
  - Events from the harness: `taskStatusChanged`, `goalRestated` (OBJ-17), `questionAsked` (a model's ask action, which pauses for the user), `cursorCommand`, `approvalCancelled`, `interruptedTaskFound` (OBJ-06), `userError`, `waitingForWindow` (OBJ-08), `tilingSuggested` (OBJ-20), `routeDecided` (OBJ-07), `speak` (OBJ-05 summary).
  - Cross-device progress is a bridge message, not an RPC event, defined in [OBJ-25](OBJ-25-cross-device-messages.md).
- [x] **OBJ-01.12** Add a `protocolVersion` field, and a versioning section in `protocol/README.md`: how to bump the version, and what counts as a breaking change. Add the rule: an objective that adds or changes an RPC method updates the schema in `protocol/` in the same commit.
- [x] **OBJ-01.13** Generate TypeScript, Swift, and Kotlin types with one command, and add a check that fails if generated files are out of date.
- [x] **OBJ-01.14** Add example JSON files for each schema and a test that validates every example.
- [x] **OBJ-01.15** Update `protocol/README.md` with the layout, the generate command, and how other products import the types.
- [x] **OBJ-01.16** Add the contracts the parallel work split relies on that OBJ-01.11 does not list yet, each with a schema and an example:
  - Harness to Mac app: `listWindows`, `getWindowFrame`, `setWindowFrame` (window tiling and locks), and `storeSecret`, `loadSecret` (Keychain, used by the bridge client).
  - Events from the harness: `tilingSuggested`, `waitingForWindow`, `interruptedTaskFound`, `bridgeStateChanged`, the goal confirmation prompt and the user's reply, and `userError` carrying an `ErrorKind`.
- [x] **OBJ-01.17** Build two mock stand-ins in `protocol/mocks/`: a **mock harness** that serves the local socket, answers every harness method with example data, and plays scripted event sequences; and a **mock Mac app** that answers every Mac-side method with example data. The Mac app is built against the mock harness, and the harness against the mock Mac app, until the real ones exist. Mocks return the same shapes as the real side, including errors.
- [x] **OBJ-01.18** Document how to run each mock and how to script an event sequence.

## Expectations

- [x] Every shape in [docs/task-record-schema.md](../docs/task-record-schema.md) has a JSON Schema, or a written reason why it changed.
- [x] A `ModelAction` with fields from another variant fails validation.
- [x] An element action that names a path instead of a number fails validation.
- [x] A `WorkerOutput` with zero or two actions fails validation (supports SPEC-02 scenario "Worker returns an invalid action").
- [x] A shell command or AppleScript action fails validation (supports SPEC-05 scenario "Raw shell is not available").
- [x] A `move_to_trash` call with `~/Downloads/*.pdf` fails validation (supports SPEC-07 scenario "Wildcards are rejected").
- [x] An `Observation` with 201 elements fails validation.
- [x] Every row of the SPEC-11 table has an `ErrorKind` value.
- [x] Generated types compile in TypeScript, Swift, and Kotlin, and unions come out as real sum types.
- [x] One command regenerates all types, and the out-of-date check runs in CI or a pre-commit step.
- [x] Every RPC method and event in OBJ-01.11 and OBJ-01.16 has a schema and a valid example.
- [x] A client can connect to the mock harness, call every method, and receive a scripted event sequence. The mock Mac app answers every Mac-side method.

## Expected outcomes

- `protocol/schemas/*.json`: the source of truth.
- Generated types for TypeScript, Swift, and Kotlin, and the recorded generator choice.
- Example files and a validation test.
- An updated `protocol/README.md`.
- All cross-team RPC contracts, and the mock harness and mock Mac app in `protocol/mocks/`.

## Out of scope

- Bridge envelope and crypto: [OBJ-02](OBJ-02-bridge-envelope-and-crypto.md). Cross-device message kinds: [OBJ-25](OBJ-25-cross-device-messages.md).
- Storing records in SQLite: [OBJ-04](OBJ-04-task-store.md).
- Deciding permission levels at runtime and building approval text: [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) and [OBJ-38](OBJ-38-approvals-pause-and-action-log.md).

## Outcome

- **Result:** Done.
- **Delivered:**
  - `protocol/schemas/`: common, task, action, tools, observation, worker, approval, action-log, errors, and rpc schemas, with the full local RPC contract under `x-rpc` in `rpc.json`.
  - `protocol/examples/`: 101 examples, covering every object and union type and every union variant.
  - `protocol/src/`: `validate(typeName, value)` (Ajv, strict mode) and `RpcPeer`, the newline-delimited JSON-RPC peer that validates every message in both directions.
  - `protocol/generator/` and `protocol/generated/`: our own generator and the TypeScript, Swift, and Kotlin types.
  - `protocol/mocks/`: the mock harness, the mock Mac app, and three event scripts.
  - `protocol/scripts/`: `generate` (with `--check`) and the Docker compile checks.
  - `.github/workflows/protocol.yml`: CI for all of the above.
  - `protocol/README.md`: layout, commands, how to use the types, the local RPC rules, the mocks, the generator, and versioning.
- **Commits:** `feat(protocol): add task record schemas, validators, generated types, and mocks` and the docs commits around it on `main`.
- **Expectations:**
  - Every shape in the design doc has a schema; the changes are written into `docs/task-record-schema.md` and `docs/lane-router.md`.
  - Wrong-variant fields, a path instead of an element number, zero or two actions, shell or AppleScript, wildcard trash, and 201 elements each fail validation: `test/validation.test.ts`.
  - Every SPEC-11 row has an `ErrorKind`, read from the spec file itself: `test/error-kinds.test.ts`.
  - TypeScript compiles (`npm run typecheck`, with `test/types-check.ts` proving unions stay strict). Swift compiles in Swift 6 mode with warnings as errors (`npm run compile:swift`, swift:6.0.3 in Docker). Kotlin compiles with warnings as errors (`npm run compile:kotlin`, Kotlin 2.0.21 and kotlinx.serialization 1.7.3 in Docker). Both decode and re-encode all 101 examples unchanged.
  - `npm run generate` regenerates everything; `test/generated.test.ts` and `npm run check:generated` fail on stale output, and CI runs them.
  - Every method and event in OBJ-01.11 and OBJ-01.16 exists in `rpc.json` (read from this file by `test/rpc.test.ts`), and every params, result, and payload type has an example.
  - A client connects to the mock harness, calls every method, and receives a scripted sequence; the mock Mac app answers every harness-side method: `test/mocks.test.ts`. Both mocks were also run together from the command line.
- **Not verified:**
  - The CI workflow has not run on GitHub yet. It runs once this work is pushed.
  - Swift was compiled with the Linux toolchain in Docker, not Xcode on macOS. Patrick should add `YumiProtocol.swift` to the Mac app target and build it once (OBJ-14).
  - Kotlin was compiled for the JVM, not in an Android Gradle project. Check it once in the Android app (OBJ-22).
- **Decisions and deviations:**
  - Our own generator instead of quicktype, which turns every union into one struct with all fields optional.
  - In Swift, `Task` is `TaskRecord`. In Kotlin, `Target` is `AppTarget`, because `kotlin.annotation.Target` is imported in every Kotlin file. The JSON is the same everywhere.
  - Local RPC framing is one JSON message per line. A failed method answers JSON-RPC error `-32000` with a `UserError` as `data`.
  - `animateCursorTo` was folded into `executeAction`, which now requires a `cursorId`. `hello`, `ping`, `answerQuestion`, and `questionAsked` were added: OBJ-03, OBJ-14, and the model's ask action need them.
  - The p0 phone tool arguments (`set_alarm` with `time` as HH:MM, `set_timer`, `open_app` with `app`) are defined here as a closed union under the `phone` tool. OBJ-25 should reuse them, not redefine them.
  - `Path` rejects only `*` and `?`, so real names like `Invoice [2024].pdf` work.
  - `Step.observation` is optional, because the step row is written before the action runs (SPEC-02 r3). `Task.confirmedGoal` is required once the task leaves `awaitingConfirmation`.
  - Added `FinishStatus` (done or stuck), the `secureTextField` role (its value is never present), `openedSecondWindow` as a route reason, and `blocked` and `declined` step outcomes.
  - `scripts/objectives.py` skipped `node_modules` only on forward-slash paths. It now splits on the OS separator, so the check also passes on Windows.
- **For the next objectives:**
  - TypeScript products import types from `@yumi/protocol/types`, and `validate` and `RpcPeer` from `@yumi/protocol`. Validate every model output as `WorkerOutput`.
  - Kotlin decodes with `Json { explicitNulls = false }`.
  - The Mac app (OBJ-14 and OBJ-27) builds against `npm run mock:harness -- --script keynote-export`. The harness (OBJ-03 and later) builds against `npm run mock:mac`.
  - A new contract type needs an example file, or `test/examples.test.ts` fails. A new RPC method or event goes in `x-rpc` in the same commit.
  - OBJ-02 and OBJ-25 should add their schemas as new files in `protocol/schemas/`. They must follow the generator rules in the protocol README, then run `npm run generate` and both compile checks.
