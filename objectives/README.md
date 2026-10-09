# Objectives

Objectives turn the specs into work.
Each objective is a short, actionable group of tasks for one product, written so a fresh session with no memory of past conversations can pick it up and finish it.

- **Specs** say what Yumi must do. They are the source of truth for behavior.
- **Objectives** say how we get there, in small steps, and track progress.

## Objective format

Every objective follows the template in [.claude/skills/objective-lifecycle/template.md](../.claude/skills/objective-lifecycle/template.md).
The [objective-lifecycle skill](../.claude/skills/objective-lifecycle/SKILL.md) is the full guide: creating, editing, working, blocking, and finishing an objective.

| Section | Meaning |
|---|---|
| Frontmatter | `id`, `title`, `product`, `assignee`, `touches` (other products it changes), `specs`, `status`, `priority`, `depends-on` (must be done first), `integrates-with` (connect to later; build against a stand-in until then), `tags` |
| Project context | The same short brief about Yumi in every objective |
| Why this objective | Where it fits and what it unlocks |
| Read first | The specs, docs, and READMEs to read before starting |
| Tasks | Child tasks as checkboxes, numbered `OBJ-NN.n` |
| Expectations | What must be true when done. Each item is verified, usually by a spec scenario |
| Expected outcomes | The concrete things that should exist when done: code, files, interfaces |
| Out of scope | What not to do here, and where it belongs |
| Outcome | Written when the objective is finished: result, what was delivered, commits, how each expectation was verified, what was not verified, decisions and deviations, and notes for the objectives that come next |

## Owners

Owners are assigned per product.

<!-- generated:objectives-owners:start -->
| Owner | Products |
|---|---|
| Brent | android, harness, iphone |
| Jepoy | bridge, models, protocol |
| Patrick | character, mac |
<!-- generated:objectives-owners:end -->
## Status

| Status | Meaning |
|---|---|
| `todo` | Not started |
| `in-progress` | Someone is working on it. Every hard dependency is `done` |
| `blocked` | Waiting on something outside the objective. The Outcome section says what, until it is unblocked |
| `done` | Every task and expectation checked, and the Outcome written |

The frontmatter is the source of truth.
The tables in this file and in each product README are generated: run `python3 scripts/objectives.py index` after any change, and `python3 scripts/objectives.py check` before committing.

## How to work an objective

Follow the [objective-lifecycle skill](../.claude/skills/objective-lifecycle/SKILL.md).
In short: pick a `todo` objective assigned to you whose `depends-on` objectives are all `done`, read everything under "Read first", set it `in-progress`, work the tasks in order, verify every expectation, write the Outcome, and set it `done`.
Do not wait for `integrates-with` objectives; use the stand-in the objective names.
If a spec turns out to be wrong or unclear, stop and raise it. Do not quietly change behavior.

## Index

