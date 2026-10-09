# Yumi Protocol

Shared contracts that every other product depends on.
If two products exchange data, the shape of that data is defined here, once.

Owner: Jepoy.

Status: task record, action, tool, observation, approval, action log, error, and local RPC schemas are built ([OBJ-01](../objectives/OBJ-01-task-record-schemas.md)).
The bridge envelope, relay frames, pairing, crypto, and cross-device message kinds are built ([OBJ-02](../objectives/OBJ-02-bridge-envelope-and-crypto.md), [OBJ-25](../objectives/OBJ-25-cross-device-messages.md)).

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
| `src/` | `validate(typeName, value)`, cross-device payload and expiry checks (`src/messages.ts`), the local RPC peer (`src/rpc.ts`), and the reference bridge crypto (`src/crypto.ts`) for TypeScript products. |
| `docs/` | [crypto.md](docs/crypto.md) (keys, envelope sealing, expiry, test vectors) and [pairing.md](docs/pairing.md) (relay connection, pairing, delivery, unpairing). |
| `vectors/` | Cross-language crypto test vectors that the Swift and Kotlin clients must reproduce. |
| `examples/rpc-sequences/` | Local RPC sequences, one per spec scenario they cover, each checked against the contract. |
| `mocks/` | The mock harness and the mock Mac app, with scripted event sequences in `mocks/scripts/`. |
| `generator/` | Reads the schemas and writes the generated types. |
| `generated/ts/index.ts` | TypeScript types, for the harness and the bridge. |
| `generated/swift/YumiProtocol.swift` | Swift types, for the Mac app and later the iPhone app. |
| `generated/kotlin/yumi/protocol/YumiProtocol.kt` | Kotlin types (kotlinx.serialization), for the Android app. |
| `scripts/` | The generate command and the Swift and Kotlin compile checks. |
| `test/` | Validation, error kind, message, RPC, mock, example, sequence, and generator tests. |

| Schema file | Types |
|---|---|
| `common.json` | ProtocolVersion, PeerProtocolVersion, Uuid, DeviceId, Timestamp, Path, Lane, RouteReason, PermissionLevel, ResultStatus, StepOutcome |
| `task.json` | Task, TaskStatus, Subtask, SubtaskStatus, SubtaskResult, TargetApp, Target, Step, ToolOutput, WindowLock, AppCapability |
| `action.json` | ModelAction and its variants, AXRole, ResolvedElement, RecordedAction |
| `tools.json` | ToolName, ToolCall and one call type per typed tool, PhoneToolCall |
| `observation.json` | Observation, TreeElement, Layer, LayerKind |
| `worker.json` | WorkerInput, StepSummary, WorkerOutput |
| `plan.json` | Plan, PlannedSubtask, PlannedSubtaskId: what the planner model returns, checked by the harness before it is saved as Subtasks |
| `approval.json` | Approval, ApprovalKind, FileSummary, ApprovalDecision, ApprovalMethod |
| `action-log.json` | ActionLogEntry |
| `errors.json` | ErrorKind, UserError |
| `messages.json` | Payload and every encrypted cross-device message kind, plus phone tool descriptions and argument schemas |
| `rpc.json` | Every local RPC method and event (listed under `x-rpc`), with their params, results, and error data |
| `bridge.json` | Envelope, EnvelopeType, Signature, SealedPayload, Key32, DeviceName, DevicePlatform, PairingOffer, PairRequest, PairAccept, BridgeFrame and one frame type per variant, RefusedReason, the expiry constants, the pairing constants (`PairingOfferSeconds`, `PairingAnswerSeconds`), and `UnsupportedVersionRetrySeconds` |

## Cross-device messages

`Payload` in `schemas/messages.json` is the closed union encrypted inside an `Envelope`.
The payload `kind` must use the envelope type listed below; `replyTo` is carried separately inside the encrypted body for every result.
Results and events may be held by the relay for up to two minutes, but commands are never queued by the relay.
Goals that wait for an offline device stay on the origin device ([SPEC-09 r15](../specs/09-cross-device-routing.md)).

