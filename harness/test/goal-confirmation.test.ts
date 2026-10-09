import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validate } from "@yumi/protocol";
import { PROTOCOL_VERSION } from "@yumi/protocol/types";
import { classifyReply, CLASSIFY_SYSTEM_PROMPT, fixedReply } from "../src/confirm/classify.ts";
import { checkRestatement, confirmedGoalFrom, repeatBack, RESTATE_SYSTEM_PROMPT } from "../src/confirm/restate.ts";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../src/planner/summary.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";
import { TaskStore } from "../src/store/task-store.ts";
import { workerSystemPrompt } from "../src/worker/prompt.ts";
import { modelConfig, rawClient, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";

/**
 * The goal confirmation loop (OBJ-17) end to end on the harness side: the real task store, planner, scheduler, and
 * local RPC server, a mocked model server, and a bare app client on the socket standing in for the Mac app. The
 * SPEC-01 "Voice intake and confirmation" scenarios are checked with their exact copy.
 */

vi.setConfig({ testTimeout: 30_000 });

const INVOICES = "rename the invoices in Downloads by date";
const INVOICES_GOAL = "rename the invoices in your Downloads folder by date";
const OCTOBER_GOAL = "rename only the October invoices in your Downloads folder by date";
const SAID_INVOICES = "You want me to rename the invoices in your Downloads folder by date. Should I go ahead?";
const SAID_OCTOBER =
  "Got it. You want me to rename only the October invoices in your Downloads folder by date. Should I go ahead?";

const content = (value: unknown): MockReply => ({ kind: "content", content: JSON.stringify(value) });

type Purpose = "restate" | "classify" | "planner" | "worker" | "summary";

interface ModelScript {
  /** The clause for each restate request, in order. */
  restate?: (string | MockReply)[];
  /** The meaning of each classify request, in order. */
  classify?: (string | MockReply)[];
}

/** A model that restates, classifies, plans one helper subtask, finishes it, and summarizes. Records each request's purpose. */
function scriptedModel(server: MockModelServer, script: ModelScript) {
  const seen: { purpose: Purpose; text: string }[] = [];
  const restates = [...(script.restate ?? [])];
  const classifies = [...(script.classify ?? [])];
  server.respond((body) => {
    const request = body as unknown as ChatRequest;
    const system = request.messages[0]!.content as string;
    const text = request.messages[1]!.content as string;
    if (system === RESTATE_SYSTEM_PROMPT) {
      seen.push({ purpose: "restate", text });
      const next = restates.shift() ?? "do something unexpected";
      return typeof next === "string" ? content({ goal: next }) : next;
    }
    if (system === CLASSIFY_SYSTEM_PROMPT) {
      seen.push({ purpose: "classify", text });
      const next = classifies.shift() ?? "unclear";
      return typeof next === "string" ? content({ reply: next }) : next;
    }
    if (system === PLANNER_SYSTEM_PROMPT) {
      seen.push({ purpose: "planner", text });
      return content({
        subtasks: [
          { id: "list", title: "Look in Downloads", instruction: "List ~/Downloads.", dependsOn: [], proposedLane: "helper" },
        ],
      });
    }
    if (system === SUMMARY_SYSTEM_PROMPT) {
      seen.push({ purpose: "summary", text });
      return content({ summary: "Done. I looked in your Downloads folder." });
    }
    if (system.startsWith(workerSystemPrompt("helper").split("\n")[0]!)) {
      seen.push({ purpose: "worker", text });
      return content({ action: { kind: "finish", status: "done", note: "Looked." } });
    }
    throw new Error("unexpected request");
  });
  return { seen, purposes: () => seen.map((s) => s.purpose) };
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
  const named = (method: string) => events.filter((e) => e.method === method).map((e) => e.params as Record<string, unknown>);
  return { events, named, call, close: () => client.close() };
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

async function start(options: { work?: boolean; baseUrl?: string } = {}): Promise<Harness> {
  harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "h.sock") }, logger, {
    ...(options.work === false
      ? {}
      : {
          work: {
            client: new ModelClient(modelConfig(options.baseUrl ?? server.baseUrl), logger),
            logger,
            deviceId: "mac-brent",
            home,
            lanes: { helper: fileHelperLane({ home, logger }) },
            slots: 1,
          },
        }),
  });
  return harness;
}

const spoken = (text: string) => ({ kind: "spoken", text });
const button = (choice: "goAhead" | "changeIt" | "cancel") => ({ kind: "button", choice });

