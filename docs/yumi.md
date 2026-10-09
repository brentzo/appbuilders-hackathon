---
type: idea
status: exploring
created: 2026-10-09
updated: 2026-10-09
tags: [idea, local-ai, computer-use, mobile, hackathon]
---

# Yumi

A fully local companion that you give a goal by voice, on your Mac or your phone.
A cursor spawns, repeats the goal back, and performs it across apps the way you would.
When the goal allows it, Yumi splits into several cursors and background helpers that work in parallel.
The Mac and the phone control each other in both directions, so a goal spoken on one device can run on the other.

The leverage is the harness, not the model.
The model only decides one small step at a time.
The harness owns planning state, device and lane routing, locks, handoffs, checkpoints, voice, and the cursor animation.

## Notes

- [Architecture](architecture.md) - how the pieces fit, with diagrams, and how the idea came about
- [Lane Router](lane-router.md) - how each subtask is assigned to a helper, a ghost cursor, or the main cursor
- [Task Record Schema](task-record-schema.md) - the on-disk record that makes tasks resumable and lets any worker pick up the next step
- [Device Bridge](device-bridge.md) - Mac and phone as tool providers, routing between them, and the encrypted VPS bridge

## Decisions so far

- **Mac model:** Qwen3.5-9B (4-bit, ~6 GB) as the single brain for planning, tool calls, and GUI control. A `gui_act` sub-agent uses the same model with a fresh context, so the planner never sees screenshots.
- **Android:** built in two parts ([SPEC-10](../specs/10-android-companion.md)). Part A (p0) has no model: a fixed rule runs alarm, timer, and open app through intents, and every other goal is delegated to the Mac. Part B (p1) adds one fixed model, Qwen3.5-4B, on the 12 GB demo phone. The 8 GB phone is Part A only.
- **Why not UI-TARS:** the newest open weights are UI-TARS-1.5-7B (April 2025). UI-TARS-2 weights are not public. Qwen3.5-4B beats it on ScreenSpot-Pro (60.3 vs 49.6) and OSWorld (35.6 vs 27.5) at half the memory. Keep UI-TARS only as a fallback if it wins our own test.
- **Voice:** Whisper for Taglish and long dictation. Native on-device STT for quick English commands, always forced on-device (Apple's new API has no Filipino).
- **Harness:** Pi-style loop in TypeScript (fork the loop, replace the coding tools with desktop tools), plus a Swift helper for native macOS APIs (ScreenCaptureKit, Accessibility API, CGEvent, overlay cursors), talking over a local socket.
- **Runtime:** MLX on the Mac. MNN or llama.cpp on Android, after benchmarking.
- **Bridge:** our own VPS relays end-to-end encrypted messages between devices.
- **Platforms:** Mac and Android first, iPhone second.
- **Machines:** Brent's 16 GB Mac (~10 GB for models, about 3 parallel contexts). Teammate's 12 GB Android phone is the demo phone, Brent's 8 GB Android is for development.
- **Parallel cap:** about 3 visible cursors.

## Why not bigger models

Kimi K2, GLM-4.6, DeepSeek V3 and similar are stronger but need 250 GB+.
Local-only is the pitch, so they are out.

## Known risks

- GUI control is both the riskiest part and the demo. Test Qwen3.5-4B, Qwen3.5-9B, and UI-TARS-1.5-7B on 3 real tasks on day one.
- Vendor benchmarks are full precision. 4-bit lowers click accuracy, more so on the phone.
- Each step takes ~1-4 s on a 16 GB Mac, mostly reading the screenshot. Design the cursor's "thinking" state around it.
- Image encoding on a phone is slow and drains battery. Prefer the accessibility tree.
- Whisper is weak when speakers switch languages mid-sentence. Test with real Taglish early.
- Parallel speedup on Metal is ~1.5-3x, not ~4x. Measure before quoting a number.
- Pi 1.0 and Pi Durable shipped around 2026-10-01. Durable mode is experimental, so do not depend on it.
