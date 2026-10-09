import type {
  DeviceId,
  Lane,
  Observation,
  Path,
  ResultStatus,
  Subtask,
  SubtaskResult,
  ToolCall,
  UserError,
} from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";
import type { ModelClient } from "../model/client.ts";
import { checkAction } from "../safety/gate.ts";
import type { TaskStore } from "../store/task-store.ts";
import { ACTION } from "../worker/actions.ts";
import { runWorkerStep } from "../worker/step.ts";
import { describeNotRun, describeToolRun } from "./describe.ts";
import type { LaneRunner } from "./lanes.ts";
import { buildSubtaskResult } from "./result.ts";
import { buildWorkerInput } from "./worker-input.ts";

/**
 * Runs one subtask on its lane, one step at a time, until the worker finishes it: each step gets a fresh worker
 * input (SPEC-02 r5) and returns one validated action for its lane (r6, SPEC-03 r7). Every action goes through the
 * permission gate (SPEC-07 r1), is written with the gate's level before it runs, and is finished after (r3). Only
 * `allowed` runs: approvals are OBJ-38, so an action that asks is recorded as not run, and the worker is told why.
 * The outcome carries the subtask's structured result (OBJ-05.6). The caller changes the subtask's status.
 */

/**
 * A guard so a worker that never finishes cannot loop forever: SPEC-02 r8's 25 steps per subtask. OBJ-06 owns the
 * limits, their user-facing errors, and attempts; this only stops the loop.
 */
export const MAX_STEPS_PER_SUBTASK = 25;

/** Longest observation line a step can store (`Step.observation`). */
const MAX_OBSERVATION = 300;

export type SubtaskRun =
  /** The worker finished: `result.status` is done or stuck. */
  | { outcome: "finished"; result: SubtaskResult }
  /** The subtask cannot go on: the model's replies were invalid twice, it needs an answer, or it hit the step guard. */
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
  /** The user's home folder, for the permission gate. Tests pass a temporary one. */
  home: string;
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
  /** Real paths the tools created or changed, as they reported them (a taken name gets a number). */
  const files: Path[] = [];
  const result = (status: ResultStatus, note: string) => buildSubtaskResult(status, note, files);
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
      // Questions to the user are not wired up yet (waitingForUser, OBJ-38): end the subtask instead of guessing.
      return { outcome: "failed", result: result("blocked", "Needs an answer from the user, and asking is not available yet.") };
    }
    if (action.kind !== ACTION.tool) {
      // The step's validation only accepts the lane's actions, and only the helper lane runs here (OBJ-36 adds UI
      // lanes), so this is a bug. Stop rather than act on the screen without a lane that can.
      throw new Error(`The ${lane} lane cannot run a ${action.kind} action yet`);
    }
    const path = await runTool(subtask, lane, runner, action.call, observation, deps, signal);
    if (path !== undefined && action.call.tool !== "read_file" && action.call.tool !== "list_dir" && !files.includes(path)) {
      files.push(path);
    }
  }
}

/**
 * Runs one tool call as a step. The gate decides its level from the call and the real file system, and the step is
 * written with that level before anything runs (SPEC-02 r3, SPEC-07 r1). Returns the real path the tool used.
 */
async function runTool(
  subtask: Subtask,
  lane: Lane,
  runner: LaneRunner,
  call: ToolCall,
  observation: Observation,
  deps: SubtaskRunDeps,
  signal: AbortSignal,
): Promise<Path | undefined> {
  const { store, logger } = deps;
  const decision = checkAction({ action: { kind: ACTION.tool, call } }, { home: deps.home, app: observation.app });
  const step = store.beginStep({ subtaskId: subtask.id, lane, action: decision.recorded });

  if (decision.level !== "allowed") {
    // Approvals come in OBJ-38: an action that asks is not run, and neither is a blocked one (SPEC-07 r5).
    logger.warn(decision.level === "ask" ? "step.needsApproval" : "step.blocked", {
      taskId: subtask.taskId,
      subtaskId: subtask.id,
      tool: call.tool,
      rule: decision.rule,
    });
    store.finishStep(step.id, {
      outcome: "blocked",
      observation:
        decision.level === "ask"
          ? `Not done: ${call.tool} needs the user's approval, which is not available yet.`
          : `Not done: Yumi's safety rules do not allow this ${call.tool}.`,
      log: { deviceId: deps.deviceId, description: describeNotRun(call, decision.level) },
    });
    return undefined;
  }

  let run;
  try {
    run = await runner.tools.run(call, signal);
  } catch (error) {
    // A tool that throws is a bug in the tool; the step still gets an outcome so it is never left open.
    logger.error("tool.threw", { taskId: subtask.taskId, tool: call.tool, ...describeError(error) });
    run = { outcome: "error" as const, output: "The tool failed, so nothing was done." };
  }
  store.finishStep(step.id, {
    outcome: run.outcome,
    observation: fit(run.output),
    log: { deviceId: deps.deviceId, description: describeToolRun(call, run.outcome === "ok", run.path) },
  });
  return run.outcome === "ok" ? run.path : undefined;
}

function fit(line: string): string {
  return line.length <= MAX_OBSERVATION ? line : `${line.slice(0, MAX_OBSERVATION - 3)}...`;
}