| Payload kind | Envelope type | Expiry policy | Direction / purpose |
|---|---|---|---|
| `toolList` | event | 2 minutes | Device advertises tool names, descriptions, and argument schemas on connect; the Mac adds its `wakeAddresses` |
| `toolCall` | command | 2 minutes | Brain calls one tool on its paired device |
| `toolResult` | result | 2 minutes | Tool provider returns success data or an `ErrorKind` |
| `delegateGoal` | command | 2 minutes | Origin sends the confirmed whole goal to the Mac while it is online |
| `goalAccepted` | result | 2 minutes | Mac says it started the goal, queued it behind the active task, or waits for the user to unlock it |
| `progress` | event | 2 minutes | Executing device reports changes and at least a 30-second heartbeat |
| `goalFinished` | event | 2 minutes | Executing device returns the final status and spoken summary, and for a failed goal its `UserError` |
| `approvalRequest` | command | 5 minutes | Executing device asks for approval on the origin device |
| `approvalResponse` | result | 2 minutes | Origin returns the decision; delete and unclassified-action approvals require a tap |
| `approvalCancelled` | event | 2 minutes | Executing device reports that a pause, or 5 minutes with no answer, cancelled the pending approval |
| `pause`, `resume`, `cancel` | command | 2 minutes | Either device controls a delegated goal |
| `pauseConfirmed`, `resumeConfirmed`, `cancelConfirmed` | result | 2 minutes | Executing device confirms the control action |
| `commandExpired` | result | 2 minutes | Receiver tells the sender that it did not run an expired command |
| `ping` | command | 2 minutes | Either device tests its peer connection |
| `pingResult` | result | 2 minutes | Peer answers the ping |

`validateMessagePayload(payload, envelopeType)` rejects unknown kinds and a kind carried under the wrong envelope type.
`getMessageExpiryKind(payload, envelopeType)` selects the matching generated expiry constant.
`validateMessageExpiry(payload, envelopeType, expiresAt, now)` rejects stale messages and expiries too far in the future.
`ApprovalKind` is `send`, `delete`, or `action` for one unclassified risky click or key press.
For `action`, the harness builds the safe summary from the resolved action, never from model text.
`isApprovalDecisionAllowed(approvalKind, decision)` is the receiver-side guard against approving a delete or `action` by voice.
The action approval's `text` is the safe summary the harness built from the resolved click or key press, never model text.
The `toolResult` schema rejects free-text failures; failures use `ErrorKind`.

Individual payload examples live in `examples/Payload.*.json` and `examples/PhoneTool*.json`.
The end-to-end JSON sequences in `examples/sequences/` cover the Mac-to-phone alarm, phone-to-Mac Keynote export, phone Stop with pause confirmation, and the edge cases below.
A step is either a payload in an envelope or a frame the relay sends itself (`"from": "relay"`), for example `targetOffline`.

Edge cases (SPEC-09 requirements 10 and 13 to 20, [OBJ-76](../objectives/OBJ-76-cross-device-edge-case-contracts.md)), each a sequence in `examples/sequences/`:

- **Presence.** There is no presence frame.
  A device knows its peer is back when the peer's `toolList` arrives, which every device sends on connect, or when a `ping` is answered by `pingResult` instead of the relay's `targetOffline`.
  The Mac answers each phone `toolList` with its own, so a phone that connects after the Mac still learns it is there and gets its `wakeAddresses`; the phone never answers the Mac's, so the two never loop.
  A phone holding a queued goal pings the Mac while it waits.
- **Mac offline** (`mac-offline.json`, SPEC-09 r15). The relay answers `delegateGoal` with `targetOffline` and never holds it, so the phone keeps the queued goal itself, one per origin device.
  When the Mac is back, the phone sends the goal as a new command, after asking again if it waited more than 30 minutes since `spokenAt`.
