import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validate } from "@yumi/protocol";
import { PROTOCOL_VERSION, type Subtask, type Task } from "@yumi/protocol/types";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ProbeFailure } from "../src/router/index.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../src/planner/summary.ts";
import { fileHelperLane, helperLane, routeWith, type LaneTools, type RouteSubtask } from "../src/scheduler/lanes.ts";
import { localVoice, runTask, type RunTaskDeps } from "../src/scheduler/run-task.ts";
import { workerSystemPrompt } from "../src/worker/prompt.ts";
import { modelConfig, rawClient, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";

/**
 * The planner, scheduler, and summary end to end, with a mocked model server, the real task store, the typed
 * file tools on a temporary home folder, and the real local RPC server with a bare app client.
 */

// Each run is about a second; give a loaded machine (other agents, the model server) room before calling it a hang.
vi.setConfig({ testTimeout: 20_000 });

const GOAL = "summarize the 5 PDFs in Downloads into one note";
const PDFS = ["Invoice March.pdf", "Lease.pdf", "Insurance.pdf", "Payslip.pdf", "Tax return.pdf"];
const PARTS = "~/Documents/PDF Summary parts";
const NOTE = "~/Documents/PDF Summary.md";
const SUMMARY = "Done. I put the summary of all 5 PDFs in a new note called PDF Summary.";
const stem = (pdf: string) => pdf.replace(/\.pdf$/, "");

/** How long the mock takes to answer one worker step, standing in for decoding time. */
const STEP_MS = 60;

const planReply = () =>
  JSON.stringify({
    subtasks: [
      ...PDFS.map((pdf, i) => ({
        id: `read-${i + 1}`,
        title: `Summarize ${pdf}`,
        instruction: `Read ~/Downloads/${pdf} and write a three-line summary to ${PARTS}/${stem(pdf)}.txt.`,
        dependsOn: [],
        proposedLane: "helper",
      })),
      {
        id: "write-note",
        title: "Write the PDF Summary note",
        instruction: `Read the five files in ${PARTS} and write them into one new note at ${NOTE}.`,
        dependsOn: PDFS.map((_, i) => `read-${i + 1}`),
        proposedLane: "helper",
      },
    ],
  });

const content = (value: unknown): MockReply => ({ kind: "content", content: JSON.stringify(value) });
const tool = (call: Record<string, unknown>) => content({ action: { kind: "tool", call } });
const finish = (note: string) => content({ action: { kind: "finish", status: "done", note } });

interface Interval {
  instruction: string;
  start: number;
  end: number;
}

/** A model that plans, works each subtask like a careful worker would, and summarizes. Times every worker step. */
function scriptedModel(
  server: MockModelServer,
  options: {
    plan?: string;
    worker?: (instruction: string, steps: number, text: string) => MockReply;
    /**
     * Hold the first worker replies until this many are in flight (or 2 s pass), so a loaded machine cannot make
     * concurrent requests look sequential. A scheduler that sends them one at a time still never gets there.
     */
    gather?: number;
  } = {},
) {
  const intervals: Interval[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let gathered = options.gather === undefined;
  server.respond(async (body) => {
    const request = body as unknown as ChatRequest;
    const system = request.messages[0]!.content as string;
    const text = request.messages[1]!.content as string;
    if (system === PLANNER_SYSTEM_PROMPT) return { kind: "content", content: options.plan ?? planReply() };
    if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary: SUMMARY });
    if (!system.startsWith(workerSystemPrompt("helper").split("\n")[0]!)) throw new Error("unexpected request");

    const instruction = /^Instruction: (.*)$/m.exec(text)![1]!;
    const steps = (text.match(/^\d+\. /gm) ?? []).length;
    const start = performance.now();
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    for (const deadline = performance.now() + 2000; !gathered && performance.now() < deadline;) {
      if (inFlight >= options.gather!) gathered = true;
      else await new Promise((resolve) => setTimeout(resolve, 5));
    }
    gathered = true;
    await new Promise((resolve) => setTimeout(resolve, STEP_MS));
    inFlight--;
    intervals.push({ instruction, start, end: performance.now() });
    return (options.worker ?? pdfWorker)(instruction, steps, text);
  });
  return { intervals, maxInFlight: () => maxInFlight };
}

