import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@yumi/protocol";
import { PROTOCOL_VERSION } from "@yumi/protocol/types";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { HarnessAlreadyRunningError } from "../src/rpc/server.ts";
import { PROTOCOL_DIR, rawClient, tempDir } from "./helpers.ts";
import { exampleAction, runningSubtask } from "./store-helpers.ts";

let dir: { path: string; cleanup: () => void };
let logger: MemoryLogger;
let harness: Harness;

beforeEach(async () => {
  dir = tempDir();
  logger = new MemoryLogger();
  harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "harness.sock") }, logger);
});

afterEach(async () => {
  await harness.close();
  dir.cleanup();
});

/** A bare client that said hello, so it gets events. */
async function app() {
  const client = await rawClient(harness.server.socketPath);
  client.send({ jsonrpc: "2.0", id: 0, method: "hello", params: { protocolVersion: PROTOCOL_VERSION } });
  await client.next();
  let id = 1;
  return {
    ...client,
    call: async (method: string, params: unknown) => {
      client.send({ jsonrpc: "2.0", id: id++, method, params });
      return (await client.next()) as { result?: unknown; error?: { code: number; data?: unknown } };
    },
  };
}

/** A finished task with a step, like one the user did months ago. */
function invoicesTask() {
  const { store } = harness;
  const { task, subtask } = runningSubtask(store, "file the March invoices in the Accounting folder");
  const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
  store.finishStep(step.id, { outcome: "ok", log: { deviceId: "mac-brent", description: "Clicked Export To in Keynote" } });
  store.setSubtaskStatus(subtask.id, "done");
  store.setTaskStatus(task.id, "done", { summary: "Done. I filed 4 invoices." });
  return { task: store.getTask(task.id)!, step: store.getStep(step.id)! };
}

describe.skipIf(process.platform === "win32")("the history methods over the local RPC", () => {
  it("a second harness on the same folder refuses to start and leaves the running task's records alone", async () => {
    // The Mac app retries its own harness while gui:run holds the socket (live Keynote runs, 2026-10-10).
    const { task, subtask } = runningSubtask(harness.store);
    const second = new MemoryLogger();
    await expect(startHarness({ supportDir: dir.path, socketPath: join(dir.path, "harness.sock") }, second)).rejects.toThrow(
      HarnessAlreadyRunningError,
    );
    expect(harness.store.getTask(task.id)!.status).toBe("running");
    expect(harness.store.getSubtask(subtask.id)).toMatchObject({ status: "running", attempts: 1 });
    expect(second.entries.map((e) => e.event)).not.toContain("recovery.done");
    expect(second.entries.map((e) => e.event)).not.toContain("store.opened");
  });

  it("listTasks returns past tasks newest first", async () => {
    const first = invoicesTask().task;
    const second = harness.store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    const client = await app();
    const reply = await client.call("listTasks", { limit: 10 });
    expect(validate("TaskList", reply.result).errors).toEqual([]);
    expect((reply.result as { tasks: { id: string }[] }).tasks.map((t) => t.id)).toEqual([second.id, first.id]);
    client.close();
  });

  // SPEC-02, "Finished tasks are kept", over the local RPC the Mac app uses.
  it("searchTasks finds a task by text, and getTask returns it with its subtasks, steps, and action log", async () => {
    const { task, step } = invoicesTask();
    harness.store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    const client = await app();

    const found = await client.call("searchTasks", { query: "invoices", limit: 10 });
    expect(found.result).toEqual({ tasks: [task] });

    const detail = await client.call("getTask", { taskId: task.id });
    expect(validate("TaskDetail", detail.result).errors).toEqual([]);
    expect(detail.result).toMatchObject({
      task: { id: task.id, status: "done" },
      steps: [step],
      actionLog: [{ taskId: task.id, lane: "main", description: "Clicked Export To in Keynote", outcome: "ok" }],
    });
    client.close();
  });

  it("getTask for a task that does not exist answers with the generic UserError and logs the id", async () => {
    const client = await app();
    const taskId = "00000000-0000-4000-8000-000000000000";
    const reply = await client.call("getTask", { taskId });
    expect(reply.error).toMatchObject({ code: -32000, data: { kind: "unexpected" } });
    expect(JSON.stringify(reply.error!.data)).not.toContain("not found");
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "history.taskNotFound", taskId }));
    client.close();
  });

  it("refuses params that break the contract", async () => {
    const client = await app();
    expect((await client.call("searchTasks", { query: "" })).error).toMatchObject({ code: -32602 });
    expect((await client.call("listTasks", { limit: 1000 })).error).toMatchObject({ code: -32602 });
    client.close();
  });
});

describe.skipIf(process.platform === "win32")("taskStatusChanged over the local RPC", () => {
  it("sends one event per status change to the app", async () => {
    const client = await app();
    const task = harness.store.createTask({ originDeviceId: "mac-brent", goal: "tidy my desktop" });
    harness.store.setTaskStatus(task.id, "cancelled");
    expect(await client.next()).toEqual({
      jsonrpc: "2.0",
      method: "taskStatusChanged",
      params: { taskId: task.id, status: "awaitingConfirmation" },
    });
    expect(await client.next()).toEqual({
      jsonrpc: "2.0",
      method: "taskStatusChanged",
      params: { taskId: task.id, status: "cancelled" },
    });
    // Nothing else arrives: a ping answers next.
    client.send({ jsonrpc: "2.0", id: 99, method: "ping", params: {} });
    expect(await client.next()).toEqual({ jsonrpc: "2.0", id: 99, result: {} });
    client.close();
  });

  describe("with the protocol's mock Mac app (npm run mock:mac)", () => {
    let mock: ChildProcess | undefined;
    let output = "";

    afterEach(() => {
      mock?.kill();
      mock = undefined;
      output = "";
    });

    async function waitFor(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`Timed out. Mock output:\n${output}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    it("receives the events and accepts them against the contract", async () => {
      mock = spawn("npm", ["run", "mock:mac", "--", "--socket", harness.server.socketPath], {
        cwd: PROTOCOL_DIR,
        stdio: ["ignore", "pipe", "pipe"],
      });
      mock.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      mock.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      await waitFor(() => harness.server.readyConnections === 1);

      const { task, subtask } = runningSubtask(harness.store);
      await waitFor(() =>
        output.includes(
          `[mock Mac app] event taskStatusChanged ${JSON.stringify({ taskId: task.id, status: "running", subtaskId: subtask.id, subtaskStatus: "running" })}`,
        ),
      );
      expect(output.match(/event taskStatusChanged/g)).toHaveLength(5);
    }, 30_000);
  });
});
