# Yumi

Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
It can split into parallel "ghost" cursors and invisible helpers.
The Mac and the phone control each other through an end-to-end encrypted bridge on our VPS.
All AI runs on the devices.
The harness, not the model, owns planning state, routing, checkpoints, and safety.

## Repository map

| Path | What it is |
|---|---|
| [docs/](docs/yumi.md) | Design background: overview, lane router, task record schema, device bridge |
| [specs/](specs/README.md) | Requirement specs with Gherkin scenarios (what to build) |
| [objectives/](objectives/README.md) | Implementation objectives with tasks, expectations, and status (how we build it) |
| [protocol/](protocol/README.md) | Shared schemas and crypto: task records, actions, bridge messages |
| [harness/](harness/README.md) | The agent harness on the Mac (TypeScript): loop, task store, planner, lane router |
| [mac/](mac/README.md) | The Mac app (Swift): voice, cursors, screen capture, input, permissions |
| [android/](android/README.md) | The Android app (Kotlin): voice, on-device model, app control, bridge client |
| [iphone/](iphone/README.md) | The iPhone app (later, p2) |
| [bridge/](bridge/README.md) | The VPS relay between devices |
| [character/](character/README.md) | Yumi the cat: the Rive animation shared by Mac and Android |
| [models/](models/README.md) | Model selection, benchmarks, and the "Hey Yumi" wake word model |

## How the pieces fit

```
             Mac (16 GB)                                       Android (12 GB demo phone)
 ┌─────────────────────────────────────┐               ┌──────────────────────────────────┐
 │ mac (Swift)                         │               │ android (Kotlin)                 │
 │  voice, wake word, cat cursors,     │               │  voice, wake word, Qwen3.5-4B,   │
 │  screen capture, mouse, keyboard    │               │  accessibility control, intents  │
 │        ▲ local socket (JSON-RPC)    │               │                                  │
 │        ▼                            │               │                                  │
 │ harness (TypeScript)                │               │                                  │
 │  agent loop, task store, planner,   │               │                                  │
 │  lane router, Qwen3.5-9B via MLX    │               │                                  │
 └────────────────┬────────────────────┘               └───────────────┬──────────────────┘
                  │        end-to-end encrypted, signed messages       │
                  └──────────────────► bridge (VPS) ◄──────────────────┘
                              relay, store-and-forward, no plaintext
```

`protocol` defines every message that crosses these lines.
`character` provides the cat animation file both apps play.
`models` decides and produces the model files the apps load.

## Key decisions

- **Models:** Qwen3.5-9B on the Mac, Qwen3.5-4B on the Android demo phone. UI-TARS only as a fallback if it wins our own test.
- **Voice:** Whisper for Taglish, native on-device recognizers for quick English commands, never cloud. Wake word "Hey Yumi" with openWakeWord, plus push-to-talk.
- **Harness:** a fork of Pi's minimal agent loop in TypeScript, with a Swift app for native macOS work.
- **Bridge:** our VPS relays end-to-end encrypted messages. NetBird is for team access only, not device traffic.
- **Character:** Yumi is a playful cat, animated with a Rive state machine.
- **Platforms:** Mac and Android first, iPhone later.

Decisions and their reasons are recorded in each spec's "Decisions" section.

## For coding agents

1. Start at [objectives/README.md](objectives/README.md). Pick an objective whose dependencies are `done`.
2. Read the objective fully. It links the specs, docs, and product README you need.
3. Set its status to `in-progress` before starting, work through its tasks, and check them off.
4. Verify every item under "Expectations".
5. Fill in "Completion notes" and set the status to `done`.
6. Specs are the source of truth for behavior. If a spec and an objective disagree, the spec wins. Raise the conflict instead of guessing.

## Writing rules

- Never use the em dash. Use a plain dash.
- In long Markdown files, put each sentence on its own line.
- Users never see status codes, exception text, or vendor wording. See [SPEC-11](specs/11-user-facing-errors.md).
- Times shown to users use am/pm.
