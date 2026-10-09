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
  WorkerThought,
} from "@yumi/protocol/types";
import type { ApprovalAnswer, ApprovalGate } from "../approvals/approval-flow.ts";
import { DEFAULT_LIMITS, type Limits } from "../config.ts";
import type { RunControl } from "../control/run-control.ts";
import type { DebugLog } from "../debug/debug-log.ts";
import { cursorIdFor, describeSees } from "../debug/thoughts.ts";
import { SubtaskTrail } from "../debug/trail.ts";
import { describeError, type Logger } from "../log.ts";
import type { ModelClient } from "../model/client.ts";
import { checkAction } from "../safety/gate.ts";
import type { TaskStore } from "../store/task-store.ts";
import { ACTION } from "../worker/actions.ts";
import { runWorkerStep } from "../worker/step.ts";
import { describeNotDone, describeToolRun, describeTrashed, type NotDone } from "./describe.ts";
import type { LaneRunner } from "./lanes.ts";
import { buildSubtaskResult, finishedSoFar } from "./result.ts";
import { buildWorkerInput } from "./worker-input.ts";

/**
 * Runs one subtask on its lane, one step at a time, until the worker finishes it: each step gets a fresh worker
 * input (SPEC-02 r5) and returns one validated action for its lane (r6, SPEC-03 r7). Every action goes through the
 * permission gate (SPEC-07 r1), is written with the gate's level before it runs, and is finished after (r3).
 *
 * Right before each action the run's pause state is checked, and nothing is written or sent once a pause covers
 * this lane (SPEC-06 r4). An action that asks goes through the approval flow (OBJ-38) and runs only once approved
 * and checked again; a blocked one never runs, and the user chooses to keep going or stop (SPEC-07 r5). The outcome
 * carries the subtask's structured result (OBJ-05.6). The caller changes the subtask's status.
 */

/** Longest observation line a step can store (`Step.observation`). */
const MAX_OBSERVATION = 300;
/** Longest tool output a step can store (`ToolOutput`): about a page of text. */
export const MAX_TOOL_OUTPUT = 4000;

export type SubtaskRun =
  /** The worker finished: `result.status` is done or stuck. */
  | { outcome: "finished"; result: SubtaskResult }
  /** The subtask cannot go on: the model's replies were invalid twice, it needs an answer, or it hit the step guard. */
  | { outcome: "failed"; result: SubtaskResult; userError?: UserError }
  /** The model could not answer. */
  | { outcome: "error"; result: SubtaskResult; userError: UserError }
  /** The caller cancelled. */
  | { outcome: "aborted"; result: SubtaskResult }
  /** Only a ghost: it got stuck, and the subtask moves to the main cursor (SPEC-03 r8, OBJ-09). */
  | { outcome: "handoff"; result: SubtaskResult };

export interface SubtaskRunDeps {
  store: TaskStore;
  client: ModelClient;
  logger: Logger;
  /** This device, for the action log. */
  deviceId: DeviceId;
  /** The user's home folder, for the permission gate. Tests pass a temporary one. */
  home: string;
  /** The limits from the configuration (SPEC-02 r8). Defaults to `DEFAULT_LIMITS`. */
  limits?: Limits;
  /**
   * Asks the user about actions that ask, and about blocked ones (OBJ-38). The running harness always has it.
   * Without it, an action that asks is recorded as not done, and a blocked one is skipped without asking.
   */
  approvals?: ApprovalGate;
  /** The detailed debug log (OBJ-52): each step's observation, decision, and outcome, while Debug mode is on. */
  debug?: DebugLog;
  /** Sends a worker's thoughts to the app; the harness sends them only in Debug mode (SPEC-07 r23). */
  thoughts?: (thought: WorkerThought) => void;
}

export async function runSubtask(
  subtask: Subtask,
  lane: Lane,
  runner: LaneRunner,
  confirmedGoal: string,
  deps: SubtaskRunDeps,
  signal: AbortSignal,
  control: RunControl,
): Promise<SubtaskRun> {
  const trail = new SubtaskTrail(deps, subtask, lane, cursorIdFor(lane, subtask, runner));
  trail.started({ attempt: subtask.attempts });
  const run = await runSteps(subtask, lane, runner, confirmedGoal, deps, signal, control, trail);
  trail.ended({
    outcome: run.outcome,
    result: run.result,
    ...("userError" in run && run.userError ? { userError: run.userError } : {}),
  });
  return run;
}

