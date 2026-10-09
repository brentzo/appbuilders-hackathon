import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Approval, ApprovalCancelled, ApprovalDecision, Lane, Observation, Step } from "@yumi/protocol/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryLogger } from "../src/log.ts";
import { ProbeFailure } from "../src/router/index.ts";
import { fileHelperLane, type LaneRunner, type RouteSubtask } from "../src/scheduler/lanes.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../src/planner/summary.ts";
import { tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";
import {
  content,
  finish,
  plan,
  scriptModel,
  startWithMac,
  tool,
  trashInto,
  type RunningHarness,
  type WorkerRequest,
} from "./support/harness-run.ts";
import { later, until } from "./support/mock-mac.ts";

/**
 * Pause and cancel at the harness level (SPEC-06 r1, r2, r4, r5, r7, r8, OBJ-38.5, OBJ-38.6), end to end with the
 * mocked model and the protocol's mock Mac app, which calls `pause`, `resumeTask`, and `cancelTask` as the stop
 * shortcut, a take-over, and the paused panel's buttons will (OBJ-35).
 */

vi.setConfig({ testTimeout: 30_000 });

const FILES = ["old-invoice.pdf", "receipt.pdf"];
const CLEAN = { id: "clean", title: "Delete the old invoices", instruction: "Move the old invoices in Downloads to the Trash." };
const NOTE_ONLY = { id: "note", title: "Write a note", instruction: "Write Cleanup.md in Documents." };
const NOTE = {
  id: "note",
  title: "Write a note about it",
  instruction: "Write Cleanup.md in Documents saying what was deleted.",
  dependsOn: ["clean"],
};

let dir: { path: string; cleanup: () => void };
let home: string;
let model: MockModelServer;
let logger: MemoryLogger;
let run: RunningHarness | undefined;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  mkdirSync(join(home, "Downloads"), { recursive: true });
  mkdirSync(join(home, "Documents"), { recursive: true });
  for (const name of FILES) writeFileSync(join(home, "Downloads", name), `${name}\n`);
  model = await startMockModelServer();
  logger = new MemoryLogger();
});

afterEach(async () => {
  await run?.close();
  run = undefined;
  await model.close();
  dir.cleanup();
});

const decided = (approved: boolean): ApprovalDecision => ({ approved, method: "tap", decidedAt: new Date().toISOString() });
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

/** Trashes the files until a step says they moved; a step that was not done (a pause) is tried again. */
function trashUntilMoved({ text }: WorkerRequest): MockReply {
  if (text.includes("Write Cleanup.md")) {
    return text.includes("Created Cleanup.md")
      ? finish("Wrote the note.")
      : tool({ tool: "write_new_file", path: "~/Documents/Cleanup.md", content: "Deleted the old invoices." });
  }
  return /Moved .+ to the Trash/.test(text)
    ? finish("Moved them.")
    : tool({ tool: "move_to_trash", paths: FILES.map((name) => `~/Downloads/${name}`) });
}

/** The helper lane on the test's home folder, counting how often it looks at the screen. */
function countingHelper(): LaneRunner & { observed: () => number } {
  const files = fileHelperLane({ home });
  let observed = 0;
  return {
    observe: (subtask, signal) => {
      observed++;
      return files.observe(subtask, signal);
    },
    tools: files.tools,
    observed: () => observed,
  };
}

const status = (taskId: string) => run!.harness.store.getTask(taskId)!.status;
const subtasks = (taskId: string) => run!.harness.store.listSubtasks(taskId);
const cards = () =>
  run!.mac.calls.filter((c) => c.method === "showApprovalCard").map((c) => (c.params as { approval: Approval }).approval);
const cancelled = () =>
  run!.mac.events.filter((e) => e.event === "approvalCancelled").map((e) => (e.payload as ApprovalCancelled).approvalId);
const trashCalls = () => run!.mac.calls.filter((c) => c.method === "moveToTrash");
const steps = (taskId: string): Step[] => subtasks(taskId).flatMap((s) => run!.harness.store.listSteps(s.id));