- **Mac busy** (`mac-busy.json`, r14). `goalAccepted` with `queued` and the running task's title; `progress` follows once the goal starts.
- **No reply** (r17). No `progress` for 2 minutes while a goal runs; the phone decides this from its own clock, with no message.
- **Stop with the Mac unreachable** (`stop-mac-unreachable.json`, r13). The relay answers `pause` with `targetOffline`, so no `pauseConfirmed` can come and the phone never shows "Paused".
- **No answer to an approval** (`approval-timeout.json`, r10). At `expiresAt` the Mac sends `approvalCancelled` and `progress` with `paused`.
- **Waking the Mac** (`mac-wakes-locked.json`, r19 and r20, p1). The phone sends Wake-on-LAN to the Mac's `wakeAddresses` from its last `toolList`, on the local Wi-Fi and outside the bridge.
  A Mac that is awake but locked answers `goalAccepted` with `waitingForUnlock` and starts the goal by itself once unlocked. Nothing in the protocol carries a password.

## Commands

Run from `protocol/` after `npm install`.

| Command | What it does |
|---|---|
| `npm run generate` | Regenerates every file under `generated/` from the schemas. Commit the result with the schema change. |
| `npm run check:generated` | Fails if `generated/` is out of date. The test suite checks this too. |
| `npm run vectors` | Rewrites `vectors/bridge-crypto-v2.json` from the reference crypto. The test suite fails if the file and the code disagree. |
| `npm run typecheck` | Type-checks the package, including `test/types-check.ts`, which proves unions stay strict. |
| `npm test` | Runs every test. |
| `npm run verify` | Typecheck and tests. `python3 scripts/verify.py` at the repo root runs it, with the generated-types check, for every commit that touches `protocol/` or `specs/`. |
| `npm run compile:swift` | Compiles the generated Swift in Docker (Swift 6 mode, warnings as errors) and round-trips every example through it. |
| `npm run compile:kotlin` | Compiles the generated Kotlin in Docker (warnings as errors) and round-trips every example through it. |
| `npm run mock:harness` | Starts the mock harness. See "Mocks". |
| `npm run mock:mac` | Starts the mock Mac app. See "Mocks". |

The compile checks need Docker.
Run them whenever a schema changes.
CI runs all of the above except the mocks ([.github/workflows/protocol.yml](../.github/workflows/protocol.yml)).

## Using the types

**TypeScript (harness, bridge)**

- Import types from `@yumi/protocol/types`, and validation and the RPC peer (`RpcPeer`, `RpcFailure`, `Handler`) from `@yumi/protocol`.
- Validate every value that crosses a process or device boundary, including every model output (`WorkerOutput`).
- Import the bridge crypto from `@yumi/protocol/crypto`: `generateDeviceKeys`, `sealEnvelope`, `openEnvelope`, `expiresAt`, `sealPairRequest`, `openPairRequest`, and the signing-bytes builders for relay authentication, pairing accept, and unpair.
- Import cross-device payload validation and expiry helpers from `@yumi/protocol/messages`.

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
  `HelloParams` accepts any version, so a Mac app on another version gets the harness's `UserError` (code `-32000`), not a `-32602` contract error.
- Either side calls the other's methods on the same connection; `x-rpc` in `schemas/rpc.json` says which side serves each method.
- Events are JSON-RPC notifications, and only the harness sends them.
- A method that fails answers with a JSON-RPC error (code `-32000`) whose `data` is a `UserError`.
  The message is for logs only and never reaches the user.
- Unknown methods answer `-32601`, and params that break the contract answer `-32602`.

This Mac's device id (SPEC-09, [OBJ-64](../objectives/OBJ-64-cross-device-local-rpc-contract.md)):

- Tasks and the action log name the device the user spoke to by its bridge device id, so a goal from the phone is told apart from one spoken on the Mac.
- The harness reports this Mac's bridge device id as the optional `deviceId` in `HelloResult` and in every `bridgeStateChanged`, with no extra method call.
  It is missing from `HelloResult` only on a first start, before the bridge client has loaded its keys; the next `bridgeStateChanged` carries it.
- The app sends it as `originDeviceId` in `submitGoal`, and `mac-local` only until the harness has reported one. The harness reads `mac-local` as this Mac too.
- Added in version 4 without a version change, since both properties are optional and older apps ignore them.

