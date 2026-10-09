# Demo readiness

Date: 2026-10-09, 11:20 pm.
Audited on `main` at `b29370a` by Jepoy, with Claude Code.
Scope: every product, every objective, the live relay, and every check `scripts/verify.py` runs.

## Summary

Yumi is not ready for an end-to-end demo yet.
Most building blocks exist and pass their tests, but the path from "the user says a goal" to "the cat does it" is not connected.

- The real harness cannot start a task from the Mac app: it serves 10 of the 14 app-to-harness RPC methods, and `submitGoal`, `replyToConfirmation`, `answerQuestion`, and `pause` are missing.
- Nothing captures a goal on the Mac yet: no push-to-talk, no wake word, no typed goal (OBJ-15, OBJ-16).
- The harness cannot drive the Mac's GUI yet: the `gui_act` sub-agent (OBJ-36) is not started, although the Mac side (OBJ-39) is mostly built.
- Demo task 2 (Mail) stops for approval before Send, and approvals do not exist yet (OBJ-38, OBJ-40).
- The phone has no bridge client and no voice (OBJ-23, OBJ-24), and SPEC-09 cross-device routing has no app objectives at all.

Of 39 p0 objectives, 15 are done, 7 are in progress, 1 is blocked, and 16 are not started.
The relay is live on protocol version 4 and healthy.

## The demo, step by step

The demo story, from the specs: the user says a goal, Yumi repeats it back, the user confirms, and the cat cursor does the three demo tasks from SPEC-05 (Keynote export, Mail to Ana, Notes summary), with the phone as a voice remote.

| Step | Specs | Ready | What exists | What is missing |
|---|---|---|---|---|
| 1. Start Yumi on the Mac | SPEC-02 | Partly | The Mac app launches the real harness by default (OBJ-27). The model server is started by hand, as in `harness/README.md`. | A single start command for the demo Mac. A model readiness signal: `mac/Yumi/App/ModelReadiness.swift` is a placeholder waiting on a protocol event (OBJ-14 open question, Jepoy and Brent). |
| 2. Say the goal | SPEC-01 | No | A Mac Whisper model is recommended (OBJ-11). | Push-to-talk and typed goals (OBJ-15), the wake word model and its Mac integration (OBJ-12, OBJ-16), and Jepoy's confirmation of the Whisper pick (OBJ-11). |
| 3. Repeat back and confirm | SPEC-01 | No | The contract (`submitGoal`, `replyToConfirmation`). | The harness handlers and the Mac's confirmation loop (OBJ-17). OBJ-05 left `submitGoal` to OBJ-17. |
| 4. Plan and route | SPEC-02, SPEC-03 | Mostly | Planner, scheduler, resume, and limits (OBJ-05, OBJ-06). The lane router (OBJ-07). | OBJ-07.3, the app capability probe, has not run against the real Mac app. |
| 5. The cat does the work | SPEC-04, SPEC-05 | Partly | The Mac reads trimmed accessibility trees and acts on numbered elements (OBJ-39). Qwen3.5-9B exported the Keynote PDF in 5 of 5 constrained runs in round 3 of the smoke test (OBJ-26). The cursor overlay moves (OBJ-18). | The `gui_act` sub-agent (OBJ-36). Hand checks of OBJ-39 in Keynote, Mail, and Notes. Any Mail or Notes runs with 9B: the Mail account and the Notes location are not decided. The Rive cat: the cursor is a placeholder drawing (OBJ-10, OBJ-19). |
| 6. Ghost cursors and tiling | SPEC-03 | Partly | Window tiling with consent, Mac side (OBJ-20). | Window locks, busy windows, and the cursor cap (OBJ-08), and ghost handoff (OBJ-09). The harness never emits `tilingSuggested`. |
| 7. Safety and approvals | SPEC-07 | Partly | The permission gate and typed file tools (OBJ-37). | Approvals, pause, and the action log (OBJ-38), and the approval cards (OBJ-40). Demo task 2 needs both. |
| 8. Stop and take over | SPEC-06 | No | The contract (`pause`, `resumeTask`, `cancelTask`). | The stop shortcut and take-over (OBJ-35), and the harness `pause` handler. |
| 9. The phone | SPEC-08, SPEC-09, SPEC-10 | No | The relay is deployed and live. The Mac bridge client and pairing (OBJ-21). The Android app shell and foreground service (OBJ-22). | The Android bridge client (OBJ-23) and voice (OBJ-24). Objectives for SPEC-09 routing and phone tools. The Mac waiting for the relay's pairing verdict (OBJ-41), so pairing is not shown before it lands. The live cross-device run (OBJ-30). |
| 10. Errors the user sees | SPEC-11 | Yes | The SPEC-11 copy is in both apps, and tests check it against the spec table. | Copy for a protocol version mismatch (OBJ-42, p1). |

