# Yumi

Yumi is a voice-driven AI companion for the Mac that does real work in your apps, and all of its AI runs on your own devices.
You say "Hey Yumi" or hold ⌥Space, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work in your apps the way a person would.
An Android phone works as a voice remote for it, through an end-to-end encrypted relay.
The harness, not the model, owns planning state, routing, checkpoints, and safety.
It was built for a local-AI hackathon.

## The demo in one paragraph

You pick up the phone and say a goal.
The phone repeats it back, you tap Send, and the goal travels encrypted to the Mac, where a cat cursor appears and starts working while the phone shows "Working on your Mac" with the current step and a Stop button.
On the Mac you ask Yumi to export a Keynote deck as a PDF: it repeats the goal, you say "Go ahead", and the cat opens File, Export To, PDF, names the file, saves it, and tells you where.
You ask it to list the files in a folder, and it offers to put the list in a new note, then opens Notes and types it in.
Grab the mouse or press Control-Option-Escape and every cat freezes; press Resume and it carries on.
More cats, called ghosts, can work in other windows at the same time, and sends and deletes always stop for an approval card you tap.
The planned opener, "Hey Yumi, open my Spotify and play a playlist", is being fixed now: Spotify draws its own interface, so Yumi has to click from a screenshot ([OBJ-75](objectives/OBJ-75-vision-fallback.md)).
[The demo script](wiki/demo-script.md) has the exact lines, what you should see, and a fallback for each step.

## Why it is local

- **The model runs on the Mac.** Qwen3.5-9B at 4-bit plans and picks every action, served by mlx-vlm on `127.0.0.1:8080`, so nothing on the network can reach it.
- **Speech runs on the devices.** On the Mac: Apple's on-device recognizer, or Whisper large-v3-turbo through WhisperKit for Taglish, and Kokoro-82M for Yumi's voice. On the phone: Android's on-device recognizer. "Hey Yumi" is spotted on each device.
- **The relay only carries sealed messages.** The Mac and the phone encrypt and sign every message end to end; the relay on our VPS routes them and cannot read them ([SPEC-08](specs/08-device-bridge.md)).
- **The internet is for downloads and the relay only:** the model, the voices, and the Whisper model are downloaded once each.

## What works and what does not

Seen working on the real Mac, on 2026-10-10:

- A spoken goal repeated back, corrected, cancelled, or confirmed, by voice or by button ([OBJ-17](objectives/OBJ-17-goal-confirmation.md)).
- The cat exporting a Keynote deck as a PDF through the accessibility tree: in the measured live runs, 3 of the 4 that got going saved a correct, named PDF ([OBJ-36](objectives/OBJ-36-gui-act-sub-agent.md)).
- A goal said on the Android phone, sent over the live relay, and run on the Mac, which exported `Q3 Report.pdf`, with progress, Stop, Resume, and the summary on the phone (task `b1d6d145`, [OBJ-68](objectives/OBJ-68-harness-delegated-goals.md), [OBJ-69](objectives/OBJ-69-android-delegated-goal-screen.md)).

Built and tested, with no recorded live run on the final build yet:

- Putting a found list into a new note ([OBJ-74](objectives/OBJ-74-save-list-to-note.md)). The first live tries failed and were fixed; the fixed build has not been run live.
- Ghost cats working in other windows at the same time, and handing a stuck step to the main cat ([OBJ-09](objectives/OBJ-09-ghost-handoff.md)).
- Stop and take-over on the Mac, the approval cards for sends and deletes, and the action log ([OBJ-38](objectives/OBJ-38-approvals-pause-and-action-log.md)).
- Spotify through a screenshot and vision clicks ([OBJ-75](objectives/OBJ-75-vision-fallback.md)), being fixed now.

Cut or not finished:

- **Approvals on the phone.** An approval for a goal sent from the phone shows on the Mac ([OBJ-70](objectives/OBJ-70-harness-phone-approvals-and-stop.md), [OBJ-71](objectives/OBJ-71-android-approvals.md)).
- **Tools that run on the phone, and phone-only goals** such as alarms and timers. Every phone goal is sent to the Mac ([OBJ-66](objectives/OBJ-66-android-phone-tool-host.md), [OBJ-67](objectives/OBJ-67-android-goal-routing.md)).
- **Scanning the pairing QR code with the phone.** The phone pairs from a debug build over `adb` ([setup guide](wiki/judges-setup.md#pair-the-phone)).
- **Sending mail.** Sends are gated by approvals, but no Mail run was done, and the approval card cannot read a Mail draft's recipients yet, so a send does not run.
- **A queue on the Mac.** A phone goal starts at once, even while another task runs.
- **A trained "Hey Yumi" model.** The phrase is spotted by Apple's on-device recognizer on the Mac and by Vosk on Android ([OBJ-58](objectives/OBJ-58-mac-hey-yumi-recognizer.md), [OBJ-59](objectives/OBJ-59-android-hey-yumi-vosk.md)).
- **The animated Rive cat.** The cursor is the cat drawn as one still pose per state.
- **A model on the phone, and the iPhone app.** Both were planned for later.

## How to run it

Judges and anyone new: the [setup guide](wiki/judges-setup.md) has every step, from a 15-minute look at the interface with no model download to the full Mac and phone setup.
On a Mac with Apple silicon, Xcode 26, Node.js 24, and Python 3.10 or later, the full Mac setup is, in this order:

1. Install the dependencies: `(cd protocol && npm install) && (cd harness && npm install)`.
2. Install mlx-vlm 0.7.6 in a virtual environment, then start the model server and leave it running: `mlx_vlm.server --model mlx-community/Qwen3.5-9B-4bit --host 127.0.0.1 --port 8080 --max-num-seqs 3`.
3. Set up signing and fetch Yumi's voice as in the guide, then build and open the app from `mac/`. The app starts the harness itself.
4. Grant Microphone, Accessibility, and Screen Recording, then say "Hey Yumi" or hold ⌥Space and say a goal.

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
- **Voice:** Whisper for Taglish, native on-device recognizers for quick English commands, never cloud. Wake word "Hey Yumi", plus push-to-talk. For the demo it is spotted by Apple's on-device recognizer on the Mac and by Vosk on Android, until a trained openWakeWord model exists.
- **Harness:** a fork of Pi's minimal agent loop in TypeScript, with a Swift app for native macOS work.
- **Bridge:** our VPS relays end-to-end encrypted messages. NetBird is for team access only, not device traffic.
- **Character:** Yumi is a playful cat. For the demo it is drawn natively, one pose per state, without Rive.
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
