---
id: OBJ-10
title: Yumi cat v0 in Rive
product: character
assignee: Patrick
touches: [mac, android]
specs: [SPEC-04]
status: todo
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, character, ux]
---

# OBJ-10 Yumi cat v0 in Rive

**Product:** [Yumi Character](../character/README.md) · **Also touches:** [mac](../mac/README.md), [android](../android/README.md) · **Specs:** [SPEC-04](../specs/04-cursor-presence.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Yumi's personality is a playful cat, and the cat is how users understand what Yumi is doing.
The apps need a working `.riv` file and a stable state machine contract early, even with rough art, so the Mac cursor and Android app can be built in parallel with the real design.
Final art, colors, and timing come later and must not change the contract.

## Read first

- [SPEC-04](../specs/04-cursor-presence.md): requirements 10-18, "Cat behaviors", "Animation tools", and Decisions.
- [character/README.md](../character/README.md): workflow with Rive's MCP server.
- Rive's current docs for the MCP integration and for state machine inputs or data binding.

## Tasks

- [ ] **OBJ-10.1** Set up the Rive desktop editor (Early Access) with MCP enabled, and connect Claude Code or Cursor following Rive's current docs. Note the working setup in `character/README.md`.
- [ ] **OBJ-10.2** Create the `yumi-cat` artboard with simple placeholder vector art: a small cat with a clearly visible paw.
- [ ] **OBJ-10.3** Build one state machine with a state for each behavior in "Cat behaviors": idle, listening, thinking, moving, waiting, paused, done, stuck, plus a pounce for clicks.
- [ ] **OBJ-10.4** Define the inputs: a number or enum input for the current state, a trigger for pounce, a color input for ghost littermates (data-bound color or a numeric hue, whichever both the Apple and Android Rive runtimes support), and a boolean `reduceMotion` that swaps leaps and pounces for simple glides.
- [ ] **OBJ-10.5** Fix the click point: the paw tip's exact coordinate in the artboard, so the apps align it with the click.
- [ ] **OBJ-10.6** Keep the pounce within about 300 ms so it never slows a task.
- [ ] **OBJ-10.7** Export `character/yumi-cat.riv`.
- [ ] **OBJ-10.8** Write the "State machine contract" section in `character/README.md`: state machine name, every input with type and allowed values, the click point, artboard size, and the rule that changing it is a breaking change.
- [ ] **OBJ-10.9** Verify the file plays and responds to every input in Rive's own preview, and record a short screen capture of all states for reference.

## Expectations

- [ ] Every state in "Cat behaviors" is reachable through the documented inputs.
- [ ] Transitions between any two states blend without visual jumps.
- [ ] The click point is documented and visibly matches the paw tip.
- [ ] With `reduceMotion` on, no leap or pounce plays.
- [ ] No state uses red or warning colors, including stuck.

## Outcomes

- `character/yumi-cat.riv`.
- The state machine contract in `character/README.md`.
- A short reference capture of all states.

## Out of scope

- Final art, colors, and animation timing: later design work, which keeps this contract.
- Playing the cat in the apps: [OBJ-19](OBJ-19-rive-cat-cursor.md) (Mac), [OBJ-22](OBJ-22-android-app-shell.md) (Android).

## Completion notes

_Fill in when done: what was built, where, decisions made, and anything the next objective needs to know._
