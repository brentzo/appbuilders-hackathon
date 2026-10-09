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
| [OBJ-03](OBJ-03-harness-skeleton.md) | Harness skeleton and local model client | harness | Brent | 02 | 01 | - | todo |
| [OBJ-04](OBJ-04-task-store.md) | Task store and history | harness | Brent | 02 | 01, 03 | - | todo |
| [OBJ-05](OBJ-05-planner-and-scheduler.md) | Planner, scheduler, and task summary | harness | Brent | 02 | 03, 04 | - | todo |
| [OBJ-06](OBJ-06-resume-and-limits.md) | Resume and limits | harness | Brent | 02 | 04, 05 | - | todo |
| [OBJ-07](OBJ-07-lane-router-core.md) | Lane router core | harness | Brent | 03 | 01, 04 | 27 | todo |
| [OBJ-08](OBJ-08-locks-busy-windows-cap.md) | Window locks, busy windows, and cursor cap | harness | Brent | 03 | 07 | 27 | todo |
| [OBJ-09](OBJ-09-ghost-handoff.md) | Ghost handoff | harness | Brent | 03 | 06, 08 | - | todo |
| [OBJ-10](OBJ-10-yumi-cat-v0.md) | Yumi cat v0 in Rive | character | Patrick | 04 | - | - | todo |
| [OBJ-11](OBJ-11-whisper-bake-off.md) | Whisper bake-off | models | Jepoy | 01 | - | - | todo |
| [OBJ-12](OBJ-12-hey-yumi-wake-word.md) | "Hey Yumi" wake word model | models | Jepoy | 01 | - | - | todo |
| [OBJ-13](OBJ-13-bridge-relay-server.md) | Bridge relay server | bridge | Jepoy | 08 | 02 | - | todo |
| [OBJ-14](OBJ-14-mac-app-shell.md) | Mac app shell, permissions, and harness link | mac | Patrick | 01, 04 | 01 | 03 | todo |
| [OBJ-15](OBJ-15-mac-voice-intake.md) | Mac voice intake | mac | Patrick | 01 | 14 | 11 | todo |
| [OBJ-16](OBJ-16-mac-wake-word.md) | Mac wake word | mac | Patrick | 01 | 15 | 12 | todo |
| [OBJ-17](OBJ-17-goal-confirmation.md) | Goal confirmation loop | mac | Patrick | 01 | 04, 15, 18 | - | todo |
| [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) | Cursor overlay and motion | mac | Patrick | 04 | 14 | - | todo |
| [OBJ-19](OBJ-19-rive-cat-cursor.md) | Rive cat cursor | mac | Patrick | 04 | 10, 18 | - | todo |
| [OBJ-20](OBJ-20-window-tiling.md) | Window tiling with consent | mac | Patrick | 03 | 18, 27 | 08 | todo |
| [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md) | Mac bridge client and pairing | harness | Jepoy | 08 | 02, 13 | 03, 27 | todo |
| [OBJ-22](OBJ-22-android-app-shell.md) | Android app shell and foreground service | android | Brent | 10, 08, 01 | - | 10 | in-progress |
| [OBJ-23](OBJ-23-android-bridge-client.md) | Android bridge client and pairing | android | Brent | 08 | 02, 13, 22 | - | todo |
| [OBJ-24](OBJ-24-android-voice-intake.md) | Android voice intake and wake word | android | Brent | 01, 10 | 22 | 12 | todo |
| [OBJ-25](OBJ-25-cross-device-messages.md) | Cross-device message kinds | protocol | Jepoy | 09, 06, 07, 08, 10 | 01, 02 | - | todo |
| [OBJ-26](OBJ-26-gui-smoke-test.md) | Qwen3.5-9B smoke test on the demo tasks | models | Brent | 05 | - | - | todo |
| [OBJ-27](OBJ-27-mac-native-services.md) | Mac native services for the harness | mac | Patrick | 03, 08 | 14 | 07, 08, 21 | todo |
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
| 1 | OBJ-01 Task record schemas and cross-team contracts | Jepoy | 16 | Brent, Patrick |
| 2 | OBJ-03 Harness skeleton and local model client | Brent | 7 | Patrick |
| 3 | OBJ-14 Mac app shell, permissions, and harness link | Patrick | 7 | No |
| 4 | OBJ-04 Task store and history | Brent | 6 | Patrick |
| 5 | OBJ-02 Bridge envelope and end-to-end crypto | Jepoy | 4 | Brent |
| 6 | OBJ-18 Cursor overlay and motion | Patrick | 3 | No |
| 7 | OBJ-05 Planner, scheduler, and task summary | Brent | 2 | No |
| 8 | OBJ-07 Lane router core | Brent | 2 | No |
| 9 | OBJ-13 Bridge relay server | Jepoy | 2 | Brent |
| 10 | OBJ-15 Mac voice intake | Patrick | 2 | No |
| 11 | OBJ-22 Android app shell and foreground service | Brent | 2 | No |
| 12 | OBJ-06 Resume and limits | Brent | 1 | No |
| 13 | OBJ-08 Window locks, busy windows, and cursor cap | Brent | 1 | No |
| 14 | OBJ-10 Yumi cat v0 in Rive | Patrick | 1 | No |
| 15 | OBJ-27 Mac native services for the harness | Patrick | 1 | No |
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
<!-- generated:objectives-cross:end -->
Workload:

