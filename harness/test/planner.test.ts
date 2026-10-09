import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@yumi/protocol";
import type { Plan, Step, TaskStatusChanged } from "@yumi/protocol/types";
import { loadConfig } from "../src/config.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { checkPlan, findCycle, MAX_PLAN_SUBTASKS } from "../src/planner/check.ts";
import { makePlan, planSchemaForModel, subtasksFromPlan } from "../src/planner/planner.ts";
import {
  answerFromListing,
  answersFromListing,
  checkSummary,
  FALLBACK_SUMMARY,
  lookingOnlyFindings,
  sentenceCount,
  summarizeTask,
  SUMMARY_SYSTEM_PROMPT,
} from "../src/planner/summary.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { startWithMac, type RunningHarness } from "./support/harness-run.ts";
import { until } from "./support/mock-mac.ts";
import { HELPER_OBSERVATION } from "../src/scheduler/lanes.ts";
import { buildSubtaskResult } from "../src/scheduler/result.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";
import { buildWorkerInput, RECENT_STEPS } from "../src/scheduler/worker-input.ts";
import type { TaskStore } from "../src/store/task-store.ts";
import { modelConfig, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer } from "./mock-model-server.ts";
import { openStore } from "./store-helpers.ts";

const sub = (id: string, dependsOn: string[] = []) => ({
  id,
  title: `Subtask ${id}`,
  instruction: `Do ${id}.`,
  dependsOn,
  proposedLane: "helper" as const,
});
const planJson = (...subtasks: ReturnType<typeof sub>[]) => JSON.stringify({ subtasks });
/** The user's home folder the planner is given. */
const HOME = "/Users/brent";

describe("plan checks (OBJ-05.2)", () => {
  it("accepts a plan with dependencies", () => {
    const check = checkPlan(planJson(sub("a"), sub("b"), sub("note", ["a", "b"])), HOME);
    expect(check.ok).toBe(true);
  });

  it("rejects a dependency cycle and names it", () => {
    const check = checkPlan(planJson(sub("a", ["c"]), sub("b", ["a"]), sub("c", ["b"])), HOME);
    expect(check).toEqual({ ok: false, error: expect.stringContaining("a -> c -> b -> a") });
  });

  it("rejects a subtask that depends on itself", () => {
    expect(checkPlan(planJson(sub("a", ["a"])), HOME)).toEqual({
      ok: false,
      error: expect.stringContaining("depends on itself"),
    });
  });

  it("rejects an unknown dependency id", () => {
    expect(checkPlan(planJson(sub("a"), sub("b", ["z"])), HOME)).toEqual({ ok: false, error: expect.stringContaining('"z"') });
  });

  it("rejects a repeated id", () => {
    expect(checkPlan(planJson(sub("a"), sub("a")), HOME)).toEqual({ ok: false, error: expect.stringContaining("more than one") });
  });

  it(`rejects more than ${MAX_PLAN_SUBTASKS} subtasks`, () => {
    const many = Array.from({ length: MAX_PLAN_SUBTASKS + 1 }, (_, i) => sub(`s${i}`));
    expect(checkPlan(planJson(...many), HOME)).toEqual({
      ok: false,
      error: expect.stringContaining(`most is ${MAX_PLAN_SUBTASKS}`),
    });
    expect(checkPlan(planJson(...many.slice(0, MAX_PLAN_SUBTASKS)), HOME).ok).toBe(true);
  });

  it("rejects replies that are not a Plan", () => {
    expect(checkPlan(null, HOME).ok).toBe(false);
    expect(checkPlan("here is my plan: ...", HOME).ok).toBe(false);
    expect(checkPlan(JSON.stringify({ subtasks: [] }), HOME).ok).toBe(false);
    expect(checkPlan(JSON.stringify({ subtasks: [{ ...sub("a"), proposedLane: "cloud" }] }), HOME).ok).toBe(false);
  });

  it("rejects a path outside the user's home folder, without quoting it (Brent's run, 2026-10-10)", () => {
    const at = (instruction: string) => planJson({ ...sub("note"), instruction });
    const made = checkPlan(at('write_new_file(path="/Users/Yumi/Documents/Yumi test", content="hello")'), HOME);
    expect(made).toEqual({ ok: false, error: expect.stringContaining('Subtask "note" names a path outside') });
    expect(JSON.stringify(made)).not.toContain("/Users/Yumi");
    expect(checkPlan(at("Read /etc/hosts."), HOME).ok).toBe(false);
    expect(checkPlan(at("Read /Users/brent/../other/notes.txt."), HOME).ok).toBe(false);
    expect(checkPlan(at("Read /Users/brenda/notes.txt."), HOME).ok).toBe(false);
  });

  it("accepts paths inside the home folder, ~ paths, and links", () => {
    const at = (instruction: string) => planJson({ ...sub("note"), instruction });
    expect(checkPlan(at('Write "Yumi test.txt" in /Users/brent/Documents/ saying hello.'), HOME).ok).toBe(true);
    expect(checkPlan(at("List /Users/brent."), HOME).ok).toBe(true);
    expect(checkPlan(at("Write ~/Documents/Yumi test.txt saying hello."), HOME).ok).toBe(true);
    expect(checkPlan(at("Open https://example.com/a/b in Safari."), HOME).ok).toBe(true);
    expect(checkPlan(at("Copy the notes and/or the slides."), HOME).ok).toBe(true);
  });

  it("finds no cycle in a diamond", () => {
    expect(findCycle([sub("a"), sub("b", ["a"]), sub("c", ["a"]), sub("d", ["b", "c"])])).toBeUndefined();
  });
});

