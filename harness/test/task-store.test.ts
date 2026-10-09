import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@yumi/protocol";
import { subtaskStatusValues, taskStatusValues, type TaskStatusChanged } from "@yumi/protocol/types";
import { MemoryLogger } from "../src/log.ts";
import { MIGRATIONS, NewerDatabaseError } from "../src/store/migrations.ts";
import { DATABASE_FILE, InvalidRecordError, matchesQuery, StoreRuleError, TaskStore } from "../src/store/task-store.ts";
import { IllegalTransitionError, SUBTASK_TRANSITIONS, TASK_TRANSITIONS } from "../src/store/transitions.ts";
import { tempDir } from "./helpers.ts";
import { exampleAction, openStore, runningSubtask, TestClock, tinyPng } from "./store-helpers.ts";

let dir: { path: string; cleanup: () => void };
let clock: TestClock;
let logger: MemoryLogger;
let store: TaskStore;
let events: TaskStatusChanged[];

beforeEach(() => {
  dir = tempDir();
  clock = new TestClock();
  logger = new MemoryLogger();
  store = openStore(dir.path, clock, logger);
  events = [];
  store.onStatusChanged((event) => events.push(event));
});

afterEach(() => {
  store.close();
  dir.cleanup();
});

/** A second, independent connection to the same file: sees only what was committed. */
function rawDatabase(): DatabaseSync {
  return new DatabaseSync(join(dir.path, DATABASE_FILE));
}

function reopen(): TaskStore {
  store.close();
  store = openStore(dir.path, clock, logger);
  return store;
}

describe("the database", () => {
  it("is created in the given folder with every table, and migrations run once", () => {
    const db = rawDatabase();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining(["action_log", "app_capabilities", "steps", "subtasks", "tasks", "window_locks"]),
    );
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    db.close();
    if (process.platform !== "win32")
      for (const file of [DATABASE_FILE, `${DATABASE_FILE}-wal`, `${DATABASE_FILE}-shm`]) {
        expect(statSync(join(dir.path, file)).mode & 0o777, file).toBe(0o600);
      }

    expect(logger.entries).toContainEqual(
      expect.objectContaining({ event: "store.opened", migrationsApplied: MIGRATIONS.length }),
    );
    reopen();
    expect(logger.entries.filter((e) => e.event === "store.opened").at(-1)).toMatchObject({ migrationsApplied: 0 });
  });

  it("refuses a database written by a newer harness", () => {
    store.close();
    const db = rawDatabase();
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.close();
    expect(() => openStore(dir.path, clock, logger)).toThrow(NewerDatabaseError);

    const again = rawDatabase();
    again.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    again.close();
    store = openStore(dir.path, clock, logger);
  });

  it("keeps every record after closing and reopening", () => {
    const { task, subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    store.finishStep(step.id, {
      outcome: "ok",
      observation: "The Export To submenu opened.",
      log: { deviceId: "mac-brent", description: "Clicked Export To in Keynote" },
    });
    if (process.platform !== "win32") store.saveStepScreenshot(step.id, tinyPng());
    store.putWindowLock({
      windowId: 4182,
      subtaskId: subtask.id,
      lane: "main",
      acquiredAt: "2026-10-09T15:40:00+08:00",
      expiresAt: "2026-10-09T15:45:00+08:00",
    });
    store.putAppCapability({
      bundleId: "com.apple.Keynote",
      appVersion: "14.4",
      accessibility: true,
      devtools: false,
      probedAt: "2026-10-09T15:40:00+08:00",
    });
    const before = store.getTaskHistory(task.id);

    reopen();
    expect(store.getTaskHistory(task.id)).toEqual(before);
    expect(store.getWindowLock(4182)).toMatchObject({ subtaskId: subtask.id });
    expect(store.getAppCapability("com.apple.Keynote", "14.4")).toMatchObject({ accessibility: true, devtools: false });
  });
});