/** What a worker would do for each subtask of the PDF plan. */
function pdfWorker(instruction: string, steps: number, text: string): MockReply {
  const read = /^Read ~\/Downloads\/(.+\.pdf) and write/.exec(instruction);
  if (read) {
    const pdf = read[1]!;
    if (steps === 0) return tool({ tool: "read_file", path: `~/Downloads/${pdf}` });
    if (steps === 1) {
      // The file's text reached this worker only through its own last step.
      if (!text.includes(`Text of ${pdf}`)) throw new Error("the read step's observation is missing");
      return tool({ tool: "write_new_file", path: `${PARTS}/${stem(pdf)}.txt`, content: `Summary of ${pdf}.` });
    }
    return finish(`Summarized ${pdf}.`);
  }
  // The note worker sees only its last 5 steps, so it decides from what they show, like a real worker must.
  if (/Created \/.*\/PDF Summary\.md\./.test(text)) return finish("Wrote PDF Summary.md with all five summaries.");
  const unread = PDFS.find((pdf) => !text.includes(JSON.stringify(`${PARTS}/${stem(pdf)}.txt`)));
  if (unread && steps < PDFS.length) return tool({ tool: "read_file", path: `${PARTS}/${stem(unread)}.txt` });
  return tool({ tool: "write_new_file", path: NOTE, content: PDFS.map((p) => `Summary of ${p}.`).join("\n") });
}

let dir: { path: string; cleanup: () => void };
let home: string;
let server: MockModelServer;
let logger: MemoryLogger;
let harness: Harness;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  mkdirSync(join(home, "Downloads"), { recursive: true });
  for (const pdf of PDFS) writeFileSync(join(home, "Downloads", pdf), `Text of ${pdf}.`);
  server = await startMockModelServer();
  logger = new MemoryLogger();
  harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "h.sock") }, logger);
});

afterEach(async () => {
  await harness.close();
  await server.close();
  dir.cleanup();
});

function deps(overrides: Partial<RunTaskDeps> = {}): RunTaskDeps {
  return {
    store: harness.store,
    client: new ModelClient(modelConfig(server.baseUrl), logger),
    logger,
    deviceId: "mac-brent",
    route: routeWith(harness.router),
    home,
    lanes: { helper: fileHelperLane({ home, logger }) },
    slots: 3,
    voice: localVoice(harness.server, logger, "mac-brent"),
    ...overrides,
  };
}

/** A task the user confirmed on the Mac, now planning. */
function confirmedTask(goal = GOAL): Task {
  const task = harness.store.createTask({ originDeviceId: "mac-brent", goal });
  return harness.store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });
}