describe("SPEC-06 User control on the Mac, at the harness level", () => {
  it("Scenario: Pause cancels a pending approval, then Scenario: User resumes", async () => {
    // Given Yumi is waiting for approval (a delete; the Send card works the same, see approvals-send.test.ts)
    const helper = countingHelper();
    const worker = scriptModel(model, { plan: plan(CLEAN), worker: trashUntilMoved });
    const late = later<ApprovalDecision>();
    let shown = 0;
    run = await startWithMac({
      dir: dir.path,
      home,
      logger,
      model,
      lanes: { helper },
      answers: {
        showApprovalCard: () => (shown++ === 0 ? late.promise : decided(true)),
        moveToTrash: trashInto(join(dir.path, "Trash")),
      },
    });
    const task = run.startTask("delete my old invoices");
    await until(() => cards().length === 1);
    expect(status(task.id)).toBe("waitingForUser");

    // When the user presses the stop shortcut
    expect(await run.mac.call("pause", { taskId: task.id })).toEqual({});
    // Then the task is paused, checkpointed, and the card is cancelled
    expect(status(task.id)).toBe("paused");
    await until(() => cancelled().length === 1);
    expect(cancelled()).toEqual([cards()[0]!.id]);
    expect(run.harness.store.getApproval(cards()[0]!.id)!.closed).toBe("cancelled");
    const [subtask] = subtasks(task.id);
    expect(subtask).toMatchObject({ status: "ready", attempts: 1 });
    expect(steps(task.id).map((s) => s.outcome)).toEqual(["noEffect"]);
    // And no action runs after the pause: a late tap on the closed card does nothing, and no step starts
    late.resolve(decided(true));
    const requests = worker.length;
    const observed = helper.observed();
    await settle();
    expect(trashCalls()).toEqual([]);
    expect(worker.length).toBe(requests);
    expect(helper.observed()).toBe(observed);
    expect(readdirSync(join(home, "Downloads")).sort()).toEqual(FILES);

    // When the user says "continue" (the app calls resumeTask)
    expect(await run.mac.call("resumeTask", { taskId: task.id })).toEqual({});
    await until(() => status(task.id) === "done");
    // Then the screen is captured again, and the task continues from its last checkpoint, in the same attempt
    expect(helper.observed()).toBeGreaterThan(observed);
    expect(subtasks(task.id)[0]).toMatchObject({ status: "done", attempts: 1 });
    expect(steps(task.id).map((s) => s.outcome)).toEqual(["noEffect", "ok"]);
    // And Yumi asked for approval again before the risky action
    expect(cards()).toHaveLength(2);
    expect(cards()[1]!.id).not.toBe(cards()[0]!.id);
    expect(trashCalls()).toHaveLength(1);
  });

  it("a take-over pause is ignored while Yumi waits for the user and no UI lane is acting (SPEC-06 r2)", async () => {
    scriptModel(model, { plan: plan(CLEAN), worker: trashUntilMoved });
    const answer = later<ApprovalDecision>();
    run = await startWithMac({
      dir: dir.path,
      home,
      logger,
      model,
      lanes: { helper: fileHelperLane({ home }) },
      answers: { showApprovalCard: () => answer.promise, moveToTrash: trashInto(join(dir.path, "Trash")) },
    });
    const task = run.startTask("delete my old invoices");
    await until(() => cards().length === 1);

    // The user clicks into the card, which the Mac app ignores, and this pause is the second guard behind it.
    expect(await run.mac.call("pause", { taskId: task.id, scope: "uiLanes" })).toEqual({});
    expect(status(task.id)).toBe("waitingForUser");
    expect(cancelled()).toEqual([]);
    expect(logger.entries.some((e) => e.event === "task.pauseIgnored" && e.reason === "waitingForUser")).toBe(true);

    answer.resolve(decided(true));
    await until(() => status(task.id) === "done");
    expect(trashCalls()).toHaveLength(1);
  });

  it("Scenario: User cancels a paused task", async () => {
    // Given a task is paused
    // And a helper subtask is still queued
    const worker = scriptModel(model, { plan: plan(CLEAN, NOTE), worker: trashUntilMoved });
    const late = later<ApprovalDecision>();
    run = await startWithMac({
      dir: dir.path,
      home,
      logger,
      model,
      lanes: { helper: fileHelperLane({ home }) },
      answers: { showApprovalCard: () => late.promise, moveToTrash: trashInto(join(dir.path, "Trash")) },
    });
    const task = run.startTask("delete my old invoices and write a note");
    await until(() => cards().length === 1);
    // The menu bar "Stop" pauses every task.
    expect(await run.mac.call("pause", {})).toEqual({});
    expect(status(task.id)).toBe("paused");
    expect(subtasks(task.id).map((s) => s.status)).toEqual(["ready", "pending"]);

    // When the user says "cancel"
    expect(await run.mac.call("cancelTask", { taskId: task.id })).toEqual({});
    // Then the task status is "cancelled"
    expect(status(task.id)).toBe("cancelled");
    // And the queued helper subtask never runs
    expect(subtasks(task.id).map((s) => [s.status, s.result?.note])).toEqual([
      ["failed", "Cancelled before it finished."],
      ["failed", "Cancelled before it started."],
    ]);
    late.resolve(decided(true));
    await settle();
    expect(worker.some((request) => request.text.includes("Write Cleanup.md"))).toBe(false);
    expect(trashCalls()).toEqual([]);
    expect(readdirSync(join(home, "Documents"))).toEqual([]);
    // (Every cursor fades out, and Yumi says "Okay, I stopped. Nothing else will happen.": the Mac app, OBJ-35.7.)
  });

  it("cancel stops every lane and drops an open approval, and nothing runs after it (SPEC-06 r8)", async () => {
    const worker = scriptModel(model, { plan: plan(CLEAN, NOTE), worker: trashUntilMoved });
    const late = later<ApprovalDecision>();
    run = await startWithMac({
      dir: dir.path,
      home,
      logger,
      model,
      lanes: { helper: fileHelperLane({ home }) },
      answers: { showApprovalCard: () => late.promise, moveToTrash: trashInto(join(dir.path, "Trash")) },
    });
    const task = run.startTask("delete my old invoices and write a note");
    await until(() => cards().length === 1);

    expect(await run.mac.call("cancelTask", { taskId: task.id })).toEqual({});
    expect(status(task.id)).toBe("cancelled");
    expect(cancelled()).toEqual([cards()[0]!.id]);
    const requests = worker.length;
    late.resolve(decided(true));
    await settle();
    expect(trashCalls()).toEqual([]);
    expect(worker.length).toBe(requests);
    expect(steps(task.id).map((s) => s.outcome)).toEqual(["noEffect"]);
    expect(run.harness.store.listActionLog(task.id).at(-1)!.description).toBe(
      "Did not move 2 items to the Trash, because the task was paused before it could",
    );
  });
});