describe("records follow the protocol", () => {
  it("returns records that validate against the protocol schemas", () => {
    const { task, subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    store.finishStep(step.id, { outcome: "ok", log: { deviceId: "mac-brent", description: "Clicked Export To in Keynote" } });
    const history = store.getTaskHistory(task.id)!;
    expect(validate("Task", history.task).errors).toEqual([]);
    for (const s of history.subtasks) expect(validate("Subtask", s).errors).toEqual([]);
    for (const s of history.steps) expect(validate("Step", s).errors).toEqual([]);
    for (const e of history.actionLog) expect(validate("ActionLogEntry", e).errors).toEqual([]);
  });

  it("refuses a record that breaks the contract, logs it, and writes nothing", () => {
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    expect(() =>
      store.addSubtask({ taskId: task.id, title: "x".repeat(61), instruction: "Tidy.", proposedLane: "helper" }),
    ).toThrow(InvalidRecordError);
    expect(store.listSubtasks(task.id)).toEqual([]);
    expect(store.getTask(task.id)!.plan).toEqual([]);
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "store.invalidRecord", typeName: "Subtask" }));
  });

  it("requires the confirmed goal once a task leaves awaitingConfirmation", () => {
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    expect(() => store.setTaskStatus(task.id, "planning")).toThrow(InvalidRecordError);
    expect(store.getTask(task.id)!.status).toBe("awaitingConfirmation");
  });
});

describe("status transitions", () => {
  it("has a rule for every task and subtask status in the protocol", () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...taskStatusValues].sort());
    expect(Object.keys(SUBTASK_TRANSITIONS).sort()).toEqual([...subtaskStatusValues].sort());
    for (const terminal of ["done", "failed", "cancelled"] as const) expect(TASK_TRANSITIONS[terminal]).toEqual([]);
    for (const terminal of ["done", "failed"] as const) expect(SUBTASK_TRANSITIONS[terminal]).toEqual([]);
  });

  it("applies a task's life from confirmation to done, with the summary", () => {
    const { task, subtask } = runningSubtask(store);
    store.setSubtaskStatus(subtask.id, "done", {
      result: { status: "done", files: ["~/Downloads/Q3 Report.pdf"], note: "Exported Q3 Report.pdf to Downloads." },
    });
    const done = store.setTaskStatus(task.id, "done", { summary: "Done. I exported the deck to Downloads." });
    expect(done).toMatchObject({ status: "done", summary: "Done. I exported the deck to Downloads." });
    expect(store.getSubtask(subtask.id)).toMatchObject({ status: "done", result: { status: "done" } });
  });

  it("pauses and resumes a running task, and cancels a paused one", () => {
    const { task } = runningSubtask(store);
    store.setTaskStatus(task.id, "paused");
    store.setTaskStatus(task.id, "running");
    store.setTaskStatus(task.id, "paused");
    expect(store.setTaskStatus(task.id, "cancelled").status).toBe("cancelled");
  });

  it("logs and refuses an illegal task transition, without applying it or emitting an event", () => {
    const { task } = runningSubtask(store);
    store.setTaskStatus(task.id, "done", { summary: "Done." });
    const before = store.getTask(task.id);
    const eventCount = events.length;

    expect(() => store.setTaskStatus(task.id, "running")).toThrow(IllegalTransitionError);
    expect(store.getTask(task.id)).toEqual(before);
    expect(events).toHaveLength(eventCount);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ event: "store.illegalTransition", record: "task", id: task.id, from: "done", to: "running" }),
    );
  });

  it("refuses a change to the status a record already has", () => {
    const { task, subtask } = runningSubtask(store);
    expect(() => store.setTaskStatus(task.id, "running")).toThrow(IllegalTransitionError);
    expect(() => store.setSubtaskStatus(subtask.id, "running")).toThrow(IllegalTransitionError);
  });

  it("logs and refuses an illegal subtask transition, without applying its other fields", () => {
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    const subtask = store.addSubtask({ taskId: task.id, title: "Tidy", instruction: "Tidy.", proposedLane: "helper" });
    expect(() => store.setSubtaskStatus(subtask.id, "done", { workerId: "helper-1" })).toThrow(IllegalTransitionError);
    expect(store.getSubtask(subtask.id)).toEqual(subtask);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ event: "store.illegalTransition", record: "subtask", from: "pending", to: "done" }),
    );
  });

  it("refuses a new task or subtask that starts in a status it cannot start in", () => {
    expect(() => store.createTask({ originDeviceId: "mac-brent", goal: "x", confirmedGoal: "x", status: "done" })).toThrow(
      IllegalTransitionError,
    );
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "x" });
    expect(() =>
      store.addSubtask({ taskId: task.id, title: "x", instruction: "x", proposedLane: "main", status: "running" }),
    ).toThrow(IllegalTransitionError);
  });

  it("changes other subtask fields without touching the status or emitting an event", () => {
    const { subtask } = runningSubtask(store);
    const eventCount = events.length;
    const updated = store.updateSubtask(subtask.id, { attempts: 2, lastGoodStep: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f" });
    expect(updated).toMatchObject({ status: "running", attempts: 2, workerId: "main-1" });
    expect(events).toHaveLength(eventCount);
  });
});

