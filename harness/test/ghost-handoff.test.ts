import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  CursorCommand,
  ExecuteActionParams,
  ModelAction,
  Observation,
  RouteDecided,
  Subtask,
  TaskStatusChanged,
  UserError,
} from "@yumi/protocol/types";
import { RunControl } from "../src/control/run-control.ts";
import type { MacGui } from "../src/gui/mac.ts";
import { QuestionBroker } from "../src/gui/questions.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import { AppCapabilities, LaneRouter, WindowCoordinator } from "../src/router/index.ts";
import { routeWith } from "../src/scheduler/lanes.ts";
import { runSchedule, type SchedulerDeps } from "../src/scheduler/scheduler.ts";
import type { TaskStore } from "../src/store/task-store.ts";
import { modelConfig, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";
import { openStore } from "./store-helpers.ts";

/**
 * SPEC-03 "Ghost handoff" (OBJ-09): a stuck ghost hands its subtask to the main cursor, and a stuck main cursor asks
 * the user for help. Runs the scheduler, the lane router, and gui_act against a fake Keynote window, with no socket.
 */

const KEYNOTE = "com.apple.Keynote";
const WINDOW = 7;
const GOAL = "Export my deck as a PDF.";

/** One Keynote window. "Next" and "Export" change it; "Stuck" never does. */
class FakeWindow implements MacGui {
  private page = 1;
  readonly commands: CursorCommand[] = [];
  readonly executed: ExecuteActionParams[] = [];

  observe(): Promise<Observation> {
    return Promise.resolve({
      app: "Keynote",
      windowTitle: `Q3 Report, slide ${this.page}`,
      layer: { kind: "window" },
      elements: [
        { n: 1, role: "button", label: "Next", enabled: true },
        { n: 2, role: "button", label: "Stuck", enabled: true },
        { n: 3, role: "button", label: "Export", enabled: true },
      ],
    });
  }

  execute(params: ExecuteActionParams) {
    this.executed.push(params);
    if (params.action.element?.label !== "Stuck") this.page++;
    return Promise.resolve({ outcome: "ok" as const, observation: `Clicked ${params.action.element?.label}.` });
  }

  cursor(command: CursorCommand): void {
    this.commands.push(command);
  }
}

let dir: { path: string; cleanup: () => void };
let store: TaskStore;
let logger: MemoryLogger;
let model: MockModelServer;
let router: LaneRouter;
let mac: FakeWindow;
let routes: RouteDecided[];
let errors: UserError[];

beforeEach(async () => {
  dir = tempDir();
  logger = new MemoryLogger();
  store = openStore(dir.path, undefined, logger);
  model = await startMockModelServer();
  mac = new FakeWindow();
  routes = [];
  errors = [];
  const capabilities = new AppCapabilities({
    store,
    logger,
    probe: (bundleId) =>
      Promise.resolve({
        bundleId,
        appVersion: "15.2.1",
        accessibility: true,
        devtools: false,
        probedAt: new Date().toISOString(),
      }),
  });
  const windows = new WindowCoordinator({
    store,
    logger,
    emit: () => {},
    windows: {
      list: (bundleId) =>
        Promise.resolve([
          {
            windowId: WINDOW,
            bundleId,
            appName: "Keynote",
            title: "Q3 Report",
            frame: { x: 0, y: 0, width: 800, height: 600 },
            minimized: false,
          },
        ]),
      open: () => Promise.resolve(undefined),
    },
  });
  router = new LaneRouter({ store, capabilities, windows, logger, emit: (_event, payload) => routes.push(payload) });
});

afterEach(async () => {
  router.close();
  await model.close();
  store.close();
  dir.cleanup();
});

/** A running task with one ghost-capable Keynote subtask, ready to schedule. */
function keynoteTask(): Subtask {
  const task = store.createTask({ originDeviceId: "mac-brent", goal: GOAL });
  store.setTaskStatus(task.id, "planning", { confirmedGoal: GOAL });
  const { subtasks } = store.savePlan(task.id, [
    {
      title: "Export the deck",
      instruction: "In Keynote, export the open deck as a PDF.",
      proposedLane: "ghost",
      status: "ready",
      targetApp: { bundleId: KEYNOTE },
    },
  ]);
  return subtasks[0]!;
}

const click = (label: "Next" | "Stuck" | "Export"): MockReply =>
  reply({ kind: "click", element: { Next: 1, Stuck: 2, Export: 3 }[label] });
const finish: MockReply = {
  kind: "content",
  content: JSON.stringify({ action: { kind: "finish", status: "done", note: "Exported." } }),
};
function reply(action: ModelAction): MockReply {
  return { kind: "content", content: JSON.stringify({ action }) };
}

/** Answers the worker's steps in order; each worker request's prompt is kept. */
function scriptModel(replies: MockReply[]): string[] {
  const prompts: string[] = [];
  model.respond((body) => {
    const messages = body.messages as { content: string }[];
    prompts.push(messages[1]!.content);
    return replies[prompts.length - 1] ?? finish;
  });
  return prompts;
}

function deps(): SchedulerDeps {
  return {
    store,
    client: new ModelClient(modelConfig(model.baseUrl), logger),
    logger,
    deviceId: "mac-brent",
    home: dir.path,
    slots: 1,
    route: routeWith(router),
    lanes: {},
    gui: {
      mac,
      questions: new QuestionBroker(() => {}, logger),
      settle: { intervalMs: 5, timeoutMs: 200 },
      watchHome: () => Promise.resolve({ takeNew: () => Promise.resolve([]), all: () => Promise.resolve([]), close: () => {} }),
    },
    voice: { userError: (_device, error) => errors.push(error) },
  };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

const WINDOW_CENTER = { kind: "element", target: { bundleId: KEYNOTE, windowId: WINDOW }, elementPath: "AXWindow" };

describe("Feature: Ghost handoff (SPEC-03)", () => {
  it("Scenario: Stuck ghost hands off to the main cursor", async () => {
    const subtask = keynoteTask();
    const prompts = scriptModel([click("Next"), click("Stuck"), click("Stuck"), click("Stuck"), click("Export"), finish]);
    const atHandoff: { locks: number; ghostSteps: string[] }[] = [];
    const statuses: TaskStatusChanged[] = [];
    store.onStatusChanged((event) => {
      if (event.subtaskId !== subtask.id) return;
      statuses.push(event);
      if (event.subtaskStatus === "handoff") {
        atHandoff.push({
          locks: store.listWindowLocks().filter((lock) => lock.subtaskId === subtask.id).length,
          ghostSteps: store.listSteps(subtask.id).map((step) => `${step.id} ${step.outcome}`),
        });
      }
    });

    expect(await runSchedule(subtask.taskId, GOAL, deps())).toEqual({ outcome: "done" });

    // Then the subtask status is "handoff", and the window lock is released.
    expect(statuses.map((event) => event.subtaskStatus)).toEqual(["running", "handoff", "queued", "running", "done"]);
    expect(atHandoff).toHaveLength(1);
    expect(atHandoff[0]!.locks).toBe(0);
    // And the ghost cursor fades out, and the main cursor moves to that window.
    const fade = mac.commands.findIndex((command) => command.command === "fade" && command.cursorId !== "main");
    const move = mac.commands.findIndex((command) => command.command === "move" && command.cursorId === "main");
    expect(fade).toBeGreaterThanOrEqual(0);
    expect(move).toBeGreaterThan(fade);
    expect(mac.commands[move]).toEqual({ command: "move", cursorId: "main", to: WINDOW_CENTER });
    expect(routes.at(-1)).toMatchObject({ subtaskId: subtask.id, lane: "main", reason: "promotedAfterFailure" });

    // And the main cursor continues from the last good step, with the step log intact.
    const steps = store.listSteps(subtask.id);
    expect(steps.map((step) => [step.lane, step.outcome])).toEqual([
      ["ghost", "ok"],
      ["ghost", "noEffect"],
      ["ghost", "noEffect"],
      ["ghost", "noEffect"],
      ["main", "ok"],
    ]);
    expect(steps.slice(0, 4).map((step) => `${step.id} ${step.outcome}`)).toEqual(atHandoff[0]!.ghostSteps);
    const done = store.getSubtask(subtask.id)!;
    expect(done).toMatchObject({ status: "done", lane: "main", routeReason: "promotedAfterFailure", lastGoodStep: steps[0]!.id });
    // Main reads the task record: its first prompt has the ghost's steps, and a fresh look at the window.
    const mainPrompt = prompts[4]!;
    expect(mainPrompt).toContain("Clicked Next.");
    expect(mainPrompt).toContain("nothing changed");
    expect(mainPrompt).toContain("Q3 Report, slide 2");
    // Nothing that already worked runs again: after the handoff, main only clicks Export.
    expect(mac.executed.map((params) => params.action.element?.label)).toEqual(["Next", "Stuck", "Stuck", "Stuck", "Export"]);
  });

  it("hands off after 2 invalid replies in a row", async () => {
    const subtask = keynoteTask();
    const invalid: MockReply = { kind: "content", content: "not an action" };
    scriptModel([invalid, invalid, click("Export"), finish]);

    expect(await runSchedule(subtask.taskId, GOAL, deps())).toEqual({ outcome: "done" });

    expect(store.getSubtask(subtask.id)).toMatchObject({ status: "done", lane: "main", routeReason: "promotedAfterFailure" });
    expect(store.listSteps(subtask.id).map((step) => [step.lane, step.outcome])).toEqual([["main", "ok"]]);
  });

  it("Scenario: Main cursor also gets stuck", async () => {
    const subtask = keynoteTask();
    const stuck = [click("Stuck"), click("Stuck"), click("Stuck")];
    scriptModel([...stuck, ...stuck, click("Export"), finish]);
    const control = new RunControl();

    const run = runSchedule(subtask.taskId, GOAL, deps(), control);
    // Then Yumi asks the user for help with the error from SPEC-11 for "stuck on screen".
    await until(() => errors.length > 0);
    expect(errors).toEqual([{ kind: "stuckOnScreen", taskId: subtask.taskId }]);
    expect(store.getTask(subtask.taskId)!.status).toBe("paused");
    expect(store.getSubtask(subtask.id)).toMatchObject({ status: "ready", lane: "main" });

    // The user's Resume tries again on the main cursor.
    store.setTaskStatus(subtask.taskId, "running");
    control.resumeUiLanes();
    expect(await run).toEqual({ outcome: "done" });
    expect(store.getSubtask(subtask.id)).toMatchObject({ status: "done", lane: "main", routeReason: "promotedAfterFailure" });
    expect(errors).toHaveLength(1);
  });
});
