import type { DeviceId, Speak, Subtask, Task, UserError, Uuid } from "@yumi/protocol/types";
import { RunControl } from "../control/run-control.ts";
import { orchestratorTools } from "../gui/orchestrator-tools.ts";
import { makePlan, subtasksFromPlan } from "../planner/planner.ts";
import type { NewSubtask } from "../store/task-store.ts";
import { lookingOnlyFindings, summarizeTask } from "../planner/summary.ts";
import { runSchedule, type ScheduleOptions, type SchedulerDeps } from "./scheduler.ts";

/**
 * Carries a confirmed task from planning to done (SPEC-02 r1, r7, r9): plan it, save the checked plan and move the
 * task to running (OBJ-05.3), run the subtasks (OBJ-05.4), then save a one or two sentence summary, set the task
 * to done, and have it spoken on the device the user spoke to (OBJ-05.7). A plan that fails its checks fails the
 * task before anything runs.
 */

/** Where the task's words go: the device the user spoke to (`Task.originDeviceId`). */
export interface TaskVoice {
  speak(originDeviceId: DeviceId, payload: Speak): void;
  userError(originDeviceId: DeviceId, error: UserError): void;
}

export interface RunTaskDeps extends SchedulerDeps {
  voice: TaskVoice;
}

export type RunTaskOutcome =
  | { outcome: "done"; summary: string }
  | { outcome: "failed"; userError: UserError }
  /** Cancelled from outside; the task's status is left to the pause and cancel flow (OBJ-38). */
  | { outcome: "aborted" };

