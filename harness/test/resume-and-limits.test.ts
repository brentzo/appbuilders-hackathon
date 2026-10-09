import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validate } from "@yumi/protocol";
import { PROTOCOL_VERSION, type Task } from "@yumi/protocol/types";
import { DEFAULT_LIMITS, loadConfig, type Limits } from "../src/config.ts";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../src/planner/summary.ts";
import { fileHelperLane, type LaneRunner } from "../src/scheduler/lanes.ts";
import { INTERRUPTED_OBSERVATION, recoverAfterRestart } from "../src/scheduler/recovery.ts";
import { finishedSoFar, MAX_FINISHED_SO_FAR } from "../src/scheduler/result.ts";
import { StoreRuleError, TaskStore } from "../src/store/task-store.ts";
import { workerSystemPrompt } from "../src/worker/prompt.ts";
import { modelConfig, PROTOCOL_DIR, rawClient, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";
import { openStore, runningSubtask } from "./store-helpers.ts";

/**
 * Resume and limits (OBJ-06) end to end: a real crash in a separate process, the real task store, planner,
 * scheduler, typed file tools on a temporary home folder, and local RPC server, a mocked model server, and a bare
 * app client (plus the protocol's mock Mac app) on the socket.
 */

vi.setConfig({ testTimeout: 30_000 });

const HARNESS_DIR = fileURLToPath(new URL("..", import.meta.url));
const NOTES_GOAL = "write four short notes in Documents";
const SUMMARY = "Done. I wrote four notes in Documents.";

const content = (value: unknown): MockReply => ({ kind: "content", content: JSON.stringify(value) });
const tool = (call: Record<string, unknown>) => content({ action: { kind: "tool", call } });
const finish = (note: string) => content({ action: { kind: "finish", status: "done", note } });

interface PlannedStub {
  id: string;
  title: string;
  instruction: string;
  dependsOn?: string[];
}
const plan = (...subtasks: PlannedStub[]) =>
  JSON.stringify({ subtasks: subtasks.map((s) => ({ dependsOn: [], proposedLane: "helper", ...s })) });

const NOTES_PLAN = plan({
  id: "notes",
  title: "Write the four notes",
  instruction: "Write Note 1.md, Note 2.md, Note 3.md, and Note 4.md in ~/Documents, one per step.",
});

/** A careful worker: writes the first note its recent steps do not show as created, then finishes. */
function notesWorker(text: string): MockReply {
  for (const n of [1, 2, 3, 4]) {
    if (!text.includes(`Created Note ${n}.md`))
      return tool({ tool: "write_new_file", path: `~/Documents/Note ${n}.md`, content: `Note ${n}.` });
  }
  return finish("Wrote all four notes.");
}

interface WorkerCall {
  text: string;
  /** How many observations the test's lane had taken when the request arrived. */
  observed: number;
}

/** A model that plans, works through `worker`, and summarizes. Records every worker request. */
function scriptedModel(
  server: MockModelServer,
  options: { plan: string; worker: (text: string) => MockReply; observed?: () => number },
) {
  const calls: WorkerCall[] = [];
  server.respond((body) => {
    const request = body as unknown as ChatRequest;
    const system = request.messages[0]!.content as string;
    const text = request.messages[1]!.content as string;
    if (system === PLANNER_SYSTEM_PROMPT) return { kind: "content", content: options.plan };
    if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary: SUMMARY });
    if (!system.startsWith(workerSystemPrompt("helper").split("\n")[0]!)) throw new Error("unexpected request");
    calls.push({ text, observed: options.observed?.() ?? 0 });
    return options.worker(text);
  });
  return calls;
}

/** The typed file tools, with an observation the test can recognize and count. */
function countingLane(home: string, title: string): LaneRunner & { observed: () => number } {
  const files = fileHelperLane({ home });
  let observed = 0;
  return {
    observe: () => {
      observed++;
      return Promise.resolve({ windowTitle: title, elements: [] });
    },
    tools: files.tools,
    observed: () => observed,
  };
}

type RpcMessage = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code: number; data?: unknown } };