describe("taskStatusChanged events", () => {
  it("emits exactly one event per status change, in order, each valid against the contract", () => {
    const { task, subtask } = runningSubtask(store);
    store.setSubtaskStatus(subtask.id, "done");
    store.setTaskStatus(task.id, "done", { summary: "Done." });

    expect(events).toEqual([
      { taskId: task.id, status: "awaitingConfirmation" },
      { taskId: task.id, status: "planning" },
      { taskId: task.id, status: "planning", subtaskId: subtask.id, subtaskStatus: "ready" },
      { taskId: task.id, status: "running" },
      { taskId: task.id, status: "running", subtaskId: subtask.id, subtaskStatus: "running" },
      { taskId: task.id, status: "running", subtaskId: subtask.id, subtaskStatus: "done" },
      { taskId: task.id, status: "done" },
    ]);
    for (const event of events) expect(validate("TaskStatusChanged", event).errors).toEqual([]);
  });

  it("emits nothing for writes that are not status changes", () => {
    const { subtask } = runningSubtask(store);
    const eventCount = events.length;
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    store.finishStep(step.id, { outcome: "ok", log: { deviceId: "mac-brent", description: "Clicked Export To in Keynote" } });
    store.updateSubtask(subtask.id, { attempts: 2 });
    expect(events).toHaveLength(eventCount);
  });

  it("keeps the change and the other listeners when one listener throws", () => {
    const seen: TaskStatusChanged[] = [];
    store.onStatusChanged(() => {
      throw new Error("listener broke");
    });
    store.onStatusChanged((event) => seen.push(event));
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    expect(store.getTask(task.id)).toBeDefined();
    expect(seen).toEqual([{ taskId: task.id, status: "awaitingConfirmation" }]);
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "store.statusListenerFailed", taskId: task.id }));
  });
});