/** A bare app client that said hello, so it receives events. */
async function app() {
  const client = await rawClient(harness.server.socketPath);
  client.send({ jsonrpc: "2.0", id: 0, method: "hello", params: { protocolVersion: PROTOCOL_VERSION } });
  await client.next();
  const events: { method: string; params: unknown }[] = [];
  const pump = (async () => {
    for (;;) events.push((await client.next()) as { method: string; params: unknown });
  })();
  void pump.catch(() => undefined);
  return { events, close: () => client.close() };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

describe("SPEC-02 task lifecycle", () => {
  it('Scenario: Planner splits a goal into subtasks ("summarize the 5 PDFs in Downloads into one note")', async () => {
    scriptedModel(server);
    const task = confirmedTask();
    // "When planning finishes": look at the task the moment it leaves planning.
    let atPlanned: { task: Task; subtasks: Subtask[] } | undefined;
    harness.store.onStatusChanged((event) => {
      if (event.taskId === task.id && event.subtaskId === undefined && event.status === "running" && !atPlanned) {
        atPlanned = { task: harness.store.getTask(task.id)!, subtasks: harness.store.listSubtasks(task.id) };
      }
    });
    await runTask(task.id, deps());

    // Then the task has subtasks for reading each PDF and one for writing the note
    const { subtasks } = atPlanned!;
    expect(subtasks).toHaveLength(PDFS.length + 1);
    const reading = subtasks.slice(0, PDFS.length);
    for (const [i, pdf] of PDFS.entries()) expect(reading[i]!.instruction).toContain(`Read ~/Downloads/${pdf}`);
    const note = subtasks[PDFS.length]!;
    expect(note.instruction).toContain(NOTE);
    // And the note subtask depends on all reading subtasks
    expect(note.dependsOn.sort()).toEqual(reading.map((s) => s.id).sort());
    // And the task status is "running"
    expect(atPlanned!.task.status).toBe("running");
    expect(atPlanned!.task.plan).toEqual(subtasks.map((s) => s.id));
    for (const s of subtasks) expect(validate("Subtask", s).errors).toEqual([]);
  });

  it("Scenario: Task finishes and reports back", async () => {
    scriptedModel(server);
    const client = await app();
    const task = confirmedTask();
    const outcome = await runTask(task.id, deps());

    // Given every subtask of a task is done
    const subtasks = harness.store.listSubtasks(task.id);
    expect(subtasks.map((s) => s.status)).toEqual(Array(PDFS.length + 1).fill("done"));
    // Then the task status is "done"
    expect(outcome).toEqual({ outcome: "done", summary: SUMMARY });
    expect(harness.store.getTask(task.id)).toMatchObject({ status: "done", summary: SUMMARY });
    // And Yumi says a short summary, on the device the user spoke to (the Mac app here)
    await until(() => client.events.some((e) => e.method === "speak"));
    const speak = client.events.find((e) => e.method === "speak")!;
    expect(speak.params).toEqual({ taskId: task.id, text: SUMMARY });
    expect(validate("Speak", speak.params).errors).toEqual([]);
    expect(client.events.filter((e) => e.method === "userError")).toEqual([]);
    client.close();

    // The work really happened, through the helper's file tools.
    expect(readFileSync(join(home, "Documents", "PDF Summary.md"), "utf8")).toBe(PDFS.map((p) => `Summary of ${p}.`).join("\n"));
  });

  it("stores each subtask's short structured result, with the files from its step log (OBJ-05.6)", async () => {
    scriptedModel(server);
    const task = confirmedTask();
    await runTask(task.id, deps());
    const subtasks = harness.store.listSubtasks(task.id);
    const real = realpathSync(home);
    expect(subtasks[0]!.result).toEqual({
      status: "done",
      files: [join(real, "Documents", "PDF Summary parts", "Invoice March.txt")],
      note: "Summarized Invoice March.pdf.",
    });
    expect(subtasks[PDFS.length]!.result).toEqual({
      status: "done",
      files: [join(real, "Documents", "PDF Summary.md")],
      note: "Wrote PDF Summary.md with all five summaries.",
    });
    for (const s of subtasks) expect(s).toMatchObject({ lane: "helper", routeReason: "noUI", attempts: 1 });
    // Every action is in the action log, from this Mac.
    const log = harness.store.listActionLog(task.id);
    expect(log).toHaveLength(PDFS.length * 2 + PDFS.length + 1);
    expect(log.every((line) => line.deviceId === "mac-brent" && line.lane === "helper" && line.outcome === "ok")).toBe(true);
  });

  it("runs a plan with dependencies in the right order (OBJ-05.9)", async () => {
    const model = scriptedModel(server);
    const task = confirmedTask();
    await runTask(task.id, deps());
    const noteSteps = model.intervals.filter((i) => i.instruction.startsWith("Read the five files"));
    const readSteps = model.intervals.filter((i) => i.instruction.startsWith("Read ~/Downloads/"));
    expect(readSteps).toHaveLength(PDFS.length * 3);
    expect(Math.min(...noteSteps.map((i) => i.start))).toBeGreaterThanOrEqual(Math.max(...readSteps.map((i) => i.end)));
  });

  it("runs independent subtasks at the same time, up to the parallel slots (OBJ-05.9, measured)", async () => {
    const model = scriptedModel(server, { gather: 3 });
    const task = confirmedTask();
    const started = performance.now();
    await runTask(task.id, deps({ slots: 3 }));
    const wall = performance.now() - started;

    const reads = PDFS.map((pdf) => model.intervals.filter((i) => i.instruction.includes(`/${pdf} `)));
    const span = (steps: Interval[]) => ({
      start: Math.min(...steps.map((s) => s.start)),
      end: Math.max(...steps.map((s) => s.end)),
    });
    const spans = reads.map(span);
    // The first three reads overlap: each starts before the others end.
    for (const a of spans.slice(0, 3)) for (const b of spans.slice(0, 3)) expect(a.start).toBeLessThan(b.end);
    expect(model.maxInFlight()).toBe(3);

    const workerSteps = model.intervals.length;
    const sequential = workerSteps * STEP_MS;
    logger.info("measured", { workerSteps, wall, sequential });
    console.log(
      `[OBJ-05 measured] ${workerSteps} worker steps of ${STEP_MS} ms each: ${Math.round(wall)} ms with 3 slots, ` +
        `${sequential} ms if run one after another. Read spans (ms from the first): ${spans
          .map((s) => `${Math.round(s.start - spans[0]!.start)}-${Math.round(s.end - spans[0]!.start)}`)
          .join(", ")}`,
    );
  });

  it("runs one subtask at a time with one slot", async () => {
    const model = scriptedModel(server);
    await runTask(confirmedTask().id, deps({ slots: 1 }));
    expect(model.maxInFlight()).toBe(1);
  });
});

describe("routing through the lane router (OBJ-07.8)", () => {
  it("routes every subtask before it runs and sends each decision to the app", async () => {
    scriptedModel(server);
    const client = await app();
    const task = confirmedTask();
    await runTask(task.id, deps());
    const subtasks = harness.store.listSubtasks(task.id);
    await until(() => client.events.filter((e) => e.method === "routeDecided").length === subtasks.length);
    const decided = client.events.filter((e) => e.method === "routeDecided").map((e) => e.params);
    for (const event of decided) expect(validate("RouteDecided", event).errors).toEqual([]);
    expect(decided).toEqual(subtasks.map((s) => ({ taskId: task.id, subtaskId: s.id, lane: "helper", reason: "noUI" })));
    client.close();
  });

  it("stores the planner's needsKeyboard on the subtask for the router", async () => {
    const plan = JSON.stringify({
      subtasks: [
        {
          id: "a",
          title: "A",
          instruction: "Read ~/Downloads/Lease.pdf.",
          dependsOn: [],
          proposedLane: "main",
          needsKeyboard: true,
        },
      ],
    });
    scriptedModel(server, { plan, worker: () => finish("Done.") });
    const task = confirmedTask();
    await runTask(task.id, deps());
    // No target app, so still a helper (SPEC-03 r2 comes before r17).
    expect(harness.store.listSubtasks(task.id)[0]).toMatchObject({ needsKeyboard: true, lane: "helper", routeReason: "noUI" });
  });

  it("fails the subtask with the probe's user error when the router cannot check the app", async () => {
    scriptedModel(server);
    const client = await app();
    const task = confirmedTask();
    const route: RouteSubtask = () =>
      Promise.reject(new ProbeFailure("com.apple.Keynote", { kind: "accessibilityPermissionMissing" }));
    const outcome = await runTask(task.id, deps({ route }));
    expect(outcome).toEqual({ outcome: "failed", userError: { kind: "accessibilityPermissionMissing", taskId: task.id } });
    expect(harness.store.listSubtasks(task.id).filter((s) => s.status === "failed").length).toBeGreaterThan(0);
    expect(harness.store.listSubtasks(task.id).some((s) => s.status === "running")).toBe(false);
    await until(() => client.events.some((e) => e.method === "userError"));
    expect(client.events.find((e) => e.method === "userError")!.params).toEqual({
      kind: "accessibilityPermissionMissing",
      taskId: task.id,
    });
    client.close();
  });
});

describe("the permission gate (OBJ-37)", () => {
  const onePlan = (instruction: string) =>
    JSON.stringify({ subtasks: [{ id: "a", title: "A", instruction, dependsOn: [], proposedLane: "helper" }] });

  it("checks every tool call, stores its level, and never runs a blocked one", async () => {
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "id_ed25519"), "SECRET KEY");
    let sawRefusal = false;
    scriptedModel(server, {
      plan: onePlan("Read ~/.ssh/id_ed25519."),
      worker: (_instruction, steps, text) => {
        if (steps === 0) return tool({ tool: "read_file", path: "~/.ssh/id_ed25519" });
        sawRefusal = text.includes("-> blocked: Not done: Yumi's safety rules do not allow this read_file.");
        if (text.includes("SECRET KEY")) throw new Error("the secret reached the model");
        return content({ action: { kind: "finish", status: "stuck", note: "Not allowed." } });
      },
    });
    const task = confirmedTask();
    await runTask(task.id, deps());
    const [step] = harness.store.listSteps(harness.store.listSubtasks(task.id)[0]!.id);
    expect(step).toMatchObject({ outcome: "blocked", action: { permission: "blocked" } });
    expect(sawRefusal).toBe(true);
    expect(harness.store.listActionLog(task.id)).toMatchObject([
      { outcome: "blocked", description: "Did not read id_ed25519, because Yumi's safety rules do not allow it" },
    ]);
    expect(logger.entries.some((e) => e.event === "step.blocked")).toBe(true);
  });

  it("does not run a call that asks, since approvals are not built yet (OBJ-38)", async () => {
    let ran = false;
    const trashTools: LaneTools = {
      tools: [{ name: "move_to_trash", description: "Move files to the Trash." }],
      run: () => {
        ran = true;
        return Promise.resolve({ outcome: "ok", output: "Trashed." });
      },
    };
    writeFileSync(join(home, "Downloads", "old.txt"), "old");
    scriptedModel(server, {
      plan: onePlan("Trash ~/Downloads/old.txt."),
      worker: (_instruction, steps) =>
        steps === 0
          ? tool({ tool: "move_to_trash", paths: ["~/Downloads/old.txt"] })
          : content({ action: { kind: "finish", status: "stuck", note: "Needs approval." } }),
    });
    const task = confirmedTask();
    await runTask(task.id, deps({ lanes: { helper: helperLane(trashTools) } }));
    expect(ran).toBe(false);
    const [step] = harness.store.listSteps(harness.store.listSubtasks(task.id)[0]!.id);
    expect(step).toMatchObject({ outcome: "blocked", action: { permission: "ask" } });
    expect(harness.store.listActionLog(task.id)[0]!.description).toBe(
      "Did not move old.txt to the Trash, because it needs your approval first",
    );
    expect(logger.entries.some((e) => e.event === "step.needsApproval")).toBe(true);
    expect(readFileSync(join(home, "Downloads", "old.txt"), "utf8")).toBe("old");
  });
});

