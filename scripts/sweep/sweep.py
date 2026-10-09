#!/usr/bin/env python3
"""Scenario sweep: a TEST TOOL, not product code. It measures what Yumi and Qwen3.5-9B can do.

It submits each scenario's goal to the running harness in Auto mode, the way the Mac app does,
follows the task until it ends or the time limit passes, judges the result on the Mac itself, and
undoes what the run made. Results go to a JSONL file and a table in wiki/model-capability.md.

    python3 scripts/sweep/sweep.py list
    python3 scripts/sweep/sweep.py run --live [SCENARIO ...] [--runs 3] [--timeout 240]
    python3 scripts/sweep/sweep.py run --live --short      # 5 scenarios once each, under 15 minutes
    python3 scripts/sweep/sweep.py report results.jsonl

It needs the Yumi app and the harness running, because the Mac app carries out the actions. It
connects to the harness without saying hello, so it never takes the Mac app's place. `--live` is
required to use the real socket, so a sweep never starts by accident. See README.md here for what
it opens and changes on the Mac.
"""
import argparse
import datetime
import json
import os
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness_client import HarnessClient, HarnessError  # noqa: E402
from mac import HOME, Mac  # noqa: E402
import scenarios as catalog  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SUPPORT = HOME / "Library/Application Support/Yumi"
DEFAULT_SOCKET = SUPPORT / "harness.sock"
DEFAULT_LOG = SUPPORT / "harness.log"
DEFAULT_OUT = ROOT / "models/sweep-results"
WIKI = ROOT / "wiki/model-capability.md"

# The short sweep (Brent, 2026-10-10): the demo's own goals, once each, under 15 minutes.
SHORT = ["spotify-play", "keynote-export", "notes-summary", "downloads-list-note", "parallel"]
SHORT_TIMEOUT = 140.0
SHORT_IDLE_WAIT = 30.0
# How long the runner waits for a task it cancelled to say so.
CANCEL_GRACE = 15.0
# Setup, cleanup, and the checks, per run, as an upper estimate.
OVERHEAD = 15.0

ACTIVE = {"awaitingConfirmation", "queued", "planning", "running", "waitingForUser", "paused"}
ENDED = {"done", "failed", "cancelled"}
POLL_SECONDS = 0.5


