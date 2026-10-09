import type { DeviceId, Speak, Task, UserError, Uuid } from "@yumi/protocol/types";
import { makePlan, subtasksFromPlan } from "../planner/planner.ts";
import { summarizeTask } from "../planner/summary.ts";
import { runSchedule, type SchedulerDeps } from "./scheduler.ts";

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

export async function runTask(taskId: Uuid, deps: RunTaskDeps, signal?: AbortSignal): Promise<RunTaskOutcome> {
  const { store, logger } = deps;
  const task = store.getTask(taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  if (task.status !== "planning" || !task.confirmedGoal) throw new Error(`Task ${taskId} is ${task.status}, not planning`);
  const confirmedGoal = task.confirmedGoal;
  const model = { client: deps.client, logger };

  const tools = Object.values(deps.lanes).flatMap((lane) => lane?.tools.tools ?? []);
  const planned = await makePlan(
    confirmedGoal,
    tools.filter((tool, i) => tools.findIndex((t) => t.name === tool.name) === i),
    model,
    { taskId, ...(signal ? { signal } : {}) },
  );
  switch (planned.outcome) {
    case "aborted":
      return { outcome: "aborted" };
    case "error":
      return fail(task, planned.userError, deps);
    case "invalidPlan":
      // The planner could not make a plan that passes the checks. Nothing ran, so there is no last action.
      return fail(task, { kind: "unexpected", taskId }, deps);
    case "ok":
      break;
  }
  store.savePlan(taskId, subtasksFromPlan(planned.plan));

  const scheduled = await runSchedule(taskId, confirmedGoal, deps, signal);
  if (scheduled.outcome === "aborted") return { outcome: "aborted" };
  if (scheduled.outcome === "failed") {
    // Without its own error, the failure was a bug in the harness, not the subtask: "Unexpected" with the last action.
    const lastAction = store.listActionLog(taskId).at(-1)?.description;
    return fail(task, scheduled.userError ?? { kind: "unexpected", taskId, ...(lastAction ? { lastAction } : {}) }, deps);
  }

  const summary = await summarizeTask(confirmedGoal, store.listSubtasks(taskId), model, {
    taskId,
    ...(signal ? { signal } : {}),
  });
  if (summary === undefined) return { outcome: "aborted" };
  store.setTaskStatus(taskId, "done", { summary });
  deps.voice.speak(task.originDeviceId, { taskId, text: summary });
  logger.info("task.done", { taskId, subtasks: store.listSubtasks(taskId).length, summaryChars: summary.length });
  return { outcome: "done", summary };
}

function fail(task: Task, userError: UserError, deps: RunTaskDeps): RunTaskOutcome {
  const error: UserError = { ...userError, taskId: task.id };
  deps.store.setTaskStatus(task.id, "failed");
  deps.voice.userError(task.originDeviceId, error);
  deps.logger.warn("task.failed", { taskId: task.id, kind: error.kind });
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