describe("pausing while Yumi plans", () => {
  it("a take-over during planning stops the planner, and the resume plans again", async () => {
    let plans = 0;
    const planner = later<void>();
    model.respond(async (body) => {
      const request = body as unknown as ChatRequest;
      const system = request.messages[0]!.content as string;
      if (system === PLANNER_SYSTEM_PROMPT) {
        if (plans++ === 0) await planner.promise;
        return { kind: "content", content: plan(NOTE_ONLY) };
      }
      if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary: "Done." });
      return (request.messages[1]!.content as string).includes("Created Cleanup.md")
        ? finish("Wrote the note.")
        : tool({ tool: "write_new_file", path: "~/Documents/Cleanup.md", content: "Notes." });
    });
    run = await startWithMac({ dir: dir.path, home, logger, model, lanes: { helper: fileHelperLane({ home }) } });
    const task = run.startTask("write a note");
    await until(() => plans === 1);
    expect(status(task.id)).toBe("planning");

    expect(await run.mac.call("pause", { taskId: task.id, scope: "uiLanes" })).toEqual({});
    expect(status(task.id)).toBe("paused");
    planner.resolve();
    await settle();
    expect(status(task.id)).toBe("paused");
    expect(subtasks(task.id)).toEqual([]);

    expect(await run.mac.call("resumeTask", { taskId: task.id })).toEqual({});
    await until(() => status(task.id) === "done");
    expect(plans).toBe(2);
    expect(readdirSync(join(home, "Documents"))).toEqual(["Cleanup.md"]);
  });
});