async function runSteps(
  subtask: Subtask,
  lane: Lane,
  runner: LaneRunner,
  confirmedGoal: string,
  deps: SubtaskRunDeps,
  signal: AbortSignal,
  control: RunControl,
  trail: SubtaskTrail,
): Promise<SubtaskRun> {
  const { store, logger } = deps;
  /** Real paths the tools created or changed, as they reported them (a taken name gets a number). */
  const files: Path[] = [];
  const result = (status: ResultStatus, note: string) => buildSubtaskResult(status, note, files);
  const lastAction = () => store.listActionLog(subtask.taskId).at(-1)?.description;
  const { stepsPerSubtask } = deps.limits ?? DEFAULT_LIMITS;

  const stopped = (): SubtaskRun => ({ outcome: "aborted", result: result("partial", "Stopped before it finished.") });

  for (;;) {
    if (signal.aborted || !control.mayAct(lane)) return stopped();
    // Every step of the subtask counts, across attempts and restarts (SPEC-05 r5), including steps a restart cut off.
    const steps = store.listSteps(subtask.id);
    if (steps.length >= stepsPerSubtask) {
      logger.warn("subtask.stepLimit", { taskId: subtask.taskId, subtaskId: subtask.id, steps: steps.length });
      const finished = describeFinished(store, subtask);
      return {
        outcome: "failed",
        result: result("partial", `Stopped after ${steps.length} steps without finishing.`),
        userError: { kind: "taskTookTooLong", taskId: subtask.taskId, ...(finished ? { finishedSoFar: finished } : {}) },
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
      { client: deps.client, logger, debug: deps.debug },
      {
        lane,
        signal,
        taskId: subtask.taskId,
        subtaskId: subtask.id,
        scrubber: trail.scrubber,
        ...(last ? { lastAction: last } : {}),
      },
    );

    switch (step.outcome) {
      case "aborted":
        return stopped();
      case "error":
        return { outcome: "error", result: result("stuck", "The model could not answer."), userError: step.userError };
      case "invalidOutput":
        return { outcome: "failed", result: result("stuck", "The worker's replies did not match the action schema twice.") };
      case "ok":
        break;
    }

    const action = step.output.action;
    trail.decided(steps.length + 1, observation, step.output, step.attempts.length, steps.at(-1));
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
    const ran = await runTool(subtask, lane, runner, action.call, observation, deps, signal, control);
    const finished = store.listSteps(subtask.id).at(-1);
    if (finished && finished.id !== steps.at(-1)?.id) trail.finished(finished, describeSees(observation, finished));
    if (ran.stopped) return stopped();
    const path = ran.path;
    if (path !== undefined && !["read_file", "list_dir", "move_to_trash"].includes(action.call.tool) && !files.includes(path)) {
      files.push(path);
    }
  }
}

/**
 * What the task finished before the step limit stopped this subtask (SPEC-11 "Task took too long"): the titles of
 * its finished subtasks, then what this subtask's actions did that worked, from the action log.
 */
export function describeFinished(store: TaskStore, subtask: Subtask): string | undefined {
  const done = store
    .listSubtasks(subtask.taskId)
    .filter((s) => s.status === "done")
    .map((s) => s.title);
  const worked = store
    .listSubtaskActionLog(subtask.id)
    .filter((line) => line.outcome === "ok")
    .map((line) => line.description);
  return finishedSoFar([...done, ...worked]);
}

/** What one tool step did: the real path the tool used, or that the subtask must stop because a pause or cancel came. */
type ToolStep = { stopped: true } | { stopped: false; path?: Path };

/** What the worker reads about an action that was not done, by reason. */
const NOT_DONE_OBSERVATION: Record<NotDone, (tool: string) => string> = {
  needsApproval: (tool) => `Not done: ${tool} needs the user's approval, and there is no way to ask for it here.`,
  blocked: (tool) => `Not done: Yumi's safety rules do not allow this ${tool}. Do not try it again.`,
  declined: (tool) => `Not done: the user said no to this ${tool}.`,
  paused: (tool) =>
    `Not done: the task was paused before this ${tool} could run. If it is still needed, the user is asked again.`,
  filesChanged: () => "Not done: the files changed or are gone, so nothing was moved to the Trash.",
  noRecipients: () => "Not done: the recipients could not be read, so nothing was sent.",
  couldNotAsk: (tool) => `Not done: the approval for this ${tool} could not be shown.`,
  actionChanged: (tool) => `Not done: the screen changed while the user was asked about this ${tool}.`,
};

const UNAVAILABLE: Record<Extract<ApprovalAnswer, { outcome: "unavailable" }>["reason"], NotDone> = {
  noApprovalCard: "needsApproval",
  noRecipients: "noRecipients",
  filesGone: "filesChanged",
  couldNotAsk: "couldNotAsk",
  actionChanged: "actionChanged",
};

/**
 * Runs one tool call as a step. The gate decides its level from the call and the real file system, and the step is
 * written with that level before anything runs (SPEC-02 r3, SPEC-07 r1). An `ask` runs only after the approval
 * flow approved it and checked it again; a `blocked` one never runs (SPEC-07 r5).
 */
async function runTool(
  subtask: Subtask,
  lane: Lane,
  runner: LaneRunner,
  call: ToolCall,
  observation: Observation,
  deps: SubtaskRunDeps,
  signal: AbortSignal,
  control: RunControl,
): Promise<ToolStep> {
  const { store, logger } = deps;
  const decision = checkAction({ action: { kind: ACTION.tool, call } }, { home: deps.home, app: observation.app });
  // The pause check (SPEC-06 r4): once a pause covers this lane, nothing is written or sent.
  if (signal.aborted || !control.mayAct(lane)) return { stopped: true };
  const step = store.beginStep({ subtaskId: subtask.id, lane, action: decision.recorded });
  const log = { taskId: subtask.taskId, subtaskId: subtask.id, stepId: step.id, tool: call.tool, rule: decision.rule };
  const notDone = (outcome: "blocked" | "declined" | "noEffect", why: NotDone) =>
    store.finishStep(step.id, {
      outcome,
      observation: NOT_DONE_OBSERVATION[why](call.tool),
      log: { deviceId: deps.deviceId, description: describeNotDone(decision.recorded, observation.app, why) },
    });

  if (decision.level === "blocked") {
    // A blocked action never runs, whatever the user says (SPEC-07 r5).
    logger.warn("step.blocked", log);
    notDone("blocked", "blocked");
    if (!deps.approvals) return { stopped: false };
    const choice = await deps.approvals.blocked({ subtask, step, lane, control, app: observation.app }, signal);
    return { stopped: choice !== "keepGoing" };
  }

  if (decision.level === "ask") {
    logger.info("step.needsApproval", log);
    const answer: ApprovalAnswer = deps.approvals
      ? await deps.approvals.request(decision, { subtask, step, lane, control }, signal)
      : { outcome: "unavailable", reason: "noApprovalCard" };
    switch (answer.outcome) {
      case "declined":
        notDone("declined", "declined");
        return { stopped: false };
      case "cancelled":
        notDone("noEffect", "paused");
        return { stopped: signal.aborted || !control.mayAct(lane) };
      case "unavailable":
        notDone(answer.reason === "filesGone" ? "noEffect" : "blocked", UNAVAILABLE[answer.reason]);
        return { stopped: false };
      case "approved":
        break;
    }
    if (call.tool === "move_to_trash" && answer.files) {
      await trash(step.id, answer.files.allPaths, deps);
      return { stopped: false };
    }
    // Only move_to_trash asks among the typed tools today; any other approved call runs like an allowed one.
  }

  let run;
  try {
    run = await runner.tools.run(call, signal, { taskId: subtask.taskId });
  } catch (error) {
    // A tool that throws is a bug in the tool; the step still gets an outcome so it is never left open.
    logger.error("tool.threw", { taskId: subtask.taskId, tool: call.tool, ...describeError(error) });
    run = { outcome: "error" as const, output: "The tool failed, so nothing was done." };
  }
  const description = describeToolRun(call, run.outcome === "ok", run.path);
  store.finishStep(step.id, {
    outcome: run.outcome,
    // The one line says what happened; what the tool returned goes in its own bounded field (Brent, 2026-10-09).
    observation: run.outcome === "ok" ? fit(description) : fit(run.output),
    ...(run.outcome === "ok" && run.output !== "" ? { toolOutput: cut(run.output) } : {}),
    log: { deviceId: run.deviceId ?? deps.deviceId, description },
  });
  return { stopped: false, ...(run.outcome === "ok" && run.path ? { path: run.path } : {}) };
}

/**
 * Moves exactly the approved, checked paths to the Trash through the Mac app (SPEC-07 r7, r12), and logs every
 * path that moved (r18). Paths the app did not move make the step an error, so the worker knows.
 */
async function trash(stepId: string, paths: readonly Path[], deps: SubtaskRunDeps): Promise<void> {
  const moved = await deps.approvals!.moveToTrash(paths);
  const trashed = "trashed" in moved ? moved.trashed : [];
  if (trashed.length === 0) {
    deps.store.finishStep(stepId, {
      outcome: "error",
      observation: "Nothing was moved to the Trash: the Mac app could not move the files.",
      log: {
        deviceId: deps.deviceId,
        description: `Tried to move ${paths.length === 1 ? "a file" : `${paths.length} files`} to the Trash`,
      },
    });
    return;
  }
  const description = describeTrashed(trashed);
  deps.store.finishStep(stepId, {
    outcome: trashed.length === paths.length ? "ok" : "error",
    observation: fit(
      trashed.length === paths.length ? description : `${description}, but ${paths.length - trashed.length} could not be moved.`,
    ),
    log: { deviceId: deps.deviceId, description, paths: [...trashed] },
  });
}

/** Cuts tool output to `MAX_TOOL_OUTPUT`, saying so, so the worker knows it saw only the start. */
function cut(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT) return output;
  const note = `\n[Cut: only the first part of ${output.length} characters.]`;
  return output.slice(0, MAX_TOOL_OUTPUT - note.length) + note;
}

function fit(line: string): string {
  return line.length <= MAX_OBSERVATION ? line : `${line.slice(0, MAX_OBSERVATION - 3)}...`;
}