/** A bare app client that said hello: it collects events and can call the harness's methods. */
async function app(socketPath: string) {
  const client = await rawClient(socketPath);
  const events: { method: string; params: unknown }[] = [];
  const pending = new Map<number, (message: RpcMessage) => void>();
  let nextId = 1;
  void (async () => {
    for (;;) {
      const message = (await client.next()) as RpcMessage;
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)!(message);
        pending.delete(message.id);
      } else if (message.method) events.push({ method: message.method, params: message.params });
    }
  })().catch(() => undefined);
  const call = (method: string, params: unknown) =>
    new Promise<RpcMessage>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      client.send({ jsonrpc: "2.0", id, method, params });
    });
  const hello = await call("hello", { protocolVersion: PROTOCOL_VERSION });
  expect(hello.result).toEqual({ protocolVersion: PROTOCOL_VERSION });
  return { events, call, close: () => client.close() };
}

const until = async (check: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

let dir: { path: string; cleanup: () => void };
let home: string;
let server: MockModelServer;
let logger: MemoryLogger;
let harness: Harness | undefined;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  mkdirSync(join(home, "Documents"), { recursive: true });
  mkdirSync(join(home, "Downloads"), { recursive: true });
  server = await startMockModelServer();
  logger = new MemoryLogger();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await server.close();
  dir.cleanup();
});

/** Starts the harness on the test folder, able to run tasks on `lane` as the helper lane. */
async function start(lane: LaneRunner, limits?: Limits): Promise<Harness> {
  harness = await startHarness(
    { supportDir: dir.path, socketPath: join(dir.path, "h.sock"), ...(limits ? { limits } : {}) },
    logger,
    {
      work: {
        client: new ModelClient(modelConfig(server.baseUrl), logger),
        logger,
        deviceId: "mac-brent",
        home,
        lanes: { helper: lane },
        slots: 1,
      },
    },
  );
  return harness;
}

/** Runs the fixture that crashes after step 4 of the notes task began. Returns the task id. */
async function crashMidTask(): Promise<string> {
  const child: ChildProcess = spawn(
    process.execPath,
    ["--import", "tsx", "test/fixtures/crash-mid-task.ts", dir.path, server.baseUrl, home, NOTES_GOAL],
    { cwd: HARNESS_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  const signal = await new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_code, sig) => resolve(sig)));
  expect(signal, output).toBe("SIGKILL");
  const taskId = /crashing (\S+)/.exec(output)?.[1];
  expect(taskId, output).toBeDefined();
  return taskId!;
}

/** A task with a saved plan of `titles`, the first running with one finished step, as the scheduler leaves it. */
function runningTask(store: TaskStore, titles: string[], goal = NOTES_GOAL): Task {
  const task = store.createTask({ originDeviceId: "mac-brent", goal });
  store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });
  const { subtasks } = store.savePlan(
    task.id,
    titles.map((title, i) => ({
      title,
      instruction: `${title}.`,
      proposedLane: "helper" as const,
      status: i === 0 ? "ready" : "pending",
    })),
  );
  const first = subtasks[0]!;
  store.setSubtaskStatus(first.id, "running", { lane: "helper", routeReason: "noUI", workerId: "helper-1", attempts: 1 });
  const call = { tool: "write_new_file" as const, path: join(home, "Documents", "Note 1.md"), content: "Note 1." };
  writeFileSync(call.path, call.content);
  const step = store.beginStep({
    subtaskId: first.id,
    lane: "helper",
    action: { action: { kind: "tool", call }, permission: "allowed" },
  });
  store.finishStep(step.id, {
    outcome: "ok",
    observation: "Created Note 1.md in Documents",
    log: { deviceId: "mac-brent", description: "Created Note 1.md in Documents" },
  });
  return store.getTask(task.id)!;
}

