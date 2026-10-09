import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcErrorCode, RpcRemoteError, validate } from "@yumi/protocol";
import type { Lane, PlannedSubtask, Subtask, TaskStatusChanged, WindowInfo, WindowLock } from "@yumi/protocol/types";
import { DEFAULT_CURSOR_CAP, loadConfig } from "../src/config.ts";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../src/planner/summary.ts";
import {
  createLaneRouter,
  LOCK_TTL_MS,
  macAppWindows,
  ProbeFailure,
  WAIT_NOTICE_MS,
  WindowCoordinator,
  type CursorClaim,
  type LaneRouter,
  type WindowCoordinatorOptions,
  type WindowSource,
} from "../src/router/index.ts";
import { routeWith, type LaneRunner } from "../src/scheduler/lanes.ts";
import { localVoice, runTask } from "../src/scheduler/run-task.ts";
import { TaskStore } from "../src/store/task-store.ts";
import { modelConfig, PROTOCOL_DIR, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";
import { openStore, runningSubtask, TestClock } from "./store-helpers.ts";

/**
 * Window locks, busy windows, the waiting notice, tiling suggestions, and the cursor cap (OBJ-08, SPEC-03 r5, r6,
 * r11 to r13): the task store's locks, the window coordinator with a fake Mac app, and the SPEC-03 scenarios end
 * to end through the planner, scheduler, and router with the protocol's mock Mac app and stand-in ghost and main
 * lanes (the real ones come with OBJ-36).
 */

const CHROME = "com.google.Chrome";
const KEYNOTE = "com.apple.Keynote";
const WEZTERM = "com.github.wez.wezterm";

// The end-to-end runs start the mock Mac app with npm; give a loaded machine room before calling it a hang.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 5_000) => {
  for (const deadline = Date.now() + ms; !check() && Date.now() < deadline;) await sleep(10);
  expect(check()).toBe(true);
};

let dir: { path: string; cleanup: () => void };
let logger: MemoryLogger;

beforeEach(() => {
  dir = tempDir();
  logger = new MemoryLogger();
});

afterEach(() => {
  vi.useRealTimers();
  dir.cleanup();
});

