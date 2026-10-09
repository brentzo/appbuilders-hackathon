import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validate } from "@yumi/protocol";
import { PROTOCOL_VERSION, type Observation, type Subtask } from "@yumi/protocol/types";
import { CLASSIFY_SYSTEM_PROMPT } from "../src/confirm/classify.ts";
import { RESTATE_SYSTEM_PROMPT } from "../src/confirm/restate.ts";
import { loadConfig } from "../src/config.ts";
import { DEBUG_LOG_FOLDER, DebugLog } from "../src/debug/debug-log.ts";
import { PASSWORD_REMOVED, PasswordScrubber } from "../src/debug/scrub.ts";
import { describeDecision, describeSees } from "../src/debug/thoughts.ts";
import { startHarness, type Harness } from "../src/harness.ts";
import { FileLogger, MemoryLogger, type Logger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../src/planner/summary.ts";
import { fileHelperLane, type LaneRunner } from "../src/scheduler/lanes.ts";
import { modelConfig, PROTOCOL_DIR, rawClient, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";

/**
 * OBJ-52: Debug mode keeps full local logs (SPEC-07 r20, r22, r23). The real harness on its socket, with a mocked
 * model server and a bare app client standing in for the Mac app, as in goal-confirmation.test.ts.
 */

vi.setConfig({ testTimeout: 30_000 });

const DAY = 24 * 60 * 60 * 1000;
const SECRET = "hunter2-Sup3r$ecret";
const content = (value: unknown): MockReply => ({ kind: "content", content: JSON.stringify(value) });

type Entry = Record<string, unknown> & { event: string; time: string };

let dir: { path: string; cleanup: () => void };
let home: string;
let server: MockModelServer;
let logger: MemoryLogger;
let harness: Harness | undefined;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  mkdirSync(join(home, "Downloads"), { recursive: true });
  writeFileSync(join(home, "Downloads", "invoice-october.pdf"), "pdf");
  server = await startMockModelServer();
  logger = new MemoryLogger();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await server.close();
  dir.cleanup();
});

const debugDir = () => join(dir.path, DEBUG_LOG_FOLDER);

/** Every entry in the debug log files, oldest first. */
function debugEntries(): Entry[] {
  if (!existsSync(debugDir())) return [];
  return readdirSync(debugDir())
    .sort()
    .flatMap((name) => readFileSync(join(debugDir(), name), "utf8").trim().split("\n").filter(Boolean))
    .map((line) => JSON.parse(line) as Entry);
}

interface StartOptions {
  debugMode: boolean;
  lanes?: Partial<Record<"helper" | "main", LaneRunner>>;
  route?: (subtask: Subtask) => Promise<{ lane: "main" | "helper"; reason: "appNotBackgroundCapable" | "noUI" }>;
}

/**
 * The harness as main.ts wires it: one debug log shared by the model client and the harness, and the real
 * `harness.log` file, with every entry also kept in memory for the assertions.
 */
async function start(options: StartOptions): Promise<Harness> {
  const config = loadConfig({ YUMI_SUPPORT_DIR: dir.path, ...(options.debugMode ? {} : { YUMI_DEBUG_MODE: "0" }) });
  const file = new FileLogger(config.logPath);
  const memory = logger;
  const folder = dir.path;
  // A socket can close after the test removed the folder; that late line is of no interest.
  const tee = (level: "info" | "warn" | "error") => (event: string, fields?: Record<string, unknown>) => {
    memory[level](event, fields);
    if (existsSync(folder)) file[level](event, fields);
  };
  const both: Logger = { info: tee("info"), warn: tee("warn"), error: tee("error") };
  const debug = new DebugLog({ dir: config.debugLogDir, enabled: config.debugMode, logger: both });
  harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "h.sock") }, both, {
    debug,
    work: {
      client: new ModelClient(modelConfig(server.baseUrl), both, fetch, debug),
      logger: both,
      deviceId: "mac-brent",
      home,
      lanes: options.lanes ?? { helper: fileHelperLane({ home, logger: both }) },
      slots: 1,
      ...(options.route ? { route: options.route } : {}),
    },
  });
  return harness;
}

type RpcMessage = { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };

/** A bare app client that said hello. */
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
  await call("hello", { protocolVersion: PROTOCOL_VERSION });
  const named = (method: string) => events.filter((e) => e.method === method).map((e) => e.params as Record<string, unknown>);
  return { named, call, close: () => client.close() };
}

const until = async (check: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

/** Says a goal, answers the repeat-back with `answer`, and returns the task id. */
async function sayAndConfirm(client: Awaited<ReturnType<typeof app>>, transcript: string, answer: string): Promise<string> {
  const submitted = await client.call("submitGoal", { transcript, originDeviceId: "mac-brent" });
  const taskId = (submitted.result as { taskId: string }).taskId;
  await until(() => client.named("goalRestated").length === 1);
  await client.call("replyToConfirmation", { taskId, reply: { kind: "spoken", text: answer } });
  return taskId;
}

const taskEnded = (client: Awaited<ReturnType<typeof app>>, taskId: string) => () =>
  client
    .named("taskStatusChanged")
    .some((e) => e.taskId === taskId && e.subtaskId === undefined && ["done", "failed"].includes(e.status as string));

interface Model {
  restate?: string;
  classify?: string;
  /** Planner replies, in order; the last one repeats. */
  plans?: unknown[];
  /** Worker replies, in order; the last one repeats. */
  worker?: MockReply[];
}

/** A model that answers each request by its system prompt, and records the worker requests. */
function scriptedModel(model: Model) {
  const plans = [...(model.plans ?? [])];
  const worker = [...(model.worker ?? [])];
  const workerRequests: ChatRequest[] = [];
  server.respond((body) => {
    const request = body as unknown as ChatRequest;
    const system = request.messages[0]!.content as string;
    if (system === RESTATE_SYSTEM_PROMPT)
      return content({ goal: model.restate ?? "rename the invoices in your Downloads folder" });
    if (system === CLASSIFY_SYSTEM_PROMPT) return content({ reply: model.classify ?? "confirm" });
    if (system === PLANNER_SYSTEM_PROMPT) return content(plans.length > 1 ? plans.shift() : plans[0]);
    if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary: "Done. I looked in your Downloads folder." });
    workerRequests.push(request);
    return worker.length > 1 ? worker.shift()! : worker[0]!;
  });
  return { workerRequests };
}

const LIST_PLAN = {
  subtasks: [{ id: "look", title: "Look in Downloads", instruction: "List ~/Downloads.", dependsOn: [], proposedLane: "helper" }],
};