describe("SPEC-02 resume", () => {
  it("Scenario: Resume after the app crashes", async () => {
    // Given a task is running and step 4 of a subtask has started
    scriptedModel(server, { plan: NOTES_PLAN, worker: notesWorker });
    // When the Yumi app crashes
    const taskId = await crashMidTask();
    const before = server.requests.length;

    // and is reopened
    const lane = countingLane(home, "After the restart");
    const calls = scriptedModel(server, { plan: NOTES_PLAN, worker: notesWorker, observed: lane.observed });
    const h = await start(lane);
    expect(h.recovery).toEqual({ interrupted: [taskId], steps: 1 });
    expect(h.store.getTask(taskId)!.status).toBe("paused");
    const [subtask] = h.store.listSubtasks(taskId);
    expect(subtask).toMatchObject({ status: "ready", attempts: 1 });

    // Then Yumi says "I was interrupted while working on your task. Want me to pick up where I left off?"
    const client = await app(h.server.socketPath);
    await until(() => client.events.some((e) => e.method === "interruptedTaskFound"));
    const found = client.events.filter((e) => e.method === "interruptedTaskFound");
    expect(found).toEqual([{ method: "interruptedTaskFound", params: { taskId } }]);
    expect(validate("TaskRef", found[0]!.params).valid).toBe(true);

    // Nothing runs until the user answers.
    await settle();
    expect(server.requests.length).toBe(before);
    expect(lane.observed()).toBe(0);
    expect(h.store.getTask(taskId)!.status).toBe("paused");

    // When the user says "yes"
    const answer = await client.call("resumeTask", { taskId });
    expect(answer.result).toEqual({});

    // Then step 4 is marked "noEffect"
    const steps = () => h.store.listSteps(subtask!.id);
    expect(steps()[3]).toMatchObject({ index: 3, outcome: "noEffect", observation: INTERRUPTED_OBSERVATION });
    expect(h.store.listActionLog(taskId).at(3)).toMatchObject({
      description: "Started to create Note 4.md, but was interrupted before it finished",
      outcome: "noEffect",
      deviceId: "mac-brent",
    });

    // And the screen is captured again before the next step
    await until(() => h.store.getTask(taskId)!.status === "done");
    expect(calls[0]!.observed).toBe(1);
    expect(calls[0]!.text).toContain('Title: "After the restart"');
    expect(calls[0]!.text).toContain("Interrupted: Yumi stopped before this step finished");

    // Resuming never repeats an action whose outcome was already recorded: notes 1 to 3 were written once, before
    // the crash, and only the cut-off note 4 was written after it.
    expect(steps().map((s) => [s.index, s.outcome])).toEqual([
      [0, "ok"],
      [1, "ok"],
      [2, "ok"],
      [3, "noEffect"],
      [4, "ok"],
    ]);
    expect(steps()[4]!.action.action).toMatchObject({
      kind: "tool",
      call: { tool: "write_new_file", path: "~/Documents/Note 4.md" },
    });
    expect(readdirSync(join(home, "Documents")).sort()).toEqual(["Note 1.md", "Note 2.md", "Note 3.md", "Note 4.md"]);
    // The same attempt, carried on.
    expect(h.store.getSubtask(subtask!.id)).toMatchObject({ status: "done", attempts: 1 });
    expect(h.store.listInterruptedTasks()).toEqual([]);
    await until(() => client.events.some((e) => e.method === "speak"));
    client.close();
  });

  it("Scenario: Resume after a reboot", async () => {
    // Given a task was paused before the Mac restarted
    const store = openStore(dir.path);
    const task = runningTask(store, ["Write the four notes"]);
    const [subtask] = store.listSubtasks(task.id);
    store.setSubtaskStatus(subtask!.id, "ready");
    store.setTaskStatus(task.id, "paused");
    store.close();

    // When Yumi starts after the reboot
    const lane = countingLane(home, "After the reboot");
    scriptedModel(server, { plan: NOTES_PLAN, worker: notesWorker, observed: lane.observed });
    const h = await start(lane);
    const client = await app(h.server.socketPath);

    // Then the paused task is listed with a "Resume" button: the app shows Resume for a paused task. It is not an
    // interruption, so Yumi does not ask about it.
    const list = await client.call("listTasks", {});
    expect((list.result as { tasks: Task[] }).tasks).toEqual([expect.objectContaining({ id: task.id, status: "paused" })]);
    expect(h.recovery).toEqual({ interrupted: [], steps: 0 });

    // And nothing runs until the user resumes it
    await settle(500);
    expect(client.events.filter((e) => e.method === "interruptedTaskFound")).toEqual([]);
    expect(server.requests).toEqual([]);
    expect(lane.observed()).toBe(0);
    expect(h.store.listSteps(subtask!.id)).toHaveLength(1);
    expect(h.store.getTask(task.id)!.status).toBe("paused");

    // The user presses Resume: the task carries on from its first finished step, with a fresh observation.
    expect((await client.call("resumeTask", { taskId: task.id })).result).toEqual({});
    await until(() => h.store.getTask(task.id)!.status === "done");
    expect(readdirSync(join(home, "Documents")).sort()).toEqual(["Note 1.md", "Note 2.md", "Note 3.md", "Note 4.md"]);
    expect(h.store.getSubtask(subtask!.id)).toMatchObject({ status: "done", attempts: 1 });
    client.close();
  });

  it("keeps asking after another restart until the user answers, and never resumes on its own", async () => {
    const store = openStore(dir.path);
    const task = runningTask(store, ["Write the four notes"]);
    store.close();

    for (const _ of [1, 2]) {
      const h = await start(countingLane(home, "Fresh"));
      const client = await app(h.server.socketPath);
      await until(() => client.events.some((e) => e.method === "interruptedTaskFound"));
      await settle();
      expect(h.store.getTask(task.id)!.status).toBe("paused");
      expect(h.store.listInterruptedTasks().map((t) => t.id)).toEqual([task.id]);
      client.close();
      await h.close();
      harness = undefined;
    }
    expect(server.requests).toEqual([]);
  });

  it("sends interruptedTaskFound that the protocol's mock Mac app accepts against the contract", async () => {
    const store = openStore(dir.path);
    const task = runningTask(store, ["Write the four notes"]);
    store.close();
    const h = await start(countingLane(home, "Fresh"));

    let output = "";
    const mock = spawn("npm", ["run", "mock:mac", "--", "--socket", h.server.socketPath], {
      cwd: PROTOCOL_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      mock.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      mock.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      await until(() => output.includes("event interruptedTaskFound"), 20_000);
      expect(output).toContain(`[mock Mac app] event interruptedTaskFound ${JSON.stringify({ taskId: task.id })}`);
    } finally {
      mock.kill();
    }
  });

  it("plans again when a restart cut off planning", async () => {
    const store = openStore(dir.path);
    const task = store.createTask({ originDeviceId: "mac-brent", goal: NOTES_GOAL });
    store.setTaskStatus(task.id, "planning", { confirmedGoal: NOTES_GOAL });
    store.close();

    const h = await start(countingLane(home, "Fresh"));
    expect(h.recovery.interrupted).toEqual([task.id]);
    scriptedModel(server, { plan: NOTES_PLAN, worker: notesWorker });
    const client = await app(h.server.socketPath);
    expect((await client.call("resumeTask", { taskId: task.id })).result).toEqual({});
    await until(() => h.store.getTask(task.id)!.status === "done");
    expect(h.store.listSubtasks(task.id)).toHaveLength(1);
    client.close();
  });
});

describe("startup recovery (OBJ-06.1)", () => {
  it("pauses working tasks as interrupted, sends cut-off subtasks back to ready, and leaves the rest alone", () => {
    const store = openStore(dir.path);
    const running = runningTask(store, ["Write the notes", "File them"]);
    const unfinished = store.beginStep({
      subtaskId: store.listSubtasks(running.id)[0]!.id,
      lane: "helper",
      action: { action: { kind: "tool", call: { tool: "read_file", path: "~/Downloads/Lease.pdf" } }, permission: "allowed" },
    });
    // Waiting for an approval when the Mac restarted: the approval is gone, so it is asked again after resume.
    const waiting = runningTask(store, ["Send the email"]);
    const approval = store.listSubtasks(waiting.id)[0]!;
    store.setSubtaskStatus(approval.id, "needsApproval");
    store.setTaskStatus(waiting.id, "waitingForUser");
    store.putWindowLock({
      windowId: 7,
      subtaskId: approval.id,
      lane: "main",
      acquiredAt: "2026-10-09T07:40:00.000Z",
      expiresAt: "2026-10-09T07:50:00.000Z",
    });
    const unconfirmed = store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    const queued = store.createTask({
      originDeviceId: "phone-brent",
      goal: "open Spotify",
      confirmedGoal: "open Spotify",
      status: "queued",
    });
    const finished = runningTask(store, ["Done already"]);
    store.setSubtaskStatus(store.listSubtasks(finished.id)[0]!.id, "done");
    store.setTaskStatus(finished.id, "done", { summary: "Done." });

    const recovery = recoverAfterRestart(store, logger);
    expect(recovery).toEqual({ interrupted: [running.id, waiting.id], steps: 1 });
    expect(store.getStep(unfinished.id)).toMatchObject({ outcome: "noEffect", observation: INTERRUPTED_OBSERVATION });
    expect(store.listUnfinishedSteps()).toEqual([]);
    expect(store.listActionLog(running.id).at(-1)).toMatchObject({
      description: "Started to read Lease.pdf, but was interrupted before it finished",
      outcome: "noEffect",
    });
    expect(store.listSubtasks(running.id).map((s) => s.status)).toEqual(["ready", "pending"]);
    expect(store.getTask(waiting.id)!.status).toBe("paused");
    expect(store.getSubtask(approval.id)!.status).toBe("ready");
    expect(store.listWindowLocks()).toEqual([]);
    expect(store.getTask(unconfirmed.id)!.status).toBe("awaitingConfirmation");
    expect(store.getTask(queued.id)!.status).toBe("queued");
    expect(store.getTask(finished.id)!.status).toBe("done");
    expect(store.listInterruptedTasks().map((t) => t.id)).toEqual([running.id, waiting.id]);

    // Running it again changes nothing.
    const events: unknown[] = [];
    store.onStatusChanged((event) => events.push(event));
    expect(recoverAfterRestart(store, logger)).toEqual({ interrupted: [], steps: 0 });
    expect(events).toEqual([]);
    store.close();
  });

  it("clears the interrupted mark when the task leaves paused, and refuses it on any other status", () => {
    const store = openStore(dir.path);
    const task = runningTask(store, ["Write the notes"]);
    expect(() => store.setTaskStatus(task.id, "failed", { interrupted: true })).toThrow(StoreRuleError);
    store.setSubtaskStatus(store.listSubtasks(task.id)[0]!.id, "ready");
    store.setTaskStatus(task.id, "paused", { interrupted: true });
    expect(store.listInterruptedTasks().map((t) => t.id)).toEqual([task.id]);
    store.setTaskStatus(task.id, "running");
    expect(store.listInterruptedTasks()).toEqual([]);
    store.close();
  });
});

describe("cancelTask and resumeTask (OBJ-06.3)", () => {
  it("cancels an interrupted task without running anything: started subtasks fail, queued ones are dropped (OBJ-38.6)", async () => {
    const store = openStore(dir.path);
    const task = runningTask(store, ["Write the notes", "File them"]);
    store.close();
    const h = await start(countingLane(home, "Fresh"));
    const client = await app(h.server.socketPath);
    await until(() => client.events.some((e) => e.method === "interruptedTaskFound"));

    expect((await client.call("cancelTask", { taskId: task.id })).result).toEqual({});
    expect(h.store.getTask(task.id)!.status).toBe("cancelled");
    expect(h.store.listSubtasks(task.id).map((s) => [s.status, s.result?.note])).toEqual([
      ["failed", "Cancelled before it finished."],
      ["failed", "Cancelled before it started."],
    ]);
    expect(h.store.listInterruptedTasks()).toEqual([]);
    await settle();
    expect(server.requests).toEqual([]);
    // A second cancel, or one that races the end of the task, is harmless.
    expect((await client.call("cancelTask", { taskId: task.id })).result).toEqual({});
    client.close();
  });

  it("cancels a running task: its work stops, and every step it began has an outcome", async () => {
    const lane = countingLane(home, "Working");
    const h = await start(lane);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.respond(async (body) => {
      const request = body as unknown as ChatRequest;
      const system = request.messages[0]!.content as string;
      if (system === PLANNER_SYSTEM_PROMPT) return { kind: "content", content: NOTES_PLAN };
      const text = request.messages[1]!.content as string;
      // Hold the second step's answer, so the cancel arrives while the task is working.
      if (text.includes("Created Note 1.md")) await held;
      return notesWorker(text);
    });
    const task = h.store.createTask({ originDeviceId: "mac-brent", goal: NOTES_GOAL });
    h.store.setTaskStatus(task.id, "planning", { confirmedGoal: NOTES_GOAL });
    const outcome = h.tasks.start(task.id);
    await until(() => server.requests.length === 3);

    const client = await app(h.server.socketPath);
    const cancelled = client.call("cancelTask", { taskId: task.id });
    await until(() => !h.tasks.isRunning(task.id));
    release();
    expect((await cancelled).result).toEqual({});
    expect(await outcome).toEqual({ outcome: "aborted" });
    expect(h.store.getTask(task.id)!.status).toBe("cancelled");
    const [subtask] = h.store.listSubtasks(task.id);
    expect(subtask).toMatchObject({ status: "failed", result: { status: "partial" } });
    expect(h.store.listSteps(subtask!.id).map((s) => s.outcome)).toEqual(["ok"]);
    await settle();
    expect(server.requests).toHaveLength(3);
    expect(readdirSync(join(home, "Documents"))).toEqual(["Note 1.md"]);
    client.close();
  });

  it("answers the Unexpected kind, never raw text, for a task that cannot be resumed or does not exist", async () => {
    const store = openStore(dir.path);
    const done = runningTask(store, ["Write the notes"]);
    store.setSubtaskStatus(store.listSubtasks(done.id)[0]!.id, "done");
    store.setTaskStatus(done.id, "done", { summary: "Done." });
    store.close();
    const h = await start(countingLane(home, "Fresh"));
    const client = await app(h.server.socketPath);

    const notPaused = await client.call("resumeTask", { taskId: done.id });
    expect(notPaused.error).toMatchObject({
      code: -32000,
      data: { kind: "unexpected", taskId: done.id, lastAction: "Created Note 1.md in Documents" },
    });
    const missing = await client.call("resumeTask", { taskId: "00000000-0000-4000-8000-000000000000" });
    expect(missing.error).toMatchObject({ code: -32000, data: { kind: "unexpected" } });
    expect(missing.error!.data).toEqual({ kind: "unexpected" });
    const cancelMissing = await client.call("cancelTask", { taskId: "00000000-0000-4000-8000-000000000000" });
    expect(cancelMissing.error!.data).toEqual({ kind: "unexpected" });
    expect(logger.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: "task.refused", rule: "notPaused" })]),
    );
    client.close();
  });

  it("does nothing on a second resume while the task runs", async () => {
    const store = openStore(dir.path);
    const task = runningTask(store, ["Write the four notes"]);
    store.close();
    const lane = countingLane(home, "Fresh");
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.respond(async (body) => {
      const request = body as unknown as ChatRequest;
      if ((request.messages[0]!.content as string) === SUMMARY_SYSTEM_PROMPT) return content({ summary: SUMMARY });
      await held;
      return notesWorker(request.messages[1]!.content as string);
    });
    const h = await start(lane);
    const client = await app(h.server.socketPath);
    expect((await client.call("resumeTask", { taskId: task.id })).result).toEqual({});
    expect((await client.call("resumeTask", { taskId: task.id })).result).toEqual({});
    release();
    await until(() => h.store.getTask(task.id)!.status === "done");
    expect(readdirSync(join(home, "Documents")).sort()).toEqual(["Note 1.md", "Note 2.md", "Note 3.md", "Note 4.md"]);
    client.close();
  });

  it("refuses to run tasks when the harness has no model or lanes, and still cancels", async () => {
    const store = openStore(dir.path);
    const task = runningTask(store, ["Write the notes"]);
    store.close();
    harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "h.sock") }, logger);
    const client = await app(harness.server.socketPath);
    expect((await client.call("resumeTask", { taskId: task.id })).error!.data).toMatchObject({ kind: "unexpected" });
    expect(harness.store.getTask(task.id)!.status).toBe("paused");
    expect((await client.call("cancelTask", { taskId: task.id })).result).toEqual({});
    expect(harness.store.getTask(task.id)!.status).toBe("cancelled");
    client.close();
  });
});