<!-- generated:objectives-workload:start -->
| Person | Objectives | Count |
|---|---|---|
| Brent | 03, 04, 05, 06, 07, 08, 09, 22, 23, 24, 26 | 11 |
| Jepoy | 01, 02, 11, 12, 13, 21, 25 | 7 |
| Patrick | 10, 14, 15, 16, 17, 18, 19, 20, 27 | 9 |
<!-- generated:objectives-workload:end -->
## Suggested order

Waves come from hard dependencies only. Each person works their column top to bottom; objectives in the same row can run in parallel.

<!-- generated:objectives-waves:start -->
| Wave | Brent | Jepoy | Patrick |
|---|---|---|---|
| 1 | OBJ-22, OBJ-26 | OBJ-01, OBJ-02, OBJ-11, OBJ-12 | OBJ-10 |
| 2 | OBJ-03, OBJ-24 | OBJ-13, OBJ-25 | OBJ-14 |
| 3 | OBJ-04, OBJ-23 | OBJ-21 | OBJ-15, OBJ-18, OBJ-27 |
| 4 | OBJ-05, OBJ-07 | - | OBJ-16, OBJ-17, OBJ-19, OBJ-20 |
| 5 | OBJ-06, OBJ-08 | - | - |
| 6 | OBJ-09 | - | - |
<!-- generated:objectives-waves:end -->
## Not covered yet

Objectives exist for specs whose decisions are final: SPEC-01, SPEC-02, SPEC-03, SPEC-04, and SPEC-08, plus the Android app shell and voice parts of SPEC-10 Part A.

| Spec | Why not yet |
|---|---|
| [SPEC-05 Mac GUI control](../specs/05-mac-gui-control.md) | The 3 demo tasks are decided. Its schemas are in OBJ-01 and the p0 model check is OBJ-26. The harness `gui_act` objective is not written yet, and the full model bake-off is p1 |
| [SPEC-06 User control](../specs/06-user-control.md) | No open questions, but not reviewed yet |
| [SPEC-07 Safety](../specs/07-safety.md) | Open question: "always allow" for risky actions |
| [SPEC-09 Cross-device routing](../specs/09-cross-device-routing.md) | Defined by Jepoy (b824989). Not reviewed together yet. Its conflicts with SPEC-01, SPEC-08, and SPEC-10 are resolved (see below). Its message kinds are OBJ-25. Objectives for the p0 rule, phone tools, and delegation in the apps come after review |
| [SPEC-10 Yumi on Android](../specs/10-android-companion.md) | Part A (p0): app shell and voice are covered by OBJ-22 and OBJ-24; phone-only goals and phone tools wait on SPEC-09. Part B (p1): the model is decided, Qwen3.5-4B fixed |
| [SPEC-11 User-facing errors](../specs/11-user-facing-errors.md) | Expanded by Jepoy. Every objective follows it |
| [SPEC-12 Yumi on iPhone](../specs/12-iphone-companion.md) | p2, after Android |

### Resolved conflicts between specs

Decided 2026-10-09.

- **SPEC-01 vs SPEC-10:** SPEC-10 wins. Android in p0 has no Whisper; it uses the on-device English recognizer and shows "Language not supported on this phone" for other languages. Whisper on the phone moved to p1 in SPEC-01. OBJ-24 already follows this.
- **SPEC-08 vs SPEC-09:** SPEC-09 wins. The VPS never queues commands, every command expires after 2 minutes, and goals waiting for an offline device are held on the origin device. The VPS only holds results and events through short reconnects. SPEC-08, the bridge docs, OBJ-02, OBJ-13, OBJ-21, and OBJ-23 are updated.
- **Phone confirmation without a model:** SPEC-10 requirement 8 adds fixed templates. Phone-only goals fill a sentence from the rule's fields; other goals echo the transcript and ask to send it to the Mac; replies are matched against fixed yes and no lists, and anything else is a correction. A phone-only goal the rule cannot parse is delegated to the Mac.