describe("window locks in the task store (OBJ-08.1)", () => {
  let clock: TestClock;
  let store: TaskStore;

  beforeEach(() => {
    clock = new TestClock();
    store = openStore(dir.path, clock, logger);
  });

  afterEach(() => store.close());

  const lockFor = (subtaskId: string, windowId = 4182, ttlMs = LOCK_TTL_MS, lane: Lane = "ghost"): WindowLock => ({
    windowId,
    subtaskId,
    lane,
    acquiredAt: clock.now().toISOString(),
    expiresAt: new Date(clock.now().getTime() + ttlMs).toISOString(),
  });

  it("gives a window to one subtask at a time, and lets the holder renew it", () => {
    const a = runningSubtask(store).subtask;
    const b = runningSubtask(store).subtask;
    const lock = lockFor(a.id);

    expect(store.acquireWindowLock(lock)).toEqual({ acquired: true, lock });
    expect(store.acquireWindowLock(lockFor(b.id))).toEqual({ acquired: false, heldBy: lock });
    clock.advance(30_000);
    const renewed = lockFor(a.id);
    expect(store.acquireWindowLock(renewed)).toEqual({ acquired: true, lock: renewed });
    expect(store.renewWindowLock(4182, a.id, new Date(clock.now().getTime() + 90_000).toISOString())).toBe(true);
    expect(store.renewWindowLock(4182, b.id, new Date(clock.now().getTime() + 90_000).toISOString())).toBe(false);
    expect(store.listLiveWindowLocks().map((l) => l.subtaskId)).toEqual([a.id]);
    for (const l of store.listWindowLocks()) expect(validate("WindowLock", l).errors).toEqual([]);
  });

  it("releases a subtask's lock in the same change that ends, fails, or hands off the subtask", () => {
    const ends = ["done", "failed", "handoff"] as const;
    for (const [i, status] of ends.entries()) {
      const { subtask } = runningSubtask(store);
      store.acquireWindowLock(lockFor(subtask.id, 100 + i));
      store.setSubtaskStatus(subtask.id, status);
      expect(store.getWindowLock(100 + i), status).toBeUndefined();
    }
    // Waiting for an approval keeps the window; going back to ready (a pause) gives it up.
    const { subtask } = runningSubtask(store);
    store.acquireWindowLock(lockFor(subtask.id, 200));
    store.setSubtaskStatus(subtask.id, "needsApproval");
    expect(store.getWindowLock(200)?.subtaskId).toBe(subtask.id);
    store.setSubtaskStatus(subtask.id, "ready");
    expect(store.getWindowLock(200)).toBeUndefined();
  });

  it("frees the window of a lock that expired, so a crashed worker cannot block it", () => {
    const a = runningSubtask(store).subtask;
    const b = runningSubtask(store).subtask;
    store.acquireWindowLock(lockFor(a.id, 4182, 60_000));

    clock.advance(59_999);
    expect(store.acquireWindowLock(lockFor(b.id)).acquired).toBe(false);
    expect(store.listLiveWindowLocks()).toHaveLength(1);
    clock.advance(1);
    expect(store.listLiveWindowLocks()).toEqual([]);
    expect(store.acquireWindowLock(lockFor(b.id)).acquired).toBe(true);

    store.acquireWindowLock(lockFor(a.id, 977, 1_000));
    clock.advance(1_000);
    expect(store.releaseExpiredWindowLocks().map((l) => l.windowId)).toEqual([977]);
    expect(store.listWindowLocks().map((l) => l.windowId)).toEqual([4182]);
  });

  it("never lets two connections to the same database hold the same window", () => {
    const second = openStore(dir.path, clock, logger);
    try {
      const a = runningSubtask(store).subtask;
      const b = runningSubtask(store).subtask;
      expect(store.acquireWindowLock(lockFor(a.id)).acquired).toBe(true);
      expect(second.acquireWindowLock(lockFor(b.id))).toMatchObject({ acquired: false, heldBy: { subtaskId: a.id } });
    } finally {
      second.close();
    }
  });

  it.skipIf(process.platform === "win32")(
    "keeps a dead worker's window locked until the harness restarts, and leaves no lock after the restart",
    async () => {
      store.close();
      const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/crash-holding-lock.ts", dir.path], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      const signal = await new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_code, sig) => resolve(sig)));
      expect(signal, output).toBe("SIGKILL");
      const holder = /locked (\S+)/.exec(output)![1]!;

      // Before a restart, the lock still guards the window: nothing else may work in it.
      clock = new TestClock(new Date());
      store = openStore(dir.path, clock, logger);
      const other = runningSubtask(store).subtask;
      expect(store.acquireWindowLock(lockFor(other.id))).toMatchObject({ acquired: false, heldBy: { subtaskId: holder } });
      // A lock whose subtask recovery does not reset (it already ended), as a bug could leave it.
      store.setSubtaskStatus(other.id, "done");
      store.putWindowLock(lockFor(other.id, 977));
      store.close();

      const harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "h.sock") }, logger);
      try {
        // No cursor survives a restart, so no window stays locked.
        expect(harness.store.listWindowLocks()).toEqual([]);
        // The dead worker's subtask goes back to ready, which releases its lock; the leftover one is released too.
        expect(harness.store.getSubtask(holder)!.status).toBe("ready");
        expect(logger.entries.filter((e) => e.event === "recovery.lockReleased").map((e) => e["windowId"])).toEqual([977]);
      } finally {
        await harness.close();
      }
      store = openStore(dir.path, clock, logger);
    },
    30_000,
  );
});

/** A fake Mac app: one window per app at first, and a new window for the apps in `canOpen`. */
class FakeWindows implements WindowSource {
  readonly windows: WindowInfo[] = [];
  readonly canOpen = new Set<string>();
  readonly opened: string[] = [];
  private nextId = 5000;

  constructor(apps: Record<string, string>) {
    for (const [bundleId, appName] of Object.entries(apps)) this.add(bundleId, appName);
  }

  add(bundleId: string, appName: string): number {
    const windowId = this.nextId++;
    this.windows.push({
      windowId,
      bundleId,
      appName,
      title: "",
      frame: { x: 0, y: 0, width: 800, height: 600 },
      minimized: false,
    });
    return windowId;
  }

  list = (bundleId: string) => Promise.resolve(this.windows.filter((w) => w.bundleId === bundleId));

  open = (bundleId: string) => {
    this.opened.push(bundleId);
    if (!this.canOpen.has(bundleId)) return Promise.resolve(undefined);
    return Promise.resolve(this.add(bundleId, this.windows.find((w) => w.bundleId === bundleId)!.appName));
  };
}