describe("a broken plan never reaches the scheduler", () => {
  it("fails the task after the planner's second broken plan, with no subtasks and no worker steps", async () => {
    const cyclic = JSON.stringify({
      subtasks: [
        { id: "a", title: "A", instruction: "Do a.", dependsOn: ["b"], proposedLane: "helper" },
        { id: "b", title: "B", instruction: "Do b.", dependsOn: ["a"], proposedLane: "helper" },
      ],
    });
    server.reply({ kind: "content", content: cyclic }, { kind: "content", content: cyclic });
    const client = await app();
    const task = confirmedTask();
    let routed = 0;
    const route: RouteSubtask = (subtask) => {
      routed++;
      return routeWith(harness.router)(subtask);
    };
    const outcome = await runTask(task.id, deps({ route }));

    expect(outcome).toEqual({ outcome: "failed", userError: { kind: "unexpected", taskId: task.id } });
    expect(server.requests).toHaveLength(2);
    expect(routed).toBe(0);
    expect(harness.store.listSubtasks(task.id)).toEqual([]);
    expect(harness.store.getTask(task.id)).toMatchObject({ status: "failed", plan: [] });
    await until(() => client.events.some((e) => e.method === "userError"));
    const error = client.events.find((e) => e.method === "userError")!.params;
    expect(validate("UserError", error).errors).toEqual([]);
    expect(JSON.stringify(error)).not.toMatch(/cycle|schema|depends/i);
    expect(logger.entries.filter((e) => e.event === "plan.rejected")).toHaveLength(2);
    client.close();
  });

  it("fixes a broken plan with the planner's one retry and runs the fixed one", async () => {
    const unknownDependency = JSON.stringify({
      subtasks: [{ id: "a", title: "A", instruction: "Do a.", dependsOn: ["zz"], proposedLane: "helper" }],
    });
    server.reply({ kind: "content", content: unknownDependency });
    scriptedModel(server);
    const outcome = await runTask(confirmedTask().id, deps());
    expect(outcome.outcome).toBe("done");
  });
});