Goal changes during a task (SPEC-06 requirements 14 to 20, OBJ-60):

- The Mac pauses UI lanes with `pause(scope: uiLanes)` before it sends `reviseGoal` with the existing task id and what the user said.
- The harness returns the same `goalRestated` event used for a new goal; the task id identifies it as a revision, and the app sends `replyToConfirmation` as usual.
- In Auto mode, `goalRestated.autoMode` is true so the app shows the revised goal without asking for confirmation; the harness also sends `speak` with a short acknowledgement.
- `resumeTask` resumes after silence or "continue", `cancelTask` cancels on "cancel", and the app declines an open approval before it sends `reviseGoal`.
- `Task.goalRevisions` stores confirmed revisions in order; each records the user's words, the revised goal, and confirmation time, while `confirmedGoal` stays the latest and `goal` stays the original.
- Each confirmed revision adds an `ActionLogEntry` whose description starts with "Goal changed to".
- A revised plan retains matching completed work and active helpers, records obsolete subtasks as `cancelled`, and starts new subtasks from the current goal.
- `examples/rpc-sequences/` writes each SPEC-06 "Changing the goal mid-task" scenario, and Auto mode, as a message sequence; a test checks every message against the contract and that every scenario has one.
- The mock harness's `goal-revision` script repeats a revised goal back after `reviseGoal`.

Pausing, approvals, and blocked actions (SPEC-06, SPEC-07, [OBJ-38](../objectives/OBJ-38-approvals-pause-and-action-log.md)):

- `pause` takes an optional `scope`: `everyLane` (the default) for the stop shortcut and the menu bar "Stop", or `uiLanes` when the user takes over the mouse or keyboard, so helpers keep running.
- `showApprovalCard` resolves when the user answers, and the harness sends `approvalCancelled` when a pause or cancel drops the approval first; the app then closes the card and ignores a late tap.
- A blocked action is a `userError` of kind `blockedAction`. The app shows "Keep going", which calls `resumeTask`, and "Stop", which calls `cancelTask` (gap G6, resolved in OBJ-45).
  Its optional `skippedAction` names what was skipped in plain language ("click File in Keynote"), so the copy can say "I can't click File in Keynote."; without it the copy says "I can't do that." Added in version 4 without a version change, since older apps ignore it (SPEC-07 r5, decided 2026-10-10).

Cross-device routing on the Mac (SPEC-09 requirements 3, 8, and 10, [OBJ-64](../objectives/OBJ-64-cross-device-local-rpc-contract.md)):

- `HelloResult.deviceId` is this Mac's bridge device id, and `bridgeStateChanged` carries the same `deviceId` for an app that connected before the Mac had one.
  The app sends it as `SubmitGoalParams.originDeviceId`, so it never needs a method call of its own to learn it.
- A goal from the phone reaches the harness over the bridge, not from the app: the app sees no `goalRestated` and no `speak`, since the phone confirmed the goal and speaks the result, but it does see the task's status and its cursor.
- The harness never calls `showApprovalCard` for a task from another device (`x-rpc` says so on the method).
  Instead it sends `approvalWaitingElsewhere` with the approval id, task id, asking device, and approval kind, and the app shows only the banner "Waiting for your OK on your phone", with no buttons.
- `approvalAnsweredElsewhere` closes the banner once the other device answers, either way; `approvalCancelled` closes it too.
- The mock harness's `delegated-approval` script plays this on connect.

Debug mode (SPEC-07 r22 and r23, [OBJ-52](../objectives/OBJ-52-harness-debug-logs.md)):