describe("the window coordinator (OBJ-08.2 to OBJ-08.7)", () => {
  let clock: TestClock;
  let store: TaskStore;
  let fake: FakeWindows;
  let events: { event: string; payload: unknown }[];
  let coordinator: WindowCoordinator;

  const coordinatorWith = (options: Partial<WindowCoordinatorOptions> = {}) =>
    new WindowCoordinator({
      store,
      windows: fake,
      emit: (event: string, payload: unknown) => events.push({ event, payload }),
      logger,
      now: clock.now,
      ...options,
    });

  beforeEach(() => {
    clock = new TestClock();
    store = openStore(dir.path, clock, logger);
    fake = new FakeWindows({ [CHROME]: "Google Chrome", [KEYNOTE]: "Keynote", [WEZTERM]: "WezTerm" });
    events = [];
    coordinator = coordinatorWith();
  });

  afterEach(() => {
    coordinator.close();
    store.close();
  });

  /** A running task with one ready subtask per app given. */
  function uiSubtasks(...apps: string[]): Subtask[] {
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "work in some windows" });
    store.setTaskStatus(task.id, "planning", { confirmedGoal: "work in some windows" });
    const subtasks = apps.map((bundleId, i) =>
      store.addSubtask({
        taskId: task.id,
        title: `Subtask ${i + 1}`,
        instruction: `Work in ${bundleId}.`,
        proposedLane: "ghost",
        targetApp: { bundleId },
        status: "ready",
      }),
    );
    store.setTaskStatus(task.id, "running");
    return subtasks;
  }

  const granted = (claim: CursorClaim) => {
    if (!claim.granted) throw new Error(`Not granted: ${claim.reason}`);
    return claim;
  };

  /** A granted subtask starts, and then finishes, as the scheduler would do it. */
  const finish = (subtask: Subtask) => {
    store.setSubtaskStatus(subtask.id, "running");
    store.setSubtaskStatus(subtask.id, "done");
  };

  describe("Scenario: Cursor cap is reached", () => {
    it("queues a new ghost-capable subtask while 3 cursors are visible, until a cursor finishes", async () => {
      fake.canOpen.add(CHROME);
      const subtasks = uiSubtasks(CHROME, CHROME, CHROME, CHROME);
      const first = [];
      for (const s of subtasks.slice(0, 3)) first.push(granted(await coordinator.claim(s, "ghost", CHROME)));
      expect(coordinator.visibleCursors).toBe(DEFAULT_CURSOR_CAP);
      expect(first.map((c) => c.target.windowId)).toEqual([5000, 5003, 5004]);

      const fourth = await coordinator.claim(subtasks[3]!, "ghost", CHROME);
      expect(fourth).toMatchObject({ granted: false, reason: "atCapacity" });
      // No window is opened for a subtask that has no cursor yet.
      expect(fake.opened).toEqual([CHROME, CHROME]);
      if (fourth.granted) return;

      let woke = false;
      const waiting = fourth.wait().then(() => (woke = true));
      await sleep(20);
      expect(woke).toBe(false);
      finish(subtasks[0]!);
      await waiting;

      const later = granted(await coordinator.claim(subtasks[3]!, "ghost", CHROME));
      // The finished subtask's window is free again, and it belongs to this task, so no new window is opened.
      expect(later.target).toEqual({ bundleId: CHROME, windowId: 5000 });
      expect(fake.opened).toHaveLength(2);
      expect(coordinator.visibleCursors).toBe(3);
    });

    it("counts the main cursor in the cap, and has only one", async () => {
      const [keynote, wezterm, chrome] = uiSubtasks(KEYNOTE, WEZTERM, CHROME);
      granted(await coordinator.claim(keynote!, "main", KEYNOTE));
      expect(await coordinator.claim(wezterm!, "main", WEZTERM)).toMatchObject({ granted: false, reason: "atCapacity" });
      granted(await coordinator.claim(chrome!, "ghost", CHROME));
      expect(coordinator.visibleCursors).toBe(2);
    });

    it("takes the cap from the configuration", async () => {
      coordinator.close();
      coordinator = coordinatorWith({ cursorCap: 1 });
      const [a, b] = uiSubtasks(CHROME, KEYNOTE);
      granted(await coordinator.claim(a!, "ghost", CHROME));
      expect(await coordinator.claim(b!, "ghost", KEYNOTE)).toMatchObject({ granted: false, reason: "atCapacity" });

      expect(loadConfig({}).cursorCap).toBe(3);
      expect(loadConfig({ YUMI_CURSOR_CAP: "5" }).cursorCap).toBe(5);
      expect(() => loadConfig({ YUMI_CURSOR_CAP: "0" })).toThrow(/YUMI_CURSOR_CAP/);
      expect(() => coordinatorWith({ cursorCap: 0 })).toThrow();
    });
  });

  describe("Scenario: Busy window, app supports a second window", () => {
    it("opens a new window for the second subtask, and both hold their own window at the same time", async () => {
      fake.canOpen.add(CHROME);
      const [form, other] = uiSubtasks(CHROME, CHROME);
      const a = granted(await coordinator.claim(form!, "ghost", CHROME));
      const b = granted(await coordinator.claim(other!, "ghost", CHROME));

      expect(a).toMatchObject({ target: { bundleId: CHROME, windowId: 5000 } });
      expect(a.reason).toBeUndefined();
      expect(b).toMatchObject({ target: { bundleId: CHROME, windowId: 5003 }, reason: "openedSecondWindow" });
      // Yumi may close the window it opened for the task, but not the user's (SPEC-07, decided 2026-10-10).
      expect([...coordinator.openedFor(form!.taskId)]).toEqual([5003]);
      expect(store.listLiveWindowLocks().map((l) => [l.windowId, l.subtaskId])).toEqual([
        [5000, form!.id],
        [5003, other!.id],
      ]);
    });
  });

  describe("Scenario: Busy window, app cannot open a second window", () => {
    it("queues the second subtask, asks for a new window only once, and gives it the window when the lock is released", async () => {
      const [first, second] = uiSubtasks(KEYNOTE, KEYNOTE);
      granted(await coordinator.claim(first!, "main", KEYNOTE));
      const waiting = await coordinator.claim(second!, "ghost", KEYNOTE);
      expect(waiting).toMatchObject({ granted: false, reason: "windowLocked" });
      expect(await coordinator.claim(second!, "ghost", KEYNOTE)).toMatchObject({ granted: false, reason: "windowLocked" });
      expect(fake.opened).toEqual([KEYNOTE]);

      if (waiting.granted) return;
      const woken = waiting.wait();
      finish(first!);
      await woken;
      expect(granted(await coordinator.claim(second!, "ghost", KEYNOTE)).target).toEqual({ bundleId: KEYNOTE, windowId: 5001 });
      expect(fake.opened).toEqual([KEYNOTE]);
    });
  });

  describe("Scenario: Long wait is explained", () => {
    it("tells the apps once, after exactly 2 minutes, which app the subtask is waiting for", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const [chart, other] = uiSubtasks(KEYNOTE, KEYNOTE);
      granted(await coordinator.claim(other!, "ghost", KEYNOTE));
      expect(await coordinator.claim(chart!, "ghost", KEYNOTE)).toMatchObject({ granted: false, reason: "windowLocked" });

      expect(WAIT_NOTICE_MS).toBe(120_000);
      await vi.advanceTimersByTimeAsync(WAIT_NOTICE_MS - 1);
      expect(events.filter((e) => e.event === "waitingForWindow")).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      const notice = { taskId: chart!.taskId, subtaskId: chart!.id, appName: "Keynote", title: chart!.title };
      expect(events.filter((e) => e.event === "waitingForWindow")).toEqual([{ event: "waitingForWindow", payload: notice }]);
      // Structured: no copy, only what the app fills its sentence with.
      expect(validate("WaitingForWindow", notice).errors).toEqual([]);

      // Waking up and finding the window still busy is the same wait: no second notice.
      await coordinator.claim(chart!, "ghost", KEYNOTE);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(events.filter((e) => e.event === "waitingForWindow")).toHaveLength(1);
    });

    it("also tells the apps after 2 minutes waiting for a free cursor, with the app's name and the subtask's title", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      coordinator.close();
      coordinator = coordinatorWith({ cursorCap: 1 });
      const [form] = uiSubtasks(CHROME);
      const chart = store.addSubtask({
        taskId: form!.taskId,
        title: "Add the chart",
        instruction: "Add the chart in Keynote.",
        proposedLane: "ghost",
        targetApp: { name: "Keynote" },
        status: "ready",
      });
      granted(await coordinator.claim(form!, "ghost", CHROME));
      expect(await coordinator.claim(chart, "ghost", KEYNOTE)).toMatchObject({ granted: false, reason: "atCapacity" });

      await vi.advanceTimersByTimeAsync(WAIT_NOTICE_MS - 1);
      expect(events.filter((e) => e.event === "waitingForWindow")).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      const notice = { taskId: chart.taskId, subtaskId: chart.id, appName: "Keynote", title: "Add the chart" };
      expect(events.filter((e) => e.event === "waitingForWindow")).toEqual([{ event: "waitingForWindow", payload: notice }]);
      expect(validate("WaitingForWindow", notice).errors).toEqual([]);
    });

    it("counts one wait from the first time a subtask is queued, whatever it waits for", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      coordinator.close();
      coordinator = coordinatorWith({ cursorCap: 2 });
      const [keynote, other, chart] = uiSubtasks(KEYNOTE, CHROME, KEYNOTE);
      granted(await coordinator.claim(keynote!, "ghost", KEYNOTE));
      granted(await coordinator.claim(other!, "ghost", CHROME));
      // First the cap, then, once a cursor is free, the busy Keynote window.
      expect(await coordinator.claim(chart!, "ghost", KEYNOTE)).toMatchObject({ reason: "atCapacity" });
      await vi.advanceTimersByTimeAsync(60_000);
      finish(other!);
      expect(await coordinator.claim(chart!, "ghost", KEYNOTE)).toMatchObject({ reason: "windowLocked" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(events.filter((e) => e.event === "waitingForWindow")).toHaveLength(1);
      expect((events.find((e) => e.event === "waitingForWindow")!.payload as { appName: string }).appName).toBe("Keynote");
    });

    it("says nothing when the window is free before 2 minutes, or when the wait is cancelled", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const [first, second, third] = uiSubtasks(KEYNOTE, KEYNOTE, KEYNOTE);
      granted(await coordinator.claim(first!, "ghost", KEYNOTE));
      await coordinator.claim(second!, "ghost", KEYNOTE);
      const cancelled = await coordinator.claim(third!, "ghost", KEYNOTE);
      await vi.advanceTimersByTimeAsync(60_000);
      finish(first!);
      granted(await coordinator.claim(second!, "ghost", KEYNOTE));
      // A pause ends the third subtask's wait.
      if (!cancelled.granted) await cancelled.wait(AbortSignal.abort());
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(events.filter((e) => e.event === "waitingForWindow")).toEqual([]);
    });
  });

  describe("tiling suggestions (OBJ-08.7)", () => {
    it("lists a task's windows when it is about to use more than one at once, and again only when it uses more", async () => {
      coordinator.close();
      coordinator = coordinatorWith({ cursorCap: 5 });
      fake.canOpen.add(CHROME);
      const [form, chart, other] = uiSubtasks(CHROME, KEYNOTE, CHROME);
      const [alone] = uiSubtasks(WEZTERM);
      granted(await coordinator.claim(form!, "ghost", CHROME));
      granted(await coordinator.claim(alone!, "main", WEZTERM));
      expect(events).toEqual([]);

      granted(await coordinator.claim(chart!, "ghost", KEYNOTE));
      const two = {
        taskId: form!.taskId,
        windows: [
          { bundleId: CHROME, windowId: 5000 },
          { bundleId: KEYNOTE, windowId: 5001 },
        ],
      };
      expect(events).toEqual([{ event: "tilingSuggested", payload: two }]);
      expect(validate("TilingSuggested", two).errors).toEqual([]);

      granted(await coordinator.claim(other!, "ghost", CHROME));
      expect(events).toHaveLength(2);
      expect((events[1]!.payload as { windows: unknown[] }).windows).toEqual([
        ...two.windows,
        { bundleId: CHROME, windowId: 5003 },
      ]);

      // Fewer windows later in the same task is not a reason to ask again.
      finish(other!);
      const again = store.addSubtask({
        taskId: form!.taskId,
        title: "Again",
        instruction: "Again.",
        proposedLane: "ghost",
        status: "ready",
      });
      granted(await coordinator.claim(again, "ghost", CHROME));
      expect(events).toHaveLength(2);
    });
  });

  describe("lock lifetime", () => {
    let real: TaskStore;
    let live: WindowCoordinator;

    beforeEach(() => {
      store.close();
      // Real time here: renewing and expiring are about the clock moving.
      real = TaskStore.open({ dir: dir.path, logger });
      store = real;
      live = coordinatorWith({ lockTtlMs: 90, now: () => new Date() });
    });

    afterEach(() => live.close());

    it("renews the locks of working cursors, so they never expire while the cursor works", async () => {
      const [a, b] = uiSubtasks(CHROME, CHROME);
      const claim = granted(await live.claim(a!, "ghost", CHROME));
      store.setSubtaskStatus(a!.id, "running");
      await sleep(300);
      expect(store.listLiveWindowLocks().map((l) => l.subtaskId)).toEqual([a!.id]);
      expect(await live.claim(b!, "ghost", CHROME)).toMatchObject({ granted: false, reason: "windowLocked" });
      claim.hold.release();
      expect(store.listWindowLocks()).toEqual([]);
    });

    it("wakes a waiting subtask when a lock nobody renews expires, and gives it the window", async () => {
      const [stale, waiting] = uiSubtasks(KEYNOTE, KEYNOTE);
      const now = Date.now();
      store.putWindowLock({
        windowId: 5001,
        subtaskId: stale!.id,
        lane: "ghost",
        acquiredAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 150).toISOString(),
      });
      const claim = await live.claim(waiting!, "ghost", KEYNOTE);
      expect(claim).toMatchObject({ granted: false, reason: "windowLocked" });
      if (claim.granted) return;
      await claim.wait();
      expect(Date.now() - now).toBeGreaterThanOrEqual(140);
      expect(granted(await live.claim(waiting!, "ghost", KEYNOTE)).target.windowId).toBe(5001);
      expect(logger.entries.some((e) => e.event === "windows.lockExpired" && e["windowId"] === 5001)).toBe(true);
    });
  });

  it("gives a claim back once, and never a later claim of the same subtask", async () => {
    const [a] = uiSubtasks(CHROME);
    const first = granted(await coordinator.claim(a!, "ghost", CHROME));
    first.hold.release();
    first.hold.release();
    const second = granted(await coordinator.claim(a!, "ghost", CHROME));
    first.hold.release();
    expect(coordinator.visibleCursors).toBe(1);
    expect(store.getWindowLock(5000)).toEqual(second.lock);
  });

  it("lets claims through one at a time, so two subtasks never get the same free window", async () => {
    const [a, b] = uiSubtasks(KEYNOTE, KEYNOTE);
    const claims = await Promise.all([coordinator.claim(a!, "ghost", KEYNOTE), coordinator.claim(b!, "ghost", KEYNOTE)]);
    expect(claims.map((c) => c.granted)).toEqual([true, false]);
  });
});