class Runner:
    def __init__(self, client, mac, log_path, timeout=240.0, idle_wait=120.0):
        self.client = client
        self.mac = mac
        self.log_path = Path(log_path)
        self.timeout = timeout
        self.idle_wait = idle_wait

    def run(self, scenario, number):
        record = {"scenario": scenario.id, "run": number, "goal": scenario.goal,
                  "startedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds")}
        busy = self.wait_until_idle()
        if busy:
            return {**record, "skipped": f"the harness is busy with task {busy}"}
        ctx = {}
        try:
            reason = scenario.setup(self.mac, ctx)
        except Exception as error:  # A test tool: say what broke and go on with the next run.
            scenario.cleanup(self.mac, ctx)
            return {**record, "skipped": f"setup failed: {error}"}
        if reason:
            scenario.cleanup(self.mac, ctx)
            return {**record, "skipped": reason}
        watched_before = self.mac.snapshot(catalog.WATCHED)
        try:
            record.update(self.follow(scenario, ctx))
            passed, detail = scenario.check(self.mac, ctx, record)
            if scenario.expects_approval and not record.get("approvalCard"):
                passed = False
            record["passed"], record["check"] = passed, detail
        except Exception as error:
            record["passed"], record["error"] = False, f"{type(error).__name__}: {error}"
        finally:
            record["unexpectedChanges"] = self.unexpected(watched_before, ctx)
            try:
                scenario.cleanup(self.mac, ctx)
            except Exception as error:
                record["cleanupError"] = f"{type(error).__name__}: {error}"
        return record

    def wait_until_idle(self):
        """None once no task is active, else the id of the task still active after idle_wait."""
        deadline = self.mac.now() + self.idle_wait
        while True:
            active = [t for t in self.client.list_tasks() if t["status"] in ACTIVE]
            if not active:
                return None
            if self.mac.now() >= deadline:
                return active[0]["id"]
            self.mac.sleep(2)

    def follow(self, scenario, ctx):
        log_offset = self.log_path.stat().st_size if self.log_path.exists() else 0
        ctx["startedAt"] = started = self.mac.now()
        task_id = self.client.submit_goal(scenario.goal)
        result = {"taskId": task_id, "timedOut": False, "approvalCard": None, "question": False, "cancelledBySweep": False}
        detail = None
        while True:
            detail = self.client.get_task(task_id)
            status = detail["task"]["status"]
            if status in ENDED:
                break
            waiting = [s for s in detail["subtasks"] if s["status"] == "needsApproval"]
            if waiting and not result["approvalCard"]:
                # Recorded, then cancelled: the sweep never approves a delete or a send.
                result["approvalCard"] = waiting[0]["title"]
                self.cancel(task_id, result)
            elif status == "waitingForUser" and not waiting and not result["question"]:
                result["question"] = True
                self.cancel(task_id, result)
            elif self.mac.now() - started > self.timeout and not result["timedOut"]:
                result["timedOut"] = True
                self.cancel(task_id, result)
            elif result["cancelledBySweep"] and self.mac.now() - started > self.timeout + CANCEL_GRACE:
                break
            self.mac.sleep(POLL_SECONDS)
        result["seconds"] = round(self.mac.now() - started, 1)
        result.update(summarize(detail))
        result.update(read_log(self.log_path, log_offset, task_id))
        return result

    def cancel(self, task_id, result):
        try:
            self.client.cancel_task(task_id)
            result["cancelledBySweep"] = True
        except HarnessError as error:
            result["cancelError"] = str(error)

    def unexpected(self, before, ctx):
        """Changes in Desktop, Documents, and Downloads that are not the scenario's fixtures or outputs."""
        after = self.mac.snapshot(catalog.WATCHED)
        expected = set(ctx.get("outputs", []))
        before_inodes = {inode: path for path, (inode, _, _) in before.items()}
        changes = []
        for path, (inode, size, mtime) in after.items():
            if path in expected or "yumi sweep" in path.lower() or "yumi-sweep" in path.lower():
                continue
            old = before_inodes.get(inode)
            if old is None:
                changes.append(f"new {Path(path).name}")
            elif old != path:
                changes.append(f"renamed {Path(old).name} -> {Path(path).name}")
            elif before[path][1:] != (size, mtime):
                changes.append(f"changed {Path(path).name}")
        after_inodes = {inode for inode, _, _ in after.values()}
        for path, (inode, _, _) in before.items():
            if inode not in after_inodes and "yumi sweep" not in path.lower() and "yumi-sweep" not in path.lower():
                changes.append(f"gone {Path(path).name}")
        return changes[:20]


def summarize(detail):
    task, subtasks, steps = detail["task"], detail["subtasks"], detail["steps"]
    order = {sid: i for i, sid in enumerate(task.get("plan", []))}
    subtasks = sorted(subtasks, key=lambda s: order.get(s["id"], len(order)))
    broken = [s for s in subtasks if s["status"] not in ("done",)]
    last_subtask = (broken or subtasks or [None])[0 if broken else -1]
    last_step = max(steps, key=lambda s: (s["startedAt"], s["index"])) if steps else None
    return {
        "status": task["status"],
        "steps": len(steps),
        "subtasks": [{"title": s["title"], "status": s["status"], "lane": s.get("lane")} for s in subtasks],
        "lastSubtask": {"title": last_subtask["title"], "status": last_subtask["status"]} if last_subtask else None,
        "lastObservation": last_step.get("observation") if last_step else None,
        "lastOutcome": last_step.get("outcome") if last_step else None,
    }