- `setDebugMode` turns it on or off. The app sends it after every `hello` and whenever the user changes the setting, so the harness never keeps its own copy across restarts.
- With Debug mode on, the harness sends `workerThought` for each step: when the model has chosen the action, and again when the action has finished. Each event replaces the last one for its subtask. A cursor's thoughts panel finds it by `cursorId` and a helper chip's by `subtaskId`.
- `WorkerOutput.reason` is the model's one-sentence reason, asked for only in Debug mode. It never changes what runs.

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
Like the real Mac app, it answers for the app asked: it probes and versions the apps of the `AppCapability` examples, lists the windows of the `WindowList` example for the app asked, and opens a new window with a fresh id only for the apps the real app can (Chrome, Finder, and Mail), answering `supported: false` for the others.
`moveToTrash` answers for the exact paths it was given and moves nothing.
Tests can pass `answers` to `connectMockMacApp` to script a method, for example a "Don't delete" tap or To and Cc fields that change; scripted answers are still checked against the contract.

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
| `keynote-export` | Repeat-back, planning, the main cursor exporting a Keynote deck with one `workerThought`, and the spoken summary |
| `approval-and-question` | A question from the model, then a pause that cancels a pending approval |
| `windows-and-bridge` | Bridge state changes, a resumable task, a tiling suggestion, a busy window, and errors |
| `goal-revision` | A revised goal repeated back after `reviseGoal`, naming what was left behind |
| `delegated-approval` | A goal from the phone running on the Mac: its cursor, the approval banner while the phone asks, and the banner closing when the phone answers |

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
- The Mac app sends it in `hello`, and the harness refuses a different version with a `UserError`.
  `HelloParams.protocolVersion` is a `PeerProtocolVersion` (any positive integer), not the `ProtocolVersion` const, so that check is reachable.
- The same goes for the relay's `authenticate` frame and the pairing QR code (`PairingOffer`): a different version validates, so the relay answers `unsupportedVersion` and the phone shows "Pairing versions differ" ([docs/pairing.md](docs/pairing.md)).
  Envelopes, `HelloResult`, and everything else keep the `ProtocolVersion` const.
- Version 3 ([OBJ-29](../objectives/OBJ-29-protocol-mac-fixes.md)) fits the contracts to real macOS: `axPress` became `click`, the p1 vision `click` became `clickAt`, `AXRole` gained rows, cells, and scrollable containers, `Observation` gained `app`, `focused`, and `layer`, peers send a `PeerProtocolVersion` where the version is checked, `open_app` takes a `name`, `open_file` takes a `bundleId`, and keys gained `enter`.
- Bridge messages carry it in the envelope, and devices send it when they authenticate with the relay.
- The relay speaks one version and refuses any other with its own version in `refused`, so each device knows whether it or the relay needs an update ([docs/pairing.md](docs/pairing.md), "Another protocol version").
  So from version 4 on, the handshake frames `challenge`, `authenticate`, and `refused` only ever gain optional properties, and the relay's signed auth text never changes.
- A new version keeps every pairing, and devices keep their keys, so nobody pairs again after an update.
  A version that changes a frame the relay holds without expiry (an unpair) says how held frames are carried over.
- **Breaking changes bump the version:** removing or renaming a type, property, enum value, RPC method, or event; making an optional property required; tightening a rule so that values that used to validate no longer do.
- **Not breaking:** adding an optional property, a new type, a new RPC method or event, or loosening a rule.
  These still need a regenerate and a commit.
- An objective that adds or changes an RPC method or event updates `schemas/rpc.json` in the same commit.
- Products never hand-write a protocol type.

## Rules the schemas cannot express

Some rules need data from two messages, so JSON Schema cannot check them alone.
The harness applies them, and the schemas describe them:

- **No typing into a password field (SPEC-05 r7).** Before running a `type` action, the harness looks up `Observation.focused` in the elements it sent.
  If that element is a `secureTextField`, it refuses the action.
  It records the focused element as `RecordedAction.element`, and the schema rejects a `type` or `setValue` whose element is a `secureTextField`, so the Mac app never receives one.