describe("the debug log file", () => {
  it("writes nothing, and makes no folder, while Debug mode is off", () => {
    const log = new DebugLog({ dir: debugDir(), enabled: false, logger });
    log.write("voice.goal", { transcript: "hello" });
    expect(existsSync(debugDir())).toBe(false);
  });

  it("writes one JSON object per line to today's file, readable only by this user", () => {
    const now = new Date(2026, 9, 10, 15, 42);
    const log = new DebugLog({ dir: debugDir(), enabled: true, logger, now: () => now });
    log.write("voice.goal", { transcript: "rename the invoices" });
    log.write("voice.answer", { reply: { kind: "spoken", text: "yes" } });
    const file = join(debugDir(), "2026-10-10.jsonl");
    expect(log.pathFor()).toBe(file);
    expect(statSync(debugDir()).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(debugEntries().map(({ event, ...rest }) => ({ event, ...rest, time: undefined }))).toEqual([
      { event: "voice.goal", transcript: "rename the invoices", time: undefined },
      { event: "voice.answer", reply: { kind: "spoken", text: "yes" }, time: undefined },
    ]);
  });

  it("is turned on and off by setDebugMode, which the harness log records", () => {
    const log = new DebugLog({ dir: debugDir(), enabled: true, logger });
    log.setEnabled(false);
    log.write("voice.goal", { transcript: "not written" });
    expect(existsSync(debugDir())).toBe(false);
    log.setEnabled(true);
    log.write("voice.goal", { transcript: "written" });
    expect(debugEntries().map((e) => e.transcript)).toEqual(["written"]);
    expect(logger.entries.filter((e) => e.event === "debug.mode").map((e) => e.enabled)).toEqual([false, true]);
  });

  it("never stops the harness when it cannot write, and says so once in the harness log", () => {
    writeFileSync(join(dir.path, "not-a-folder"), "");
    const log = new DebugLog({ dir: join(dir.path, "not-a-folder", "Debug log"), enabled: true, logger });
    expect(() => {
      log.write("voice.goal", {});
      log.write("voice.answer", {});
    }).not.toThrow();
    expect(logger.entries.filter((e) => e.event === "debug.writeFailed")).toHaveLength(1);
  });

  it("deletes day files older than 7 days when the harness starts, in either mode, and nothing else", async () => {
    mkdirSync(debugDir(), { recursive: true });
    const age = (name: string, days: number) => {
      const path = join(debugDir(), name);
      writeFileSync(path, "{}\n");
      const when = new Date(Date.now() - days * DAY);
      utimesSync(path, when, when);
    };
    age("2026-09-01.jsonl", 8);
    age("2026-09-03.jsonl", 6.9);
    age("notes.txt", 30);
    await start({ debugMode: false });
    expect(readdirSync(debugDir()).sort()).toEqual(["2026-09-03.jsonl", "notes.txt"]);
    expect(logger.entries.find((e) => e.event === "debug.deletedOld")?.files).toEqual(["2026-09-01.jsonl"]);
  });

  it("also deletes old files when a harness that keeps running starts a new day", () => {
    let now = new Date(2026, 9, 10, 23, 59);
    const log = new DebugLog({ dir: debugDir(), enabled: true, logger, now: () => now });
    log.write("first", {});
    const old = join(debugDir(), "2026-10-02.jsonl");
    writeFileSync(old, "{}\n");
    utimesSync(old, new Date(now.getTime() - 8 * DAY), new Date(now.getTime() - 8 * DAY));
    now = new Date(2026, 9, 11, 0, 1);
    log.write("second", {});
    expect(readdirSync(debugDir()).sort()).toEqual(["2026-10-10.jsonl", "2026-10-11.jsonl"]);
  });

  it("is on by default for a harness run from source, off with YUMI_DEBUG_MODE=0, in the support folder", () => {
    expect(loadConfig({ YUMI_SUPPORT_DIR: "/tmp/y" })).toMatchObject({ debugMode: true, debugLogDir: "/tmp/y/Debug log" });
    expect(loadConfig({ YUMI_SUPPORT_DIR: "/tmp/y", YUMI_DEBUG_MODE: "0" }).debugMode).toBe(false);
  });
});

describe("Debug mode on: a failed goal can be explained from the detailed log alone", () => {
  it("has what was heard, what the model was asked and answered, and why the goal failed", async () => {
    // A plan that reuses an id fails the checks twice, so the user hears only "Unexpected" (Brent's run, 2026-10-10).
    const broken = {
      subtasks: [
        { id: "a", title: "Look", instruction: "List ~/Downloads.", dependsOn: [], proposedLane: "helper" },
        { id: "a", title: "Rename", instruction: "Rename them.", dependsOn: [], proposedLane: "helper" },
      ],
    };
    scriptedModel({ plans: [broken], classify: "confirm" });
    const h = await start({ debugMode: true });
    const client = await app(h.server.socketPath);
    const taskId = await sayAndConfirm(client, "pakirename yung invoices sa Downloads", "oo sige");
    await until(taskEnded(client, taskId));
    expect(client.named("userError")).toEqual([{ kind: "unexpected", taskId }]);

    const entries = debugEntries();
    const of = (event: string) => entries.filter((e) => e.event === event);
    // What was heard: the transcript, and the answer as it was transcribed and read.
    expect(of("voice.goal")).toEqual([expect.objectContaining({ taskId, transcript: "pakirename yung invoices sa Downloads" })]);
    expect(of("voice.answer")).toEqual([expect.objectContaining({ taskId, reply: { kind: "spoken", text: "oo sige" } })]);
    expect(of("confirm.classified")).toEqual([
      expect.objectContaining({ taskId, text: "oo sige", kind: "confirm", by: "model" }),
    ]);
    expect(of("confirm.repeatBack")[0]).toMatchObject({
      said: "You want me to rename the invoices in your Downloads folder. Should I go ahead?",
    });
    // What the model was asked, and what it answered, for every request: restate, classify, and both plans.
    const requests = of("model.request");
    expect(requests.map((r) => [r.purpose, r.schema])).toEqual([
      ["restateGoal", "Restatement"],
      ["classifyReply", "ConfirmationReply"],
      ["plan", "Plan"],
      ["plan", "Plan"],
    ]);
    for (const request of requests) {
      expect(request.taskId).toBe(taskId);
      const reply = entries.find((e) => e.event === "model.reply" && e.requestId === request.requestId)!;
      expect(reply).toMatchObject({ purpose: request.purpose, finishReason: "stop" });
      expect(reply.durationMs).toEqual(expect.any(Number));
      expect(reply.totalTokens).toEqual(expect.any(Number));
      expect(typeof reply.content).toBe("string");
    }
    expect(JSON.stringify(requests[0]!.messages)).toContain("pakirename yung invoices sa Downloads");
    expect(JSON.stringify(requests[1]!.messages)).toContain("oo sige");
    expect(JSON.parse(entries.find((e) => e.event === "model.reply" && e.purpose === "plan")!.content as string)).toEqual(broken);
    // Why it failed: the check's reason for each plan, and the error the user got.
    expect(of("plan.rejected").map((e) => e.error)).toEqual([
      'The id "a" is used by more than one subtask. Give every subtask its own id.',
      'The id "a" is used by more than one subtask. Give every subtask its own id.',
    ]);
    expect(of("task.failed")).toEqual([
      expect.objectContaining({
        taskId,
        userError: { kind: "unexpected", taskId },
        why: expect.stringContaining("No valid plan"),
      }),
    ]);
    // The harness log still has only sizes, never the words.
    expect(readFileSync(join(dir.path, "harness.log"), "utf8")).not.toContain("pakirename");
    expect(readFileSync(join(dir.path, "harness.log"), "utf8")).toContain('"event":"plan.rejected"');
    client.close();
  });

  it("has each step's observation, decision, reason, and outcome, and sends them as the worker's thoughts", async () => {
    const model = scriptedModel({
      plans: [LIST_PLAN],
      worker: [
        content({
          reason: "I need to see what is in Downloads first.",
          action: { kind: "tool", call: { tool: "list_dir", path: "~/Downloads" } },
        }),
        content({
          reason: "The folder is listed, so this is done.",
          action: { kind: "finish", status: "done", note: "Listed it." },
        }),
      ],
    });
    const h = await start({ debugMode: true });
    const client = await app(h.server.socketPath);
    const taskId = await sayAndConfirm(client, "look in my downloads", "yes");
    await until(taskEnded(client, taskId));

    // The model was asked for its reason first, as part of its output (SPEC-07 r23).
    const schema = model.workerRequests[0]!.response_format!.json_schema.schema as {
      $defs: Record<string, { required: string[] }>;
    };
    expect(schema.$defs["WorkerOutput"]!.required).toEqual(["reason", "action"]);
    expect(model.workerRequests[0]!.messages[0]!.content).toContain('{"reason": "...", "action": {...}}');

    const thoughts = client.named("workerThought");
    for (const t of thoughts) expect(validate("WorkerThought", t).errors).toEqual([]);
    const subtaskId = thoughts[0]!.subtaskId;
    expect(thoughts.map(({ at: _at, ...rest }) => rest)).toEqual([
      {
        taskId,
        subtaskId,
        title: "Look in Downloads",
        lane: "helper",
        sees: "Files only, no window. Nothing done yet.",
        decision: "Look in the folder Downloads",
        reason: "I need to see what is in Downloads first.",
      },
      {
        taskId,
        subtaskId,
        title: "Look in Downloads",
        lane: "helper",
        sees: "Looked in the folder Downloads: invoice-october.pdf",
        lastAction: "Looked in the folder Downloads",
        decision: "Look in the folder Downloads",
        reason: "I need to see what is in Downloads first.",
      },
      {
        taskId,
        subtaskId,
        title: "Look in Downloads",
        lane: "helper",
        sees: "Looked in the folder Downloads: invoice-october.pdf",
        lastAction: "Looked in the folder Downloads",
        decision: "Finish as done: Listed it.",
        reason: "The folder is listed, so this is done.",
      },
    ]);

    const entries = debugEntries();
    const decided = entries.filter((e) => e.event === "step.decided");
    expect(decided.map((e) => [e.step, e.decision, e.reason])).toEqual([
      [1, "Look in the folder Downloads", "I need to see what is in Downloads first."],
      [2, "Finish as done: Listed it.", "The folder is listed, so this is done."],
    ]);
    expect(decided[0]).toMatchObject({ subtaskId, observation: { windowTitle: "", elements: [] } });
    expect(entries.find((e) => e.event === "step.finished")).toMatchObject({
      subtaskId,
      outcome: "ok",
      observation: "Looked in the folder Downloads",
      toolOutput: expect.stringContaining("invoice-october.pdf"),
    });
    expect(entries.find((e) => e.event === "plan.made")).toMatchObject({ taskId, plan: LIST_PLAN });
    expect(entries.find((e) => e.event === "subtask.ended")).toMatchObject({ subtaskId, outcome: "finished" });
    expect(entries.find((e) => e.event === "task.done")).toMatchObject({
      taskId,
      summary: "Done. I looked in your Downloads folder.",
    });
    client.close();
  });
});

describe("Debug mode off", () => {
  it("writes no detailed log, sends no thoughts, and does not ask the model for a reason", async () => {
    const model = scriptedModel({
      plans: [LIST_PLAN],
      worker: [
        content({ action: { kind: "tool", call: { tool: "list_dir", path: "~/Downloads" } } }),
        content({ action: { kind: "finish", status: "done", note: "Listed it." } }),
      ],
    });
    // On by default, as a harness run from source starts; the app turns it off right after hello.
    const h = await start({ debugMode: true });
    const client = await app(h.server.socketPath);
    expect((await client.call("setDebugMode", { enabled: false })).result).toEqual({});
    const taskId = await sayAndConfirm(client, "look in my downloads", "yes");
    await until(taskEnded(client, taskId));
    expect(h.store.getTask(taskId)!.status).toBe("done");

    expect(existsSync(debugDir())).toBe(false);
    expect(client.named("workerThought")).toEqual([]);
    const schema = model.workerRequests[0]!.response_format!.json_schema.schema as {
      $defs: Record<string, { required: string[]; properties: Record<string, unknown> }>;
    };
    expect(schema.$defs["WorkerOutput"]!.required).toEqual(["action"]);
    expect(schema.$defs["WorkerOutput"]!.properties).not.toHaveProperty("reason");
    client.close();
  });

  it("writes nothing when the harness starts with it off, until the app turns it on", async () => {
    scriptedModel({ plans: [LIST_PLAN], worker: [content({ action: { kind: "finish", status: "done", note: "Ok." } })] });
    const h = await start({ debugMode: false });
    const client = await app(h.server.socketPath);
    const first = await sayAndConfirm(client, "look in my downloads", "yes");
    await until(taskEnded(client, first));
    expect(existsSync(debugDir())).toBe(false);

    await client.call("setDebugMode", { enabled: true });
    expect(h.debug.enabled).toBe(true);
    await client.call("submitGoal", { transcript: "now with Debug mode", originDeviceId: "mac-brent" });
    await until(() => debugEntries().some((e) => e.event === "voice.goal"));
    expect(debugEntries().find((e) => e.event === "voice.goal")!.transcript).toBe("now with Debug mode");
    client.close();
  });
});

describe("No password text in any log (SPEC-07 r20)", () => {
  const passwordDialog = () =>
    JSON.parse(readFileSync(join(PROTOCOL_DIR, "examples", "Observation.password-dialog.json"), "utf8")) as Observation;

  /** Every file the harness wrote in the support folder, as text, including the task database. */
  function everyFile(): { name: string; text: string }[] {
    return (readdirSync(dir.path, { recursive: true, encoding: "utf8" }) as string[])
      .filter((name) => !name.startsWith("home") && statSync(join(dir.path, name)).isFile() && !name.endsWith(".sock"))
      .map((name) => ({ name, text: readFileSync(join(dir.path, name)).toString("latin1") }));
  }

  it("keeps the text the model tried to put into a password field out of every file", async () => {
    // A worker in the Mail password dialog tries to fill the password, then answers with text that is not JSON.
    scriptedModel({
      plans: [
        {
          subtasks: [
            {
              id: "login",
              title: "Sign in to Mail",
              instruction: "Sign in.",
              dependsOn: [],
              proposedLane: "main",
              targetApp: { name: "Mail" },
            },
          ],
        },
      ],
      worker: [
        content({ reason: "The password is in the goal.", action: { kind: "setValue", element: 2, text: SECRET } }),
        { kind: "content", content: `I will type ${SECRET} into the password field` },
      ],
    });
    const mailLane: LaneRunner = {
      observe: () => Promise.resolve(passwordDialog()),
      tools: { tools: [], run: () => Promise.reject(new Error("no tools")) },
    };
    const h = await start({
      debugMode: true,
      lanes: { main: mailLane },
      route: () => Promise.resolve({ lane: "main", reason: "appNotBackgroundCapable" }),
    });
    const client = await app(h.server.socketPath);
    const taskId = await sayAndConfirm(client, `sign in to Mail`, "yes");
    await until(taskEnded(client, taskId));
    expect(h.store.getTask(taskId)!.status).toBe("failed");

    const files = everyFile();
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["harness.log", expect.stringMatching(/^Debug log\//)]));
    const escaped = JSON.stringify(SECRET).slice(1, -1);
    for (const file of files) {
      expect(file.text, file.name).not.toContain(SECRET);
      expect(file.text, file.name).not.toContain(escaped);
    }
    // Not vacuous: both replies were logged, with the password text taken out.
    const replies = debugEntries().filter((e) => e.event === "model.reply" && e.purpose === "workerStep");
    expect(replies).toHaveLength(2);
    expect(replies[0]!.content).toContain(PASSWORD_REMOVED);
    expect(replies[1]!.content).toMatch(
      /^\[reply not logged: it is not JSON and a password field is on screen; \d+ characters\]$/,
    );
    expect(debugEntries().filter((e) => e.event === "step.invalidOutput")).toHaveLength(2);
    client.close();
  });

  it("removes text typed while focus is unknown and a password field is on screen, also from the next prompt", () => {
    const screen = { ...passwordDialog() };
    delete screen.focused;
    const scrubber = new PasswordScrubber();
    const reply = scrubber.reply(JSON.stringify({ action: { kind: "type", text: SECRET } }), screen);
    expect(reply).toBe(JSON.stringify({ action: { kind: "type", text: PASSWORD_REMOVED } }));
    // A later prompt lists the step as JSON inside the prompt text, which the log line escapes again.
    const prompt = `1. ${JSON.stringify({ kind: "type", text: SECRET })} -> ok: Typed`;
    const line = JSON.stringify({ messages: [{ role: "user", content: prompt }] });
    expect(scrubber.scrub(line)).not.toContain(SECRET);
    expect(scrubber.scrub(line)).toContain(PASSWORD_REMOVED);
  });

  it("leaves text for ordinary fields alone", () => {
    const screen = passwordDialog();
    const scrubber = new PasswordScrubber();
    const reply = JSON.stringify({ action: { kind: "setValue", element: 1, text: "ana@example.com" } });
    expect(scrubber.reply(reply, screen)).toBe(reply);
    expect(scrubber.reply(JSON.stringify({ action: { kind: "type", text: "hello" } }), { ...screen, focused: 1 })).toContain(
      "hello",
    );
  });
});

describe("the thoughts panel's words", () => {
  const keynote = (): Observation =>
    JSON.parse(readFileSync(join(PROTOCOL_DIR, "examples", "Observation.export-sheet.json"), "utf8")) as Observation;

  it("says what a cursor sees and what it decided, never the text it types", () => {
    const screen = keynote();
    expect(describeSees(screen)).toMatch(/^Keynote, ".+"(, with the sheet( ".+")? in front)? \(\d+ elements\)$/);
    const first = screen.elements[0]!;
    expect(describeDecision({ kind: "click", element: first.n }, screen)).toBe(
      `Click ${JSON.stringify(first.label)} (element ${first.n})`,
    );
    expect(describeDecision({ kind: "type", text: SECRET }, screen)).toBe("Type into the focused field");
    expect(describeDecision({ kind: "setValue", element: first.n, text: SECRET }, screen)).not.toContain(SECRET);
    expect(describeDecision({ kind: "key", combo: "cmd+shift+e" }, screen)).toBe("Press cmd+shift+e");
  });
});