describe("the planner (OBJ-05.1)", () => {
  let server: MockModelServer;
  let logger: MemoryLogger;
  let client: ModelClient;

  beforeEach(async () => {
    server = await startMockModelServer();
    logger = new MemoryLogger();
    client = new ModelClient(modelConfig(server.baseUrl), logger);
  });
  afterEach(() => server.close());

  const tools = fileHelperLane({ home: "/tmp/never-used" }).tools.tools;

  it("sends the goal and the tools, with the Plan schema limited to the most subtasks", async () => {
    server.reply({ kind: "content", content: planJson(sub("a")) });
    const result = await makePlan("tidy my notes", tools, { client, logger, home: HOME });
    expect(result.outcome).toBe("ok");

    const request = server.requests[0] as unknown as ChatRequest;
    expect(request.response_format?.json_schema.name).toBe("Plan");
    const user = request.messages[1]!.content as string;
    expect(user).toContain("Goal: tidy my notes");
    expect(user).toContain("- read_file: Read a text file in the home folder.");
    expect(user).toContain("- write_new_file:");
    expect(request.messages[0]!.content as string).toContain("- targetApp: the app whose window the subtask works in");
    expect(request.messages[0]!.content as string).toContain(
      "- needsKeyboard: true when the subtask types text or uses keyboard shortcuts",
    );
    const schema = request.response_format!.json_schema.schema as {
      $defs: Record<string, { properties?: Record<string, unknown> }>;
    };
    expect(schema.$defs["Plan"]!.properties!["subtasks"]).toMatchObject({ minItems: 1, maxItems: MAX_PLAN_SUBTASKS });
    expect(JSON.stringify(planSchemaForModel())).not.toContain("uniqueItems");
  });

  it("gives the planner the user's real home, Documents, Desktop, and Downloads folders", async () => {
    server.reply({ kind: "content", content: planJson(sub("a")) });
    await makePlan("write a note in Documents", tools, { client, logger, home: HOME });
    const request = server.requests[0] as unknown as ChatRequest;
    const user = request.messages[1]!.content as string;
    expect(user).toContain("- Home folder: /Users/brent\n- Documents: /Users/brent/Documents\n");
    expect(user).toContain("- Desktop: /Users/brent/Desktop");
    expect(user).toContain("- Downloads: /Users/brent/Downloads");
    expect(request.messages[0]!.content as string).toContain("Never make up a user name or a home folder.");
  });

  it("sends a plan with a made-up home folder back once, and accepts the fixed one", async () => {
    const note = (path: string) => planJson({ ...sub("note"), instruction: `Write ${path} saying hello.` });
    server.reply(
      { kind: "content", content: note("/Users/Yumi/Documents/Yumi test.txt") },
      { kind: "content", content: note("/Users/brent/Documents/Yumi test.txt") },
    );
    const result = await makePlan("goal", tools, { client, logger, home: HOME });
    expect(result.outcome).toBe("ok");
    const retry = (server.requests[1] as unknown as ChatRequest).messages;
    expect(retry[3]!.content).toContain("outside the user's home folder");
  });

  it("asks once to fix a broken plan, with the reason, and accepts the fixed one", async () => {
    server.reply(
      { kind: "content", content: planJson(sub("a", ["b"]), sub("b", ["a"])) },
      { kind: "content", content: planJson(sub("a"), sub("b", ["a"])) },
    );
    const result = await makePlan("goal", tools, { client, logger, home: HOME });
    expect(result.outcome).toBe("ok");
    expect(server.requests).toHaveLength(2);
    const retry = (server.requests[1] as unknown as ChatRequest).messages;
    expect(retry.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(retry[3]!.content).toContain("cycle");
  });

  it("gives up after the second broken plan, without a third request", async () => {
    server.reply({ kind: "content", content: planJson(sub("a", ["zz"])) }, { kind: "content", content: "not json" });
    const result = await makePlan("goal", tools, { client, logger, home: HOME });
    expect(result).toEqual({ outcome: "invalidPlan", error: expect.stringContaining("not valid JSON") });
    expect(server.requests).toHaveLength(2);
  });

  it("maps an unreachable model server to modelFailedToLoad", async () => {
    await server.close();
    const result = await makePlan(
      "goal",
      tools,
      { client, logger, home: HOME },
      { taskId: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8" },
    );
    expect(result).toEqual({
      outcome: "error",
      userError: { kind: "modelFailedToLoad", taskId: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8" },
    });
  });

  it("turns planned ids into Uuids, with dependencies and ready or pending", () => {
    const plan = JSON.parse(planJson(sub("a"), sub("b"), sub("note", ["a", "b"]))) as Plan;
    const subtasks = subtasksFromPlan(plan);
    expect(subtasks.map((s) => s.status)).toEqual(["ready", "ready", "pending"]);
    expect(subtasks[2]!.dependsOn).toEqual([subtasks[0]!.id, subtasks[1]!.id]);
    for (const s of subtasks) expect(validate("Uuid", s.id).valid).toBe(true);
  });
});

describe("the summary (OBJ-05.7)", () => {
  let server: MockModelServer;
  let logger: MemoryLogger;
  let client: ModelClient;

  beforeEach(async () => {
    server = await startMockModelServer();
    logger = new MemoryLogger();
    client = new ModelClient(modelConfig(server.baseUrl), logger);
  });
  afterEach(() => server.close());

  it("counts sentences", () => {
    expect(sentenceCount("Done.")).toBe(1);
    expect(sentenceCount("Done. I put the summary of all 5 PDFs in a new note called PDF Summary.")).toBe(2);
    expect(sentenceCount("Done. One. Two.")).toBe(3);
  });

  it("accepts one or two sentences and rejects more, or other shapes", () => {
    expect(checkSummary(JSON.stringify({ summary: "Done. I made the note." }))).toEqual({
      ok: true,
      summary: "Done. I made the note.",
    });
    expect(checkSummary(JSON.stringify({ summary: "Done. One. Two." })).ok).toBe(false);
    expect(checkSummary(JSON.stringify({ summary: "" })).ok).toBe(false);
    expect(checkSummary(JSON.stringify({ summary: "Done.", extra: 1 })).ok).toBe(false);
    expect(checkSummary("Done.").ok).toBe(false);
  });

  it("is built from the goal and the structured results only, and retried once", async () => {
    server.reply(
      { kind: "content", content: JSON.stringify({ summary: "Done. One. Two. Three." }) },
      { kind: "content", content: JSON.stringify({ summary: "Done. I wrote the note." }) },
    );
    const summary = await summarizeTask(
      "make a note",
      [
        {
          id: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8",
          taskId: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e9",
          title: "Write the note",
          instruction: "Write it.",
          dependsOn: [],
          proposedLane: "helper",
          status: "done",
          attempts: 1,
          result: { status: "done", files: ["~/Documents/Note.md"], note: "Wrote the note." },
        },
      ],
      { client, logger },
    );
    expect(summary).toBe("Done. I wrote the note.");
    const user = (server.requests[0] as unknown as ChatRequest).messages[1]!.content as string;
    expect(user).toContain('- "Write the note": done. Files: "~/Documents/Note.md". Note: "Wrote the note.".');
    expect(user).not.toContain("Write it.");
  });

  it("falls back to a plain sentence when the model cannot answer, since the work is done", async () => {
    server.reply({ kind: "httpError", status: 500, detail: "boom" });
    expect(await summarizeTask("goal", [], { client, logger })).toBe(FALLBACK_SUMMARY);
    expect(sentenceCount(FALLBACK_SUMMARY)).toBeLessThanOrEqual(2);
  });
});

describe("the worker input (OBJ-05.5, SPEC-02 r5)", () => {
  const step = (index: number, outcome?: Step["outcome"]): Step => ({
    id: `6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7${String(index).padStart(2, "0")}`,
    subtaskId: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8",
    index,
    lane: "helper",
    action: { action: { kind: "tool", call: { tool: "read_file", path: `~/Downloads/${index}.txt` } }, permission: "allowed" },
    ...(outcome ? { outcome, observation: `Read ${index}.` } : {}),
    startedAt: "2026-10-09T15:40:00+08:00",
  });

  it("holds exactly the goal, the instruction, the last 5 finished steps, the observation, and the tools", () => {
    const steps = [0, 1, 2, 3, 4, 5, 6].map((i) => step(i, "ok"));
    const input = buildWorkerInput({
      confirmedGoal: "summarize the 5 PDFs in Downloads into one note",
      instruction: "Read ~/Downloads/a.pdf.",
      steps,
      observation: HELPER_OBSERVATION,
      tools: ["read_file", "write_new_file"],
    });
    expect(Object.keys(input).sort()).toEqual(["allowedTools", "confirmedGoal", "instruction", "observation", "recentSteps"]);
    expect(input.recentSteps).toHaveLength(RECENT_STEPS);
    expect(input.recentSteps.map((s) => s.observation)).toEqual(["Read 2.", "Read 3.", "Read 4.", "Read 5.", "Read 6."]);
    expect(input.recentSteps[0]).toEqual({ action: steps[2]!.action.action, observation: "Read 2.", outcome: "ok" });
    expect(validate("WorkerInput", input).errors).toEqual([]);
  });

  it("leaves out a step that has no outcome yet", () => {
    const input = buildWorkerInput({
      confirmedGoal: "g",
      instruction: "i",
      steps: [step(0, "ok"), step(1)],
      observation: HELPER_OBSERVATION,
      tools: [],
    });
    expect(input.recentSteps).toHaveLength(1);
  });
});

describe("the structured result (OBJ-05.6)", () => {
  it("keeps the real paths it is given and caps the note at 200 characters", () => {
    const result = buildSubtaskResult("done", "x".repeat(250), ["/Users/ana/b.txt", "/Users/ana/d 2.txt"]);
    expect(result).toEqual({ status: "done", files: ["/Users/ana/b.txt", "/Users/ana/d 2.txt"], note: `${"x".repeat(197)}...` });
    expect(validate("SubtaskResult", result).errors).toEqual([]);
  });
});

describe("the helper lane's tools (OBJ-37's typed file tools)", () => {
  let home: { path: string; cleanup: () => void };
  beforeEach(() => {
    home = tempDir();
    mkdirSync(join(home.path, "Downloads"));
    writeFileSync(join(home.path, "Downloads", "a.pdf"), "Alpha report text.");
  });
  afterEach(() => home.cleanup());

  it("offers the five file tools and move_to_trash, and runs the file tools on the given home folder", async () => {
    const { tools } = fileHelperLane({ home: home.path });
    expect(tools.tools.map((t) => t.name)).toEqual(["read_file", "list_dir", "write_new_file", "copy", "move", "move_to_trash"]);
    // move_to_trash only ever runs through the approval flow (OBJ-38.3): run as an allowed call, it does nothing.
    expect(await tools.run({ tool: "move_to_trash", paths: ["~/Downloads/a.pdf"] })).toMatchObject({ outcome: "error" });
    expect(existsSync(join(home.path, "Downloads", "a.pdf"))).toBe(true);
    const real = realpathSync(home.path);
    expect(await tools.run({ tool: "read_file", path: "~/Downloads/a.pdf" })).toEqual({
      outcome: "ok",
      output: "Alpha report text.",
      path: join(real, "Downloads", "a.pdf"),
    });
    const write = await tools.run({ tool: "write_new_file", path: "~/Downloads/a.pdf", content: "x" });
    // A taken name gets a number, and the real path comes back.
    expect(write).toMatchObject({ outcome: "ok", path: join(real, "Downloads", "a 2.pdf") });
    expect(readFileSync(join(home.path, "Downloads", "a.pdf"), "utf8")).toBe("Alpha report text.");
    expect(await tools.run({ tool: "read_file", path: "~/Downloads/missing.txt" })).toMatchObject({ outcome: "error" });
    expect(existsSync(join(home.path, "..", "escape.txt"))).toBe(false);
  });
});

describe("saving a plan (OBJ-05.3)", () => {
  let dir: { path: string; cleanup: () => void };
  let store: TaskStore;
  beforeEach(() => {
    dir = tempDir();
    store = openStore(dir.path);
  });
  afterEach(() => {
    store.close();
    dir.cleanup();
  });

  it("adds every subtask and moves the task to running in one go, then emits one event per change", () => {
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "g", confirmedGoal: "g", status: "planning" });
    const events: TaskStatusChanged[] = [];
    store.onStatusChanged((event) => events.push(event));
    const plan = subtasksFromPlan(JSON.parse(planJson(sub("a"), sub("note", ["a"]))) as Plan);
    const saved = store.savePlan(task.id, plan);

    expect(saved.task.status).toBe("running");
    expect(store.getTask(task.id)!.plan).toEqual(plan.map((s) => s.id));
    expect(store.listSubtasks(task.id).map((s) => s.status)).toEqual(["ready", "pending"]);
    expect(events).toEqual([
      { taskId: task.id, status: "running" },
      { taskId: task.id, status: "running", subtaskId: plan[0]!.id, subtaskStatus: "ready" },
      { taskId: task.id, status: "running", subtaskId: plan[1]!.id, subtaskStatus: "pending" },
    ]);
  });

  it("saves nothing when one subtask is invalid, and refuses a second plan", () => {
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "g", confirmedGoal: "g", status: "planning" });
    const plan = subtasksFromPlan(JSON.parse(planJson(sub("a"), sub("b"))) as Plan);
    expect(() => store.savePlan(task.id, [plan[0]!, { ...plan[1]!, title: "x".repeat(61) }])).toThrow();
    expect(store.getTask(task.id)).toMatchObject({ status: "planning", plan: [] });
    expect(store.listSubtasks(task.id)).toEqual([]);

    store.savePlan(task.id, plan);
    expect(() => store.savePlan(task.id, plan)).toThrow();
  });
});

