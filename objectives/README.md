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
| [OBJ-04](OBJ-04-task-store.md) | Task store and history | harness | Brent | 02 | 01, 03 | - | todo |
| [OBJ-05](OBJ-05-planner-and-scheduler.md) | Planner, scheduler, and task summary | harness | Brent | 02 | 03, 04 | - | todo |
| [OBJ-06](OBJ-06-resume-and-limits.md) | Resume and limits | harness | Brent | 02 | 04, 05 | - | todo |
| [OBJ-07](OBJ-07-lane-router-core.md) | Lane router core | harness | Brent | 03 | 01, 04 | 27 | todo |
| [OBJ-08](OBJ-08-locks-busy-windows-cap.md) | Window locks, busy windows, and cursor cap | harness | Brent | 03 | 07 | 27 | todo |
| [OBJ-09](OBJ-09-ghost-handoff.md) | Ghost handoff | harness | Brent | 03 | 06, 08 | - | todo |
| [OBJ-10](OBJ-10-yumi-cat-v0.md) | Yumi cat v0 in Rive | character | Patrick | 04 | - | - | todo |
| [OBJ-11](OBJ-11-whisper-bake-off.md) | Whisper bake-off | models | Jepoy | 01 | - | - | blocked |
| [OBJ-12](OBJ-12-hey-yumi-wake-word.md) | "Hey Yumi" wake word model | models | Jepoy | 01 | - | - | todo |
| [OBJ-13](OBJ-13-bridge-relay-server.md) | Bridge relay server | bridge | Jepoy | 08 | 02 | - | todo |
| [OBJ-14](OBJ-14-mac-app-shell.md) | Mac app shell, permissions, and harness link | mac | Patrick | 01, 04 | 01 | 03 | in-progress |
| [OBJ-15](OBJ-15-mac-voice-intake.md) | Mac voice intake | mac | Patrick | 01 | 14 | 11 | todo |
| [OBJ-16](OBJ-16-mac-wake-word.md) | Mac wake word | mac | Patrick | 01 | 15 | 12 | todo |
| [OBJ-17](OBJ-17-goal-confirmation.md) | Goal confirmation loop | mac | Patrick | 01 | 04, 15, 18 | - | todo |
| [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) | Cursor overlay and motion | mac | Patrick | 04 | 14 | - | todo |
| [OBJ-19](OBJ-19-rive-cat-cursor.md) | Rive cat cursor | mac | Patrick | 04 | 10, 18 | - | todo |
| [OBJ-20](OBJ-20-window-tiling.md) | Window tiling with consent | mac | Patrick | 03 | 18, 27 | 08 | todo |
| [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) | Mac bridge client and pairing | harness | Jepoy | 08 | 02 | 03, 13, 27 | done |
| [OBJ-22](OBJ-22-android-app-shell.md) | Android app shell and foreground service | android | Brent | 10, 08, 01 | - | 10 | in-progress |
| [OBJ-23](OBJ-23-android-bridge-client.md) | Android bridge client and pairing | android | Brent | 08 | 02, 13, 22 | - | todo |
| [OBJ-24](OBJ-24-android-voice-intake.md) | Android voice intake and wake word | android | Brent | 01, 10 | 22 | 12 | todo |
| [OBJ-25](OBJ-25-cross-device-messages.md) | Cross-device message kinds | protocol | Jepoy | 09, 06, 07, 08, 10 | 01, 02 | - | todo |
| [OBJ-26](OBJ-26-gui-smoke-test.md) | Qwen3.5-9B smoke test on the demo tasks | models | Brent | 05 | - | - | in-progress |
| [OBJ-27](OBJ-27-mac-native-services.md) | Mac native services for the harness | mac | Patrick | 03, 08 | 14 | 07, 08, 21 | todo |
| [OBJ-28](OBJ-28-android-whisper-bake-off.md) | Android Whisper bake-off | models | Jepoy | 01, 10 | - | 11, 24 | todo |
| [OBJ-29](OBJ-29-protocol-mac-fixes.md) | Protocol v3, fit the contracts to real macOS | protocol | Brent | 05, 07 | 01 | 03, 26 | done |
| [OBJ-30](OBJ-30-mac-stop-and-take-over.md) | Stop and take over on the Mac | mac | Patrick | 06 | 17, 34 | 33 | todo |
| [OBJ-31](OBJ-31-unpair-delivery-ack-contract.md) | Define unpair delivery acknowledgement | protocol | Jepoy | 08 | 02 | 13, 21, 23 | todo |
| [OBJ-32](OBJ-32-permission-gate-and-file-tools.md) | Permission gate and typed file tools | harness | Brent | 07 | 03 | - | todo |
| [OBJ-33](OBJ-33-approvals-pause-and-action-log.md) | Approvals, pause, and action log in the harness | harness | Brent | 07, 06 | 06, 32 | 29, 30, 34 | todo |
| [OBJ-34](OBJ-34-mac-gui-execution.md) | Mac GUI execution | mac | Patrick | 05, 11 | 14, 18 | 26, 31 | todo |
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
| 1 | OBJ-01 Task record schemas and cross-team contracts | Jepoy | 21 | Brent, Patrick |
| 2 | OBJ-03 Harness skeleton and local model client | Brent | 10 | Patrick |
| 3 | OBJ-14 Mac app shell, permissions, and harness link | Patrick | 9 | No |
| 4 | OBJ-04 Task store and history | Brent | 8 | Patrick |
| 5 | OBJ-02 Bridge envelope and end-to-end crypto | Jepoy | 5 | Brent |
| 6 | OBJ-18 Cursor overlay and motion | Patrick | 5 | No |
| 7 | OBJ-05 Planner, scheduler, and task summary | Brent | 3 | No |
| 8 | OBJ-15 Mac voice intake | Patrick | 3 | No |
| 9 | OBJ-06 Resume and limits | Brent | 2 | No |
| 10 | OBJ-07 Lane router core | Brent | 2 | No |
| 11 | OBJ-22 Android app shell and foreground service | Brent | 2 | No |
| 12 | OBJ-08 Window locks, busy windows, and cursor cap | Brent | 1 | No |
| 13 | OBJ-10 Yumi cat v0 in Rive | Patrick | 1 | No |
| 14 | OBJ-13 Bridge relay server | Jepoy | 1 | Brent |
| 15 | OBJ-17 Goal confirmation loop | Patrick | 1 | No |
| 16 | OBJ-27 Mac native services for the harness | Patrick | 1 | No |
| 17 | OBJ-32 Permission gate and typed file tools | Brent | 1 | No |
| 18 | OBJ-34 Mac GUI execution | Patrick | 1 | No |
<!-- generated:objectives-priority:end -->
Hard dependencies that cross between people (everything else is within one person's queue):

<!-- generated:objectives-cross:start -->
- OBJ-01 (Jepoy) before OBJ-03 (Brent)
- OBJ-01 (Jepoy) before OBJ-04 (Brent)
- OBJ-01 (Jepoy) before OBJ-07 (Brent)
- OBJ-01 (Jepoy) before OBJ-14 (Patrick)
- OBJ-04 (Brent) before OBJ-17 (Patrick)
- OBJ-02 (Jepoy) before OBJ-23 (Brent)
- OBJ-13 (Jepoy) before OBJ-23 (Brent)
- OBJ-01 (Jepoy) before OBJ-29 (Brent)
<!-- generated:objectives-cross:end -->
Workload:

<!-- generated:objectives-workload:start -->
| Person | Objectives | Count |
|---|---|---|
| Brent | 03, 04, 05, 06, 07, 08, 09, 22, 23, 24, 26, 29, 32, 33 | 14 |
| Jepoy | 01, 02, 11, 12, 13, 21, 25, 28, 31 | 9 |
| Patrick | 10, 14, 15, 16, 17, 18, 19, 20, 27, 30, 34 | 11 |
<!-- generated:objectives-workload:end -->
## Suggested order

Waves come from hard dependencies only. Each person works their column top to bottom; objectives in the same row can run in parallel.

<!-- generated:objectives-waves:start -->
| Wave | Brent | Jepoy | Patrick |
|---|---|---|---|
| 1 | OBJ-22, OBJ-26 | OBJ-01, OBJ-02, OBJ-11, OBJ-12, OBJ-28 | OBJ-10 |
| 2 | OBJ-03, OBJ-24, OBJ-29 | OBJ-13, OBJ-21, OBJ-25, OBJ-31 | OBJ-14 |
| 3 | OBJ-04, OBJ-23, OBJ-32 | - | OBJ-15, OBJ-18, OBJ-27 |
| 4 | OBJ-05, OBJ-07 | - | OBJ-16, OBJ-17, OBJ-19, OBJ-20, OBJ-34 |
| 5 | OBJ-06, OBJ-08 | - | OBJ-30 |
| 6 | OBJ-09, OBJ-33 | - | - |
<!-- generated:objectives-waves:end -->
## Not covered yet

Objectives exist for specs whose decisions are final: SPEC-01 to SPEC-08, plus the Android app shell and voice parts of SPEC-10 Part A.
SPEC-05 is covered by OBJ-34 (Mac) and OBJ-31 (harness), with schemas in OBJ-01 and the p0 model check in OBJ-26.
SPEC-06 is covered by OBJ-30 (Mac) and OBJ-33 (harness).
SPEC-07 is covered by OBJ-29 (Mac), OBJ-32, and OBJ-33 (harness).
Their p1 requirements (vision fallback, the model bake-off, voice stop, phone control, the injection warning, and crash approvals) are listed under each objective's Out of scope, except the password-logging test, which is p1 task OBJ-33.8.
Some of their tasks wait on the open questions below.

| Spec | Why not yet |
|---|---|
| [SPEC-09 Cross-device routing](../specs/09-cross-device-routing.md) | Defined by Jepoy (b824989). Not reviewed together yet. Its conflicts with SPEC-01, SPEC-08, and SPEC-10 are resolved (see below). Its message kinds are OBJ-25. Objectives for the p0 rule, phone tools, and delegation in the apps come after review |
| [SPEC-10 Yumi on Android](../specs/10-android-companion.md) | Part A (p0): app shell and voice are covered by OBJ-22 and OBJ-24; phone-only goals and phone tools wait on SPEC-09. Part B (p1): the model is decided, Qwen3.5-4B fixed |
| [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md) | Expanded by Jepoy. Every objective follows it |
| [SPEC-12 Yumi on iPhone](../specs/12-iphone-companion.md) | p2, after Android |

### Open questions for OBJ-29 to OBJ-34

Raised 2026-10-09 while writing these objectives.
Each needs a decision in the spec (spec-lifecycle skill), not in code.
Open items name their owner; resolved items stay listed so the history is easy to follow.

- **G1 Take-over vs approvals (SPEC-06 r2 and r5, SPEC-07 r11):** Resolved 2026-10-09 by Patrick: clicks on Yumi's own windows (cards, panels) never count as take-over, and there is no take-over pause while Yumi waits for the user and no UI lane is acting. Recorded in SPEC-06 r2 and Decisions.
- **G2 Take-over vs password fields (SPEC-05 r7, SPEC-06 r2):** Resolved 2026-10-09 by Patrick, by the G1 rule: a password field Yumi hands to the user never pauses the task. Recorded in SPEC-05 r7 and SPEC-06 r2.
- **G3 Voice on a delete card (SPEC-11 r9 vs SPEC-07 r11):** SPEC-11 says every button works by saying its label; SPEC-07 says a delete is approved only by a tap. OBJ-29 follows SPEC-07. Proposal: add an exception to SPEC-11 r9. Owner: Jepoy.
- **G4 "Cannot classify" (SPEC-07 r6):** Resolved 2026-10-09 by Patrick: "Quit", "Force Quit", Command-Q, and Command-Option-Escape are blocked; "cannot classify asks" applies only to key presses and to clicks in the risky apps (Mail, Messages, WhatsApp, Finder, System Settings); other clicks are allowed. Recorded in SPEC-07 r6 and Decisions. Follow-up for Patrick in SPEC-07 Open questions: unlisted clicks in Mail would ask during demo task 2.
- **G5 Missing copy (SPEC-05 r7, SPEC-07, SPEC-11):** SPEC-11 has no row for the SPEC-07 r5 blocked-action message, so the SPEC-11 copy test does not cover it. The SPEC-07 copy (password, declined send, one-file and several-folder delete cards, Messages send, several recipients) is drafted in SPEC-07 and waits for Patrick's review. Owner: Jepoy for the SPEC-11 row.
- **G6 Missing contracts (OBJ-01):** The scope of `pause` (every lane or UI lanes only; `PauseParams` has only `taskId`) and the reply to the blocked-action card ("Keep going" or "Stop"). The `ask` question and answer is covered by OBJ-01's `questionAsked` and `answerQuestion`. Owner: Jepoy.
- **G7 Paused by take-over:** Resolved 2026-10-09 by Patrick: "Paused. Say continue when you're ready, or cancel to stop for good." is spoken only for the stop shortcut and the menu bar "Stop"; a take-over pauses silently and shows the paused panel. Recorded in SPEC-06 r1, r2, and Decisions.
- **G8 Resume by voice:** Resolved 2026-10-09 by Patrick: the button stays "Resume", and both "continue" and "resume" work by voice. Recorded in SPEC-06 r6 and Decisions.
- **G9 GUI-created files (SPEC-05 r4):** The harness builds `files` from the step log, but a PDF exported through Keynote's menus is not in any tool call. OBJ-31.8 proposes watching the home folder during an attempt. Owner: Brent.
- **G10 Editing Yumi's own files (SPEC-07 r1):** Resolved 2026-10-09 by Patrick: dropped from the allowed list for p0. Recorded in SPEC-07 r1 and Decisions.
- **G11 Two invalid outputs in a row on `main`:** Still open in [docs/task-record-schema.md](../docs/task-record-schema.md). OBJ-31 ends the attempt with `stuck` until decided. Owner: Brent.
- **G12 Approval timeout on the Mac:** The 5-minute timeout comes from SPEC-09 r10 (approvals on the other device). Does it also apply when the approval is on the same Mac? Owner: Brent.
- **G13 "Show what I did" (SPEC-11):** The button is p0 and opens the action log, but opening the log from the menu bar is p1 (SPEC-07 r19). Owner: Jepoy.
- **G14 Orchestrator tools (SPEC-05 r9):** The limit is 8, but the spec does not name them. OBJ-31.2 proposes a list. Owner: Brent.
- **G15 Screenshot retention (SPEC-07 r20 vs SPEC-02 r10):** SPEC-07 (p1) deletes screenshots after 7 days; SPEC-02 keeps them forever. Owner: Brent.
- **G16 Stale pointers:** OBJ-01 (Jepoy), OBJ-03, OBJ-06, OBJ-07, and OBJ-09 (Brent), and OBJ-14 and OBJ-18 (Patrick) still say SPEC-05, SPEC-06, or SPEC-07 is "not finalized" or "not written yet" in Out of scope. Point them at OBJ-29 to OBJ-34. Owner: each objective's owner.

### Resolved conflicts between specs

Decided 2026-10-09.

- **SPEC-01 vs SPEC-10:** SPEC-10 wins. Android in p0 has no Whisper; it uses the on-device English recognizer and shows "Language not supported on this phone" for other languages. Whisper on the phone moved to p1 in SPEC-01. OBJ-24 already follows this.
- **SPEC-08 vs SPEC-09:** SPEC-09 wins. The VPS never queues commands, every command expires after 2 minutes, and goals waiting for an offline device are held on the origin device. The VPS only holds results and events through short reconnects. SPEC-08, the bridge docs, OBJ-02, OBJ-13, OBJ-21, and OBJ-23 are updated.
- **Phone confirmation without a model:** SPEC-10 requirement 8 adds fixed templates. Phone-only goals fill a sentence from the rule's fields; other goals echo the transcript and ask to send it to the Mac; replies are matched against fixed yes and no lists, and anything else is a correction. A phone-only goal the rule cannot parse is delegated to the Mac.