<!-- generated:objectives-index:start -->
| ID | Objective | Product | Assignee | Specs | Depends on | Integrates with | Status |
|---|---|---|---|---|---|---|---|
| [OBJ-01](OBJ-01-task-record-schemas.md) | Task record schemas and cross-team contracts | protocol | Jepoy | 02, 03, 05, 07, 11 | - | - | done |
| [OBJ-02](OBJ-02-bridge-envelope-and-crypto.md) | Bridge envelope and end-to-end crypto | protocol | Jepoy | 08 | - | - | done |
| [OBJ-03](OBJ-03-harness-skeleton.md) | Harness skeleton and local model client | harness | Brent | 02 | 01 | - | done |
| [OBJ-04](OBJ-04-task-store.md) | Task store and history | harness | Brent | 02 | 01, 03 | - | done |
| [OBJ-05](OBJ-05-planner-and-scheduler.md) | Planner, scheduler, and task summary | harness | Brent | 02 | 03, 04 | - | done |
| [OBJ-06](OBJ-06-resume-and-limits.md) | Resume and limits | harness | Brent | 02 | 04, 05 | - | done |
| [OBJ-07](OBJ-07-lane-router-core.md) | Lane router core | harness | Brent | 03 | 01, 04 | 27 | done |
| [OBJ-08](OBJ-08-locks-busy-windows-cap.md) | Window locks, busy windows, and cursor cap | harness | Brent | 03 | 07 | 27 | done |
| [OBJ-09](OBJ-09-ghost-handoff.md) | Ghost handoff | harness | Brent | 03 | 06, 08 | - | todo |
| [OBJ-10](OBJ-10-yumi-cat-v0.md) | Yumi cat v0 without Rive | character | Patrick | 04 | - | - | done |
| [OBJ-11](OBJ-11-whisper-bake-off.md) | Whisper bake-off | models | Jepoy | 01 | - | - | in-progress |
| [OBJ-12](OBJ-12-hey-yumi-wake-word.md) | "Hey Yumi" wake word model | models | Jepoy | 01 | - | - | in-progress |
| [OBJ-13](OBJ-13-bridge-relay-server.md) | Bridge relay server | bridge | Jepoy | 08 | 02 | 31, 33 | done |
| [OBJ-14](OBJ-14-mac-app-shell.md) | Mac app shell, permissions, and harness link | mac | Patrick | 01, 04 | 01 | 03 | done |
| [OBJ-15](OBJ-15-mac-voice-intake.md) | Mac voice intake | mac | Patrick | 01 | 14 | 11 | done |
| [OBJ-16](OBJ-16-mac-wake-word.md) | Mac wake word | mac | Patrick | 01 | 15 | 12 | in-progress |
| [OBJ-17](OBJ-17-goal-confirmation.md) | Goal confirmation loop | mac | Brent | 01 | 04, 15, 18 | - | in-progress |
| [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) | Cursor overlay and motion | mac | Patrick | 04 | 14 | - | done |
| [OBJ-19](OBJ-19-cat-cursor.md) | Cat cursor without Rive | mac | Patrick | 04 | 10, 18 | - | in-progress |
| [OBJ-20](OBJ-20-window-tiling.md) | Window tiling with consent | mac | Patrick | 03 | 18, 27 | 08 | in-progress |
| [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) | Mac bridge client and pairing | harness | Jepoy | 08 | 02 | 03, 13, 27 | done |
| [OBJ-22](OBJ-22-android-app-shell.md) | Android app shell and foreground service | android | Brent | 10, 08, 01 | - | 10 | done |
| [OBJ-23](OBJ-23-android-bridge-client.md) | Android bridge client and pairing | android | Brent | 08 | 02, 13, 22 | - | todo |
| [OBJ-24](OBJ-24-android-voice-intake.md) | Android voice intake and wake word | android | Brent | 01, 10 | 22 | 12 | done |
| [OBJ-25](OBJ-25-cross-device-messages.md) | Cross-device message kinds | protocol | Jepoy | 09, 06, 07, 08, 10 | 01, 02 | - | done |
| [OBJ-26](OBJ-26-gui-smoke-test.md) | Qwen3.5-9B smoke test on the demo tasks | models | Brent | 05 | - | - | in-progress |
| [OBJ-27](OBJ-27-mac-native-services.md) | Mac native services for the harness | mac | Patrick | 03, 08 | 14 | 03, 07, 08, 21 | done |
| [OBJ-28](OBJ-28-android-whisper-bake-off.md) | Android Whisper bake-off | models | Jepoy | 01, 10 | - | 11, 24 | todo |
| [OBJ-29](OBJ-29-protocol-mac-fixes.md) | Protocol v3, fit the contracts to real macOS | protocol | Brent | 05, 07 | 01 | 03, 26 | done |
| [OBJ-30](OBJ-30-live-cross-device-bridge-acceptance.md) | Live cross-device bridge acceptance | bridge | Jepoy | 08 | 13, 21, 23, 27, 41, 42, 43, 49 | 48 | blocked |
| [OBJ-31](OBJ-31-unpair-delivery-ack-contract.md) | Define unpair delivery acknowledgement | protocol | Jepoy | 08 | 02 | 13, 21, 23 | done |
| [OBJ-32](OBJ-32-production-bridge-deployment.md) | Deploy the bridge relay to the VPS | bridge | Brent | 08 | - | 30 | done |
| [OBJ-33](OBJ-33-pairing-response-timeout-contract.md) | Align the pairing response timeout contract | protocol | Jepoy | 08 | 02 | 13, 21, 23 | in-progress |
| [OBJ-34](OBJ-34-protocol-version-upgrade-recovery.md) | Define protocol version upgrade recovery | protocol | Jepoy | 08, 11 | 31 | 21, 23, 30, 42, 43, 44 | in-progress |
| [OBJ-35](OBJ-35-mac-stop-and-take-over.md) | Stop and take over on the Mac | mac | Patrick | 06 | 17, 39 | 38 | todo |
| [OBJ-36](OBJ-36-gui-act-sub-agent.md) | gui_act sub-agent | harness | Brent | 05, 02, 11 | 06, 07, 37 | 26, 39 | in-progress |
| [OBJ-37](OBJ-37-permission-gate-and-file-tools.md) | Permission gate and typed file tools | harness | Brent | 07 | 03 | - | done |
| [OBJ-38](OBJ-38-approvals-pause-and-action-log.md) | Approvals, pause, and action log in the harness | harness | Brent | 07, 06 | 06, 37 | 35, 39, 40 | in-progress |
| [OBJ-39](OBJ-39-mac-gui-execution.md) | Mac GUI execution | mac | Patrick | 05, 11 | 14, 18 | 26, 36 | in-progress |
| [OBJ-40](OBJ-40-mac-approval-cards.md) | Approval and blocked-action cards on the Mac | mac | Patrick | 07, 11 | 17 | 38 | todo |
| [OBJ-41](OBJ-41-mac-pairing-verdict.md) | Mac pairing waits for the relay's verdict | harness | Brent | 08 | 21, 33 | 13, 23 | todo |
| [OBJ-42](OBJ-42-version-mismatch-copy.md) | Add the protocol version mismatch copy | android | Brent | 08, 11 | 34 | 23, 43, 44 | todo |
| [OBJ-43](OBJ-43-mac-bridge-client-version-refusal.md) | Mac bridge client recovers from a version refusal | harness | Brent | 08 | 21, 34 | 13, 42 | todo |
| [OBJ-44](OBJ-44-mac-version-mismatch-copy.md) | Mac app shows the version mismatch copy | mac | Patrick | 08, 11 | 34 | 42, 43 | todo |
| [OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md) | Pause scope and model readiness contracts | protocol | Jepoy | 06, 07, 11 | 01 | 35, 38, 46, 47 | in-progress |
| [OBJ-46](OBJ-46-mac-model-readiness.md) | Mac app shows whether the model is ready | mac | Patrick | 11 | 14 | 45, 47 | todo |
| [OBJ-47](OBJ-47-harness-model-readiness.md) | Harness reports whether the model is ready | harness | Brent | 11 | 03, 45 | 46 | todo |
| [OBJ-48](OBJ-48-unpair-without-device-clocks.md) | Bind unpair to the pairing instead of device clocks | protocol | Jepoy | 08 | 31 | 13, 23, 30, 41 | todo |
| [OBJ-49](OBJ-49-mac-bridge-test-support.md) | Mac answers ping and has bridge test hooks | harness | Brent | 08 | 21, 25 | 23, 30 | todo |
| [OBJ-50](OBJ-50-mac-auto-mode.md) | Auto mode skips the repeat-back | mac | Brent | 01 | - | 17 | in-progress |
| [OBJ-51](OBJ-51-mac-neural-voice.md) | Yumi's neural voice on the Mac | mac | Brent | 04 | - | 17 | done |
| [OBJ-52](OBJ-52-harness-debug-logs.md) | Debug mode keeps full local logs | harness | Brent | 07 | - | 53 | done |
| [OBJ-53](OBJ-53-mac-thoughts-panel.md) | Expand a cursor to see what it is thinking | mac | Brent | 07 | 52 | - | in-progress |
| [OBJ-54](OBJ-54-mac-cats-avoid-pointer.md) | Cats avoid the user's pointer | mac | Brent | 04 | - | - | in-progress |
| [OBJ-55](OBJ-55-voice-stop-keyword-models.md) | Voice stop keyword models | models | Jepoy | 06 | - | 35 | todo |
| [OBJ-56](OBJ-56-unclassified-action-approval-contract.md) | Approval contract for unclassified risky actions | protocol | Jepoy | 07 | 01 | 23, 36, 38, 40 | blocked |
| [OBJ-57](OBJ-57-route-classified-gui-deletes-through-strict-delete.md) | Route classified GUI delete asks through strict delete | harness | Brent | 07 | 37, 38 | 36, 40 | todo |
| [OBJ-58](OBJ-58-mac-hey-yumi-recognizer.md) | "Hey Yumi" on the Mac with the on-device recognizer | mac | Brent | 01 | - | 16 | done |
| [OBJ-59](OBJ-59-android-hey-yumi-vosk.md) | "Hey Yumi" on Android with Vosk | android | Brent | 01, 10 | - | 12, 24 | done |
| [OBJ-60](OBJ-60-goal-revision-contract.md) | Contract for changing the goal mid-task | protocol | Jepoy | 06, 02 | 01 | 61, 62 | in-progress |
| [OBJ-61](OBJ-61-harness-goal-revision.md) | Harness turns an interruption into a revised goal | harness | Brent | 06, 02, 01 | - | 17, 38, 60, 62 | in-progress |
| [OBJ-62](OBJ-62-mac-voice-interruption.md) | Mac listens for interruptions during a task | mac | Patrick | 06, 01 | 16, 35, 60 | 40, 61 | todo |
| [OBJ-63](OBJ-63-question-answer-interruption.md) | Decide when an answer to a task question changes its goal | harness | Brent | 06 | 61 | 36 | todo |
| [OBJ-64](OBJ-64-cross-device-local-rpc-contract.md) | Local RPC for cross-device routing on the Mac | protocol | Jepoy | 09 | 25 | 68, 70, 72 | todo |
| [OBJ-65](OBJ-65-harness-phone-tool-lane.md) | Phone tool lane in the harness | harness | Brent | 09, 07 | 25, 37, 49 | 23, 66 | todo |
| [OBJ-66](OBJ-66-android-phone-tool-host.md) | Phone runs the Mac's tool calls | android | Brent | 09, 10 | 23, 25 | 65 | todo |
| [OBJ-67](OBJ-67-android-goal-routing.md) | Phone repeats back a goal and runs it or sends it to the Mac | android | Brent | 09, 10 | 24, 66 | 68 | todo |
| [OBJ-68](OBJ-68-harness-delegated-goals.md) | Harness runs goals sent from the phone | harness | Brent | 09, 02 | 05, 25, 49 | 23, 64, 67, 69 | todo |
| [OBJ-69](OBJ-69-android-delegated-goal-screen.md) | Phone shows a goal working on the Mac, with Stop | android | Brent | 09, 10, 06 | 67 | 68, 70 | todo |
| [OBJ-70](OBJ-70-harness-phone-approvals-and-stop.md) | Harness takes approvals and Stop from the phone | harness | Brent | 09, 06, 07 | 38, 68 | 64, 69, 71, 72 | todo |
| [OBJ-71](OBJ-71-android-approvals.md) | Approvals on the phone for goals running on the Mac | android | Brent | 09, 07 | 69 | 70 | todo |
| [OBJ-72](OBJ-72-mac-cross-device-routing.md) | Mac app side of cross-device routing | mac | Patrick | 09 | 14 | 64, 68, 70 | todo |
| [OBJ-73](OBJ-73-live-cross-device-routing-acceptance.md) | Live cross-device routing acceptance | bridge | Jepoy | 09 | 30, 65, 66, 67, 68, 69, 70, 71, 72 | - | todo |
| [OBJ-74](OBJ-74-save-list-to-note.md) | Save a list into a new note | harness | Brent | 02, 01 | - | 17, 36, 50 | todo |
<!-- generated:objectives-index:end -->

