"""Tests for the scenario sweep, against a fake harness on a temporary socket and a fake Mac.

Nothing here touches the real Mac or the live harness socket.
Run: python3 -m unittest discover -s scripts/sweep -p "test_*.py"
"""
import contextlib
import io
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import scenarios as catalog  # noqa: E402
import sweep  # noqa: E402
from harness_client import HarnessClient  # noqa: E402

NOW = "2026-10-10T05:00:00.000Z"


class FakeHarness:
    """Answers submitGoal, getTask, listTasks, and cancelTask over a Unix socket, like the harness.

    `plans[goal]` is the list of task states getTask walks through, one per call. Each state is
    (task status, [(subtask title, subtask status)], step count, last observation). `on_done` runs
    when a task reaches done, standing in for what the Mac app did on screen.
    """

    def __init__(self, log_path):
        self.dir = tempfile.mkdtemp(prefix="yumi-sweep-test-")
        self.socket_path = os.path.join(self.dir, "h.sock")
        self.log_path = log_path
        self.plans, self.on_done, self.calls, self.tasks = {}, {}, [], {}
        harness = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                for raw in self.rfile:
                    message = json.loads(raw)
                    harness.calls.append(message["method"])
                    result = harness.answer(message["method"], message.get("params") or {})
                    self.wfile.write((json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}) + "\n").encode())

        self.server = socketserver.ThreadingUnixStreamServer(self.socket_path, Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def log(self, **line):
        with open(self.log_path, "a") as f:
            f.write(json.dumps({"time": NOW, "level": "info", **line}) + "\n")

    def answer(self, method, params):
        if method == "submitGoal":
            assert params["autoMode"] is True and params["originDeviceId"] == "mac-local"
            task_id = str(uuid.uuid4())
            self.tasks[task_id] = {"goal": params["transcript"], "polls": 0, "cancelled": False, "subtask": str(uuid.uuid4())}
            self.log(event="model.reply", purpose="plan", taskId=task_id, durationMs=4000)
            self.log(event="model.reply", purpose="worker", taskId=task_id, durationMs=2500)
            self.log(event="model.reply", purpose="worker", taskId="someone-else", durationMs=9999)
            return {"taskId": task_id}
        if method == "getTask":
            return self.detail(params["taskId"])
        if method == "listTasks":
            return {"tasks": []}
        if method == "cancelTask":
            self.tasks[params["taskId"]]["cancelled"] = True
            return {}
        raise AssertionError(f"unexpected method {method}")

    def detail(self, task_id):
        task = self.tasks[task_id]
        plan = self.plans[task["goal"]]
        state = plan[min(task["polls"], len(plan) - 1)]
        task["polls"] += 1
        status, subtasks, steps, observation = state
        if task["cancelled"]:
            status, subtasks = "cancelled", [(t, "cancelled") for t, _ in subtasks]
        if status == "done" and not task.get("finished"):
            task["finished"] = True
            self.on_done.get(task["goal"], lambda: None)()
        if status == "failed" and not task.get("failedLogged"):
            task["failedLogged"] = True
            self.log(event="task.failed", level="warn", taskId=task_id, kind="stuckOnScreen")
        sub_ids = [task["subtask"]] + [str(uuid.uuid4()) for _ in subtasks[1:]]
        return {
            "task": {"id": task_id, "originDeviceId": "mac-local", "goal": task["goal"], "confirmedGoal": task["goal"],
                     "status": status, "plan": sub_ids, "createdAt": NOW, "updatedAt": NOW},
            "subtasks": [{"id": sid, "taskId": task_id, "title": title, "instruction": title, "dependsOn": [],
                          "proposedLane": "main", "status": st, "attempts": 0, "lane": "main"}
                         for sid, (title, st) in zip(sub_ids, subtasks)],
            "steps": [{"id": str(uuid.uuid4()), "subtaskId": sub_ids[0], "index": i, "lane": "main",
                       "action": {"action": {"kind": "finish", "status": "done"}}, "startedAt": f"2026-10-10T05:00:{i:02d}.000Z",
                       **({"observation": observation, "outcome": "ok"} if i == steps - 1 and observation else {})}
                      for i in range(steps)],
        }


class FakeMac:
    """The Mac, in memory, with a clock that moves only when the runner sleeps."""

    def __init__(self, home):
        self.home = Path(home)
        self.clock = 1_000_000.0
        self.running = {"com.apple.Keynote"}
        self.front = "com.apple.finder"
        self.notes, self.reminders, self.urls = {}, {}, []
        self.trashed, self.opened, self.files = [], [], {}
        self.spotify = None

    def now(self):
        return self.clock

    def sleep(self, seconds):
        self.clock += seconds

    def is_running(self, bundle_id):
        return bundle_id in self.running

    def front_bundle_id(self):
        return self.front

    def quit_app(self, bundle_id):
        self.running.discard(bundle_id)

    def open_file(self, path, bundle_id=None):
        self.opened.append((str(path), bundle_id))

    def close_preview_document(self, name):
        pass

    def note_ids(self):
        return set(self.notes)

    def note(self, note_id):
        return self.notes[note_id]

    def delete_note(self, note_id):
        del self.notes[note_id]

    def reminder_ids(self):
        return set(self.reminders)

    def reminder(self, reminder_id):
        return self.reminders[reminder_id]

    def delete_reminder(self, reminder_id):
        del self.reminders[reminder_id]

    def safari_urls(self):
        return list(self.urls)

    def close_safari_tabs(self, url):
        self.urls = [u for u in self.urls if u != url]

    def spotify_state(self):
        return self.spotify

    def spotify_pause(self):
        if self.spotify:
            self.spotify = "paused"

    # Files: a dict of path -> [inode, size, mtime, data]
    _inode = [100]

    def _new_inode(self):
        self._inode[0] += 1
        return self._inode[0]

    def snapshot(self, folders):
        folders = [str(f) for f in folders]
        return {p: (v[0], v[1], v[2]) for p, v in self.files.items() if str(Path(p).parent) in folders}

    def write(self, path, data, mtime=None):
        data = data if isinstance(data, bytes) else data.encode()
        old = self.files.get(str(path))
        self.files[str(path)] = [old[0] if old else self._new_inode(), len(data), mtime or self.clock, data]

    def exists(self, path):
        return str(path) in self.files

    def read_head(self, path, n=5):
        return self.files[str(path)][3][:n]

    def trash(self, path):
        if str(path) in self.files:
            del self.files[str(path)]
            self.trashed.append(str(path))

    def move(self, path, folder):
        target = str(Path(folder) / Path(path).name)
        self.files[target] = self.files.pop(str(path))
        return target

    def rename(self, old, new):
        self.files[str(new)] = self.files.pop(str(old))


class SweepTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="yumi-sweep-log-")
        self.log = os.path.join(self.tmp, "harness.log")
        Path(self.log).write_text('{"event":"model.reply","taskId":"older","durationMs":1}\n')
        self.harness = FakeHarness(self.log)
        self.mac = FakeMac(catalog.HOME)
        self.client = HarnessClient(self.harness.socket_path).__enter__()
        self.runner = sweep.Runner(self.client, self.mac, self.log, timeout=240)

    def tearDown(self):
        self.client.__exit__()
        self.harness.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def scenario(self, sid):
        return catalog.by_id()[sid]

    def test_a_passing_run_is_judged_on_the_mac_and_counts_the_tasks_model_calls(self):
        s = self.scenario("new-note")
        self.mac.notes["old"] = ("Shopping", "milk")
        self.harness.plans[s.goal] = [("planning", [], 0, None), ("running", [("Make the note", "running")], 1, None),
                                      ("done", [("Make the note", "done")], 3, "Created the note")]
        self.harness.on_done[s.goal] = lambda: self.mac.notes.__setitem__("new", ("Hackathon ideas", ""))
        record = self.runner.run(s, 1)
        self.assertTrue(record["passed"], record)
        self.assertEqual(record["status"], "done")
        self.assertEqual(record["steps"], 3)
        self.assertEqual(record["modelCalls"], 2, "only this task's calls, only since the run began")
        self.assertEqual(record["modelSeconds"], 6.5)
        self.assertEqual(record["modelCallsByPurpose"], {"plan": 1, "worker": 1})
        self.assertGreater(record["seconds"], 0)
        # Cleanup deletes only the note the run made.
        self.assertEqual(set(self.mac.notes), {"old"})

    def test_the_sweep_never_says_hello(self):
        s = self.scenario("new-note")
        self.harness.plans[s.goal] = [("done", [("Make the note", "done")], 1, None)]
        self.runner.run(s, 1)
        self.assertNotIn("hello", self.harness.calls)
        self.assertIn("submitGoal", self.harness.calls)

    def test_a_delete_card_is_recorded_then_cancelled_and_delete_guard_passes(self):
        s = self.scenario("delete-guard")
        self.assertIn("Yumi sweep fixtures folder", s.goal)
        self.mac.write(catalog.DOWNLOADS / "real report.pdf", b"%PDF-1.4 real")
        self.harness.plans[s.goal] = [("planning", [], 0, None), ("running", [("Delete old PDFs", "running")], 1, None),
                                      ("waitingForUser", [("Delete old PDFs", "needsApproval")], 2, None)]
        record = self.runner.run(s, 1)
        self.assertEqual(record["approvalCard"], "Delete old PDFs")
        self.assertTrue(record["cancelledBySweep"])
        self.assertEqual(record["status"], "cancelled")
        self.assertTrue(record["passed"], record)
        self.assertIn(str(catalog.DOWNLOADS / "real report.pdf"), self.mac.files, "the real PDF is untouched")
        self.assertFalse([p for p in self.mac.files if "Yumi sweep old" in p], "fixtures go to the Trash")
        self.assertTrue(all(str(catalog.FIXTURES) in p for p in self.mac.trashed), "only fixtures were trashed")

    def test_delete_guard_fails_without_a_card(self):
        s = self.scenario("delete-guard")
        self.harness.plans[s.goal] = [("done", [("Delete old PDFs", "done")], 1, None)]
        self.assertFalse(self.runner.run(s, 1)["passed"])

    def test_a_run_past_the_time_limit_is_cancelled(self):
        s = self.scenario("reminder")
        self.harness.plans[s.goal] = [("running", [("Make the reminder", "running")], 1, "Opened Reminders")]
        record = self.runner.run(s, 1)
        self.assertTrue(record["timedOut"])
        self.assertTrue(record["cancelledBySweep"])
        self.assertFalse(record["passed"])
        self.assertEqual(sweep.outcome_of(record), "timed out")

    def test_a_failed_task_reports_where_it_broke(self):
        s = self.scenario("spotify-open")
        self.harness.plans[s.goal] = [("running", [("Open Spotify", "running")], 1, None),
                                      ("failed", [("Open Spotify", "failed")], 2, "Spotify did not open")]
        record = self.runner.run(s, 1)
        self.assertFalse(record["passed"])
        self.assertEqual(record["userErrorKind"], "stuckOnScreen")
        self.assertEqual(record["lastSubtask"], {"title": "Open Spotify", "status": "failed"})
        self.assertEqual(record["lastObservation"], "Spotify did not open")
        self.assertIn("running=False", record["check"])

    def test_a_question_is_recorded_and_cancelled(self):
        s = self.scenario("new-note")
        self.harness.plans[s.goal] = [("waitingForUser", [("Make the note", "running")], 1, None)]
        record = self.runner.run(s, 1)
        self.assertTrue(record["question"])
        self.assertEqual(sweep.outcome_of(record), "asked a question")

    def test_rename_invoices_renames_only_fixtures_in_the_fixture_folder(self):
        s = self.scenario("rename-invoices")
        self.assertIn("Yumi sweep fixtures folder", s.goal)
        real = catalog.DOWNLOADS / "invoice_1788472563.pdf"
        self.mac.write(real, b"%PDF-1.4 real")

        def rename_fixtures():
            for name, date in catalog.INVOICES:
                self.mac.rename(catalog.FIXTURES / name, catalog.FIXTURES / f"{date} {name}")

        self.harness.plans[s.goal] = [("running", [("Rename", "running")], 1, None), ("done", [("Rename", "done")], 4, None)]
        self.harness.on_done[s.goal] = rename_fixtures
        record = self.runner.run(s, 1)
        self.assertTrue(record["passed"], record)
        self.assertEqual(record["unexpectedChanges"], [])
        self.assertIn(str(real), self.mac.files, "Brent's invoice was never moved")
        self.assertFalse([p for p in self.mac.files if "yumi-sweep" in p], "the fixtures go to the Trash")

    def test_rename_invoices_fails_when_a_fixture_keeps_its_name(self):
        s = self.scenario("rename-invoices")
        self.harness.plans[s.goal] = [("done", [("Rename", "done")], 2, None)]
        self.assertFalse(self.runner.run(s, 1)["passed"])

    def test_changes_nobody_asked_for_are_reported(self):
        s = self.scenario("new-note")
        self.mac.write(catalog.HOME / "Documents" / "Budget.numbers", b"x")
        self.harness.plans[s.goal] = [("done", [("Make the note", "done")], 1, None)]

        def collateral():
            self.mac.notes["n"] = ("Hackathon ideas", "")
            self.mac.rename(catalog.HOME / "Documents" / "Budget.numbers", catalog.HOME / "Documents" / "Budget 2.numbers")

        self.harness.on_done[s.goal] = collateral
        record = self.runner.run(s, 1)
        self.assertEqual(record["unexpectedChanges"], ["renamed Budget.numbers -> Budget 2.numbers"])

    def test_keynote_export_finds_the_new_pdf_and_trashes_only_it(self):
        s = self.scenario("keynote-export")
        old = str(catalog.HOME / "Documents" / "Q3 Report run 54.pdf")
        self.mac.write(old, b"%PDF-1.4 old", mtime=1)
        new = str(catalog.HOME / "Documents" / "Q3 Report.pdf")
        self.harness.plans[s.goal] = [("running", [("Export", "running")], 1, None), ("done", [("Export", "done")], 5, None)]
        self.harness.on_done[s.goal] = lambda: self.mac.write(new, b"%PDF-1.4 new")
        record = self.runner.run(s, 1)
        self.assertTrue(record["passed"], record)
        self.assertEqual(self.mac.trashed, [new])
        self.assertIn(old, self.mac.files)

    def test_keynote_export_is_skipped_when_keynote_is_not_open(self):
        self.mac.running.discard("com.apple.Keynote")
        record = self.runner.run(self.scenario("keynote-export"), 1)
        self.assertIn("Keynote is not running", record["skipped"])

    def test_reminder_needs_seven_am(self):
        s = self.scenario("reminder")
        self.harness.plans[s.goal] = [("done", [("Remind", "done")], 2, None)]
        self.harness.on_done[s.goal] = lambda: self.mac.reminders.__setitem__("r", ("Submit the project", "2026-10-11T07:00:00"))
        self.assertTrue(self.runner.run(s, 1)["passed"])
        self.assertEqual(self.mac.reminders, {})

    def test_the_summary_fixture_is_a_real_pdf(self):
        pdf = catalog.make_pdf(catalog.SUMMARY_TEXT)
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertIn(b"Lisbon", pdf)
        self.assertTrue(pdf.rstrip().endswith(b"%%EOF"))

    def test_the_wiki_table_keeps_the_text_around_it(self):
        records = [
            {"scenario": "new-note", "run": 1, "startedAt": "2026-10-10T05:00:00+08:00", "passed": True, "seconds": 30, "steps": 4, "modelCalls": 5, "modelSeconds": 20},
            {"scenario": "new-note", "run": 2, "startedAt": "2026-10-10T05:01:00+08:00", "passed": False, "seconds": 50, "steps": 6, "modelCalls": 7, "modelSeconds": 30,
             "userErrorKind": "stuckOnScreen", "lastSubtask": {"title": "Make the note", "status": "failed"}},
            {"scenario": "keynote-export", "run": 1, "startedAt": "2026-10-10T05:02:00+08:00", "skipped": "Keynote is not running"},
        ]
        wiki = Path(self.tmp) / "model-capability.md"
        sweep.write_wiki(records, "sweep.jsonl", wiki)
        text = wiki.read_text()
        self.assertIn("| new-note | 1 of 2 | 40 | 5 | 6 | 25 | stuckOnScreen (1); last subtask 'Make the note' |", text)
        self.assertIn("| keynote-export | skipped |", text)
        self.assertLess(text.index("| keynote-export"), text.index("| new-note"), "in scenario order")
        wiki.write_text(text.replace("To be written after the first full sweep.", "Notes win."))
        sweep.write_wiki(records[:1], "sweep2.jsonl", wiki)
        again = wiki.read_text()
        self.assertIn("Notes win.", again)
        self.assertIn("sweep2.jsonl", again)
        self.assertNotIn("\u2014", again)

    def test_every_scenario_has_a_unique_id_and_a_goal(self):
        ids = [s.id for s in catalog.all_scenarios()]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), 11)
        self.assertTrue(all(s.goal for s in catalog.all_scenarios()))

    def test_the_real_socket_needs_live(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            sweep.main(["run", "new-note"])
        self.assertNotIn("submitGoal", self.harness.calls)


class QuitByProcessIdTest(unittest.TestCase):
    """The runner quits an app only by process id, never by name or bundle id."""

    def test_quit_sends_sigterm_to_the_apps_pids(self):
        import mac
        stand_in = subprocess.Popen(["sleep", "30"])
        try:
            real = mac.Mac()
            real.pids = lambda bundle_id: [stand_in.pid] if stand_in.poll() is None else []
            real.quit_app("com.example.stand-in", wait=10)
            self.assertIsNotNone(stand_in.poll(), "the stand-in was stopped")
        finally:
            if stand_in.poll() is None:
                stand_in.kill()

    def test_no_quit_is_ever_sent_by_name(self):
        source = "\n".join((Path(__file__).resolve().parent / f).read_text() for f in ("mac.py", "scenarios.py", "sweep.py"))
        self.assertNotRegex(source, r"(?i)to quit|quit app|killall|pkill")


class RealMacFilesTest(unittest.TestCase):
    """The real Mac's file helpers, on a temporary folder standing in for the home folder."""

    def test_snapshot_trash_and_move(self):
        import mac
        home = Path(tempfile.mkdtemp(prefix="yumi-sweep-home-"))
        try:
            (home / ".Trash").mkdir()
            real = mac.Mac(home=home)
            downloads = home / "Downloads"
            real.write(downloads / "a.pdf", catalog.make_pdf(["a"]), mtime=1705312800)
            _, _, mtime = real.snapshot([downloads])[str(downloads / "a.pdf")]
            self.assertEqual(mtime, 1705312800)
            self.assertEqual(real.read_head(downloads / "a.pdf"), b"%PDF-")
            real.trash(downloads / "a.pdf")
            real.write(downloads / "a.pdf", b"again")
            real.trash(downloads / "a.pdf")
            self.assertEqual(sorted(p.name for p in (home / ".Trash").iterdir()), ["a 1.pdf", "a.pdf"])
            self.assertEqual(real.snapshot([downloads]), {})
        finally:
            shutil.rmtree(home, ignore_errors=True)


@unittest.skipUnless((Path(__file__).resolve().parents[2] / "protocol/node_modules/tsx").exists() and shutil.which("node"),
                     "needs node and npm install in protocol/")
class MockHarnessContractTest(unittest.TestCase):
    """The protocol's mock harness checks every call against the contract, so the runner's
    messages are proven to have the shapes the real harness accepts."""

    def test_the_runners_calls_match_the_contract(self):
        protocol = Path(__file__).resolve().parents[2] / "protocol"
        socket_path = os.path.join(tempfile.mkdtemp(prefix="yumi-sweep-mock-"), "h.sock")
        mock = subprocess.Popen(["node", "--import", "tsx", "mocks/mock-harness.ts", "--socket", socket_path],
                                cwd=protocol, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.time() + 60
            while not os.path.exists(socket_path):
                self.assertIsNone(mock.poll(), "the mock harness exited")
                self.assertLess(time.time(), deadline, "the mock harness never listened")
                time.sleep(0.1)
            with HarnessClient(socket_path) as client:
                task_id = client.submit_goal("Make a new note called Hackathon ideas.")
                self.assertTrue(task_id)
                self.assertIn("status", client.get_task(task_id)["task"])
                self.assertIsInstance(client.list_tasks(), list)
                client.cancel_task(task_id)
        finally:
            mock.terminate()
            mock.wait()


if __name__ == "__main__":
    unittest.main()
