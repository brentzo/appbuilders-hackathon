# Yumi Protocol

Shared contracts that every other product depends on.
If two products exchange data, the shape of that data is defined here, once.

Owner: Jepoy.

Status: empty scaffold, nothing built yet.

## Responsibilities

- **Task record schemas:** Task, Subtask, Step, WindowLock, AppCapability, Approval, and ActionLogEntry ([task-record-schema](../docs/task-record-schema.md)).
- **Action and tool schemas:** the action the model outputs (elements by number), the resolved action the harness records, the trimmed accessibility tree the model sees, and one argument schema per typed tool. No shell or AppleScript.
- **Error kinds:** one value per row of the [SPEC-11](../specs/11-user-facing-errors.md) error table, shared by every product.
- **Local RPC schemas:** every method and event between the harness and the native apps.
- **Bridge schemas:** the message envelope, and every message kind sent between devices: tool calls, delegated goals, progress, approvals, pause and cancel ([device-bridge](../docs/device-bridge.md)).
- **Crypto rules:** pairing, key types, encryption, and signatures for bridge messages, plus a reference TypeScript implementation.
- **Mock stand-ins:** a mock harness and a mock Mac app that answer every contract with example data, so each person can build without waiting for the others.
- **Generated types:** TypeScript, Swift, and Kotlin types generated from the schemas, so no product hand-writes them.

## Not responsible for

- Transport code (sockets, retries). That lives in each product.
- Business logic. Schemas only describe shapes and rules.

## Initial technical plan

- JSON Schema files are the source of truth.
- Generate TypeScript types (for harness and bridge), Swift types (for mac), and Kotlin types (for android). quicktype or json-schema-to-typescript are candidates.
- Crypto uses libsodium everywhere: X25519 key exchange with XChaCha20-Poly1305 for encryption, Ed25519 for signatures. Libraries: libsodium-wrappers (TypeScript), swift-sodium (Swift), lazysodium (Kotlin).
- Every schema change is versioned. Breaking changes bump the protocol version carried in each message.

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

| ID | Objective | Status |
|---|---|---|
| [OBJ-01](../objectives/OBJ-01-task-record-schemas.md) | Task record schemas and cross-team contracts (assigned to Brent) | in-progress |
| [OBJ-02](../objectives/OBJ-02-bridge-envelope-and-crypto.md) | Bridge envelope and end-to-end crypto | todo |
| [OBJ-25](../objectives/OBJ-25-cross-device-messages.md) | Cross-device message kinds | todo |