## Priority and blocking

How the work is split so nobody waits on someone else:

- **Contracts first.** [OBJ-01](OBJ-01-task-record-schemas.md) defines every interface between people's work and ships a mock harness and a mock Mac app. It is the top priority, and Jepoy does it first.
- **Build against stand-ins.** `integrates-with` lists work you connect to later, not work you wait for. Until it is done, use the stand-in named in the objective: the mock harness or mock Mac app, Whisper large-v3-turbo, an openWakeWord pre-trained model, or a placeholder cat.
- **Each person writes code only in their own product.** Native Mac services for the harness and the bridge client live in Patrick's [OBJ-27](OBJ-27-mac-native-services.md).

Ranked by how many objectives each one holds up through hard dependencies:

<!-- generated:objectives-priority:start -->
| Rank | Objective | Assignee | Holds up (hard) | Holds up another person |
|---|---|---|---|---|
| 1 | OBJ-01 Task record schemas and cross-team contracts | Jepoy | 42 | Brent, Patrick |
| 2 | OBJ-02 Bridge envelope and end-to-end crypto | Jepoy | 23 | Brent, Patrick |
| 3 | OBJ-03 Harness skeleton and local model client | Brent | 19 | Jepoy, Patrick |
| 4 | OBJ-04 Task store and history | Brent | 15 | Jepoy, Patrick |
| 5 | OBJ-14 Mac app shell, permissions, and harness link | Patrick | 15 | Brent, Jepoy |
| 6 | OBJ-25 Cross-device message kinds | Jepoy | 11 | Brent |
| 7 | OBJ-05 Planner, scheduler, and task summary | Brent | 8 | Jepoy |
| 8 | OBJ-21 Mac bridge client and pairing | Jepoy | 8 | Brent |
| 9 | OBJ-22 Android app shell and foreground service | Brent | 8 | Jepoy |
| 10 | OBJ-13 Bridge relay server | Jepoy | 7 | Brent |
| 11 | OBJ-18 Cursor overlay and motion | Patrick | 7 | Brent |
| 12 | OBJ-31 Define unpair delivery acknowledgement | Jepoy | 7 | Brent, Patrick |
| 13 | OBJ-06 Resume and limits | Brent | 6 | Jepoy |
| 14 | OBJ-23 Android bridge client and pairing | Brent | 6 | Jepoy |
| 15 | OBJ-37 Permission gate and typed file tools | Brent | 6 | Jepoy |
| 16 | OBJ-15 Mac voice intake | Patrick | 5 | Brent |
| 17 | OBJ-34 Define protocol version upgrade recovery | Jepoy | 5 | Brent, Patrick |
| 18 | OBJ-49 Mac answers ping and has bridge test hooks | Brent | 5 | Jepoy |
| 19 | OBJ-24 Android voice intake and wake word | Brent | 4 | Jepoy |
| 20 | OBJ-66 Phone runs the Mac's tool calls | Brent | 4 | Jepoy |
| 21 | OBJ-07 Lane router core | Brent | 3 | No |
| 22 | OBJ-17 Goal confirmation loop | Brent | 3 | Patrick |
| 23 | OBJ-27 Mac native services for the harness | Patrick | 3 | Jepoy |
| 24 | OBJ-33 Align the pairing response timeout contract | Jepoy | 3 | Brent |
| 25 | OBJ-38 Approvals, pause, and action log in the harness | Brent | 3 | Jepoy |
| 26 | OBJ-67 Phone repeats back a goal and runs it or sends it to the Mac | Brent | 3 | Jepoy |
| 27 | OBJ-39 Mac GUI execution | Patrick | 2 | No |
| 28 | OBJ-41 Mac pairing waits for the relay's verdict | Brent | 2 | Jepoy |
| 29 | OBJ-42 Add the protocol version mismatch copy | Brent | 2 | Jepoy |
| 30 | OBJ-43 Mac bridge client recovers from a version refusal | Brent | 2 | Jepoy |
| 31 | OBJ-68 Harness runs goals sent from the phone | Brent | 2 | Jepoy |
| 32 | OBJ-69 Phone shows a goal working on the Mac, with Stop | Brent | 2 | Jepoy |
| 33 | OBJ-08 Window locks, busy windows, and cursor cap | Brent | 1 | No |
| 34 | OBJ-10 Yumi cat v0 without Rive | Patrick | 1 | No |
| 35 | OBJ-16 Mac wake word | Patrick | 1 | No |
| 36 | OBJ-30 Live cross-device bridge acceptance | Jepoy | 1 | No |
| 37 | OBJ-35 Stop and take over on the Mac | Patrick | 1 | No |
| 38 | OBJ-45 Pause scope and model readiness contracts | Jepoy | 1 | Brent |
| 39 | OBJ-52 Debug mode keeps full local logs | Brent | 1 | No |
| 40 | OBJ-60 Contract for changing the goal mid-task | Jepoy | 1 | Patrick |
| 41 | OBJ-61 Harness turns an interruption into a revised goal | Brent | 1 | No |
| 42 | OBJ-65 Phone tool lane in the harness | Brent | 1 | Jepoy |
| 43 | OBJ-70 Harness takes approvals and Stop from the phone | Brent | 1 | Jepoy |
| 44 | OBJ-71 Approvals on the phone for goals running on the Mac | Brent | 1 | Jepoy |
| 45 | OBJ-72 Mac app side of cross-device routing | Patrick | 1 | Jepoy |
<!-- generated:objectives-priority:end -->
Hard dependencies that cross between people (everything else is within one person's queue):

<!-- generated:objectives-cross:start -->
- OBJ-01 (Jepoy) before OBJ-03 (Brent)
- OBJ-01 (Jepoy) before OBJ-04 (Brent)
- OBJ-01 (Jepoy) before OBJ-07 (Brent)
- OBJ-01 (Jepoy) before OBJ-14 (Patrick)
- OBJ-15 (Patrick) before OBJ-17 (Brent)
- OBJ-18 (Patrick) before OBJ-17 (Brent)
- OBJ-02 (Jepoy) before OBJ-23 (Brent)
- OBJ-13 (Jepoy) before OBJ-23 (Brent)
- OBJ-01 (Jepoy) before OBJ-29 (Brent)
- OBJ-23 (Brent) before OBJ-30 (Jepoy)
- OBJ-27 (Patrick) before OBJ-30 (Jepoy)
- OBJ-41 (Brent) before OBJ-30 (Jepoy)
- OBJ-42 (Brent) before OBJ-30 (Jepoy)
- OBJ-43 (Brent) before OBJ-30 (Jepoy)
- OBJ-49 (Brent) before OBJ-30 (Jepoy)
- OBJ-17 (Brent) before OBJ-35 (Patrick)
- OBJ-17 (Brent) before OBJ-40 (Patrick)
- OBJ-21 (Jepoy) before OBJ-41 (Brent)
- OBJ-33 (Jepoy) before OBJ-41 (Brent)
- OBJ-34 (Jepoy) before OBJ-42 (Brent)
- OBJ-21 (Jepoy) before OBJ-43 (Brent)
- OBJ-34 (Jepoy) before OBJ-43 (Brent)
- OBJ-34 (Jepoy) before OBJ-44 (Patrick)
- OBJ-45 (Jepoy) before OBJ-47 (Brent)
- OBJ-21 (Jepoy) before OBJ-49 (Brent)
- OBJ-25 (Jepoy) before OBJ-49 (Brent)
- OBJ-60 (Jepoy) before OBJ-62 (Patrick)
- OBJ-25 (Jepoy) before OBJ-65 (Brent)
- OBJ-25 (Jepoy) before OBJ-66 (Brent)
- OBJ-25 (Jepoy) before OBJ-68 (Brent)
- OBJ-65 (Brent) before OBJ-73 (Jepoy)
- OBJ-66 (Brent) before OBJ-73 (Jepoy)
- OBJ-67 (Brent) before OBJ-73 (Jepoy)
- OBJ-68 (Brent) before OBJ-73 (Jepoy)
- OBJ-69 (Brent) before OBJ-73 (Jepoy)
- OBJ-70 (Brent) before OBJ-73 (Jepoy)
- OBJ-71 (Brent) before OBJ-73 (Jepoy)
- OBJ-72 (Patrick) before OBJ-73 (Jepoy)
<!-- generated:objectives-cross:end -->
Workload:

<!-- generated:objectives-workload:start -->
| Person | Objectives | Count |
|---|---|---|
| Brent | 03, 04, 05, 06, 07, 08, 09, 17, 22, 23, 24, 26, 29, 32, 36, 37, 38, 41, 42, 43, 47, 49, 50, 51, 52, 53, 54, 57, 58, 59, 61, 63, 65, 66, 67, 68, 69, 70, 71, 74 | 40 |
| Jepoy | 01, 02, 11, 12, 13, 21, 25, 28, 30, 31, 33, 34, 45, 48, 55, 56, 60, 64, 73 | 19 |
| Patrick | 10, 14, 15, 16, 18, 19, 20, 27, 35, 39, 40, 44, 46, 62, 72 | 15 |
<!-- generated:objectives-workload:end -->
## Suggested order

Waves come from hard dependencies only. Each person works their column top to bottom; objectives in the same row can run in parallel.

<!-- generated:objectives-waves:start -->
| Wave | Brent | Jepoy | Patrick |
|---|---|---|---|
| 1 | OBJ-22, OBJ-26, OBJ-32, OBJ-50, OBJ-51, OBJ-52, OBJ-54, OBJ-58, OBJ-59, OBJ-61, OBJ-74 | OBJ-01, OBJ-02, OBJ-11, OBJ-12, OBJ-28, OBJ-55 | OBJ-10 |
| 2 | OBJ-03, OBJ-24, OBJ-29, OBJ-53, OBJ-63 | OBJ-13, OBJ-21, OBJ-25, OBJ-31, OBJ-33, OBJ-45, OBJ-56, OBJ-60 | OBJ-14 |
| 3 | OBJ-04, OBJ-23, OBJ-37, OBJ-41, OBJ-47, OBJ-49 | OBJ-34, OBJ-48, OBJ-64 | OBJ-15, OBJ-18, OBJ-27, OBJ-46, OBJ-72 |
| 4 | OBJ-05, OBJ-07, OBJ-17, OBJ-42, OBJ-43, OBJ-65, OBJ-66 | - | OBJ-16, OBJ-19, OBJ-20, OBJ-39, OBJ-44 |
| 5 | OBJ-06, OBJ-08, OBJ-67, OBJ-68 | OBJ-30 | OBJ-35, OBJ-40 |
| 6 | OBJ-09, OBJ-36, OBJ-38, OBJ-69 | - | OBJ-62 |
| 7 | OBJ-57, OBJ-70, OBJ-71 | - | - |
| 8 | - | OBJ-73 | - |
<!-- generated:objectives-waves:end -->
## Not covered yet

Objectives exist for specs whose decisions are final: SPEC-01 to SPEC-08, plus the Android app shell and voice parts of SPEC-10 Part A.
SPEC-05 is covered by OBJ-39 (Mac) and OBJ-36 (harness), with schemas in OBJ-01 and the p0 model check in OBJ-26.
SPEC-06 is covered by OBJ-35 (Mac) and OBJ-38 (harness).
SPEC-07 is covered by OBJ-40 (Mac), OBJ-37, and OBJ-38 (harness).
Their p1 requirements (vision fallback, the model bake-off, voice stop, phone control, the injection warning, and crash approvals) are listed under each objective's Out of scope, except the password-logging test, which is p1 task OBJ-38.8.
Some of their tasks wait on the open questions below.

| Spec | Why not yet |
|---|---|
| [SPEC-09 Cross-device routing](../specs/09-cross-device-routing.md) | Defined by Jepoy (b824989). Not reviewed together yet. Its conflicts with SPEC-01, SPEC-08, and SPEC-10 are resolved (see below). Its message kinds are OBJ-25. Objectives for the p0 rule, phone tools, and delegation in the apps come after review |
| [SPEC-10 Yumi on Android](../specs/10-android-companion.md) | Part A (p0): app shell and voice are covered by OBJ-22 and OBJ-24; phone-only goals and phone tools wait on SPEC-09. Part B (p1): the model is decided, Qwen3.5-4B fixed |
| [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md) | Expanded by Jepoy. Every objective follows it |
| [SPEC-12 Yumi on iPhone](../specs/12-iphone-companion.md) | p2, after Android |

### Open questions for OBJ-35 to OBJ-40

Raised 2026-10-09 while writing these objectives.
Each needs a decision in the spec (spec-lifecycle skill), not in code.
Open items name their owner; resolved items stay listed so the history is easy to follow.

- **G1 Take-over vs approvals (SPEC-06 r2 and r5, SPEC-07 r11):** Resolved 2026-10-09 by Patrick: clicks on Yumi's own windows (cards, panels) never count as take-over, and there is no take-over pause while Yumi waits for the user and no UI lane is acting. Recorded in SPEC-06 r2 and Decisions.
- **G2 Take-over vs password fields (SPEC-05 r7, SPEC-06 r2):** Resolved 2026-10-09 by Patrick, by the G1 rule: a password field Yumi hands to the user never pauses the task. Recorded in SPEC-05 r7 and SPEC-06 r2.
- **G3 Voice on a delete card (SPEC-11 r9 vs SPEC-07 r11):** SPEC-11 says every button works by saying its label; SPEC-07 says a delete is approved only by a tap. OBJ-40 follows SPEC-07. Resolved 2026-10-10 by Jepoy: SPEC-11 r9 now names the exception, and the decision is in SPEC-11.
- **G4 "Cannot classify" (SPEC-07 r6):** Resolved 2026-10-09 by Patrick: "Quit", "Force Quit", Command-Q, and Command-Option-Escape are blocked; "cannot classify asks" applies only to key presses and to clicks in the risky apps (Mail, Messages, WhatsApp, Finder, System Settings); other clicks are allowed. Recorded in SPEC-07 r6 and Decisions. Follow-up for Patrick in SPEC-07 Open questions: unlisted clicks in Mail would ask during demo task 2. Updated 2026-10-09 by Brent: unlisted key presses also ask only in the risky apps, and System Settings left the list because every action there is blocked. Recorded in SPEC-07 r6 and Decisions.
- **G5 Missing copy (SPEC-05 r7, SPEC-07, SPEC-11):** SPEC-11 has no row for the SPEC-07 r5 blocked-action message, so the SPEC-11 copy test does not cover it. The SPEC-07 copy (password, declined send, one-file and several-folder delete cards, Messages send, several recipients) is drafted in SPEC-07 and waits for Patrick's review. The SPEC-11 part is resolved 2026-10-10 by Jepoy: the message stays in SPEC-07 r5, where the Mac's copy test already reads it, and SPEC-11 records why. The SPEC-07 draft copy still waits for Patrick.
- **G6 Missing contracts (OBJ-01):** Resolved 2026-10-10 by Jepoy in [OBJ-45](OBJ-45-pause-scope-and-model-readiness-contracts.md): `PauseParams` has an optional `scope`, `everyLane` (the default) or `uiLanes` for a take-over, and the blocked-action card needs no method of its own, since "Keep going" calls `resumeTask` and "Stop" calls `cancelTask`, as the Mac already does. The `ask` question and answer is covered by OBJ-01's `questionAsked` and `answerQuestion`.
- **G7 Paused by take-over:** Resolved 2026-10-09 by Patrick: "Paused. Say continue when you're ready, or cancel to stop for good." is spoken only for the stop shortcut and the menu bar "Stop"; a take-over pauses silently and shows the paused panel. Recorded in SPEC-06 r1, r2, and Decisions.
- **G8 Resume by voice:** Resolved 2026-10-09 by Patrick: the button stays "Resume", and both "continue" and "resume" work by voice. Recorded in SPEC-06 r6 and Decisions.
- **G9 GUI-created files (SPEC-05 r4):** The harness builds `files` from the step log, but a PDF exported through Keynote's menus is not in any tool call. OBJ-36.8 proposes watching the home folder during an attempt. Owner: Brent.
- **G10 Editing Yumi's own files (SPEC-07 r1):** Resolved 2026-10-09 by Patrick: dropped from the allowed list for p0. Recorded in SPEC-07 r1 and Decisions.
- **G11 Two invalid outputs in a row on `main`:** Still open in [docs/task-record-schema.md](../docs/task-record-schema.md). OBJ-36 ends the attempt with `stuck` until decided. Owner: Brent.
- **G12 Approval timeout on the Mac:** The 5-minute timeout comes from SPEC-09 r10 (approvals on the other device). Does it also apply when the approval is on the same Mac? Owner: Brent.
- **G13 "Show what I did" (SPEC-11):** The button is p0 and opens the action log, but opening the log from the menu bar is p1 (SPEC-07 r19). Resolved 2026-10-10 by Jepoy: the button opens that task's log from `getTask`'s `actionLog`, which is p0; the menu bar entry stays p1. Recorded in SPEC-11 Decisions, and built in [OBJ-40](OBJ-40-mac-approval-cards.md) task 9.
- **G14 Orchestrator tools (SPEC-05 r9):** The limit is 8, but the spec does not name them. OBJ-36.2 proposes a list. Owner: Brent.
- **G15 Screenshot retention (SPEC-07 r20 vs SPEC-02 r10):** SPEC-07 (p1) deletes screenshots after 7 days; SPEC-02 keeps them forever. Owner: Brent.
- **G16 Stale pointers:** OBJ-03, OBJ-06, OBJ-07, and OBJ-09 (Brent), and OBJ-14 and OBJ-18 (Patrick) still say SPEC-05, SPEC-06, or SPEC-07 is "not finalized" or "not written yet" in Out of scope. Point them at OBJ-35 to OBJ-40. Owner: each objective's owner.

### Resolved conflicts between specs

Decided 2026-10-09.

- **SPEC-01 vs SPEC-10:** SPEC-10 wins. Android in p0 has no Whisper; it uses the on-device English recognizer and shows "Language not supported on this phone" for other languages. Whisper on the phone moved to p1 in SPEC-01. OBJ-24 already follows this.
- **SPEC-08 vs SPEC-09:** SPEC-09 wins. The VPS never queues commands, every command expires after 2 minutes, and goals waiting for an offline device are held on the origin device. The VPS only holds results and events through short reconnects. SPEC-08, the bridge docs, OBJ-02, OBJ-13, OBJ-21, and OBJ-23 are updated.
- **SPEC-07 vs SPEC-11:** SPEC-07 requirement 6 wins for unclassified risky-action approvals. Their harness-authored summaries cannot be approved by voice; only a tap can approve them. SPEC-11 requirement 9 now names this exception, alongside the existing delete exception.
- **Phone confirmation without a model:** SPEC-10 requirement 8 adds fixed templates. Phone-only goals fill a sentence from the rule's fields; other goals echo the transcript and ask to send it to the Mac; replies are matched against fixed yes and no lists, and anything else is a correction. A phone-only goal the rule cannot parse is delegated to the Mac.