describe("limits (OBJ-06.5 to OBJ-06.7)", () => {
  it("has the SPEC-02 r8 defaults and reads each from the environment", () => {
    expect(DEFAULT_LIMITS).toEqual({ stepsPerSubtask: 25, attemptsPerSubtask: 3, subtaskDepth: 1 });
    expect(loadConfig({}).limits).toEqual(DEFAULT_LIMITS);
    expect(loadConfig({ YUMI_STEPS_PER_SUBTASK: "40", YUMI_ATTEMPTS_PER_SUBTASK: "2", YUMI_SUBTASK_DEPTH: "2" }).limits).toEqual({
      stepsPerSubtask: 40,
      attemptsPerSubtask: 2,
      subtaskDepth: 2,
    });
    expect(() => loadConfig({ YUMI_STEPS_PER_SUBTASK: "0" })).toThrow("YUMI_STEPS_PER_SUBTASK");
    // Subtask.attempts allows at most 3 in the protocol.
    expect(() => loadConfig({ YUMI_ATTEMPTS_PER_SUBTASK: "4" })).toThrow(
      "YUMI_ATTEMPTS_PER_SUBTASK must be a whole number from 1 to 3",
    );
    expect(() => loadConfig({ YUMI_SUBTASK_DEPTH: "deep" })).toThrow("YUMI_SUBTASK_DEPTH");
  });

  describe("steps", () => {
    const LOOP_PLAN = plan(
      { id: "lease", title: "Read the lease", instruction: "Read ~/Downloads/Lease.pdf." },
      { id: "forever", title: "Sort the downloads", instruction: "Sort ~/Downloads.", dependsOn: ["lease"] },
    );
    /** Reads the lease and finishes; on the other subtask, looks at the folder again and again. */
    const loopWorker = (text: string) => {
      if (/^Instruction: Read/m.test(text))
        return text.includes("Read Lease.pdf") ? finish("Read it.") : tool({ tool: "read_file", path: "~/Downloads/Lease.pdf" });
      return tool({ tool: "list_dir", path: "~/Downloads" });
    };

    async function runLoop(limits?: Limits) {
      writeFileSync(join(home, "Downloads", "Lease.pdf"), "Text of the lease.");
      const h = await start(countingLane(home, "Fresh"), limits);
      const calls = scriptedModel(server, { plan: LOOP_PLAN, worker: loopWorker });
      const client = await app(h.server.socketPath);
      const task = h.store.createTask({ originDeviceId: "mac-brent", goal: "sort my downloads" });
      h.store.setTaskStatus(task.id, "planning", { confirmedGoal: "sort my downloads" });
      const outcome = await h.tasks.start(task.id);
      await until(() => client.events.some((e) => e.method === "userError"));
      return { h, task, calls, outcome, client };
    }

    it("Scenario: Step limit is reached", async () => {
      // Given a subtask has run 25 steps, When it has not finished
      const { h, task, calls, outcome, client } = await runLoop();
      const [, sorting] = h.store.listSubtasks(task.id);
      expect(h.store.listSteps(sorting!.id)).toHaveLength(25);
      // 2 for the lease, 25 for the loop: the 26th step was never asked for.
      expect(calls).toHaveLength(27);

      // Then the subtask status is "failed"
      expect(h.store.getSubtask(sorting!.id)).toMatchObject({
        status: "failed",
        result: { status: "partial", note: "Stopped after 25 steps without finishing." },
      });
      expect(h.store.getTask(task.id)!.status).toBe("failed");

      // And the user hears the error from SPEC-11 for "task took too long": the app turns the kind into the copy,
      // and gets what was finished so far.
      const error = client.events.find((e) => e.method === "userError")!.params;
      expect(error).toEqual({
        kind: "taskTookTooLong",
        taskId: task.id,
        finishedSoFar: "Read the lease\nLooked in the folder Downloads",
      });
      expect(validate("UserError", error).valid).toBe(true);
      expect(outcome).toEqual({ outcome: "failed", userError: error });
      client.close();
    });

    it("uses the configured step limit", async () => {
      const { h, task, client } = await runLoop({ ...DEFAULT_LIMITS, stepsPerSubtask: 3 });
      const [, sorting] = h.store.listSubtasks(task.id);
      expect(h.store.listSteps(sorting!.id)).toHaveLength(3);
      expect(client.events.find((e) => e.method === "userError")!.params).toMatchObject({ kind: "taskTookTooLong" });
      client.close();
    });

    it("counts the steps from before a restart", async () => {
      const store = openStore(dir.path);
      const task = runningTask(store, ["Write the four notes"]);
      store.close();
      const h = await start(countingLane(home, "Fresh"), { ...DEFAULT_LIMITS, stepsPerSubtask: 2 });
      scriptedModel(server, { plan: NOTES_PLAN, worker: notesWorker });
      const client = await app(h.server.socketPath);
      await client.call("resumeTask", { taskId: task.id });
      await until(() => h.store.getTask(task.id)!.status === "failed");
      expect(h.store.listSteps(h.store.listSubtasks(task.id)[0]!.id)).toHaveLength(2);
      await until(() => client.events.some((e) => e.method === "userError"));
      expect(client.events.find((e) => e.method === "userError")!.params).toEqual({
        kind: "taskTookTooLong",
        taskId: task.id,
        finishedSoFar: "Created Note 1.md in Documents\nCreated Note 2.md in Documents",
      });
      client.close();
    });

    it("lists what was finished in at most 500 characters, each item once, and counts the rest", () => {
      expect(finishedSoFar([])).toBeUndefined();
      expect(finishedSoFar(["Read the lease", "Read the lease", "Created Notes.md in Documents"])).toBe(
        "Read the lease\nCreated Notes.md in Documents",
      );
      const many = Array.from({ length: 40 }, (_, i) => `Created Report number ${i + 1}.md in Documents`);
      const text = finishedSoFar(many)!;
      expect(text.length).toBeLessThanOrEqual(MAX_FINISHED_SO_FAR);
      const lines = text.split("\n");
      expect(lines[0]).toBe(many[0]);
      expect(lines.at(-1)).toBe(`And ${40 - (lines.length - 1)} more.`);
      expect(finishedSoFar(["x".repeat(900)])).toBe(`${"x".repeat(197)}...`);
    });
  });

  describe("attempts", () => {
    it("fails a subtask whose attempts are used up before it runs or is routed", async () => {
      const h = await start(countingLane(home, "Fresh"));
      scriptedModel(server, { plan: NOTES_PLAN, worker: notesWorker });
      const client = await app(h.server.socketPath);
      const task = h.store.createTask({ originDeviceId: "mac-brent", goal: NOTES_GOAL });
      h.store.setTaskStatus(task.id, "planning", { confirmedGoal: NOTES_GOAL });
      // Three attempts already made, as a handoff or a retry would leave them (OBJ-09, OBJ-38).
      h.store.onStatusChanged((event) => {
        if (event.subtaskStatus === "ready") h.store.updateSubtask(event.subtaskId!, { attempts: 3 });
      });
      const outcome = await h.tasks.start(task.id);
      const [subtask] = h.store.listSubtasks(task.id);
      expect(h.store.getSubtask(subtask!.id)).toMatchObject({
        status: "failed",
        attempts: 3,
        result: { status: "stuck", note: "Stopped after 3 attempts without finishing." },
      });
      expect(subtask!.lane).toBeUndefined();
      expect(h.store.listSteps(subtask!.id)).toEqual([]);
      // Only the planner was asked.
      expect(server.requests).toHaveLength(1);
      expect(outcome).toEqual({
        outcome: "failed",
        userError: { kind: "stepFailed", taskId: task.id, step: "Write the four notes" },
      });
      await until(() => client.events.some((e) => e.method === "userError"));
      client.close();
    });

    it("uses the configured attempt limit, and a resume carries on the attempt it cut off", async () => {
      const store = openStore(dir.path);
      const task = runningTask(store, ["Write the four notes"]);
      store.close();
      // One attempt allowed, and already used by the run before the restart: the resume still finishes it.
      const h = await start(countingLane(home, "Fresh"), { ...DEFAULT_LIMITS, attemptsPerSubtask: 1 });
      scriptedModel(server, { plan: NOTES_PLAN, worker: notesWorker });
      const client = await app(h.server.socketPath);
      await client.call("resumeTask", { taskId: task.id });
      await until(() => h.store.getTask(task.id)!.status === "done");
      expect(h.store.listSubtasks(task.id)[0]).toMatchObject({ status: "done", attempts: 1 });
      client.close();
    });
  });

  describe("subtask depth", () => {
    it("rejects a subtask made from inside a subtask, and writes nothing", () => {
      const store = openStore(dir.path);
      const { task, subtask } = runningSubtask(store);
      const events: unknown[] = [];
      store.onStatusChanged((event) => events.push(event));
      let error: unknown;
      try {
        store.addSubtask({
          taskId: task.id,
          title: "Nested",
          instruction: "Do more.",
          proposedLane: "helper",
          parentSubtaskId: subtask.id,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(StoreRuleError);
      expect((error as StoreRuleError).rule).toBe("subtaskDepth");
      expect(store.listSubtasks(task.id)).toHaveLength(1);
      expect(store.getTask(task.id)!.plan).toEqual([subtask.id]);
      expect(events).toEqual([]);
      store.close();
    });

    it("follows the configured depth", () => {
      const store = TaskStore.open({ dir: dir.path, logger, maxSubtaskDepth: 2 });
      const { task, subtask } = runningSubtask(store);
      const child = store.addSubtask({
        taskId: task.id,
        title: "Nested",
        instruction: "Do more.",
        proposedLane: "helper",
        parentSubtaskId: subtask.id,
      });
      expect(() =>
        store.addSubtask({
          taskId: task.id,
          title: "Deeper",
          instruction: "Do even more.",
          proposedLane: "helper",
          parentSubtaskId: child.id,
        }),
      ).toThrow(expect.objectContaining({ rule: "subtaskDepth" }));
      const other = runningSubtask(store, "another goal");
      expect(() =>
        store.addSubtask({
          taskId: other.task.id,
          title: "Elsewhere",
          instruction: "Do more.",
          proposedLane: "helper",
          parentSubtaskId: subtask.id,
        }),
      ).toThrow(expect.objectContaining({ rule: "parentInOtherTask" }));
      store.close();
    });

    it("opens the running harness's store with the configured depth", async () => {
      const h = await start(countingLane(home, "Fresh"), { ...DEFAULT_LIMITS, subtaskDepth: 2 });
      const { task, subtask } = runningSubtask(h.store);
      expect(
        h.store.addSubtask({
          taskId: task.id,
          title: "Nested",
          instruction: "Do more.",
          proposedLane: "helper",
          parentSubtaskId: subtask.id,
        }),
      ).toMatchObject({ status: "pending" });
      expect(existsSync(h.store.dbPath)).toBe(true);
    });
  });
});
