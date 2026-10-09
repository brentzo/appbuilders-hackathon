# Yumi Harness

The brain-side runtime on the Mac.
It runs the agent loop, owns all task state, plans goals into subtasks, routes subtasks to lanes, and talks to the local model, the Mac app, and the bridge.
The model is stateless; everything that makes Yumi feel long-running and reliable lives here.

Status: empty scaffold, nothing built yet.

## Responsibilities

- **Agent loop:** call the model, validate its output, run the tool, record the result, repeat ([SPEC-02](../specs/02-task-lifecycle.md)).
- **Model client:** talk to the local Qwen3.5-9B server through an OpenAI-compatible API.
- **Task store:** tasks, subtasks, steps, locks, and the action log in SQLite, kept forever.
- **Planner and scheduler:** split a confirmed goal into subtasks with dependencies and run independent ones in parallel.
- **Resume and limits:** checkpoints, crash and reboot resume, step and attempt limits.
- **Lane router:** decide helper, ghost, or main for each subtask, with window locks, busy-window handling, and the cursor cap ([SPEC-03](../specs/03-lane-routing.md)).
- **Bridge client:** connect the Mac to the VPS bridge, encrypt and sign messages ([SPEC-08](../specs/08-device-bridge.md)).
- **Local RPC server:** the Mac app connects to the harness over a local socket.

## Not responsible for

- Anything native to macOS: screen capture, accessibility, mouse and keyboard, overlay cursors, microphone, speech. The [mac](../mac/README.md) app does these when the harness asks.
- Drawing anything. The harness sends events; the Mac app renders them.

## Initial technical plan

- TypeScript on Node.js (current LTS).
- Fork the agent loop from Pi (`@mariozechner/pi-agent-core`, MIT). The package may now be published under an `earendil-works` scope, so check npm. Replace Pi's coding tools with Yumi's tools.
- Model server: an OpenAI-compatible MLX server running Qwen3.5-9B at 4-bit (mlx-vlm or mlx-lm server; confirm Qwen3.5 vision support). Use structured output when the server supports it, and always validate against JSON Schema.
- SQLite for the task store.
- JSON-RPC 2.0 over a Unix domain socket for the Mac app.
- Types come from [protocol](../protocol/README.md). Never hand-write a schema type here.

## Interfaces

| With | How | What |
|---|---|---|
| [mac](../mac/README.md) | Local socket, JSON-RPC | Harness asks Mac to execute actions and capture screens; Mac sends voice input, confirmations, and user interrupts; harness sends task and cursor events |
| Local model server | HTTP, OpenAI-compatible | Planning, tool calls, GUI steps |
| [bridge](../bridge/README.md) | WebSocket over TLS | Encrypted messages to and from the phone |

## Specs

- [SPEC-02 Task lifecycle and resume](../specs/02-task-lifecycle.md)
- [SPEC-03 Lane routing and handoff](../specs/03-lane-routing.md)
- [SPEC-08 Device bridge](../specs/08-device-bridge.md)
- Also follows [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md) for any message a user can see.

## Objectives

| ID | Objective | Status |
|---|---|---|
| [OBJ-03](../objectives/OBJ-03-harness-skeleton.md) | Harness skeleton and local model client | todo |
| [OBJ-04](../objectives/OBJ-04-task-store.md) | Task store and history | todo |
| [OBJ-05](../objectives/OBJ-05-planner-and-scheduler.md) | Planner, scheduler, and task summary | todo |
| [OBJ-06](../objectives/OBJ-06-resume-and-limits.md) | Resume and limits | todo |
| [OBJ-07](../objectives/OBJ-07-lane-router-core.md) | Lane router core | todo |
| [OBJ-08](../objectives/OBJ-08-locks-busy-windows-cap.md) | Window locks, busy windows, and cursor cap | todo |
| [OBJ-09](../objectives/OBJ-09-ghost-handoff.md) | Ghost handoff | todo |
| [OBJ-21](../objectives/OBJ-21-mac-bridge-client-and-pairing.md) | Mac bridge client and pairing | todo |