- **Element numbers point into the tree.** `focused`, `layer.defaultButton`, and `layer.cancelButton` must be numbers of elements in the same observation.
- **Key aliases.** The harness normalizes common aliases before validating a `key` action (for example `Cmd+S` to `cmd+s`, `esc` to `escape`, `backspace` to `delete`). The schema accepts only the canonical, lower-case form.
- **Case-insensitive names.** Mac volumes are case-insensitive by default, so name clash checks (SPEC-07 r4) and checks for a file Yumi did not create compare names case-insensitively.
- **Packages are folders.** Documents such as `.key` and `.pages` can be packages, so file tools handle a folder at a path that looks like a file.
- **Approvals are asked on the origin device (SPEC-09 r10).** The harness calls `showApprovalCard` only for a task whose `originDeviceId` is this Mac.
  For a task from another device it sends `approvalWaitingElsewhere` instead, then `approvalAnsweredElsewhere` or `approvalCancelled` for the same approval.

## How macOS roles map

The Mac app maps `kAXRoleAttribute` and `kAXSubroleAttribute` (`AXRoleConstants.h` in the macOS SDK) to `AXRole`:

| macOS | `AXRole` |
|---|---|
| `AXButton`, `AXMenuItem`, `AXMenuBarItem`, `AXTextArea`, `AXLink`, `AXCheckBox`, `AXPopUpButton`, `AXComboBox`, `AXMenuButton`, `AXDisclosureTriangle` | The name without `AX`, lower camel case (`checkbox` for `AXCheckBox`) |
| `AXTextField` | `textField`, including a search field (subrole `AXSearchField`) |
| `AXTextField` with subrole `AXSecureTextField` | `secureTextField`; its value is never read |
| `AXRadioButton`, including a tab inside an `AXTabGroup` | `radioButton` |
| `AXRow` (subroles `AXTableRow`, `AXOutlineRow`), `AXCell` | `row`, `cell`; `click` selects them by setting `AXSelected`, because rows usually do not support `AXPress` |
| `AXScrollArea`, `AXTable`, `AXList`, `AXOutline` | `scrollArea`, `table`, `list`, `outline`, so the model can scroll the thing that scrolls |

`Observation.layer` is `sheet` for an `AXSheet`, `dialog` for a window with subrole `AXDialog` or `AXSystemDialog`, and `menu` for an open `AXMenu`.
An alert is reported as the `sheet` or `dialog` it is shown in, because macOS has no alert role or subrole.
A sheet usually has no `AXTitle`.
`defaultButton` and `cancelButton` come from `AXDefaultButton` and `AXCancelButton`, and `focused` from `AXFocusedUIElement`.

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
| [OBJ-25](../objectives/OBJ-25-cross-device-messages.md) | Cross-device message kinds | Jepoy | done |
| [OBJ-29](../objectives/OBJ-29-protocol-mac-fixes.md) | Protocol v3, fit the contracts to real macOS | Brent | done |
| [OBJ-31](../objectives/OBJ-31-unpair-delivery-ack-contract.md) | Define unpair delivery acknowledgement | Jepoy | done |
| [OBJ-33](../objectives/OBJ-33-pairing-response-timeout-contract.md) | Align the pairing response timeout contract | Jepoy | in-progress |
| [OBJ-34](../objectives/OBJ-34-protocol-version-upgrade-recovery.md) | Define protocol version upgrade recovery | Jepoy | in-progress |
| [OBJ-45](../objectives/OBJ-45-pause-scope-and-model-readiness-contracts.md) | Pause scope and model readiness contracts | Jepoy | in-progress |
| [OBJ-48](../objectives/OBJ-48-unpair-without-device-clocks.md) | Bind unpair to the pairing instead of device clocks | Jepoy | todo |
| [OBJ-56](../objectives/OBJ-56-unclassified-action-approval-contract.md) | Approval contract for unclassified risky actions | Jepoy | blocked |
| [OBJ-60](../objectives/OBJ-60-goal-revision-contract.md) | Contract for changing the goal mid-task | Jepoy | in-progress |
| [OBJ-64](../objectives/OBJ-64-cross-device-local-rpc-contract.md) | Local RPC for cross-device routing on the Mac | Jepoy | done |
| [OBJ-76](../objectives/OBJ-76-cross-device-edge-case-contracts.md) | Contracts for SPEC-09 edge cases and waking the Mac | Jepoy | in-progress |
<!-- generated:product-objectives:end -->