## Objectives

| Status | p0 | p1 |
|---|---|---|
| Done | 15: OBJ-01 to 06, 14, 18, 21, 22, 27, 29, 31, 32, 37 | 0 |
| In progress | 7: OBJ-07, 11, 13, 20, 26, 33, 39 | 1: OBJ-34 |
| Blocked | 1: OBJ-25 | 0 |
| Not started | 16: OBJ-08, 09, 10, 12, 15, 16, 17, 19, 23, 24, 30, 35, 36, 38, 40, 41 | 4: OBJ-28, 42, 43, 44 |

The critical path to a Mac-only demo is OBJ-15, then OBJ-17, then OBJ-36, then OBJ-38 and OBJ-40.
OBJ-36 also depends on OBJ-07, which is one check away from done.

## Checks

| Check | Where | Result |
|---|---|---|
| Objectives and docs | Windows | Passed |
| Protocol, with Swift and Kotlin round trips | Windows | Passed |
| Bridge relay | Windows | Passed, 27 tests |
| Whisper benchmark tests | Windows | Passed |
| Harness | Linux (Docker, `node:24-bookworm`) | 331 of 332 passed; the one failure is the `strict-delete.test.ts` test below |
| Harness | Windows | 81 failed, all on macOS and POSIX paths; the harness is not meant to run on Windows |
| Android build, unit tests, and lint | Linux (Docker, `ghcr.io/cirruslabs/android-sdk:36`) | Passed |
| Mac build and tests | - | Not run: needs a Mac with Xcode |

## Live relay

Checked 2026-10-09 at 11:15 pm from this machine.

- `https://yumibridge.studiokova.co/health` returns `{"status":"ok"}`.
- A handshake with protocol version 999 was refused with `{"frame":"refused","reason":"unsupportedVersion","protocolVersion":4}`.
  So the relay speaks version 4 and runs a build with OBJ-34, which is the first to name its version in a refusal.
  A refused device is never registered, so the check left nothing behind.
- `wiki/bridge-deployment.md` still records the first deploy (commit `5f00ac9`, version 3) and does not name the commit running now.

## Risks for demo day

- **Memory on the 16 GB Mac.** Qwen3.5-9B peaks at 8.6 GiB and the recommended Whisper model adds about 0.8 GiB (OBJ-11), before the wake word model, which does not exist yet.
  OBJ-26 found the 9B server unusable next to Gradle and the Android emulator: a 618-token prompt took 3 minutes 41 seconds and timed out.
  Run nothing else heavy on the demo Mac.
- **Speed.** Prompt processing takes about 4 seconds per step at 1,000 prompt tokens and 11 seconds at 3,200 (OBJ-26), so long trees and histories slow every step.
- **The model has only been measured on Keynote.** Round 3 passed on the file check, but the model never declared the task done.
  Mail and Notes have no runs.
- **The demo Mac.** Keynote was not installed on the Mac where OBJ-39 was built, and the app needs Accessibility and Screen Recording permission on the demo Mac.
  Whether key events reach Keynote's out-of-process save panel is unverified (OBJ-26).
