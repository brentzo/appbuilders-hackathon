# Yumi Protocol

Shared contracts that every other product depends on.
If two products exchange data, the shape of that data is defined here, once.

Status: empty scaffold, nothing built yet.

## Responsibilities

- **Task record schemas:** Task, Subtask, Step, Action, WindowLock, AppCapability ([task-record-schema](../docs/task-record-schema.md)).
- **Local RPC schemas:** messages between the harness and the native apps (execute an action, capture the screen, task and cursor events).
- **Bridge schemas:** the message envelope, message types, and payloads sent between devices ([device-bridge](../docs/device-bridge.md)).
- **Crypto rules:** pairing, key types, encryption, and signatures for bridge messages, plus a reference TypeScript implementation.
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
- [SPEC-08 Device bridge](../specs/08-device-bridge.md)

## Objectives

| ID | Objective | Status |
|---|---|---|
| [OBJ-01](../objectives/OBJ-01-task-record-schemas.md) | Task record and action schemas | todo |
| [OBJ-02](../objectives/OBJ-02-bridge-envelope-and-crypto.md) | Bridge envelope and end-to-end crypto | todo |