describe("the step checkpoint rule", () => {
  it("writes the step to disk, with no outcome, before the action runs", () => {
    const { subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    expect(step).toMatchObject({ index: 0, lane: "main", startedAt: clock.time.toISOString() });
    expect(step.outcome).toBeUndefined();

    // Another connection sees it now: it is committed, not waiting in a transaction.
    const db = rawDatabase();
    expect(db.prepare("SELECT outcome, duration_ms FROM steps WHERE id = ?").get(step.id)).toEqual({
      outcome: null,
      duration_ms: null,
    });
    db.close();
    expect(store.listUnfinishedSteps().map((s) => s.id)).toEqual([step.id]);
  });

  it("writes the outcome, the observation, and the duration after the action", () => {
    const { subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    clock.advance(1830);
    const finished = store.finishStep(step.id, {
      outcome: "ok",
      observation: "The Export To submenu opened.",
      log: { deviceId: "mac-brent", description: "Clicked Export To in Keynote" },
    });
    expect(finished).toMatchObject({ outcome: "ok", observation: "The Export To submenu opened.", durationMs: 1830 });
    expect(store.getStep(step.id)).toEqual(finished);
    expect(store.listUnfinishedSteps()).toEqual([]);
  });

  it("numbers steps in order and refuses a new step while the last one has no outcome", () => {
    const { subtask } = runningSubtask(store);
    const first = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    expect(() => store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() })).toThrow(StoreRuleError);
    store.finishStep(first.id, {
      outcome: "noEffect",
      log: { deviceId: "mac-brent", description: "Clicked Export To in Keynote" },
    });
    const second = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    expect(second.index).toBe(1);
    expect(store.listSteps(subtask.id).map((s) => s.index)).toEqual([0, 1]);
  });

  it("refuses to finish a step twice", () => {
    const { subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    store.finishStep(step.id, { outcome: "ok", log: { deviceId: "mac-brent", description: "Clicked Export To in Keynote" } });
    expect(() => store.finishStep(step.id, { outcome: "error", log: { deviceId: "mac-brent", description: "x" } })).toThrow(
      StoreRuleError,
    );
    expect(store.getStep(step.id)!.outcome).toBe("ok");
    expect(store.listActionLog(subtask.taskId)).toHaveLength(1);
  });

  it("refuses a step for a subtask that is not running", () => {
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    const subtask = store.addSubtask({ taskId: task.id, title: "Tidy", instruction: "Tidy.", proposedLane: "helper" });
    expect(() => store.beginStep({ subtaskId: subtask.id, lane: "helper", action: exampleAction() })).toThrow(StoreRuleError);
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "store.refused", rule: "stepNeedsRunningSubtask" }));
  });

  it.skipIf(process.platform === "win32")(
    "leaves a step with no outcome when the process is killed between the insert and the outcome update",
    async () => {
      store.close();
      const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/crash-mid-step.ts", dir.path], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      const signal = await new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_code, sig) => resolve(sig)));
      expect(signal, output).toBe("SIGKILL");
      const stepId = /began (\S+)/.exec(output)?.[1];
      expect(stepId, output).toBeDefined();

      store = openStore(dir.path, clock, logger);
      const unfinished = store.listUnfinishedSteps();
      expect(unfinished.map((s) => s.id)).toEqual([stepId]);
      expect(unfinished[0]!.outcome).toBeUndefined();
      expect(unfinished[0]!.durationMs).toBeUndefined();
      const subtask = store.getSubtask(unfinished[0]!.subtaskId)!;
      expect(subtask.status).toBe("running");
      expect(store.listActionLog(subtask.taskId)).toEqual([]);
    },
    30_000,
  );
});