def read_log(path, offset, task_id):
    """Model calls and failures for the task, from the harness log written since the run began."""
    calls, total_ms, purposes, kinds, failures = 0, 0, Counter(), [], []
    path = Path(path)
    if path.exists():
        with open(path, "rb") as f:
            f.seek(offset)
            for raw in f:
                try:
                    line = json.loads(raw)
                except ValueError:
                    continue
                if line.get("taskId") != task_id:
                    continue
                event = line.get("event")
                if event == "model.reply":
                    calls += 1
                    total_ms += line.get("durationMs", 0)
                    purposes[line.get("purpose", "?")] += 1
                elif event == "model.failure":
                    calls += 1
                    total_ms += line.get("durationMs", 0)
                    failures.append(line.get("failure"))
                elif event == "task.failed" and line.get("kind"):
                    kinds.append(line["kind"])
    return {
        "modelCalls": calls,
        "modelSeconds": round(total_ms / 1000, 1),
        "modelCallsByPurpose": dict(purposes),
        "modelFailures": failures,
        "userErrorKind": kinds[-1] if kinds else None,
    }


# Report


def outcome_of(record):
    if record.get("skipped"):
        return "skipped"
    if record.get("passed"):
        return "pass"
    if record.get("timedOut"):
        return "timed out"
    if record.get("approvalCard"):
        return f"card: {record['approvalCard']}"
    if record.get("question"):
        return "asked a question"
    if record.get("userErrorKind"):
        return record["userErrorKind"]
    return "check failed"


def table(records):
    rows = ["| Scenario | Passed | Median s | Median steps | Model calls | Model s | Where it broke |",
            "|---|---|---|---|---|---|---|"]
    order = [s.id for s in catalog.all_scenarios()]
    by = {}
    for r in records:
        by.setdefault(r["scenario"], []).append(r)
    for sid in sorted(by, key=lambda s: order.index(s) if s in order else len(order)):
        runs = [r for r in by[sid] if not r.get("skipped")]
        if not runs:
            rows.append(f"| {sid} | skipped | | | | | {by[sid][0]['skipped']} |")
            continue
        passed = sum(1 for r in runs if r.get("passed"))

        def median(key):
            values = [r[key] for r in runs if isinstance(r.get(key), (int, float))]
            return f"{statistics.median(values):g}" if values else ""

        failures = Counter(outcome_of(r) for r in runs if not r.get("passed"))
        where = ", ".join(f"{k} ({n})" for k, n in failures.most_common(2))
        last = next((r for r in runs if not r.get("passed") and r.get("lastSubtask")), None)
        if last:
            where += f"; last subtask {last['lastSubtask']['title']!r}"
        rows.append(f"| {sid} | {passed} of {len(runs)} | {median('seconds')} | {median('steps')} | "
                    f"{median('modelCalls')} | {median('modelSeconds')} | {where.replace('|', '/')} |")
    return "\n".join(rows)


START, END = "<!-- sweep-table:start -->", "<!-- sweep-table:end -->"


def write_wiki(records, results_file, wiki=WIKI):
    when = records[0]["startedAt"][:16].replace("T", " ") if records else ""
    block = (f"{START}\nSweep of {when}, {len(records)} runs, from `{Path(results_file).name}`.\n"
             f"Written by `scripts/sweep/sweep.py`; do not edit this block by hand.\n\n{table(records)}\n{END}")
    if wiki.exists() and START in wiki.read_text():
        text = wiki.read_text()
        text = text[:text.index(START)] + block + text[text.index(END) + len(END):]
    else:
        text = WIKI_TEMPLATE.replace("{table}", block)
    wiki.write_text(text)


WIKI_TEMPLATE = """# What Yumi and Qwen3.5-9B can do on the Mac

The scenario sweep's results: each demo-style goal, said in Auto mode, three times, judged on the Mac itself.
Measured on Brent's Mac (16 GB, Qwen3.5-9B 4-bit on mlx-vlm), with the Yumi app and harness from local main.

## How it was measured

`scripts/sweep/sweep.py` submits each goal to the harness the way the Mac app does, follows the task until it ends or 4 minutes pass, and checks the result on the Mac: a file, a note, a reminder, the frontmost app.
A delete or send card is recorded and the task cancelled, never approved.
"Model calls" and "Model s" count every call the harness made to the model for the task, and their total time.

## Results

{table}

## What it means

To be written after the first full sweep.
"""


