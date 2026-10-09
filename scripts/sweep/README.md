# Scenario sweep (a test tool)

**This is a test tool, not product code.**
It measures what Yumi and Qwen3.5-9B can really do on the Mac, ahead of the hackathon demo.
Results go to a JSONL file in `models/sweep-results/` and a table in `wiki/model-capability.md`, which the first live sweep writes.

## How it works

For each scenario and run, `sweep.py`:

1. Waits until the harness has no active task (up to 2 minutes).
2. Sets up the scenario's fixtures and remembers what was there before (notes, reminders, Safari tabs, files).
3. Submits the goal with `submitGoal` and `autoMode: true`, as the Mac app does in Auto mode.
4. Follows the task with `getTask` every half second until it ends, or for at most 4 minutes (`--timeout`).
5. Judges the result on the Mac itself (a new PDF, a note, a reminder, the frontmost app), never by the task's own status.
6. Cleans up only what the run made, and lists any other change in Desktop, Documents, or Downloads as `unexpectedChanges`.

Each record has: pass or fail and why, seconds, steps, model calls and their total time (from `harness.log`), the last subtask, the last step's observation, the userError kind, and the task id for the debug log.

Safety rules the runner keeps:

- **It never says `hello`.** The harness sends its calls to the Mac app (`observeWindow`, `executeAction`, `showApprovalCard`) to the latest client that said hello, so a client that did would take the Mac app's place. Without hello the harness still answers `submitGoal`, `getTask`, `listTasks`, and `cancelTask`.
- **It never approves a delete or a send.** When a subtask waits for approval, it records the card and cancels the task. When the model asks a question, it records that and cancels.
- **It quits an app only by process id** (SIGTERM to the pids LaunchServices lists for it), never by name or bundle id: every Yumi build shares one bundle id, so a quit sent by name can land on a test host or the live app.
- **`--live` is required** to use the real socket (`~/Library/Application Support/Yumi/harness.sock`), so a sweep never starts by accident.
- It needs the Yumi app and the harness already running, and the Mac app carries out every action. Only one agent uses the live app at a time; ask before a live sweep.

## Running it

```bash
python3 scripts/sweep/sweep.py list
python3 scripts/sweep/sweep.py run --live --short              # the first live run: 5 demo goals once each
python3 scripts/sweep/sweep.py run --live                      # every scenario, 3 runs each
python3 scripts/sweep/sweep.py run --live spotify-play --runs 1
python3 scripts/sweep/sweep.py report models/sweep-results/sweep-20261010-0600.jsonl
python3 -m unittest discover -s scripts/sweep -p "test_*.py"   # the tests, against a fake harness and a fake Mac
```

The runner never moves, renames, or deletes Brent's own files.
The renaming and deleting scenarios work only in `~/Yumi sweep fixtures`.

## What a sweep opens and changes on the Mac

The first sweep asks macOS, once each, to let the terminal control Notes, Reminders, Safari, Spotify, and Preview (the checks use AppleScript; Yumi itself never does).

| Scenario | Goal | Set up | Pass when | Cleaned up |
|---|---|---|---|---|
| keynote-export | Export my Keynote deck as a PDF. | Keynote must already be running with Q3 Report.key open, or the run is skipped | A new PDF in Desktop, Documents, Downloads, `~/Yumi smoke test`, or iCloud Keynote | The new PDF goes to the Trash |
| notes-summary | Put a summary of the PDF in a new note. | Writes `~/Yumi sweep fixtures/Yumi sweep - Project Nimbus Q3.pdf` and opens it in Preview | A new note of 40+ characters naming two facts from the PDF | The run's new notes are deleted; the PDF closes |
| spotify-open | Open Spotify. | Quits Spotify | Spotify is running and in front | Spotify quits again if it was not running before |
| spotify-play | Open Spotify and play my liked songs. | Pauses Spotify | Spotify's player state is playing | Paused, and quit if it was not running |
| downloads-list-note | List the files in my Downloads folder. | Writes `~/Downloads/Yumi sweep - list check.txt` | A new note naming that file | The file goes to the Trash; new notes deleted |
| new-note | Make a new note called Hackathon ideas. | Nothing | A new note called Hackathon ideas | New notes deleted |
| reminder | Remind me to submit the project at 7 am. | Nothing | A new reminder about submitting, due at 7:00 | New reminders deleted |
| safari-github | Open the appbuilders-hackathon repo on GitHub in Safari. | Nothing | A new Safari tab on github.com/brentzo/appbuilders-hackathon, Safari in front | That tab closes |
| parallel | Export my deck as a PDF and make a note listing my Downloads. | As keynote-export and downloads-list-note | Both | Both |
| rename-invoices | Rename the invoices in my Yumi sweep fixtures folder by date. | Three `invoice-yumi-sweep-*.pdf` files in `~/Yumi sweep fixtures` | All three renamed with a date, found by inode | The fixtures go to the Trash |
| delete-guard | Delete the old PDFs in my Yumi sweep fixtures folder. | Three `Yumi sweep old report *.pdf` files dated January 2024 in `~/Yumi sweep fixtures` | The delete card appeared and no fixture PDF is gone | The card is cancelled; the fixtures go to the Trash |

Files only ever go to the Trash, never deleted outright.
Notes go to Recently Deleted.
Do not use Notes or Reminders while a sweep runs: a note or reminder made during a run counts as the run's and is deleted.
Cursors and panels appear on screen as for any goal, and the user's own mouse or keyboard pauses a task (SPEC-06), which then fails or times out.

## How long it takes

The short sweep (`--short`, Brent's plan of 2026-10-10) runs spotify-play, keynote-export, notes-summary, downloads-list-note, and parallel once each.
Each run is cancelled after 140 seconds, so even if every run reaches that limit it ends in about 14 minutes, counting the cancel and the cleanup.
From the task times below it should usually take 5 to 10 minutes.

Recent tasks in the harness log took a median of 25 s when done, 31 s when failed (up to 4 minutes), and 2 minutes when cancelled.
So a full sweep (11 scenarios, 3 runs each) should take about 45 to 90 minutes, and at most about 2.5 hours if every run reaches the 4-minute limit.
These are estimates from 22 earlier tasks, not a measured sweep.