describe.skipIf(process.platform === "win32")("step screenshots", () => {
  it("are saved as files next to the database, with the path on the step", () => {
    const { task, subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    const png = tinyPng();
    const saved = store.saveStepScreenshot(step.id, png);

    expect(saved.screenshotPath).toBe(join(dir.path, "screenshots", task.id, `${step.id}.png`));
    expect(readFileSync(saved.screenshotPath!)).toEqual(Buffer.from(png));
    expect(statSync(saved.screenshotPath!).mode & 0o777).toBe(0o600);
    expect(store.getStep(step.id)!.screenshotPath).toBe(saved.screenshotPath);
    expect(validate("Step", store.getStep(step.id)).errors).toEqual([]);
  });

  it("never replace a saved screenshot, and refuse bytes that are not an image", () => {
    const { subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    expect(() => store.saveStepScreenshot(step.id, new TextEncoder().encode("not an image"))).toThrow(StoreRuleError);
    const first = store.saveStepScreenshot(step.id, tinyPng(2, 2));
    expect(() => store.saveStepScreenshot(step.id, tinyPng(3, 3))).toThrow(StoreRuleError);
    expect(readFileSync(first.screenshotPath!)).toEqual(Buffer.from(tinyPng(2, 2)));
  });
});

describe("the action log", () => {
  it("gets one plain-language line for every finished action, with time, device, lane, and outcome", () => {
    const { task, subtask } = runningSubtask(store);
    const outcomes = ["ok", "noEffect", "blocked", "declined", "error"] as const;
    for (const outcome of outcomes) {
      const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
      clock.advance(1000);
      store.finishStep(step.id, {
        outcome,
        log: { deviceId: "mac-brent", description: `Clicked Export To in Keynote (${outcome})` },
      });
    }
    const log = store.listActionLog(task.id);
    expect(log.map((e) => e.outcome)).toEqual(outcomes);
    expect(log[0]).toEqual({
      time: "2026-10-09T07:40:01.000Z",
      deviceId: "mac-brent",
      taskId: task.id,
      lane: "main",
      description: "Clicked Export To in Keynote (ok)",
      outcome: "ok",
    });
  });

  it("gets no line for an invalid model output, because no action ran", () => {
    const { task, subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    store.finishStep(step.id, { outcome: "invalidOutput" });
    expect(store.listActionLog(task.id)).toEqual([]);
  });

  it("keeps every path of a delete, and takes lines for actions outside a step", () => {
    const { task } = runningSubtask(store);
    store.appendActionLog({
      deviceId: "phone-ana",
      taskId: task.id,
      description: "Moved 2 files to the Trash",
      paths: ["~/Downloads/a.pdf", "~/Downloads/b.pdf"],
      outcome: "ok",
    });
    expect(store.listActionLog(task.id)[0]).toMatchObject({
      deviceId: "phone-ana",
      paths: ["~/Downloads/a.pdf", "~/Downloads/b.pdf"],
    });
  });
});

describe("history", () => {
  /** A finished task with one subtask, one step, and its action log line, created at `createdAt`. */
  function finishedTask(createdAt: string, goal: string, subtaskTitle: string, summary: string) {
    clock.set(createdAt);
    const task = store.createTask({ originDeviceId: "mac-brent", goal, confirmedGoal: goal, status: "planning" });
    const subtask = store.addSubtask({
      taskId: task.id,
      title: subtaskTitle,
      instruction: subtaskTitle,
      proposedLane: "main",
      status: "ready",
    });
    store.setTaskStatus(task.id, "running");
    store.setSubtaskStatus(subtask.id, "running");
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    clock.advance(1500);
    store.finishStep(step.id, {
      outcome: "ok",
      log: { deviceId: "mac-brent", description: `Clicked Export in ${subtaskTitle}` },
    });
    store.setSubtaskStatus(subtask.id, "done");
    store.setTaskStatus(task.id, "done", { summary });
    return store.getTask(task.id)!;
  }

  // SPEC-02, "Finished tasks are kept".
  it("Scenario: Finished tasks are kept", () => {
    // Given a task finished 6 months ago
    const old = finishedTask(
      "2026-04-09T02:00:00.000Z",
      "file the March invoices in the Accounting folder",
      "Move invoices",
      "Done. I filed 4 invoices.",
    );
    finishedTask("2026-10-08T02:00:00.000Z", "export my Keynote deck as a PDF", "Export deck", "Done. I exported the deck.");
    clock.set("2026-10-09T08:00:00.000Z");
    reopen();

    // When the user searches past tasks for "invoices"
    const found = store.searchTasks({ query: "invoices" });

    // Then the task is found with its steps and action log
    expect(found.map((t) => t.id)).toEqual([old.id]);
    const history = store.getTaskHistory(old.id)!;
    expect(history.task).toMatchObject({ status: "done", createdAt: "2026-04-09T02:00:00.000Z" });
    expect(history.steps).toHaveLength(1);
    expect(history.steps[0]).toMatchObject({ outcome: "ok", durationMs: 1500 });
    expect(history.actionLog).toEqual([
      expect.objectContaining({ description: "Clicked Export in Move invoices", outcome: "ok" }),
    ]);
  });

  it("searches goals, subtask titles, and summaries, ignoring case and accents, and matches every word", () => {
    const a = finishedTask("2026-10-01T00:00:00.000Z", "update my CV", "Open Résumé.pages", "Done.");
    const b = finishedTask(
      "2026-10-02T00:00:00.000Z",
      "tidy the desktop",
      "Sort files",
      "Done. I moved the Q3 INVOICES to Accounting.",
    );
    const c = finishedTask("2026-10-03T00:00:00.000Z", "send the invoices to Ana", "Write email", "Done. I sent it.");

    expect(store.searchTasks({ query: "resume" }).map((t) => t.id)).toEqual([a.id]);
    expect(store.searchTasks({ query: "Invoices" }).map((t) => t.id)).toEqual([c.id, b.id]);
    expect(store.searchTasks({ query: "invoices ana" }).map((t) => t.id)).toEqual([c.id]);
    expect(store.searchTasks({ query: "invoices", limit: 1 }).map((t) => t.id)).toEqual([c.id]);
    expect(store.searchTasks({ query: "50%_" })).toEqual([]);
    expect(matchesQuery("anything", "   ")).toBe(false);
  });

  it("lists past tasks newest first, with a limit and paging back by creation time", () => {
    const ids = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map(
      (day) => finishedTask(`${day}T00:00:00.000Z`, `goal on ${day}`, "Step", "Done.").id,
    );
    expect(store.listTasks().map((t) => t.id)).toEqual([...ids].reverse());
    const page = store.listTasks({ limit: 2 });
    expect(page.map((t) => t.id)).toEqual([ids[3], ids[2]]);
    expect(store.listTasks({ limit: 2, before: page.at(-1)!.createdAt }).map((t) => t.id)).toEqual([ids[1], ids[0]]);
  });
});

describe("nothing is deleted", () => {
  it("the database refuses to delete tasks, subtasks, steps, or action log lines, or to change a log line", () => {
    const { subtask } = runningSubtask(store);
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
    store.finishStep(step.id, { outcome: "ok", log: { deviceId: "mac-brent", description: "Clicked Export To in Keynote" } });
    const db = rawDatabase();
    for (const table of ["action_log", "steps", "subtasks", "tasks"]) {
      expect(() => db.exec(`DELETE FROM ${table}`), table).toThrow(/kept forever/);
    }
    expect(() => db.exec("UPDATE action_log SET description = 'changed'")).toThrow(/append-only/);
    db.close();
  });

  it("no harness code deletes task records or screenshots", () => {
    const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
    const sources = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .map((file) => ({ file, text: readFileSync(join(srcDir, file), "utf8") }));
    // History lives in these task store tables. The only DELETEs on them release window locks, which are
    // working state, not history. Other modules keep their own databases (the bridge client's delivery queue in
    // bridge.sqlite), and deleting from those is not task history.
    const storeTables = ["tasks", "subtasks", "steps", "window_locks", "app_capabilities", "action_log"];
    const deletes = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/DELETE\s+FROM\s+(\w+)/gi)]
        .filter((m) => storeTables.includes(m[1]!.toLowerCase()))
        .map((m) => `${file.replaceAll("\\", "/")}: ${m[1]}`),
    );
    expect(new Set(deletes)).toEqual(new Set(["store/task-store.ts: window_locks"]));
    // No file removal in the store; the RPC server removes only its own socket file, and the move tool removes a
    // file's old name only after the same file has its new one (OBJ-37).
    const removals = sources
      .filter(({ text }) => /\b(rmSync|unlinkSync|rm|unlink|rmdirSync)\(/.test(text))
      .map(({ file }) => file.replaceAll("\\", "/"))
      .sort();
    expect(removals).toEqual(["rpc/server.ts", "tools/file-tools.ts"]);
    expect(existsSync(join(srcDir, "store"))).toBe(true);
  });
});

describe("window locks and app capabilities", () => {
  it("records, replaces, and releases window locks", () => {
    const { subtask } = runningSubtask(store);
    const lock = {
      windowId: 4182,
      subtaskId: subtask.id,
      lane: "ghost" as const,
      acquiredAt: "2026-10-09T15:40:00+08:00",
      expiresAt: "2026-10-09T15:45:00+08:00",
    };
    store.putWindowLock(lock);
    store.putWindowLock({ ...lock, lane: "main" });
    expect(store.listWindowLocks()).toEqual([{ ...lock, lane: "main" }]);
    expect(store.releaseWindowLock(4182)).toBe(true);
    expect(store.releaseWindowLock(4182)).toBe(false);
    expect(store.getWindowLock(4182)).toBeUndefined();
  });
});