# CLI


def plan(args):
    """The scenarios, runs per scenario, time limit per run, and idle wait a `run` asks for."""
    known = catalog.by_id()
    unknown = [s for s in args.scenarios if s not in known]
    if unknown:
        raise ValueError(f"unknown scenario(s): {', '.join(unknown)}")
    if args.short and args.scenarios:
        raise ValueError("--short picks its own scenarios; leave the ids out")
    ids = SHORT if args.short else args.scenarios
    chosen = [known[s] for s in ids] or catalog.all_scenarios()
    runs = args.runs or (1 if args.short else 3)
    timeout = args.timeout or (SHORT_TIMEOUT if args.short else 240.0)
    idle_wait = SHORT_IDLE_WAIT if args.short else 120.0
    return chosen, runs, timeout, idle_wait


def worst_case_minutes(runs, timeout):
    """Every run reaching its time limit, then the cancel and the cleanup."""
    return runs * (timeout + CANCEL_GRACE + OVERHEAD) / 60


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="list the scenarios")
    run = sub.add_parser("run", help="run scenarios against the harness")
    run.add_argument("scenarios", nargs="*", help="scenario ids (default: all)")
    run.add_argument("--live", action="store_true", help="use the real harness socket (required unless --socket is given)")
    run.add_argument("--socket", help="harness socket (default: the live one, with --live)")
    run.add_argument("--log", default=str(DEFAULT_LOG), help="harness log, for model calls and error kinds")
    run.add_argument("--short", action="store_true", help=f"one run each of {', '.join(SHORT)}, at most {SHORT_TIMEOUT:g} s each")
    run.add_argument("--runs", type=int, help="runs per scenario (default 3, or 1 with --short)")
    run.add_argument("--timeout", type=float, help="seconds per run before the sweep cancels it (default 240, or 150 with --short)")
    run.add_argument("--out", help="JSONL file (default: models/sweep-results/sweep-<time>.jsonl)")
    run.add_argument("--no-wiki", action="store_true", help="do not write wiki/model-capability.md")
    report = sub.add_parser("report", help="write the wiki table from a JSONL file")
    report.add_argument("results")
    args = parser.parse_args(argv)

    if args.command == "list":
        for s in catalog.all_scenarios():
            print(f"{s.id:22} {s.goal}")
        return 0
    if args.command == "report":
        records = [json.loads(line) for line in Path(args.results).read_text().splitlines() if line.strip()]
        write_wiki(records, args.results)
        print(table(records))
        return 0

    if not args.socket and not args.live:
        parser.error("say --live to use the real harness socket, or --socket for another one")
    try:
        chosen, runs, timeout, idle_wait = plan(args)
    except ValueError as error:
        parser.error(str(error))
    print(f"{len(chosen)} scenario(s) x {runs} run(s), at most {timeout:g} s each: "
          f"at most about {worst_case_minutes(len(chosen) * runs, timeout):.0f} minutes", flush=True)
    out = Path(args.out) if args.out else DEFAULT_OUT / f"sweep-{datetime.datetime.now():%Y%m%d-%H%M}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    records = []
    with HarnessClient(args.socket or str(DEFAULT_SOCKET)) as client:
        runner = Runner(client, Mac(), args.log, timeout=timeout, idle_wait=idle_wait)
        for scenario in chosen:
            for number in range(1, runs + 1):
                record = runner.run(scenario, number)
                records.append(record)
                with open(out, "a") as f:
                    f.write(json.dumps(record) + "\n")
                print(f"{scenario.id} run {number}: {outcome_of(record)} "
                      f"({record.get('seconds', '-')} s, {record.get('steps', '-')} steps)", flush=True)
    print(f"\nResults: {out}")
    if not args.no_wiki:
        write_wiki(records, out)
        print(f"Table: {WIKI.relative_to(ROOT)}")
    print(table(records))
    return 0


if __name__ == "__main__":
    sys.exit(main())
