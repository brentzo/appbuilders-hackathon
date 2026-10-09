import type {
  DeviceId,
  Lane,
  ModelAction,
  RecordedAction,
  ResultStatus,
  Subtask,
  SubtaskResult,
  UserError,
} from "@yumi/protocol/types";
import type { Logger } from "../log.ts";
import type { ModelClient } from "../model/client.ts";
import type { TaskStore } from "../store/task-store.ts";
import { ACTION } from "../worker/actions.ts";
import { runWorkerStep } from "../worker/step.ts";
import type { LaneRunner } from "./lanes.ts";
import { buildSubtaskResult } from "./result.ts";
import { buildWorkerInput } from "./worker-input.ts";

/**
 * Runs one subtask on its lane, one step at a time, until the worker finishes it: each step gets a fresh worker
 * input (SPEC-02 r5), returns one validated action (r6), and is written before it runs and finished after (r3).
 * The outcome carries the subtask's structured result (OBJ-05.6). The caller changes the subtask's status.
 */

/**
 * A guard so a worker that never finishes cannot loop forever: SPEC-02 r8's 25 steps per subtask. OBJ-06 owns the
 * limits, their user-facing errors, and attempts; this only stops the loop.
 */
export const MAX_STEPS_PER_SUBTASK = 25;

export type SubtaskRun =
  /** The worker finished: `result.status` is done or stuck. */
  | { outcome: "finished"; result: SubtaskResult }
  /** The subtask cannot go on: the model's replies were invalid twice, it needs something a helper cannot do, or it hit the step guard. */
  | { outcome: "failed"; result: SubtaskResult; userError?: UserError }
  /** The model could not answer. */
  | { outcome: "error"; result: SubtaskResult; userError: UserError }
  /** The caller cancelled. */
  | { outcome: "aborted"; result: SubtaskResult };

export interface SubtaskRunDeps {
  store: TaskStore;
  client: ModelClient;
  logger: Logger;
  /** This device, for the action log. */
  deviceId: DeviceId;
}

export async function runSubtask(
  subtask: Subtask,
  lane: Lane,
  runner: LaneRunner,
  confirmedGoal: string,
  deps: SubtaskRunDeps,
  signal: AbortSignal,
): Promise<SubtaskRun> {
  const { store, logger } = deps;
  const result = (status: ResultStatus, note: string) => buildSubtaskResult(status, note, store.listSteps(subtask.id));
  const lastAction = () => store.listActionLog(subtask.taskId).at(-1)?.description;

  for (;;) {
    if (signal.aborted) return { outcome: "aborted", result: result("partial", "Stopped before it finished.") };
    const steps = store.listSteps(subtask.id);
    if (steps.length >= MAX_STEPS_PER_SUBTASK) {
      logger.warn("subtask.stepGuard", { taskId: subtask.taskId, subtaskId: subtask.id, steps: steps.length });
      return {
        outcome: "failed",
        result: result("partial", `Stopped after ${MAX_STEPS_PER_SUBTASK} steps without finishing.`),
        userError: { kind: "taskTookTooLong", taskId: subtask.taskId },
      };
    }

    const observation = await runner.observe(subtask, signal);
    const input = buildWorkerInput({
      confirmedGoal,
      instruction: subtask.instruction,
      steps,
      observation,
      tools: runner.tools.tools.map((tool) => tool.name),
    });
    const last = lastAction();
    const step = await runWorkerStep(
      input,
      { client: deps.client, logger },
      { lane, signal, taskId: subtask.taskId, ...(last ? { lastAction: last } : {}) },
    );

    switch (step.outcome) {
      case "aborted":
        return { outcome: "aborted", result: result("partial", "Stopped before it finished.") };
      case "error":
        return { outcome: "error", result: result("stuck", "The model could not answer."), userError: step.userError };
      case "invalidOutput":
        return { outcome: "failed", result: result("stuck", "The worker's replies did not match the action schema twice.") };
      case "ok":
        break;
    }

    const action = step.output.action;
    if (action.kind === ACTION.finish) return { outcome: "finished", result: result(action.status, action.note) };
    if (action.kind === ACTION.ask) {
      // Questions to the user are not wired up yet (waitingForUser, OBJ-43): end the subtask instead of guessing.
      return { outcome: "failed", result: result("blocked", "Needs an answer from the user, and asking is not available yet.") };
    }
    if (action.kind === ACTION.tool) {
      await runTool(subtask, lane, runner, action, deps, signal);
    } else {
      refuse(subtask, lane, action, deps);
    }
  }
}

/** Runs one tool call as a step: written before it runs, finished with its outcome and log line after (SPEC-02 r3). */
async function runTool(
  subtask: Subtask,
  lane: Lane,
  runner: LaneRunner,
  action: Extract<ModelAction, { kind: "tool" }>,
  deps: SubtaskRunDeps,
  signal: AbortSignal,
): Promise<void> {
  const permission = runner.tools.permission(action.call);
  const recorded: RecordedAction = { action, permission };
  const step = deps.store.beginStep({ subtaskId: subtask.id, lane, action: recorded });
  if (permission !== "allowed") {
    // Approvals (permission "ask") are not wired up yet (OBJ-43), so only allowed calls run.
    deps.store.finishStep(step.id, {
      outcome: "blocked",
      observation: `The tool ${action.call.tool} is not allowed here.`,
      log: {
        deviceId: deps.deviceId,
        description: `Did not use ${action.call.tool}, because it needs your approval or is blocked`,
      },
    });
    return;
  }
  let run;
  try {
    run = await runner.tools.run(action.call, signal);
  } catch (error) {
    // A tool that throws is a bug in the tool; the step still gets an outcome so it is never left open.
    deps.logger.error("tool.threw", { taskId: subtask.taskId, tool: action.call.tool, errorName: (error as Error)?.name });
    run = { outcome: "error" as const, observation: "The tool failed.", description: `Tried to use ${action.call.tool}` };
  }
  deps.store.finishStep(step.id, {
    outcome: run.outcome,
    observation: run.observation,
    log: { deviceId: deps.deviceId, description: run.description },
  });
}

/**
 * An action this lane cannot take: on a helper, anything that is not a tool, such as keystrokes (only main sends
 * keystrokes, SPEC-03 r7). It is recorded as a blocked step, so the next worker sees why, and nothing runs.
 */
function refuse(subtask: Subtask, lane: Lane, action: ModelAction, deps: SubtaskRunDeps): void {
  const recorded: RecordedAction = { action, permission: "blocked" };
  const step = deps.store.beginStep({ subtaskId: subtask.id, lane, action: recorded });
  deps.store.finishStep(step.id, {
    outcome: "blocked",
    observation: `The ${lane} lane cannot ${action.kind}. Use the available tools.`,
    log: {
      deviceId: deps.deviceId,
      description: `Did not ${action.kind === ACTION.type || action.kind === ACTION.key ? "use the keyboard" : "act on the screen"} from a background helper`,
    },
  });
  deps.logger.warn("subtask.actionRefused", { taskId: subtask.taskId, subtaskId: subtask.id, lane, action: action.kind });
}
