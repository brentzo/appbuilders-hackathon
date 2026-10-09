# Yumi

Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
It can split into parallel "ghost" cursors and invisible helpers.
The Mac and the phone control each other through an end-to-end encrypted bridge on our VPS.
All AI runs on the devices.
The harness, not the model, owns planning state, routing, checkpoints, and safety.

## Try Yumi

Judges and anyone new: start with the [setup guide](wiki/judges-setup.md).
It has four paths, from quickest to fullest:

1. **The Mac app with the scripted harness:** the whole interface in about 15 minutes, with no model download.
2. **The real harness and model:** Qwen3.5-9B running on your Mac through mlx-vlm.
3. **The Android app:** build and install the phone app, with push-to-talk and the wake word.
4. **The tests:** every product's checks, on macOS, Linux, or Windows.

The quickest start, on a Mac with Apple silicon, Xcode 26, and Node.js 24:

```sh
git clone https://github.com/brentzo/appbuilders-hackathon.git
cd appbuilders-hackathon
(cd protocol && npm install) && (cd harness && npm install)
cd mac && cp Signing.local.xcconfig.example Signing.local.xcconfig   # then set your team ID in it
xcodebuild -project Yumi.xcodeproj -scheme Yumi -configuration Release -derivedDataPath build build
open build/Build/Products/Release/Yumi.app --args -YumiMockHarness YES
```

Then choose "Send sample goal to the mock" in Yumi's menu bar menu, or hold ⌥Space and say a goal.

Yumi is a hackathon build and some parts are still being finished.
[Demo readiness](wiki/demo-readiness.md) says what works end to end today.

## Repository map

| Path | What it is |
|---|---|
| [docs/](docs/yumi.md) | Design background: overview, lane router, task record schema, device bridge |
| [specs/](specs/README.md) | Requirement specs with Gherkin scenarios (what to build) |
| [objectives/](objectives/README.md) | Implementation objectives with tasks, expectations, and status (how we build it) |
| [wiki/](wiki/README.md) | Reports and guides: the setup guide for judges, demo readiness, and what was measured |
| [protocol/](protocol/README.md) | Shared schemas and crypto: task records, actions, bridge messages |
| [harness/](harness/README.md) | The agent harness on the Mac (TypeScript): loop, task store, planner, lane router |
| [mac/](mac/README.md) | The Mac app (Swift): voice, cursors, screen capture, input, permissions |
| [android/](android/README.md) | The Android app (Kotlin): voice remote and phone tools first (p0), its own model and app control later (p1) |
| [iphone/](iphone/README.md) | The iPhone app (later, p2) |
| [bridge/](bridge/README.md) | The VPS relay between devices |
| [character/](character/README.md) | Yumi the cat: the Rive animation shared by Mac and Android |
| [models/](models/README.md) | Model selection, benchmarks, and the "Hey Yumi" wake word model |

## How the pieces fit

```
             Mac (16 GB)                                       Android (12 GB demo phone)
 ┌─────────────────────────────────────┐               ┌──────────────────────────────────┐
 │ mac (Swift)                         │               │ android (Kotlin)                 │
 │  voice, wake word, cat cursors,     │               │  voice, wake word, phone tools,  │
 │  screen capture, mouse, keyboard    │               │  intents, app control (p1)       │
 │        ▲ local socket (JSON-RPC)    │               │                                  │
 │        ▼                            │               │                                  │
 │ harness (TypeScript)                │               │                                  │
 │  agent loop, task store, planner,   │               │                                  │
 │  lane router, Qwen3.5-9B via MLX    │               │                                  │
 └────────────────┬────────────────────┘               └───────────────┬──────────────────┘
                  │        end-to-end encrypted, signed messages       │
                  └──────────────────► bridge (VPS) ◄──────────────────┘
                              relay, offline notices, no plaintext 
```

`protocol` defines every message that crosses these lines.
`character` provides the cat animation file both apps play.
`models` decides and produces the model files the apps load.

## Key decisions

- **Models:** Qwen3.5-9B on the Mac. The Android phone has no model at first (p0) and delegates to the Mac; its own model comes later (p1). UI-TARS only as a fallback if it wins our own test.
- **Voice:** Whisper for Taglish, native on-device recognizers for quick English commands, never cloud. Wake word "Hey Yumi" with openWakeWord, plus push-to-talk.
- **Harness:** a fork of Pi's minimal agent loop in TypeScript, with a Swift app for native macOS work.
- **Bridge:** our VPS relays end-to-end encrypted messages. NetBird is for team access only, not device traffic.
- **Character:** Yumi is a playful cat, animated with a Rive state machine.
- **Platforms:** Mac and Android first, iPhone later.

Decisions and their reasons are recorded in each spec's "Decisions" section.

## For coding agents

Read [AGENTS.md](AGENTS.md) first in Codex, or [CLAUDE.md](CLAUDE.md) in Claude Code.
The repository skills in [.agents/skills/](.agents/skills/) and [.claude/skills/](.claude/skills/) describe how we work: objectives, specs, products, git, orchestration, contracts and stand-ins, user-facing errors, and grounding facts.

## Writing rules

- Never use the em dash. Use a plain dash.
- In long Markdown files, put each sentence on its own line.
- Users never see status codes, exception text, or vendor wording. See [SPEC-11](specs/11-user-facing-errors.md).
- Times shown to users use am/pm.