- **Model server settings.** `harness/README.md` says to start the server with `--max-num-seqs` equal to `YUMI_MODEL_PARALLEL_SLOTS` (default 3), but the start command it gives leaves the flag out.
- **The venue network.** The phone and Mac reach each other only through the relay, so the demo needs internet on both devices.
  The Mac-only demo does not.
- **Upgrades.** The relay accepts only one protocol version, so the Mac, the phone, and the relay have to run builds of the same version on demo day.

## What can be shown today

Each of these runs now, and each needs saying out loud that it is not the full product:

- The Mac app against the mock harness, with "Send sample goal to the mock" playing a script from `protocol/mocks/scripts/`: the menu bar, cursor overlay, window tiling, and error copy. The menu shows "Using the" and the mock's name the whole time.
- The GUI debug window in Debug builds of the Mac app, reading and pressing elements by number.
- The OBJ-26 smoke test, `models/gui/smoke.py`, exporting the Keynote PDF with Qwen3.5-9B.
- The Android app shell with its placeholder cat, which lists its own stand-ins in Settings.

## Bookkeeping found along the way

- SPEC-11 has two requirements numbered 12.
- OBJ-17.1 is harness code (the `submitGoal` handler) inside a Mac objective owned by Patrick, while the harness is Brent's.
- OBJ-13.7 (unpairing at the relay) is unchecked, although the relay's unpair acknowledgement shipped with OBJ-31.
- OBJ-25 is `blocked` only because `verify.py` cannot pass the harness on Windows, yet its commits are on `main`; it needs a run on macOS or Linux and an Outcome.
- `strict-delete.test.ts` "files in several folders name their shared folder" fails on Linux since OBJ-37.
- Open gaps in `objectives/README.md`: G3, G5, G6, and G13 (Jepoy), G9, G11, G12, G14, and G15 (Brent), and G16 (everyone).
- A local worktree for OBJ-28 holds an uncommitted `OBJ-42-android-whisper-benchmark-support.md`; OBJ-42 is now taken on `main`, so it needs the next free number.

## Before the demo, in order

| # | Action | Owner |
|---|---|---|
| 1 | Decide the demo cut: which steps run live, which are left out, and whether the phone is in it. | Brent |
| 2 | Serve `submitGoal` and `replyToConfirmation` in the harness (OBJ-17.1), and agree who builds it. | Brent, Patrick |
| 3 | Push-to-talk and typed goals on the Mac (OBJ-15), after Jepoy confirms the Whisper model (OBJ-11). | Patrick, Jepoy |
| 4 | The `gui_act` sub-agent (OBJ-36), and the OBJ-39 hand checks in Keynote, Mail, and Notes. | Brent, Patrick |
| 5 | Approvals and cards for demo task 2 (OBJ-38, OBJ-40). | Brent, Patrick |
| 6 | Decide the Mail account and Notes location, then run the Mail and Notes smoke tests (OBJ-26). | Brent |
| 7 | If the phone is in the demo: OBJ-23, OBJ-24, SPEC-09 objectives, OBJ-41, then the live run (OBJ-30). | Brent, Jepoy |
| 8 | Set up the demo Mac: Keynote installed, permissions granted, model downloaded, one start command, nothing else heavy running. | Patrick, Brent |
| 9 | Jepoy's open items: the model readiness event, G3, G5, G6, G13, the wake word (OBJ-12), and closing OBJ-13, OBJ-25, and OBJ-33. | Jepoy |
| 10 | Record the running relay commit in `wiki/bridge-deployment.md`. | Brent |

## Not verified

- The Mac app, which needs Xcode: its build and tests, and every hand check listed in OBJ-20, OBJ-27, and OBJ-39.
- Anything on the demo Mac or the demo phone: memory, speed, permissions, and the model.
- Model quality beyond the OBJ-26 Keynote runs.
