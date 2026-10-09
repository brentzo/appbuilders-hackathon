# Yumi Protocol

Shared contracts that every other product depends on.
If two products exchange data, the shape of that data is defined here, once.

Owner: Jepoy.

Status: task record, action, tool, observation, approval, action log, error, and local RPC schemas are built ([OBJ-01](../objectives/OBJ-01-task-record-schemas.md)).
The bridge envelope, relay frames, pairing, and crypto are built ([OBJ-02](../objectives/OBJ-02-bridge-envelope-and-crypto.md)).
Cross-device message kinds are next ([OBJ-25](../objectives/OBJ-25-cross-device-messages.md)).

## Responsibilities

- **Task record schemas:** Task, Subtask, Step, WindowLock, AppCapability, Approval, and ActionLogEntry ([task-record-schema](../docs/task-record-schema.md)).
- **Action and tool schemas:** the action the model outputs (elements by number), the resolved action the harness records, the trimmed accessibility tree the model sees, and one argument schema per typed tool, with no shell or AppleScript.
- **Error kinds:** one value per row of the [SPEC-11](../specs/11-user-facing-errors.md) error table, shared by every product.
- **Local RPC schemas:** every method and event between the harness and the native apps.
- **Bridge schemas:** the message envelope, and every message kind sent between devices: tool calls, delegated goals, progress, approvals, pause and cancel ([device-bridge](../docs/device-bridge.md)).
- **Crypto rules:** pairing, key types, encryption, and signatures for bridge messages, plus a reference TypeScript implementation.
- **Mock stand-ins:** a mock harness and a mock Mac app that answer every contract with example data, so each person can build without waiting for the others.
- **Generated types:** TypeScript, Swift, and Kotlin types generated from the schemas, so no product hand-writes them.

## Not responsible for

- Transport code (sockets, retries), which lives in each product.
- Business logic: schemas only describe shapes and rules.

## Layout

| Path | What it is |
|---|---|
| `schemas/*.json` | JSON Schema (draft 2020-12), the source of truth. Related types are grouped under `$defs`, and type names are unique across files. |
| `examples/<Type>.<label>.json` | Example values. Every object and union type has one, every union variant appears in one, and every one must validate. |
| `src/` | `validate(typeName, value)`, the local RPC peer (`src/rpc.ts`), and the reference bridge crypto (`src/crypto.ts`) for TypeScript products. |
| `docs/` | [crypto.md](docs/crypto.md) (keys, envelope sealing, expiry, test vectors) and [pairing.md](docs/pairing.md) (relay connection, pairing, delivery, unpairing). |
| `vectors/` | Cross-language crypto test vectors that the Swift and Kotlin clients must reproduce. |
| `mocks/` | The mock harness and the mock Mac app, with scripted event sequences in `mocks/scripts/`. |
| `generator/` | Reads the schemas and writes the generated types. |
| `generated/ts/index.ts` | TypeScript types, for the harness and the bridge. |
| `generated/swift/YumiProtocol.swift` | Swift types, for the Mac app and later the iPhone app. |
| `generated/kotlin/yumi/protocol/YumiProtocol.kt` | Kotlin types (kotlinx.serialization), for the Android app. |
| `scripts/` | The generate command and the Swift and Kotlin compile checks. |
| `test/` | Validation, error kind, RPC, mock, example, and generator tests. |

| Schema file | Types |
|---|---|
| `common.json` | ProtocolVersion, Uuid, DeviceId, Timestamp, Path, Lane, RouteReason, PermissionLevel, ResultStatus, StepOutcome |
| `task.json` | Task, TaskStatus, Subtask, SubtaskStatus, SubtaskResult, Target, Step, WindowLock, AppCapability |
| `action.json` | ModelAction and its variants, AXRole, ResolvedElement, RecordedAction |
| `tools.json` | ToolName, ToolCall and one call type per typed tool, PhoneToolCall |
| `observation.json` | Observation, TreeElement |
| `worker.json` | WorkerInput, StepSummary, WorkerOutput |
| `approval.json` | Approval, ApprovalKind, FileSummary, ApprovalDecision, ApprovalMethod |
| `action-log.json` | ActionLogEntry |
| `errors.json` | ErrorKind, UserError |
| `rpc.json` | Every local RPC method and event (listed under `x-rpc`), with their params, results, and error data |
| `bridge.json` | Envelope, EnvelopeType, Signature, SealedPayload, Key32, DeviceName, DevicePlatform, PairingOffer, PairRequest, PairAccept, BridgeFrame and one frame type per variant, RefusedReason, and the expiry constants |