describe("SPEC-06 r2 take-over: UI lanes pause, helpers keep running", () => {
  /** A UI lane that "reads" in Keynote; every run is counted, so a run after the pause would show. */
  function keynoteLane() {
    const runs: number[] = [];
    const lane: LaneRunner = {
      observe: () => Promise.resolve<Observation>({ app: "Keynote", windowTitle: "Deck", elements: [] }),
      tools: {
        tools: [{ name: "read_file", description: "Read a text file in the home folder." }],
        run: () => {
          runs.push(Date.now());
          return Promise.resolve({ outcome: "ok", output: "Slide text." });
        },
      },
    };
    return { lane, runs };
  }

  const UI = { id: "ui", title: "UI: read the deck", instruction: "Read the slides in Keynote." };
  const NOTES = { id: "notes", title: "Write the notes", instruction: "Write Note 1.md to Note 4.md in Documents." };
  const route: RouteSubtask = (subtask) =>
    Promise.resolve(
      subtask.title.startsWith("UI")
        ? { lane: "main" as Lane, reason: "appNotBackgroundCapable" as const }
        : { lane: "helper" as Lane, reason: "noUI" as const },
    );

  /**
   * The model for these tests: the UI subtask reads 6 times, then finishes; the helper writes four notes, waiting
   * while `helper.open` is false, so it is still working while the user has the mouse. With `keynote.holdAfter`, the
   * UI subtask's replies wait after that many reads while `keynote.held` is true, so a busy machine cannot let it
   * finish before the test pauses it.
   */
  function respond(
    keynote: { runs: number[]; holdAfter?: number; held?: boolean },
    helper: { open: boolean; steps: number; delay: number },
  ) {
    model.respond(async (body) => {
      const request = body as unknown as ChatRequest;
      const system = request.messages[0]!.content as string;
      const text = request.messages[1]!.content as string;
      if (system === PLANNER_SYSTEM_PROMPT) return { kind: "content", content: plan(UI, NOTES) };
      if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary: "Done." });
      if (text.includes(UI.instruction)) {
        while (keynote.held && keynote.runs.length >= (keynote.holdAfter ?? Infinity)) await settle(10);
        return keynote.runs.length >= 6 ? finish("Read every slide.") : tool({ tool: "read_file", path: "~/Documents/deck.txt" });
      }
      helper.steps++;
      while (!helper.open) await settle(10);
      await settle(helper.delay);
      for (const n of [1, 2, 3, 4]) {
        if (!text.includes(`Created Note ${n}.md`))
          return tool({ tool: "write_new_file", path: `~/Documents/Note ${n}.md`, content: `${n}` });
      }
      return finish("Wrote the notes.");
    });
  }

  it("Scenario: User takes the mouse: the UI lane stops before its next action, helpers finish, resume carries on", async () => {
    const keynote = keynoteLane();
    const helperGate = { open: false, steps: 0, delay: 0 };
    respond(keynote, helperGate);
    run = await startWithMac({
      dir: dir.path,
      home,
      logger,
      model,
      lanes: { main: keynote.lane, helper: fileHelperLane({ home }) },
      route,
      slots: 2,
    });
    const task = run.startTask("read my deck and write notes");
    await until(() => keynote.runs.length >= 2);

    // When the user moves their own mouse
    expect(await run.mac.call("pause", { taskId: task.id, scope: "uiLanes" })).toEqual({});
    const ranBeforePause = keynote.runs.length;
    expect(status(task.id)).toBe("paused");

    // Then every UI lane pauses before its next action, and helpers keep running
    helperGate.open = true;
    await until(() => subtasks(task.id).find((s) => s.title === NOTES.title)!.status === "done");
    await settle();
    expect(keynote.runs.length).toBe(ranBeforePause);
    const ui = subtasks(task.id).find((s) => s.title === UI.title)!;
    expect(ui).toMatchObject({ status: "ready", attempts: 1 });
    expect(status(task.id)).toBe("paused");
    expect(readdirSync(join(home, "Documents")).sort()).toEqual(["Note 1.md", "Note 2.md", "Note 3.md", "Note 4.md"]);

    // When the user resumes, the UI lane carries on in the same attempt
    expect(await run.mac.call("resumeTask", { taskId: task.id })).toEqual({});
    await until(() => status(task.id) === "done");
    expect(keynote.runs.length).toBe(6);
    expect(subtasks(task.id).find((s) => s.title === UI.title)).toMatchObject({ status: "done", attempts: 1 });
  });

  it("Scenario: Stop shortcut: every lane stops, helpers included, and nothing is sent after the pause", async () => {
    const keynote = { ...keynoteLane(), holdAfter: 2, held: true };
    const helper = { open: true, steps: 0, delay: 30 };
    respond(keynote, helper);
    run = await startWithMac({
      dir: dir.path,
      home,
      logger,
      model,
      lanes: { main: keynote.lane, helper: fileHelperLane({ home }) },
      route,
      slots: 2,
    });
    const task = run.startTask("read my deck and write notes");
    await until(() => keynote.runs.length >= 2 && helper.steps >= 1);

    const pausing = run.mac.call("pause", { taskId: task.id, scope: "everyLane" });
    // The UI subtask's next reply arrives only after the pause was sent, and must not run.
    keynote.held = false;
    expect(await pausing).toEqual({});
    expect(status(task.id)).toBe("paused");
    const ran = { keynote: keynote.runs.length, notes: readdirSync(join(home, "Documents")).length };
    await settle(300);
    expect(keynote.runs.length).toBe(ran.keynote);
    expect(readdirSync(join(home, "Documents")).length).toBe(ran.notes);
    expect(subtasks(task.id).map((s) => s.status)).toEqual(["ready", "ready"]);
  });
});