export async function runTask(taskId: Uuid, deps: RunTaskDeps, control = new RunControl()): Promise<RunTaskOutcome> {
  const { store, logger } = deps;
  const signal = control.signal;
  const task = store.getTask(taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  if (task.status !== "planning" || !task.confirmedGoal) throw new Error(`Task ${taskId} is ${task.status}, not planning`);
  const confirmedGoal = task.confirmedGoal;
  const model = { client: deps.client, logger, debug: deps.debug };
  deps.debug?.write("task.planning", { taskId, confirmedGoal });

  // The orchestrator's tools (SPEC-05 r9): gui_act for work in an app's window, and the helper lane's tools.
  const tools = orchestratorTools(
    Object.values(deps.lanes).flatMap((lane) => lane?.tools.tools ?? []),
    deps.gui !== undefined,
  );
  const planned = await makePlan(confirmedGoal, tools, { ...model, home: deps.home }, { taskId, signal });
  switch (planned.outcome) {
    case "aborted":
      return { outcome: "aborted" };
    case "error":
      return fail(task, planned.userError, deps);
    case "invalidPlan":
      // The planner could not make a plan that passes the checks. Nothing ran, so there is no last action.
      return fail(task, { kind: "unexpected", taskId }, deps, `No valid plan after two replies: ${planned.error}`);
    case "ok":
      break;
  }
  store.savePlan(taskId, subtasksFromPlan(planned.plan));
  return runPlan(task, confirmedGoal, deps, control);
}

/**
 * Carries on with a resumed task whose plan is saved (OBJ-06.3): the task is running again, and its subtasks are
 * where the pause or restart left them. Finished subtasks stay finished, and no recorded step runs again: each
 * subtask that was cut off goes on from its next step, with a fresh observation, as part of the same attempt.
 */
export async function continueTask(taskId: Uuid, deps: RunTaskDeps, control = new RunControl()): Promise<RunTaskOutcome> {
  const task = deps.store.getTask(taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  if (task.status !== "running" || !task.confirmedGoal || task.plan.length === 0) {
    throw new Error(`Task ${taskId} is ${task.status} with ${task.plan.length} subtasks, not running a saved plan`);
  }
  // A subtask is back at ready with attempts already counted only when a pause or restart cut its attempt off
  // (running -> ready or needsApproval -> ready in src/store/transitions.ts).
  const continuing = new Set(
    deps.store
      .listSubtasks(taskId)
      .filter((s) => s.status === "ready" && s.attempts > 0)
      .map((s) => s.id),
  );
  return runPlan(task, task.confirmedGoal, deps, control, { continuing });
}

/** Plans a revised goal from recorded progress, retaining ids for completed or still-needed helpers. */
export async function prepareRevisedPlan(
  taskId: Uuid,
  confirmedGoal: string,
  deps: RunTaskDeps,
): Promise<{ outcome: "ok"; subtasks: NewSubtask[] } | { outcome: "failed"; userError: UserError }> {
  const task = deps.store.getTask(taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const old = deps.store.listSubtasks(taskId);
  const context = JSON.stringify({
    originalGoal: task.goal,
    previouslyConfirmedGoal: task.confirmedGoal,
    completed: old.filter((subtask) => subtask.status === "done").map(progressRecord),
    continuingHelpers: old
      .filter(
        (subtask) =>
          subtask.proposedLane === "helper" && ["running", "ready", "queued", "needsApproval"].includes(subtask.status),
      )
      .map(progressRecord),
  });
  const tools = orchestratorTools(
    Object.values(deps.lanes).flatMap((lane) => lane?.tools.tools ?? []),
    deps.gui !== undefined,
  );
  const planned = await makePlan(
    confirmedGoal,
    tools,
    { client: deps.client, logger: deps.logger, home: deps.home, ...(deps.debug ? { debug: deps.debug } : {}) },
    { taskId, context },
  );
  if (planned.outcome === "error") return { outcome: "failed", userError: planned.userError };
  if (planned.outcome !== "ok") return { outcome: "failed", userError: { kind: "unexpected", taskId } };
  const raw = subtasksFromPlan(planned.plan);
  const used = new Set<Uuid>();
  const oldByKey = new Map<string, Subtask[]>();
  for (const subtask of old) {
    if (subtask.status === "failed" || subtask.status === "cancelled") continue;
    const key = reuseKey(subtask);
    oldByKey.set(key, [...(oldByKey.get(key) ?? []), subtask]);
  }
  const idMap = new Map<string, Uuid>();
  const matched = new Map<string, Subtask>();
  for (const plannedSubtask of raw) {
    const candidates = oldByKey.get(reuseKey(plannedSubtask)) ?? [];
    const reuse = candidates.find((candidate) => !used.has(candidate.id) && canReuse(candidate, plannedSubtask));
    const id = reuse?.id ?? plannedSubtask.id!;
    idMap.set(plannedSubtask.id!, id);
    if (reuse) {
      used.add(reuse.id);
      matched.set(plannedSubtask.id!, reuse);
    }
  }
  return {
    outcome: "ok",
    subtasks: raw.map((subtask) => {
      const previous = matched.get(subtask.id!);
      return {
        ...subtask,
        taskId,
        id: idMap.get(subtask.id!)!,
        dependsOn: (subtask.dependsOn ?? []).map((dependency) => idMap.get(dependency)!),
        ...(previous ? { status: previous.status } : {}),
      };
    }),
  };
}

function progressRecord(subtask: Subtask) {
  return {
    id: subtask.id,
    title: subtask.title,
    instruction: subtask.instruction,
    status: subtask.status,
    note: subtask.result?.note,
  };
}

function reuseKey(subtask: Pick<Subtask, "title" | "instruction" | "proposedLane">): string {
  return `${subtask.proposedLane}\n${subtask.title.trim().toLocaleLowerCase()}\n${subtask.instruction.trim().toLocaleLowerCase()}`;
}

function canReuse(existing: Subtask, planned: Omit<NewSubtask, "taskId" | "parentSubtaskId">): boolean {
  if (existing.status === "done") return true;
  return (
    planned.proposedLane === "helper" &&
    existing.proposedLane === "helper" &&
    existing.dependsOn.length === 0 &&
    (planned.dependsOn?.length ?? 0) === 0 &&
    ["running", "ready", "queued", "needsApproval"].includes(existing.status)
  );
}

/** Runs a saved plan to the end: the schedule, then the summary, spoken on the device the user spoke to. */
async function runPlan(
  task: Task,
  confirmedGoal: string,
  deps: RunTaskDeps,
  control: RunControl,
  options: ScheduleOptions = {},
): Promise<RunTaskOutcome> {
  const { store, logger } = deps;
  const taskId = task.id;
  const model = { client: deps.client, logger, debug: deps.debug };
  const signal = control.signal;
  const scheduled = await runSchedule(taskId, confirmedGoal, deps, control, options);
  if (scheduled.outcome === "aborted") return { outcome: "aborted" };
  if (scheduled.outcome === "failed") {
    // Without its own error, the failure was a bug in the harness, not the subtask: "Unexpected" with the last action.
    const lastAction = store.listActionLog(taskId).at(-1)?.description;
    return fail(
      task,
      scheduled.userError ?? { kind: "unexpected", taskId, ...(lastAction ? { lastAction } : {}) },
      deps,
      `Subtask ${scheduled.subtaskId} failed${scheduled.userError ? "" : " without its own error, so the harness says Unexpected"}`,
    );
  }

  const subtasks = store.listSubtasks(taskId);
  const findings = lookingOnlyFindings(store, subtasks);
  const latestGoal = store.getTask(taskId)?.confirmedGoal ?? confirmedGoal;
  const summary = await summarizeTask(latestGoal, subtasks, model, { taskId, signal, ...(findings ? { findings } : {}) });
  if (summary === undefined) return { outcome: "aborted" };
  store.setTaskStatus(taskId, "done", { summary });
  deps.voice.speak(task.originDeviceId, { taskId, text: summary });
  logger.info("task.done", { taskId, subtasks: store.listSubtasks(taskId).length, summaryChars: summary.length });
  deps.debug?.write("task.done", { taskId, summary });
  return { outcome: "done", summary };
}

/** Fails the task and tells the user. `why` is for the debug log only: what went wrong, in the team's words. */
function fail(task: Task, userError: UserError, deps: RunTaskDeps, why?: string): RunTaskOutcome {
  const status = deps.store.getTask(task.id)?.status;
  if (status === "paused" || status === "cancelled") {
    // The user paused or cancelled while the failure happened: their status stands, and no error is shown.
    deps.logger.info("task.failureAfterStop", { taskId: task.id, status, kind: userError.kind });
    return { outcome: "aborted" };
  }
  const error: UserError = { ...userError, taskId: task.id };
  deps.store.setTaskStatus(task.id, "failed");
  deps.voice.userError(task.originDeviceId, error);
  deps.logger.warn("task.failed", { taskId: task.id, kind: error.kind });
  deps.debug?.write("task.failed", { taskId: task.id, userError: error, ...(why ? { why } : {}) });
  return { outcome: "failed", userError: error };
}

/**
 * Speaks through the Mac app on the local socket (`speak` and `userError` events). Cross-device messages are not
 * built yet (OBJ-25), so a task the user started on the phone is spoken on the Mac too, and the log says so; swap
 * this for a voice that sends to the phone over the bridge when `originDeviceId` is not this Mac.
 */
export function localVoice(
  app: { emit(event: string, payload: unknown): number },
  logger: RunTaskDeps["logger"],
  macDeviceId?: DeviceId,
): TaskVoice {
  const note = (originDeviceId: DeviceId, event: string) => {
    if (macDeviceId !== undefined && originDeviceId !== macDeviceId)
      logger.warn("voice.originNotReachable", { originDeviceId, event });
  };
  return {
    speak: (originDeviceId, payload) => {
      note(originDeviceId, "speak");
      app.emit("speak", payload);
    },
    userError: (originDeviceId, error) => {
      note(originDeviceId, "userError");
      app.emit("userError", error);
    },
  };
}
