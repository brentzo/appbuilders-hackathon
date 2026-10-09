---
id: OBJ-35
title: Stop and take over on the Mac
product: mac
assignee: Patrick
touches: []
specs: [SPEC-06]
status: todo
priority: p0
depends-on: [OBJ-17, OBJ-39]
integrates-with: [OBJ-38]
tags: [objective, p0, mac, ux, safety]
---

# OBJ-35 Stop and take over on the Mac

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-06](../specs/06-user-control.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The user is always in charge.
A shortcut or the menu bar stops everything, and touching their own mouse or keyboard pauses every cursor before its next action.
This objective builds the Mac side: the stop shortcut, the input watcher, the instant local stop, and the paused screen with "Resume" and "Cancel".
The harness side of pausing and cancelling is [OBJ-38](OBJ-38-approvals-pause-and-action-log.md); until it exists, use the mock harness from [OBJ-01](OBJ-01-task-record-schemas.md).

## Read first

- [SPEC-06](../specs/06-user-control.md), requirements 1-9 and the "User control on the Mac" scenarios.
- [docs/lane-router.md](../docs/lane-router.md), "User interrupts".
- [OBJ-01](OBJ-01-task-record-schemas.md): the RPC methods `pause`, `resumeTask`, and `cancelTask`, and the `taskStatusChanged` and `cursorCommand` events.
- The Outcome of [OBJ-17](OBJ-17-goal-confirmation.md) (`speak` and listening for a reply), [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) (paused cursor state, fade), and [OBJ-39](OBJ-39-mac-gui-execution.md) (event tag and typing cancel flag).
- [SPEC-06](../specs/06-user-control.md) Decisions: what never counts as taking over, and when Yumi speaks on a pause.

## Tasks

- [ ] **OBJ-35.1** Register Control-Option-Escape as a global shortcut that works whichever app is in front, and add "Stop" to Yumi's menu bar menu. Both call `pause` for every lane, helpers included (SPEC-06 r1).
- [ ] **OBJ-35.2** Instant local stop: the moment a pause is triggered on the Mac, set the [OBJ-39](OBJ-39-mac-gui-execution.md) typing cancel flag and make `executeAction` refuse every action until the task resumes. This makes the pause land before the next action even if a request from the harness is already on its way (SPEC-06 r4).
- [ ] **OBJ-35.3** Take-over: a listen-only `CGEvent` tap for mouse movement, clicks, scrolls, and key presses. Events with Yumi's tag are ignored; any other untagged event triggers the local stop and calls `pause` for UI lanes only, so helpers keep running (SPEC-06 r2 and r3). Two exceptions never pause: clicks and typing in Yumi's own windows (cards and panels), and any input while Yumi is waiting for the user and no UI lane is acting, which covers a password field Yumi handed to the user. Check which permission the tap needs and, if it is not Accessibility, add it to the [OBJ-14](OBJ-14-mac-app-shell.md) onboarding.
- [ ] **OBJ-35.4** Secure Input: while macOS Secure Input is on, keystrokes are not visible, but mouse movement still pauses Yumi (SPEC-06 r9). Log when Secure Input is on, so a missed key press can be explained.
- [ ] **OBJ-35.5** Paused state: every cursor freezes in the paused state, and the paused panel shows "Resume" and "Cancel" buttons (SPEC-06 r6). Only after the stop shortcut or the menu bar "Stop" does Yumi say "Paused. Say continue when you're ready, or cancel to stop for good." and listen for the reply. A mouse or keyboard take-over pauses silently and only shows the panel.
- [ ] **OBJ-35.6** Resume by the "Resume" button or by saying "continue" or "resume": call `resumeTask` and lift the local stop only after the harness reports the task running again.
- [ ] **OBJ-35.7** Cancel by the "Cancel" button or by saying "cancel": call `cancelTask`, fade every cursor out, and say "Okay, I stopped. Nothing else will happen."
- [ ] **OBJ-35.8** Tests with a fake event source (tagged and untagged), a pause landing between typing chunks, and a pause racing an in-flight `executeAction`. Manual checks on the demo Mac with a main and a ghost cursor, first against the mock harness, then the real one when [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) is done.

## Expectations

- [ ] SPEC-06 scenarios pass with the real harness: "Stop shortcut", "Stop from the menu bar", "User takes the mouse", "Clicking Yumi's own card is not taking over", "Typing a password Yumi asked for is not taking over", "Yumi's own input does not pause it", "Typing stops mid-sentence", "Pause cancels a pending approval", "User resumes", "User resumes by saying resume", "User cancels a paused task".
- [ ] No action runs after a pause is triggered, over 20 tries with the main cursor typing a long sentence.
- [ ] Yumi's own tagged events never pause it, over a full demo task.

## Expected outcomes

- The global stop shortcut, the menu bar "Stop", the input watcher, and the instant local stop in the Mac app.
- The paused state with "Resume" and "Cancel", and the spoken lines.

## Out of scope

- The harness pause and cancel path, dropping queued work, and cancelling approvals: [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) (Brent).
- Saying "stop" by voice, including "teka", "tama na", and "hinto" (SPEC-06 r10, p1).
- Touch on the phone, the Android notification stop, and pausing after 10 seconds without the other device (SPEC-06 r11-13, p1).
- Stop from the other device: SPEC-09, not reviewed yet. Its message kinds are [OBJ-25](OBJ-25-cross-device-messages.md).
- Resume after a crash or reboot: [OBJ-06](OBJ-06-resume-and-limits.md).

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