/** Submits the invoices goal and waits for the first repeat-back. */
async function submitInvoices(client: Awaited<ReturnType<typeof app>>): Promise<string> {
  const submitted = await client.call("submitGoal", { transcript: INVOICES, originDeviceId: "mac-brent" });
  const taskId = (submitted.result as { taskId: string }).taskId;
  await until(() => client.named("goalRestated").length === 1);
  return taskId;
}

describe("SPEC-01 Voice intake and confirmation", () => {
  it("Scenario: User gives a goal and confirms it", async () => {
    const model = scriptedModel(server, { restate: [INVOICES_GOAL] });
    const h = await start();
    const client = await app(h.server.socketPath);
    // Given Yumi is idle on the Mac
    // When the user says "rename the invoices in Downloads by date"
    const taskId = await submitInvoices(client);
    // Then a cursor spawns near the user's pointer
    const spawn = client.named("cursorCommand")[0];
    expect(spawn).toEqual({ command: "spawn", cursorId: "main", cursorKind: "main" });
    expect(spawn).not.toHaveProperty("at");
    // And Yumi says "You want me to rename the invoices in your Downloads folder by date. Should I go ahead?"
    expect(client.named("goalRestated")).toEqual([{ taskId, text: SAID_INVOICES }]);
    expect(h.store.getTask(taskId)).toMatchObject({ status: "awaitingConfirmation", goal: INVOICES });
    expect(model.purposes()).toEqual(["restate"]);
    // When the user says "yes"
    await client.call("replyToConfirmation", { taskId, reply: spoken("yes") });
    // Then a task is created with that confirmed goal
    // And the task status is "planning"
    await until(() => client.named("taskStatusChanged").some((e) => e.taskId === taskId && e.status === "planning"));
    const statuses = client
      .named("taskStatusChanged")
      .filter((e) => e.subtaskId === undefined)
      .map((e) => e.status);
    expect(statuses.slice(0, 2)).toEqual(["awaitingConfirmation", "planning"]);
    const task = h.store.getTask(taskId)!;
    expect(task.confirmedGoal).toBe("Rename the invoices in your Downloads folder by date");
    expect(task.goal).toBe(INVOICES);
    // The work starts only now, and runs to the end.
    await until(() => h.store.getTask(taskId)!.status === "done");
    expect(model.purposes()).toEqual(["restate", "planner", "worker", "summary"]);
    expect(model.seen[1]!.text).toContain("Goal: Rename the invoices in your Downloads folder by date");
    client.close();
  });

  it("Scenario: User corrects the goal", async () => {
    const model = scriptedModel(server, { restate: [INVOICES_GOAL, OCTOBER_GOAL], classify: ["correction"] });
    const h = await start();
    const client = await app(h.server.socketPath);
    // Given Yumi has repeated back a goal
    const taskId = await submitInvoices(client);
    // When the user says "no, only the ones from October"
    await client.call("replyToConfirmation", { taskId, reply: spoken("no, only the ones from October") });
    // Then Yumi says "Got it. You want me to rename only the October invoices in your Downloads folder by date. Should I go ahead?"
    await until(() => client.named("goalRestated").length === 2);
    expect(client.named("goalRestated")[1]).toEqual({ taskId, text: SAID_OCTOBER });
    // The model saw the goal, what it said, and the correction.
    const restate = model.seen.filter((s) => s.purpose === "restate")[1]!.text;
    expect(restate).toContain(JSON.stringify(INVOICES));
    expect(restate).toContain(JSON.stringify(INVOICES_GOAL));
    expect(restate).toContain(JSON.stringify("no, only the ones from October"));
    // And no task work has started
    await settle();
    expect(model.purposes()).toEqual(["restate", "classify", "restate"]);
    expect(h.store.getTask(taskId)).toMatchObject({ status: "awaitingConfirmation", plan: [] });
    expect(h.store.getTask(taskId)!.confirmedGoal).toBeUndefined();
    expect(h.store.listSubtasks(taskId)).toEqual([]);
    // A yes now confirms the corrected goal; the raw goal stays what the user first said.
    await client.call("replyToConfirmation", { taskId, reply: button("goAhead") });
    await until(() => h.store.getTask(taskId)!.status === "done");
    expect(h.store.getTask(taskId)).toMatchObject({
      goal: INVOICES,
      confirmedGoal: "Rename only the October invoices in your Downloads folder by date",
    });
    client.close();
  });

  it("Scenario: User cancels before work starts", async () => {
    const model = scriptedModel(server, { restate: [INVOICES_GOAL] });
    const h = await start();
    const client = await app(h.server.socketPath);
    // Given Yumi has repeated back a goal
    const taskId = await submitInvoices(client);
    // When the user says "never mind"
    await client.call("replyToConfirmation", { taskId, reply: spoken("never mind") });
    // Then Yumi says "Okay, I won't do anything."
    // And the cursor fades out
    // The Mac app says the line and fades the cursor when the task turns cancelled
    // (mac/YumiTests/GoalConfirmationTests.swift), so the harness sends neither, or they would come twice.
    await until(() => h.store.getTask(taskId)!.status === "cancelled");
    await until(() => client.named("taskStatusChanged").some((e) => e.taskId === taskId && e.status === "cancelled"));
    expect(client.named("speak")).toEqual([]);
    expect(client.named("cursorCommand").some((c) => c.command === "fade")).toBe(false);
    // And no task is created: the record ends cancelled with no confirmed goal, no plan, and nothing run.
    await settle();
    expect(model.purposes()).toEqual(["restate"]);
    const task = h.store.getTask(taskId)!;
    expect(task.status).toBe("cancelled");
    expect(task.confirmedGoal).toBeUndefined();
    expect(task.plan).toEqual([]);
    expect(h.store.listActionLog(taskId)).toEqual([]);
    client.close();
  });

  it("Taglish goals are repeated back in English", async () => {
    const model = scriptedModel(server, { restate: ["find your latest resume and send it to Ana"] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taglish = "pakihanap yung latest na resume ko and send it to Ana";
    const submitted = await client.call("submitGoal", { transcript: taglish, originDeviceId: "mac-brent" });
    await until(() => client.named("goalRestated").length === 1);
    expect(client.named("goalRestated")[0]!.text).toBe(
      "You want me to find your latest resume and send it to Ana. Should I go ahead?",
    );
    expect(model.seen[0]!.text).toContain(JSON.stringify(taglish));
    expect(RESTATE_SYSTEM_PROMPT).toContain("Write it in plain English, even when the user mixed in Tagalog");
    expect(h.store.getTask((submitted.result as { taskId: string }).taskId)!.goal).toBe(taglish);
    client.close();
  });
});

describe("OBJ-17 answers", () => {
  it("reads a yes the fixed list does not know with the model", async () => {
    const model = scriptedModel(server, { restate: [INVOICES_GOAL], classify: ["confirm"] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    await client.call("replyToConfirmation", { taskId, reply: spoken("sige, go for it") });
    await until(() => h.store.getTask(taskId)!.status === "done");
    expect(model.purposes()).toEqual(["restate", "classify", "planner", "worker", "summary"]);
    expect(model.seen[1]!.text).toContain(JSON.stringify(SAID_INVOICES));
    expect(model.seen[1]!.text).toContain(JSON.stringify("sige, go for it"));
    client.close();
  });

  it("asks an unclear answer again once, then waits for a button, and never runs on it", async () => {
    const model = scriptedModel(server, { restate: [INVOICES_GOAL], classify: ["unclear", "unclear", "unclear"] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    await client.call("replyToConfirmation", { taskId, reply: spoken("hmm what") });
    // Asked again: the same repeat-back.
    await until(() => client.named("goalRestated").length === 2);
    expect(client.named("goalRestated")[1]).toEqual({ taskId, text: SAID_INVOICES });
    await client.call("replyToConfirmation", { taskId, reply: spoken("the weather is nice") });
    await until(() => logger.entries.some((e) => e.event === "confirm.waitingForButton"));
    // Not listening any more: the cursor waits for a button instead of thinking.
    expect(client.named("cursorCommand").at(-1)).toEqual({ command: "setState", cursorId: "main", state: "waitingForUser" });
    // Not asked a third time, nothing planned, and still waiting.
    await settle();
    expect(client.named("goalRestated")).toHaveLength(2);
    expect(model.purposes()).toEqual(["restate", "classify", "classify"]);
    expect(h.store.getTask(taskId)!.status).toBe("awaitingConfirmation");
    // The panel's buttons still work.
    await client.call("replyToConfirmation", { taskId, reply: button("goAhead") });
    await until(() => h.store.getTask(taskId)!.status === "done");
    client.close();
  });

  it("treats a model reply that is not a meaning as unclear, never as a yes", async () => {
    const model = scriptedModel(server, {
      restate: [INVOICES_GOAL],
      classify: [content({ reply: "yes" }), { kind: "content", content: "confirm" }],
    });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    await client.call("replyToConfirmation", { taskId, reply: spoken("absolutely, yes") });
    await until(() => client.named("goalRestated").length === 2);
    await client.call("replyToConfirmation", { taskId, reply: spoken("absolutely, yes") });
    await until(() => logger.entries.some((e) => e.event === "confirm.waitingForButton"));
    await settle();
    expect(model.purposes()).not.toContain("planner");
    expect(h.store.getTask(taskId)!.status).toBe("awaitingConfirmation");
    client.close();
  });

  it("Change it: the next spoken answer is the correction, without asking the model what it means", async () => {
    const model = scriptedModel(server, { restate: [INVOICES_GOAL, OCTOBER_GOAL] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    await client.call("replyToConfirmation", { taskId, reply: button("changeIt") });
    await settle(100);
    expect(client.named("goalRestated")).toHaveLength(1);
    await client.call("replyToConfirmation", { taskId, reply: spoken("only the ones from October") });
    await until(() => client.named("goalRestated").length === 2);
    expect(client.named("goalRestated")[1]).toEqual({ taskId, text: SAID_OCTOBER });
    expect(model.purposes()).toEqual(["restate", "restate"]);
    client.close();
  });

  it("the Cancel button cancels like saying it", async () => {
    const model = scriptedModel(server, { restate: [INVOICES_GOAL] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    await client.call("replyToConfirmation", { taskId, reply: button("cancel") });
    await until(() => h.store.getTask(taskId)!.status === "cancelled");
    expect(client.named("speak")).toEqual([]);
    expect(model.purposes()).toEqual(["restate"]);
    client.close();
  });

  it("ignores a second Go ahead, and refuses an answer for a task that does not exist", async () => {
    const model = scriptedModel(server, { restate: [INVOICES_GOAL] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    const [first, second] = await Promise.all([
      client.call("replyToConfirmation", { taskId, reply: button("goAhead") }),
      client.call("replyToConfirmation", { taskId, reply: button("goAhead") }),
    ]);
    expect(first.result).toEqual({});
    expect(second.result).toEqual({});
    await until(() => h.store.getTask(taskId)!.status === "done");
    expect(model.purposes().filter((p) => p === "planner")).toHaveLength(1);
    await client.call("replyToConfirmation", { taskId, reply: button("goAhead") });
    const unknown = await client.call("replyToConfirmation", {
      taskId: "00000000-0000-4000-8000-000000000000",
      reply: button("goAhead"),
    });
    expect(unknown.error?.data).toEqual({ kind: "unexpected" });
    client.close();
  });

  it("every event it sends is valid against the contract", async () => {
    scriptedModel(server, { restate: [INVOICES_GOAL, OCTOBER_GOAL], classify: ["correction"] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    await client.call("replyToConfirmation", { taskId, reply: spoken("no, only the ones from October") });
    await until(() => client.named("goalRestated").length === 2);
    await client.call("replyToConfirmation", { taskId, reply: spoken("never mind") });
    await until(() => h.store.getTask(taskId)!.status === "cancelled");
    await settle(100);
    const types: Record<string, string> = {
      goalRestated: "GoalRestated",
      cursorCommand: "CursorCommand",
      speak: "Speak",
      taskStatusChanged: "TaskStatusChanged",
    };
    for (const event of client.events) expect(validate(types[event.method]!, event.params).valid, event.method).toBe(true);
    expect(client.named("cursorCommand").map((c) => (c.command === "setState" ? c.state : c.command))).toEqual([
      // The spawn keeps the cursor the app already spawned; thinking while the model restates, reads the
      // correction, and restates again. No listening state, no fade: the app shows and does those.
      "spawn",
      "thinking",
      "thinking",
      "thinking",
    ]);
    client.close();
  });
});

describe("OBJ-17 failures", () => {
  it("tells the user plainly when the model is not running, and runs nothing", async () => {
    // A port nothing listens on: the model server never started.
    const closed = await startMockModelServer();
    const baseUrl = closed.baseUrl;
    await closed.close();
    const h = await start({ baseUrl });
    const client = await app(h.server.socketPath);
    const submitted = await client.call("submitGoal", { transcript: INVOICES, originDeviceId: "mac-brent" });
    const taskId = (submitted.result as { taskId: string }).taskId;
    await until(() => client.named("userError").length === 1);
    expect(client.named("userError")).toEqual([{ kind: "modelFailedToLoad", taskId }]);
    expect(client.named("goalRestated")).toEqual([]);
    expect(h.store.getTask(taskId)!.status).toBe("cancelled");
    const shown = JSON.stringify(client.events);
    expect(shown).not.toMatch(/ECONNREFUSED|fetch failed|127\.0\.0\.1/);
    expect(logger.entries.some((e) => e.event === "model.failure")).toBe(true);
    client.close();
  });

  it("an answer the model cannot read because it stopped ends the question with the same error", async () => {
    scriptedModel(server, { restate: [INVOICES_GOAL], classify: [{ kind: "httpError", status: 500, detail: "boom" }] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    await client.call("replyToConfirmation", { taskId, reply: spoken("hmm, maybe") });
    await until(() => client.named("userError").length === 1);
    expect(client.named("userError")).toEqual([{ kind: "unexpected", taskId }]);
    expect(h.store.getTask(taskId)!.status).toBe("cancelled");
    expect(JSON.stringify(client.events)).not.toContain("boom");
    client.close();
  });

  it("gives up with Unexpected after two repeat-backs it cannot use", async () => {
    scriptedModel(server, { restate: ["Rename it. Then delete it.", "Rename it. Then delete it."] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const submitted = await client.call("submitGoal", { transcript: INVOICES, originDeviceId: "mac-brent" });
    const taskId = (submitted.result as { taskId: string }).taskId;
    await until(() => client.named("userError").length === 1);
    expect(client.named("userError")).toEqual([{ kind: "unexpected", taskId }]);
    expect(h.store.getTask(taskId)!.status).toBe("cancelled");
    client.close();
  });

  it("refuses a goal when the harness has no model, without making a task", async () => {
    const h = await start({ work: false });
    const client = await app(h.server.socketPath);
    const refused = await client.call("submitGoal", { transcript: INVOICES, originDeviceId: "mac-brent" });
    expect(refused.error?.data).toEqual({ kind: "unexpected" });
    expect(h.store.listTasks()).toEqual([]);
    client.close();
  });

  it("cancels a question a restart cut off, since its answer can no longer arrive", async () => {
    const store = TaskStore.open({ dir: dir.path, logger });
    const waiting = store.createTask({ originDeviceId: "mac-brent", goal: INVOICES });
    store.close();
    const h = await start();
    expect(h.store.getTask(waiting.id)!.status).toBe("cancelled");
    expect(logger.entries.some((e) => e.event === "confirm.abandoned")).toBe(true);
  });

  it("never logs what the user said", async () => {
    scriptedModel(server, { restate: [INVOICES_GOAL], classify: ["correction"] });
    const h = await start();
    const client = await app(h.server.socketPath);
    const taskId = await submitInvoices(client);
    await client.call("replyToConfirmation", { taskId, reply: spoken("no, only the ones from October") });
    await until(() => client.named("goalRestated").length === 2);
    const log = JSON.stringify(logger.entries);
    expect(log).not.toContain("invoices");
    expect(log).not.toContain("October");
    client.close();
  });
});

describe("OBJ-17 repeat-back and answer checks", () => {
  it("normalizes the clause the model writes", () => {
    expect(checkRestatement(JSON.stringify({ goal: "Rename the invoices in your Downloads folder by date." }))).toEqual({
      ok: true,
      goal: INVOICES_GOAL,
    });
    expect(checkRestatement(JSON.stringify({ goal: "You want me to export the deck as a PDF" }))).toEqual({
      ok: true,
      goal: "export the deck as a PDF",
    });
    expect(checkRestatement(JSON.stringify({ goal: "PDF the deck" }))).toEqual({ ok: true, goal: "PDF the deck" });
    expect(checkRestatement(JSON.stringify({ goal: "Rename it. Then delete it." })).ok).toBe(false);
    expect(checkRestatement(JSON.stringify({ goal: " " })).ok).toBe(false);
    expect(checkRestatement(JSON.stringify({ goal: "x", extra: 1 })).ok).toBe(false);
    expect(checkRestatement("not json").ok).toBe(false);
    expect(checkRestatement(null).ok).toBe(false);
  });

  it("builds the SPEC-01 sentences and the stored goal", () => {
    expect(repeatBack(INVOICES_GOAL, false)).toBe(SAID_INVOICES);
    expect(repeatBack(OCTOBER_GOAL, true)).toBe(SAID_OCTOBER);
    expect(confirmedGoalFrom(INVOICES_GOAL)).toBe("Rename the invoices in your Downloads folder by date");
  });

  it("reads the fixed answers and the button labels without the model", async () => {
    expect(fixedReply("Yes.")).toBe("confirm");
    expect(fixedReply("Go ahead!")).toBe("confirm");
    expect(fixedReply("Never mind")).toBe("cancel");
    expect(fixedReply("Cancel")).toBe("cancel");
    expect(fixedReply("no")).toBeUndefined();
    expect(fixedReply("no, only the ones from October")).toBeUndefined();
    const model = scriptedModel(server, {});
    const client = new ModelClient(modelConfig(server.baseUrl), logger);
    expect(await classifyReply(SAID_INVOICES, "yes", { client, logger })).toEqual({ kind: "confirm", by: "fixed" });
    expect(model.seen).toEqual([]);
  });
});