describe("the parallel slots setting", () => {
  it("defaults to 3 and reads YUMI_MODEL_PARALLEL_SLOTS", () => {
    expect(loadConfig({}).model.parallelSlots).toBe(3);
    expect(loadConfig({ YUMI_MODEL_PARALLEL_SLOTS: "4" }).model.parallelSlots).toBe(4);
    expect(() => loadConfig({ YUMI_MODEL_PARALLEL_SLOTS: "0" })).toThrow("YUMI_MODEL_PARALLEL_SLOTS");
  });
});

describe("a goal that asks for information gets the answer (SPEC-02 r9, Brent's live check 2026-10-10)", () => {
  let dir: { path: string; cleanup: () => void };
  let home: string;
  let server: MockModelServer;
  let logger: MemoryLogger;
  let run: RunningHarness | undefined;

  beforeEach(async () => {
    dir = tempDir();
    home = join(dir.path, "home");
    mkdirSync(join(home, "Downloads", "Receipts"), { recursive: true });
    for (const name of ["invoice-oct.pdf", "photo.jpg", "notes.txt"]) writeFileSync(join(home, "Downloads", name), name);
    mkdirSync(join(home, "Documents"), { recursive: true });
    server = await startMockModelServer();
    logger = new MemoryLogger();
  });
  afterEach(async () => {
    await run?.close();
    run = undefined;
    await server.close();
    dir.cleanup();
  });

  /** Plans one helper subtask, runs the real file tools, and answers the summary with `summaries` in turn. */
  async function listDownloads(worker: (text: string) => string, summaries: string[]) {
    const summaryRequests: string[] = [];
    server.respond((body) => {
      const request = body as unknown as ChatRequest;
      const system = request.messages[0]!.content as string;
      const text = request.messages.at(-1)!.content as string;
      if (system === PLANNER_SYSTEM_PROMPT) {
        return { kind: "content", content: planJson({ ...sub("list"), instruction: "List the files in ~/Downloads." }) };
      }
      if (system === SUMMARY_SYSTEM_PROMPT) {
        summaryRequests.push(request.messages[1]!.content as string);
        return { kind: "content", content: JSON.stringify({ summary: summaries.shift() ?? "Done." }) };
      }
      return { kind: "content", content: worker(text) };
    });
    run = await startWithMac({ dir: dir.path, home, logger, model: server, lanes: { helper: fileHelperLane({ home }) } });
    const task = run.startTask("List the files in my Downloads folder");
    await until(() => ["done", "failed"].includes(run!.harness.store.getTask(task.id)!.status));
    const spoken = run.mac.events.filter((e) => e.event === "speak").map((e) => (e.payload as { text: string }).text);
    return { task: run.harness.store.getTask(task.id)!, summaryRequests, spoken };
  }

  const listThenFinish = (text: string) =>
    JSON.stringify({
      action: text.includes("invoice-oct.pdf")
        ? { kind: "finish", status: "done", note: "Listed the files in Downloads." }
        : { kind: "tool", call: { tool: "list_dir", path: "~/Downloads" } },
    });

  it("gives the summary model the real listing, with the count, and keeps an answer that uses it", async () => {
    const { task, summaryRequests, spoken } = await listDownloads(listThenFinish, [
      "You have 3 files and 1 folder in Downloads, including invoice-oct.pdf, notes.txt and photo.jpg.",
    ]);
    expect(task.status).toBe("done");
    expect(summaryRequests[0]).toContain('The folder "Downloads" has 4 items: 3 files and 1 folders shown.');
    expect(summaryRequests[0]).toContain('"invoice-oct.pdf", "notes.txt", "photo.jpg", "Receipts (folder)"');
    expect(task.summary).toBe("You have 3 files and 1 folder in Downloads, including invoice-oct.pdf, notes.txt and photo.jpg.");
    expect(spoken).toEqual([task.summary]);
  });

  it("sends back a summary that does not answer, then says the answer from the listing itself", async () => {
    // What the model said in Brent's live check.
    const vague = "Done. Listed the files in your Downloads folder.";
    const { task, summaryRequests } = await listDownloads(listThenFinish, [vague, vague]);
    expect(summaryRequests).toHaveLength(2);
    expect(task.summary).toBe(
      "You have 3 files and 1 folder in Downloads. Some of them are invoice-oct.pdf, notes.txt and photo.jpg.",
    );
    expect(sentenceCount(task.summary!)).toBeLessThanOrEqual(2);
  });

  it("says an empty folder is empty", async () => {
    for (const name of ["invoice-oct.pdf", "photo.jpg", "notes.txt"]) rmSync(join(home, "Downloads", name));
    rmSync(join(home, "Downloads", "Receipts"), { recursive: true });
    const { task } = await listDownloads(
      (text) =>
        JSON.stringify({
          action: text.includes("empty")
            ? { kind: "finish", status: "done", note: "Listed." }
            : { kind: "tool", call: { tool: "list_dir", path: "~/Downloads" } },
        }),
      ["Done.", "Done."],
    );
    expect(task.summary).toBe("Your Downloads folder is empty.");
  });

  it("leaves the summary of a task that changed something alone", async () => {
    const { task, summaryRequests } = await listDownloads(
      (text) =>
        JSON.stringify({
          action: text.includes("Created")
            ? { kind: "finish", status: "done", note: "Wrote it." }
            : { kind: "tool", call: { tool: "write_new_file", path: "~/Documents/List.md", content: "files" } },
        }),
      ["Done. I wrote List in Documents."],
    );
    expect(task.summary).toBe("Done. I wrote List in Documents.");
    expect(summaryRequests[0]).not.toContain("The user asked for information");
  });

  it("reads the count past list_dir's limit and a cut output as at least", () => {
    const store = openStore(join(dir.path, "s"), undefined, logger);
    try {
      const task = store.createTask({ originDeviceId: "mac-local", goal: "how many files" });
      store.setTaskStatus(task.id, "planning", { confirmedGoal: "how many files" });
      const { subtasks } = store.savePlan(task.id, [
        { title: "List", instruction: "List", proposedLane: "helper", status: "ready" },
      ]);
      store.setSubtaskStatus(subtasks[0]!.id, "running", { lane: "helper", workerId: "helper-1", attempts: 1 });
      const step = store.beginStep({
        subtaskId: subtasks[0]!.id,
        lane: "helper",
        action: { action: { kind: "tool", call: { tool: "list_dir", path: "/Users/brent/Downloads" } }, permission: "allowed" },
      });
      store.finishStep(step.id, {
        outcome: "ok",
        observation: "Listed.",
        toolOutput: "a.pdf\nb.pdf\n[and 498 more]",
        log: { deviceId: "mac-local", description: "Looked in the folder Downloads" },
      });
      const findings = lookingOnlyFindings(store, store.listSubtasks(task.id))!;
      expect(findings).toEqual([
        { kind: "list", folder: "Downloads", files: ["a.pdf", "b.pdf"], folders: [], total: 500, atLeast: false },
      ]);
      expect(answerFromListing(findings)).toBe("You have 500 items in Downloads. Some of them are a.pdf and b.pdf.");
      expect(answersFromListing("You have 500 things there.", findings)).toBe(true);
      expect(answersFromListing("Done. Listed the files in your Downloads folder.", findings)).toBe(false);
    } finally {
      store.close();
    }
  });
});
