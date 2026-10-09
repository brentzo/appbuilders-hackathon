---
id: OBJ-53
title: Expand a cursor to see what it is thinking
product: mac
assignee: Brent
touches: []
specs: [SPEC-07]
status: in-progress
priority: p0
depends-on: [OBJ-52]
integrates-with: []
tags: [objective, p0, mac, debug, ux]
---

# OBJ-53 Expand a cursor to see what it is thinking

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

SPEC-07 requirement 23 lets the user, in Debug mode, expand any cursor or helper chip to see what it is doing and why.
It makes the multi-cursor demo explainable and lets Brent see a stuck worker's reasoning without opening log files.
It reads the reasoning data that [OBJ-52](OBJ-52-harness-debug-logs.md) adds.

## Read first

- SPEC-07 requirements 22 and 23, and SPEC-04 requirements 3 to 6.
- [OBJ-52](OBJ-52-harness-debug-logs.md) and the protocol fields it adds.
- `mac/Yumi/Overlay/CursorBubble.swift`, `mac/Yumi/Overlay/HelperChips.swift`, and `mac/Yumi/Overlay/CursorOverlay.swift`.
- `mac/Yumi/MenuBar/CursorDebugMenu.swift` for the existing debug options.

## Tasks

- [x] **OBJ-53.1** Add the Debug mode toggle to the Mac Settings window and send it to the harness, matching OBJ-52.
- [x] **OBJ-53.2** In Debug mode, clicking a cursor's bubble or a helper chip expands a small panel with the subtask title, the lane, what it sees (short), its last action, and the model's last decision and reason.
- [x] **OBJ-53.3** Update the panel live as steps happen, and collapse it on click or when the subtask ends.
- [x] **OBJ-53.4** Keep the overlay click-through everywhere except the expandable bubble and chip (SPEC-04 requirement 7).
- [x] **OBJ-53.5** Make the panel look right in light and dark mode and at every scale, with the Yumi design tokens.
- [ ] **OBJ-53.6** Tests for the view model, and a live check with a real goal.

## Expectations

- [ ] In Debug mode, Brent can expand the main cat and a ghost during a real task and read why each did its last action.
- [x] With Debug mode off, nothing is expandable and the overlay behaves as before.

## Expected outcomes

- The expandable thoughts panel for cursors and helper chips, with tests.

## Out of scope

- Writing the logs and the reasoning data: [OBJ-52](OBJ-52-harness-debug-logs.md).

## Outcome

- **Result:** Not finished: everything is built and unit tested, but the live checks need the live app, which agents may not launch without the orchestrator's go (rule of 2026-10-10). Status stays `in-progress` until Brent runs the steps under "Not verified".
- **Delivered:**
  - The "Debug mode" toggle in Settings, under Troubleshooting: `YumiSettings.debugMode`, on in Debug builds and off in release builds (`#if DEBUG`), saved as `settings.debugMode`.
  - `mac/Yumi/Harness/HarnessLink+DebugMode.swift`: sends `setDebugMode` after every hello and on every change, and turns the overlay's panels on and off. A failed send is logged only; the next connection sends it again.
  - `mac/Yumi/Overlay/WorkerThoughts.swift`: the view model (latest thought per subtask, a cat's by cursor id, a chip's by subtask id, which panels are open) and `ThoughtsContent`, the panel's words: subtask title, lane and time in am/pm, then "Sees", "Last action", "Decided", and "Why", with "Nothing yet" and "No reason given" when a field is missing.
  - `mac/Yumi/Overlay/ThoughtsCard.swift`: the panel, drawn on the `surface`, `line`, `ink`, and `muted` tokens for the current light or dark appearance, with a dot in the cat's or chip's coat. Over a cat it takes the bubble's place with the same tail, moves sideways to stay on the display, and goes below the paws near the top. Under a chip it pushes the chips below down.
  - `mac/Yumi/Overlay/ThoughtsClickTarget.swift`: the overlay panels stay click-through. While the pointer is over a bubble, chip, or open panel, a transparent non-activating panel the size of that target sits under it and takes the click; anywhere else there is nothing.
  - `mac/Yumi/Overlay/CursorOverlay+Thoughts.swift`: the overlay glue. `HarnessLink` now sends `workerThought` to the overlay and closes a panel when `taskStatusChanged` reports its subtask `done` or `failed`.
  - `mac/Yumi/Overlay/ThoughtsDemo.swift`: an 18-second thoughts part in `-YumiCursorDemo YES`, and `-YumiOpen thoughts -YumiSnapshotDir <dir>`.
  - `mac/YumiTests/WorkerThoughtsTests.swift` (18 tests) and `HarnessClientTests.sendsDebugMode` (the mock harness checks the params against the protocol). `mac/README.md` "Debug mode and the thoughts panels".