describe("the Mac app's window methods (macAppWindows)", () => {
  const failing = (error: unknown) => ({ request: () => Promise.reject(error) });

  it("keeps the UserError the Mac app reports, and makes anything else unexpected", async () => {
    const reported = new RpcRemoteError({
      code: RpcErrorCode.failed,
      message: "AX",
      data: { kind: "accessibilityPermissionMissing" },
    });
    const listFailure = (await macAppWindows(failing(reported), logger)
      .list(CHROME)
      .catch((e: unknown) => e)) as ProbeFailure;
    expect(listFailure).toBeInstanceOf(ProbeFailure);
    expect(listFailure.userError).toEqual({ kind: "accessibilityPermissionMissing" });

    const raw = (await macAppWindows(failing(new Error("ECONNRESET")), logger)
      .open(CHROME)
      .catch((e: unknown) => e)) as ProbeFailure;
    expect(raw.userError).toEqual({ kind: "unexpected" });
    expect(JSON.stringify(raw.userError)).not.toContain("ECONNRESET");
    expect(logger.entries.some((e) => JSON.stringify(e).includes("ECONNRESET"))).toBe(true);
  });

  it("treats a Mac app that does not serve openNewWindow as one that cannot open a window", async () => {
    const notServed = new RpcRemoteError({ code: RpcErrorCode.methodNotFound, message: "Method not found: openNewWindow" });
    expect(await macAppWindows(failing(notServed), logger).open(CHROME)).toBeUndefined();
  });
});