## Commands

Run from `protocol/` after `npm install`.

| Command | What it does |
|---|---|
| `npm run generate` | Regenerates every file under `generated/` from the schemas. Commit the result with the schema change. |
| `npm run check:generated` | Fails if `generated/` is out of date. The test suite checks this too. |
| `npm run vectors` | Rewrites `vectors/bridge-crypto-v2.json` from the reference crypto. The test suite fails if the file and the code disagree. |
| `npm run typecheck` | Type-checks the package, including `test/types-check.ts`, which proves unions stay strict. |
| `npm test` | Runs every test. |
| `npm run verify` | Typecheck and tests. Run it before every commit that touches `protocol/`. |
| `npm run compile:swift` | Compiles the generated Swift in Docker (Swift 6 mode, warnings as errors) and round-trips every example through it. |
| `npm run compile:kotlin` | Compiles the generated Kotlin in Docker (warnings as errors) and round-trips every example through it. |
| `npm run mock:harness` | Starts the mock harness. See "Mocks". |
| `npm run mock:mac` | Starts the mock Mac app. See "Mocks". |

The compile checks need Docker.
Run them whenever a schema changes.
CI runs all of the above except the mocks ([.github/workflows/protocol.yml](../.github/workflows/protocol.yml)).

## Using the types

**TypeScript (harness, bridge)**

- Import types from `@yumi/protocol/types` and validation from `@yumi/protocol`.
- Validate every value that crosses a process or device boundary, including every model output (`WorkerOutput`).
- Import the bridge crypto from `@yumi/protocol/crypto`: `generateDeviceKeys`, `sealEnvelope`, `openEnvelope`, `expiresAt`, `sealPairRequest`, `openPairRequest`, and the signing-bytes builders for relay authentication, pairing accept, and unpair.

**Swift (Mac app)**

- Add `generated/swift/YumiProtocol.swift` to the target, and decode with a plain `JSONDecoder`.
- `Task` is generated as `TaskRecord`, so it never clashes with Swift's `Task`.
- Primitive aliases such as `Path` and `Uuid` are plain `String`, so they never clash with SwiftUI's `Path`.

**Kotlin (Android app)**

- Add `generated/kotlin` as a source folder, with the kotlinx.serialization plugin.
- Decode with `Json { explicitNulls = false }`.
- `Target` is generated as `AppTarget`, so it never clashes with `kotlin.annotation.Target`, which every Kotlin file imports.

Every union carries its variant in a discriminator property (`kind`, `tool`, or `command`).
It decodes to a TypeScript discriminated union, a Swift enum with associated values, and a Kotlin sealed interface.
Renames only change the type name in one language; the JSON is the same everywhere.

## Local RPC

The harness and the Mac app talk JSON-RPC 2.0 over a Unix socket, one JSON message per line.

- The harness listens, at `~/Library/Application Support/Yumi/harness.sock` on the Mac.
- The Mac app connects and calls `hello` with its protocol version first.
- Either side calls the other's methods on the same connection; `x-rpc` in `schemas/rpc.json` says which side serves each method.
- Events are JSON-RPC notifications, and only the harness sends them.
- A method that fails answers with a JSON-RPC error (code `-32000`) whose `data` is a `UserError`.
  The message is for logs only and never reaches the user.
- Unknown methods answer `-32601`, and params that break the contract answer `-32602`.

`src/rpc.ts` implements this for TypeScript (`RpcPeer`) and validates every message in both directions.
The Swift and Kotlin sides follow the same rules.

## Mocks

The mocks are stand-ins that honor the local RPC contract, so the Mac app and the harness can be built before each other exists.
They answer with the example files, return the same error shapes as the real side, and print every call with a `[mock harness]` or `[mock Mac app]` prefix, so nobody demos a mock by accident.

**Mock harness:** for building the Mac app before the real harness exists.

```
npm run mock:harness -- --script keynote-export
```

It listens where the real harness does, answers every method the Mac app can call, and plays the script.

**Mock Mac app:** for building the harness before the real Mac app exists.

```
npm run mock:mac
```

It connects to the harness, says `hello`, logs every event, and answers every method the harness can call.

Options for both:

| Option | Meaning |
|---|---|
| `--socket <path>` | Socket path. Defaults to the harness's path (a named pipe on Windows). |
| `--fail method=kind,...` | Make methods fail with an `ErrorKind`, for example `--fail submitGoal=bridgeDown`. |
| `--script <name>` | Mock harness only: the event script to play. |
| `--speed <factor>` | Mock harness only: multiply script delays, for example `0.2` for five times faster. |

**Scripts** live in `mocks/scripts/<name>.json`:

```json
{
  "description": "What the script shows.",
  "trigger": "submitGoal",
  "events": [
    { "afterMs": 300, "event": "goalRestated", "payload": { "taskId": "...", "text": "..." } },
    { "afterMs": 100, "event": "speak", "example": "Speak.summary" }
  ]
}
```

- `trigger` is `connect` (play after `hello`) or the name of a method the Mac app calls.
- Each event waits `afterMs` after the previous one.
- An event gives either an inline `payload` or the name of an example file (`Type.label`).
- Every event is checked against the contract when the script loads, and a test loads every script.

| Script | Shows |
|---|---|
| `keynote-export` | Repeat-back, planning, the main cursor exporting a Keynote deck, and the spoken summary |
| `approval-and-question` | A question from the model, then a pause that cancels a pending approval |
| `windows-and-bridge` | Bridge state changes, a resumable task, a tiling suggestion, a busy window, and errors |

## Generator

The types come from our own small generator in `generator/`, not quicktype.
quicktype was tried first (OBJ-01.1).
It turns every `oneOf` into one struct with every field optional, in all three languages, so a `finish` action with an `element` would type-check.
Our generator accepts only the schema subset that maps faithfully to all three languages, and throws on anything else:

- An object must set `additionalProperties: false`, and nested objects must be named types in `$defs`.
- A union is a `oneOf` of named object types with a `discriminator`, and each variant has a required `const` for that property.
  A `const` property anywhere else is an error.
- Enums are string enums.
- Constraint-only keywords (`pattern`, `minimum`, `maxItems`, `if`/`then`, `allOf`, and similar) are enforced by Ajv and do not change the types.

## Versioning

- `ProtocolVersion` in `common.json` is the version of these schemas, generated as `PROTOCOL_VERSION` in every language.
- The Mac app sends it in `hello`, and the harness refuses a different version.
- Bridge messages carry it in the envelope, and devices send it when they authenticate with the relay.
- **Breaking changes bump the version:** removing or renaming a type, property, enum value, RPC method, or event; making an optional property required; tightening a rule so that values that used to validate no longer do.
- **Not breaking:** adding an optional property, a new type, a new RPC method or event, or loosening a rule.
  These still need a regenerate and a commit.
- An objective that adds or changes an RPC method or event updates `schemas/rpc.json` in the same commit.
- Products never hand-write a protocol type.

## Bridge crypto

- libsodium everywhere: X25519 key exchange (`crypto_kx`), XChaCha20-Poly1305 encryption, and Ed25519 signatures.
- Libraries: libsodium-wrappers (TypeScript), swift-sodium (Swift), and lazysodium (Kotlin).
- The details, the library function for each step, and the test vectors are in [docs/crypto.md](docs/crypto.md).
- The relay connection and pairing are in [docs/pairing.md](docs/pairing.md).

## Used by

[harness](../harness/README.md), [mac](../mac/README.md), [android](../android/README.md), [bridge](../bridge/README.md), later [iphone](../iphone/README.md).

## Specs

- [SPEC-02 Task lifecycle and resume](../specs/02-task-lifecycle.md)
- [SPEC-05 Mac GUI control](../specs/05-mac-gui-control.md) (actions, trimmed tree, typed tools, structured result)
- [SPEC-07 Safety and action log](../specs/07-safety.md) (permission levels, approvals, action log)
- [SPEC-08 Device bridge](../specs/08-device-bridge.md)
- [SPEC-09 Cross-device routing](../specs/09-cross-device-routing.md) (message kinds)
- [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md) (error kinds)

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-01](../objectives/OBJ-01-task-record-schemas.md) | Task record schemas and cross-team contracts | Jepoy | done |
| [OBJ-02](../objectives/OBJ-02-bridge-envelope-and-crypto.md) | Bridge envelope and end-to-end crypto | Jepoy | done |
| [OBJ-25](../objectives/OBJ-25-cross-device-messages.md) | Cross-device message kinds | Jepoy | todo |
<!-- generated:product-objectives:end -->