- **Commits:**
  - `2815445 docs(objectives): start OBJ-53`
  - `bc67d4d feat(mac): expand a cat or helper chip to see what it is thinking in Debug mode`
  - Then the commit that writes this Outcome.
- **Expectations:**
  - With Debug mode off, nothing is expandable and the overlay behaves as before: `withDebugModeOffNothingIsExpandable` (no targets, no pointer watching, a toggle does nothing, `isClickThrough`), `turningDebugModeOffClosesAndForgetsEverything`, and `theMainCatGetsABubbleToClickInDebugMode` (the main cat's bubble goes away again with it off). The existing overlay, pointer avoidance, and settings tests still pass.
  - In Debug mode, Brent can expand the main cat and a ghost during a real task: not verified live (see below). In tests: `aClickOnTheBubbleOpensThePanelAndAnotherClosesIt`, `thePanelUpdatesLiveAndClosesWhenTheSubtaskEnds`, `aHelperChipOpensUnderItselfAndClosesWhenItLeaves`, and `thePanelSaysWhatItSeesDidAndDecidedAndWhy` on the protocol's own `WorkerThought.main-export` example, decoded through `HarnessEvent`.
  - Light and dark: `-YumiOpen thoughts` snapshots with `-YumiAppearance light` and `dark` at 2x, run once before the no-launch rule with the mock harness and a scratch support folder (never the live socket), checked by eye: the right-edge shift, the flip under the top, and the chip push all look right. `colorsFollowLightAndDarkMode` checks the tokens resolve per appearance.
  - `python3 scripts/verify.py` passed (docs and the Mac build and all Mac tests).
- **Not verified:**
  - Clicks for real: that the transparent click panel takes a click over another app without activating Yumi, and that clicks right next to a bubble still reach the app underneath. Brent: in Settings check "Debug mode" is on, run `open -n mac/build/Build/Products/Debug/Yumi.app --args -YumiCursorDemo YES -YumiMockHarness YES` from the repo (after the orchestrator's go, with no other Yumi running), wait for "your turn: click my bubble" (about 46 seconds in), click a bubble (it opens), click the panel (it closes), and click just beside a bubble in a Finder window (Finder gets it).
  - The live check with a real goal (OBJ-53.6, first expectation), because the model server and the live app belong to other agents now. Brent: with the model server up and Debug mode on, say "export my Keynote deck as a PDF", answer "yes", then click the main cat's bubble and a ghost's. Reaching for a bubble no longer pauses the task (SPEC-06 r2, changed 2026-10-10), so the panel should update while the task runs.
  - Snapshots at 1x: only a 2x display was available; the text is rendered at the panel's own scale (`ThoughtsCard.render` is tested at 2x).
- **Decisions and deviations:**
  - In Debug mode the main cat, which has no label, shows the title of its subtask in its bubble once a thought arrives, so there is something to click. Without a thought there is no bubble, and nothing to open.
  - Several panels can be open at once, so the main cat and a ghost can be compared.
  - Reaching for a bubble during a running task used to pause it. Brent changed SPEC-06 r2 on 2026-10-10: pointer movement over, and clicks in, Yumi's own bubbles, panels, and chips never count, and small moves never count either.
  - The main cat's subtask title in its bubble in Debug mode was confirmed by the orchestrator, 2026-10-10.
  - A cat stays put while the pointer is on its bubble or panel, instead of scooting (SPEC-04 r21), so it can be clicked.
  - The panels follow the system appearance; the existing bubble stays on light paper as before.
  - Helper chips still say "Helper working"; their panel shows the subtask title from the thought.
  - Patrick's files changed: `CursorOverlay.swift` (stored properties and five hook lines), `CursorLayer.swift` (the card in the bubble's place, `thoughtsTapFrame`), `HelperChips.swift` (a card under a chip, `tapFrames`), `OverlayCursor.swift` (`thoughtTitle`), `PointerAvoidance.swift` (stay put on the bubble), `CursorDebugActions.swift` (the demo part), `DebugLaunchOptions.swift` (`-YumiOpen thoughts`), `HarnessLink.swift` (routing, `model` no longer private), the three settings files, `HarnessClientTests.swift`, and `mac/README.md`.
- **For the next objectives:**
  - `CursorOverlay.setDebugMode`, `receive(_:)`, `subtaskEnded(_:)`, and `toggleThoughts(_:)` are the overlay's whole thoughts API. A new event that should close panels calls `subtaskEnded`.
  - Anything new drawn on the overlay that the user should click can join `thoughtsTargets()` and get the same click panel, without making the overlay take clicks.