/**
 * The SPEC-03 scenarios end to end: the planner, scheduler, and lane router of a real harness, the protocol's mock
 * Mac app (`npm run mock:mac`, which opens new windows for Chrome but not for Keynote, like the real app), a mocked
 * model server, and stand-in ghost and main lanes until OBJ-36.
 */
describe.skipIf(process.platform === "win32")("SPEC-03 busy windows and the cursor cap, with the mock Mac app", () => {
  let harness: Harness;
  let model: MockModelServer;
  let mock: ChildProcess | undefined;
  let output: string;
  let statuses: TaskStatusChanged[];
  let routers: LaneRouter[];

  beforeEach(async () => {
    model = await startMockModelServer();
    harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "h.sock") }, logger);
    statuses = [];
    harness.store.onStatusChanged((event) => statuses.push({ ...event, at: performance.now() } as TaskStatusChanged));
    routers = [];
    output = "";
    mock = spawn("npm", ["run", "mock:mac", "--", "--socket", harness.server.socketPath], {
      cwd: PROTOCOL_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    mock.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    mock.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    await until(() => harness.server.readyConnections === 1, 20_000);
  });

  afterEach(async () => {
    mock?.kill();
    for (const router of routers) router.close();
    await harness.close();
    await model.close();
  });

  /** The events the mock Mac app received, by name. */
  const macEvents = (name: string): unknown[] =>
    output
      .split("\n")
      .filter((line) => line.startsWith(`[mock Mac app] event ${name} `))
      .map((line) => JSON.parse(line.slice(`[mock Mac app] event ${name} `.length)) as unknown);

  interface Work {
    start: number;
    end: number;
  }

  /**
   * A model that plans `plan`, finishes each subtask in one step after `holdMs`, and summarizes. Records when each
   * worker step ran, by instruction. The first replies wait until `gather` are in flight (or 3 s pass), so a loaded
   * machine cannot make concurrent work look sequential, and a scheduler that runs them one at a time never gets there.
   */
  function scriptedModel(plan: PlannedSubtask[], holdMs: number, gather = 1) {
    const work = new Map<string, Work>();
    let inFlight = 0;
    let maxInFlight = 0;
    let gathered = gather <= 1;
    model.respond(async (body) => {
      const request = body as unknown as ChatRequest;
      const system = request.messages[0]!.content as string;
      const text = request.messages[1]!.content as string;
      const content = (value: unknown): MockReply => ({ kind: "content", content: JSON.stringify(value) });
      if (system === PLANNER_SYSTEM_PROMPT) return content({ subtasks: plan });
      if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary: "Done. Everything is filled in." });
      const instruction = /^Instruction: (.*)$/m.exec(text)![1]!;
      const start = performance.now();
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      for (const deadline = performance.now() + 3_000; !gathered && performance.now() < deadline;) {
        if (inFlight >= gather) gathered = true;
        else await sleep(5);
      }
      gathered = true;
      await sleep(holdMs);
      inFlight--;
      work.set(instruction, { start, end: performance.now() });
      return content({ action: { kind: "finish", status: "done", note: `Finished: ${instruction}` } });
    });
    return { work, maxInFlight: () => maxInFlight };
  }

  /** A ghost or main lane stand-in until OBJ-36: it sees the window the router gave the subtask, and has no tools. */
  const observed: { subtaskId: string; windowId: number | undefined; at: number }[] = [];
  const standIn: LaneRunner = {
    observe: (subtask) => {
      observed.push({ subtaskId: subtask.id, windowId: subtask.target?.windowId, at: performance.now() });
      return Promise.resolve({ windowTitle: `Stand-in window ${subtask.target?.windowId ?? "none"}`, elements: [] });
    },
    tools: { tools: [], run: () => Promise.resolve({ outcome: "error", output: "No tools in the stand-in lane." }) },
  };

  const inApp = (id: string, bundleId: string): PlannedSubtask => ({
    id,
    title: `Fill ${id}`,
    instruction: `Fill ${id} in ${bundleId}.`,
    dependsOn: [],
    proposedLane: "ghost",
    targetApp: { bundleId },
  });

  async function run(options: { router?: LaneRouter; slots?: number } = {}) {
    const goal = "fill in the forms";
    const created = harness.store.createTask({ originDeviceId: "mac-brent", goal });
    const task = harness.store.setTaskStatus(created.id, "planning", { confirmedGoal: goal });
    const outcome = await runTask(task.id, {
      store: harness.store,
      client: new ModelClient(modelConfig(model.baseUrl), logger),
      logger,
      deviceId: "mac-brent",
      route: routeWith(options.router ?? harness.router),
      home: dir.path,
      lanes: { ghost: standIn, main: standIn },
      slots: options.slots ?? 3,
      voice: localVoice(harness.server, logger, "mac-brent"),
    });
    const subtasks = harness.store.listSubtasks(task.id);
    const byPlanId = (id: string) => subtasks.find((s) => s.title === `Fill ${id}`)!;
    return { task, outcome, subtasks, byPlanId };
  }

  const overlaps = (a: Work, b: Work) => a.start < b.end && b.start < a.end;
  const queuedAt = (subtaskId: string) => statuses.find((e) => e.subtaskId === subtaskId && e.subtaskStatus === "queued");
  const doneAt = (subtaskId: string) =>
    (statuses.find((e) => e.subtaskId === subtaskId && e.subtaskStatus === "done") as unknown as { at: number }).at;

  it("Scenario: Busy window, app supports a second window", async () => {
    observed.length = 0;
    // "Given a ghost cursor holds the lock on a Chrome window, When another subtask needs Chrome"
    const script = scriptedModel([inApp("form-a", CHROME), inApp("form-b", CHROME)], 150, 2);
    const { outcome, byPlanId, task } = await run();

    expect(outcome.outcome).toBe("done");
    const [a, b] = [byPlanId("form-a"), byPlanId("form-b")].sort((x, y) => x.target!.windowId! - y.target!.windowId!) as [
      Subtask,
      Subtask,
    ];
    // "Then Yumi opens a new Chrome window": the mock Mac app has Chrome window 977; 978 is the new one.
    expect(output).toContain(`[mock Mac app] openNewWindow {"bundleId":"${CHROME}"}`);
    expect([a.target, b.target]).toEqual([
      { bundleId: CHROME, windowId: 977 },
      { bundleId: CHROME, windowId: 978 },
    ]);
    expect([a.lane, a.routeReason, b.lane, b.routeReason]).toEqual(["ghost", "backgroundCapable", "ghost", "openedSecondWindow"]);
    // "And the second subtask works in the new window at the same time"
    expect(overlaps(script.work.get(a.instruction)!, script.work.get(b.instruction)!)).toBe(true);
    expect(observed.find((o) => o.subtaskId === b.id)!.windowId).toBe(978);
    // About to use two windows at once, so the Mac app is asked about tiling, with both windows.
    await until(() => macEvents("tilingSuggested").length === 1);
    expect(macEvents("tilingSuggested")).toEqual([{ taskId: task.id, windows: [a.target, b.target] }]);
    expect(harness.store.listWindowLocks()).toEqual([]);
  });

  it("Scenario: Busy window, app cannot open a second window", async () => {
    observed.length = 0;
    // "Given a cursor holds the lock on the only window of an app, When another subtask needs that app"
    const script = scriptedModel([inApp("chart", KEYNOTE), inApp("title", KEYNOTE)], 200);
    const { outcome, byPlanId } = await run();

    expect(outcome.outcome).toBe("done");
    const [first, second] = [byPlanId("chart"), byPlanId("title")].sort(
      (x, y) => script.work.get(x.instruction)!.start - script.work.get(y.instruction)!.start,
    );
    expect(output).toContain(`[mock Mac app] openNewWindow {"bundleId":"${KEYNOTE}"}`);
    // "Then the second subtask waits": queued, with the reason sent to the dashboard.
    expect(queuedAt(second!.id)).toBeDefined();
    await until(() => macEvents("routeDecided").length >= 3);
    expect(macEvents("routeDecided")).toContainEqual({
      taskId: second!.taskId,
      subtaskId: second!.id,
      lane: "ghost",
      reason: "windowLocked",
    });
    // "And it starts after the lock is released": in the same window, after the first one finished.
    expect([first!.target, second!.target]).toEqual([
      { bundleId: KEYNOTE, windowId: 4182 },
      { bundleId: KEYNOTE, windowId: 4182 },
    ]);
    expect(observed.find((o) => o.subtaskId === second!.id)!.at).toBeGreaterThanOrEqual(doneAt(first!.id));
    expect(overlaps(script.work.get(first!.instruction)!, script.work.get(second!.instruction)!)).toBe(false);
    expect(output.match(/openNewWindow/g)).toHaveLength(1);
    expect(macEvents("waitingForWindow")).toEqual([]);
  });

  it("Scenario: Long wait is explained", async () => {
    // The 2 minutes are shortened here; the coordinator test above checks the real 2 minutes with a fake clock.
    const router = createLaneRouter({ store: harness.store, server: harness.server, logger, windows: { waitNoticeMs: 300 } });
    routers.push(router);
    const script = scriptedModel([inApp("deck", KEYNOTE), inApp("chart", KEYNOTE)], 800);
    const { outcome, byPlanId } = await run({ router });

    expect(outcome.outcome).toBe("done");
    const [deck, chart] = [byPlanId("deck"), byPlanId("chart")];
    const waiter = script.work.get(deck.instruction)!.start < script.work.get(chart.instruction)!.start ? chart : deck;
    // "Then Yumi says ...": the harness sends the structured notice; the Mac app owns the sentence.
    await until(() => macEvents("waitingForWindow").length === 1);
    const notice = macEvents("waitingForWindow")[0];
    expect(notice).toEqual({ taskId: waiter.taskId, subtaskId: waiter.id, appName: "Keynote", title: waiter.title });
    expect(validate("WaitingForWindow", notice).errors).toEqual([]);
  });

  it("Scenario: Cursor cap is reached", async () => {
    observed.length = 0;
    const plan = ["a", "b", "c", "d"].map((id) => inApp(id, CHROME));
    // Four model slots, so only the cursor cap can hold the fourth subtask back.
    const script = scriptedModel(plan, 250, 3);
    const { outcome, subtasks } = await run({ slots: 4 });

    expect(outcome.outcome).toBe("done");
    expect(script.maxInFlight()).toBe(3);
    const byStart = [...subtasks].sort((x, y) => script.work.get(x.instruction)!.start - script.work.get(y.instruction)!.start);
    const fourth = byStart[3]!;
    // "Then it is queued until a cursor finishes"
    expect(queuedAt(fourth.id)).toBeDefined();
    await until(() => macEvents("routeDecided").some((e) => (e as { reason: string }).reason === "atCapacity"));
    expect(macEvents("routeDecided")).toContainEqual({
      taskId: fourth.taskId,
      subtaskId: fourth.id,
      lane: "ghost",
      reason: "atCapacity",
    });
    const firstDone = Math.min(...byStart.slice(0, 3).map((s) => doneAt(s.id)));
    expect(observed.find((o) => o.subtaskId === fourth.id)!.at).toBeGreaterThanOrEqual(firstDone);
    // Three cursors at most, each in its own window; the fourth reuses a window the task already had.
    const claimed = logger.entries.filter((e) => e.event === "windows.claimed").map((e) => e["visible"] as number);
    expect(Math.max(...claimed)).toBe(3);
    expect(output.match(/openNewWindow/g)).toHaveLength(2);
    expect(new Set(byStart.slice(0, 3).map((s) => s.target?.windowId))).toEqual(new Set([977, 978, 979]));
    expect([977, 978, 979]).toContain(fourth.target?.windowId);
  });
});