describe("when a subtask fails", () => {
  it("stops the others, fails the task, and tells the user which step could not finish (SPEC-11 r14)", async () => {
    scriptedModel(server, {
      worker: (instruction, steps) => {
        const pdf = /~\/Downloads\/(.+\.pdf) /.exec(instruction)![1]!;
        if (steps === 0) return tool({ tool: "read_file", path: `~/Downloads/${pdf}` });
        if (pdf === "Lease.pdf") return content({ action: { kind: "finish", status: "stuck", note: "Could not summarize it." } });
        return finish(`Summarized ${pdf}.`);
      },
    });
    const client = await app();
    const task = confirmedTask();
    const outcome = await runTask(task.id, deps());

    expect(outcome).toEqual({
      outcome: "failed",
      userError: { kind: "stepFailed", taskId: task.id, step: "Summarize Lease.pdf" },
    });
    expect(harness.store.getTask(task.id)!.status).toBe("failed");
    const subtasks = harness.store.listSubtasks(task.id);
    expect(subtasks.find((s) => s.title === "Summarize Lease.pdf")).toMatchObject({
      status: "failed",
      result: { status: "stuck" },
    });
    // Nothing that depended on it ran.
    expect(subtasks.at(-1)!.status).toBe("pending");
    expect(subtasks.some((s) => s.status === "running")).toBe(false);
    await until(() => client.events.some((e) => e.method === "userError"));
    expect(client.events.some((e) => e.method === "speak")).toBe(false);
    client.close();
  });

  it("maps an unreachable model server to modelFailedToLoad and saves no plan", async () => {
    await server.close();
    const task = confirmedTask();
    const outcome = await runTask(task.id, deps());
    expect(outcome).toEqual({ outcome: "failed", userError: { kind: "modelFailedToLoad", taskId: task.id } });
    expect(harness.store.listSubtasks(task.id)).toEqual([]);
  });

  it("never offers or runs keystrokes on a helper (SPEC-03 r7)", async () => {
    const plan = JSON.stringify({
      subtasks: [{ id: "a", title: "A", instruction: "Type hello.", dependsOn: [], proposedLane: "helper" }],
    });
    scriptedModel(server, { plan, worker: () => content({ action: { kind: "type", text: "hello" } }) });
    const task = confirmedTask();
    const outcome = await runTask(task.id, deps());
    const [subtask] = harness.store.listSubtasks(task.id);
    // The reply is rejected by the step's validation, retried once, and nothing is recorded or run.
    expect(harness.store.listSteps(subtask!.id)).toEqual([]);
    expect(subtask).toMatchObject({ status: "failed", result: { status: "stuck" } });
    expect(outcome.outcome).toBe("failed");
    const schema = JSON.stringify((server.requests.at(-1) as unknown as ChatRequest).response_format!.json_schema.schema);
    expect(schema).not.toContain("TypeTextAction");
  });
});