describe("a pause or cancel always wins over work that was still being routed (Brent's run, 2026-10-10)", () => {
  const userErrors = () => run!.mac.events.filter((e) => e.event === "userError");

  /** A route that waits for `gate` on its first call, then answers with `first`, and later calls go to the helper. */
  function gatedRoute(first: () => Promise<Awaited<ReturnType<RouteSubtask>>>) {
    const gate = later<void>();
    let calls = 0;
    const route: RouteSubtask = async () => {
      if (calls++ === 0) {
        await gate.promise;
        return first();
      }
      return { lane: "helper", reason: "noUI" };
    };
    return { route, gate, calls: () => calls };
  }

  it("a pause of every lane while a subtask is routed starts nothing, and the resume runs it", async () => {
    const helper = countingHelper();
    const worker = scriptModel(model, { plan: plan(NOTE_ONLY), worker: trashUntilMoved });
    const { route, gate, calls } = gatedRoute(() => Promise.resolve({ lane: "helper", reason: "noUI" }));
    run = await startWithMac({ dir: dir.path, home, logger, model, lanes: { helper }, route });
    const task = run.startTask("write a note");
    await until(() => calls() === 1);

    const paused = run.mac.call("pause", { taskId: task.id, scope: "everyLane" });
    await until(() => status(task.id) === "paused");
    gate.resolve();
    expect(await paused).toEqual({});

    expect(status(task.id)).toBe("paused");
    expect(subtasks(task.id).map((s) => s.status)).toEqual(["ready"]);
    expect(helper.observed()).toBe(0);
    expect(worker).toEqual([]);
    expect(logger.entries.some((e) => e.event === "schedule.notStarted")).toBe(true);

    expect(await run.mac.call("resumeTask", { taskId: task.id })).toEqual({});
    await until(() => status(task.id) === "done");
    expect(readdirSync(join(home, "Documents"))).toEqual(["Cleanup.md"]);
  });

  it("a failure after the pause leaves the task paused, shows no error, and the resume runs the subtask", async () => {
    const helper = countingHelper();
    scriptModel(model, { plan: plan(NOTE_ONLY), worker: trashUntilMoved });
    const { route, gate, calls } = gatedRoute(() =>
      Promise.reject(new ProbeFailure("com.apple.finder", { kind: "stuckOnScreen" })),
    );
    run = await startWithMac({ dir: dir.path, home, logger, model, lanes: { helper }, route });
    const task = run.startTask("write a note");
    await until(() => calls() === 1);

    const paused = run.mac.call("pause", { taskId: task.id, scope: "everyLane" });
    await until(() => status(task.id) === "paused");
    gate.resolve();
    expect(await paused).toEqual({});
    await settle();

    expect(status(task.id)).toBe("paused");
    expect(subtasks(task.id).map((s) => s.status)).toEqual(["ready"]);
    expect(userErrors()).toEqual([]);

    expect(await run.mac.call("resumeTask", { taskId: task.id })).toEqual({});
    await until(() => status(task.id) === "done");
  });

  it("cancelling while a subtask is routed starts nothing and leaves the task cancelled", async () => {
    const helper = countingHelper();
    scriptModel(model, { plan: plan(NOTE_ONLY), worker: trashUntilMoved });
    const { route, gate, calls } = gatedRoute(() =>
      Promise.reject(new ProbeFailure("com.apple.finder", { kind: "stuckOnScreen" })),
    );
    run = await startWithMac({ dir: dir.path, home, logger, model, lanes: { helper }, route });
    const task = run.startTask("write a note");
    await until(() => calls() === 1);

    const cancel = run.mac.call("cancelTask", { taskId: task.id });
    await settle(50);
    gate.resolve();
    expect(await cancel).toEqual({});
    await settle();

    expect(status(task.id)).toBe("cancelled");
    expect(helper.observed()).toBe(0);
    expect(userErrors()).toEqual([]);
    expect(subtasks(task.id).map((s) => s.result?.note)).toEqual(["Cancelled before it started."]);
  });
});
