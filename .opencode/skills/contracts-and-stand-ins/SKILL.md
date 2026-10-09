---
name: contracts-and-stand-ins
description: How Yumi products talk to each other through contracts in protocol/ and how to build against stand-ins (mock harness, mock Mac app, placeholder assets, default models) before the real thing exists. Use whenever code crosses a product boundary (harness and Mac app, harness and bridge, phone and bridge), when an objective lists integrates-with, or when you are tempted to hand-write a type another product also uses.
---

# Contracts and stand-ins

Yumi is built by several people at once.
Products never reach into each other's code; they meet at contracts.
Until the other side exists, you build against a stand-in that honors the same contract.

## Contracts live in protocol/

- Every message, request, response, and event that crosses a product boundary has a JSON Schema in `protocol/schemas/` and a valid example.
- Types for TypeScript, Swift, and Kotlin are generated from the schemas. Never hand-write a contract type in a product; import the generated one.
- Error results carry a structured kind (matching the SPEC-11 table), never free text meant for users.
- The protocol product's README documents the layout, the generate command, and versioning.

If `protocol/` does not have what you need yet:

1. Do not invent the shape inside your product and hope it matches.
2. Write down the shape you need (fields, types, an example) and raise it with the protocol owner (see the owners table in `objectives/README.md`).
3. If you must move before it lands, keep your temporary types in one file, clearly marked as temporary until the protocol types exist, and list the swap as a task.

## Changing a contract

- Contract changes go through the protocol product, in a protocol commit, never as a side effect of another objective.
- Bump the protocol version for breaking changes and tell every consumer (search for the type name across products).
- Regenerate types and update examples in the same commit.

## Stand-ins

`integrates-with` in an objective means: build against a stand-in now, connect to the real thing later. It is never a reason to wait.

| Real thing | Stand-in |
|---|---|
| The harness (OBJ-03 and later) | The mock harness in `protocol/mocks/` (answers every harness method, plays scripted events) |
| The Mac app's native services (OBJ-27) | The mock Mac app in `protocol/mocks/` |
| The trained "Hey Yumi" model (OBJ-12) | An openWakeWord pre-trained model, for example "hey jarvis" |
| The Whisper bake-off result (OBJ-11) | Whisper large-v3-turbo |
| The Rive cat (OBJ-10) | A static placeholder image behind the same interface |

Rules:

- Put each stand-in behind the same interface the real thing will use, so swapping is a one-line or one-file change.
- Make the stand-in obvious in code and in the UI where relevant (a log line or a debug label), so nobody demos a mock by accident.
- Add a task to swap in the real thing, and check it before calling the objective done if the real thing exists by then.
- When the real thing lands, run the same expectations against it and record the result in the Outcome.

## Mocks must be honest

- A mock returns the same shapes, including the same error shapes, that the real side returns. A friendlier mock hides real failures.
- When the real side lands and differs from the mock, fix the mock in `protocol/mocks/`, not the consumer's workaround.
