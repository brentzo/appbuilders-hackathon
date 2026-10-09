import { mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import type { Handler } from "@yumi/protocol";
import type { MoveToTrashParams, MoveToTrashResult, Task } from "@yumi/protocol/types";
import { startHarness, type Harness } from "../../src/harness.ts";
import type { MemoryLogger } from "../../src/log.ts";
import { ModelClient } from "../../src/model/client.ts";
import type { ChatRequest } from "../../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../../src/planner/summary.ts";
import type { LaneRunners, RouteSubtask } from "../../src/scheduler/lanes.ts";
import { modelConfig } from "../helpers.ts";
import type { MockModelServer, MockReply } from "../mock-model-server.ts";
import { connectScriptedMac, until, type ScriptedMac } from "./mock-mac.ts";

/**
 * A whole harness for the approval, pause, and cancel tests (OBJ-38.9): the real task store, planner, scheduler,
 * gate, approval flow, typed file tools on a temporary home folder, and local RPC server, with the mocked model
 * server and the protocol's mock Mac app, scripted per test.
 */

export const content = (value: unknown): MockReply => ({ kind: "content", content: JSON.stringify(value) });
export const tool = (call: Record<string, unknown>) => content({ action: { kind: "tool", call } });
export const finish = (note: string) => content({ action: { kind: "finish", status: "done", note } });

export interface PlannedStub {
  id: string;
  title: string;
  instruction: string;
  dependsOn?: string[];
}

export const plan = (...subtasks: PlannedStub[]) =>
  JSON.stringify({ subtasks: subtasks.map((s) => ({ dependsOn: [], proposedLane: "helper", ...s })) });

/** A worker request: the subtask's instruction and its recent steps are in `text`. */
export interface WorkerRequest {
  system: string;
  text: string;
}

/**
 * A model that plans with `plan`, answers each worker step with `worker`, and summarizes. Records every worker
 * request.
 */
export function scriptModel(
  server: MockModelServer,
  options: { plan: string; worker: (request: WorkerRequest) => MockReply | Promise<MockReply> },
) {
  const calls: WorkerRequest[] = [];
  server.respond((body) => {
    const request = body as unknown as ChatRequest;
    const system = request.messages[0]!.content as string;
    const text = request.messages[1]!.content as string;
    if (system === PLANNER_SYSTEM_PROMPT) return { kind: "content", content: options.plan };
    if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary: "Done." });
    calls.push({ system, text });
    return options.worker({ system, text });
  });
  return calls;
}

/**
 * The real Mac app's `moveToTrash`, played on the test folder: each path is moved into `trash` (the user's Trash),
 * never deleted, and the answer lists what moved.
 */
export function trashInto(trash: string): Handler {
  return (params): MoveToTrashResult => {
    mkdirSync(trash, { recursive: true });
    const trashed: string[] = [];
    for (const path of (params as MoveToTrashParams).paths) {
      renameSync(path, join(trash, `${trashed.length}-${basename(path)}`));
      trashed.push(path);
    }
    return { trashed };
  };
}

export interface RunningHarness {
  harness: Harness;
  mac: ScriptedMac;
  /** Creates a confirmed task in planning and starts it, as OBJ-17 will after the user confirms. */
  startTask(goal: string): Task;
  close(): Promise<void>;
}

export async function startWithMac(options: {
  dir: string;
  home: string;
  logger: MemoryLogger;
  model: MockModelServer;
  lanes: LaneRunners;
  answers?: Record<string, Handler>;
  route?: RouteSubtask;
  slots?: number;
}): Promise<RunningHarness> {
  const harness = await startHarness({ supportDir: options.dir, socketPath: join(options.dir, "h.sock") }, options.logger, {
    work: {
      client: new ModelClient(modelConfig(options.model.baseUrl), options.logger),
      logger: options.logger,
      deviceId: "mac-brent",
      home: options.home,
      lanes: options.lanes,
      slots: options.slots ?? 1,
      ...(options.route ? { route: options.route } : {}),
    },
  });
  const mac = await connectScriptedMac(harness.server.socketPath, options.answers ?? {});
  await until(() => harness.server.readyConnections === 1);
  return {
    harness,
    mac,
    startTask: (goal) => {
      const task = harness.store.createTask({ originDeviceId: "mac-brent", goal });
      harness.store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });
      void harness.tasks.start(task.id);
      return harness.store.getTask(task.id)!;
    },
    close: async () => {
      mac.close();
      await harness.close();
    },
  };
}
