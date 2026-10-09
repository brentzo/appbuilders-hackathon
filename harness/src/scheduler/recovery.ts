import type { Subtask, SubtaskStatus, Task, TaskStatus, Uuid } from "@yumi/protocol/types";
import type { Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { describeInterrupted } from "./describe.ts";

/**
 * Startup recovery (SPEC-02 r4, OBJ-06.1 and OBJ-06.4). When the harness starts, nothing is running yet, so any
 * record that says otherwise was cut off by a crash, a quit, or a reboot:
 *
 * - A step with no outcome is finished as `noEffect`: its action may or may not have happened, and the next step
 *   looks at the screen again before doing anything.
 * - A task that was planning, running, or waiting for the user is paused and marked interrupted, so the app asks
 *   "I was interrupted while working on your task. Want me to pick up where I left off?" (the `interruptedTaskFound`
 *   event). It never resumes on its own.
 * - A task the user paused stays paused, and is not marked: the app lists it with a Resume button.
 * - The subtasks of every paused task that were working go back to ready, and their window locks are released, so
 *   a resume routes them again and continues the attempt that was cut off.
 *
 * Every change goes through the store's status rules. Recovery is safe to run again after a crash halfway through:
 * each part only changes records that still need it.
 */

/** What a worker sees on the step a restart cut off, in its recent steps. */
export const INTERRUPTED_OBSERVATION =
  "Interrupted: Yumi stopped before this step finished, so it may or may not have happened. Check before doing it again.";

/** Task statuses that mean work was under way. */
const WORKING: readonly TaskStatus[] = ["planning", "running", "waitingForUser"];

/** Subtask statuses that mean a worker had it, and what a resume needs it to be. */
const CUT_OFF: Partial<Record<SubtaskStatus, SubtaskStatus>> = {
  running: "ready",
  needsApproval: "ready",
  // Waiting for a lock or for room; locks do not survive a restart, so it is routed again.
  queued: "ready",
  // handoff is left alone: moving to the main lane is OBJ-09's, and its resume belongs with it.
};

export interface Recovery {
  /** Tasks that were working and are now paused and marked interrupted, oldest first. */
  interrupted: Uuid[];
  /** Steps finished as `noEffect`. */
  steps: number;
}

export function recoverAfterRestart(store: TaskStore, logger: Logger): Recovery {
  let steps = 0;
  for (const step of store.listUnfinishedSteps()) {
    const task = taskOfSubtask(store, step.subtaskId);
    store.finishStep(step.id, {
      outcome: "noEffect",
      observation: INTERRUPTED_OBSERVATION,
      log: { deviceId: deviceFor(store, task), description: describeInterrupted(step.action) },
    });
    logger.info("recovery.stepInterrupted", { taskId: task.id, subtaskId: step.subtaskId, stepId: step.id });
    steps++;
  }

  const interrupted: Uuid[] = [];
  for (const task of store.listTasksByStatus(WORKING)) {
    resetSubtasks(store, logger, task.id);
    store.setTaskStatus(task.id, "paused", { interrupted: true });
    logger.info("recovery.taskInterrupted", { taskId: task.id, was: task.status });
    interrupted.push(task.id);
  }
  // Paused before the restart, by the user or by an earlier recovery: they stay paused (OBJ-06.4).
  for (const task of store.listTasksByStatus(["paused"])) {
    if (!interrupted.includes(task.id)) resetSubtasks(store, logger, task.id);
  }
  return { interrupted, steps };
}

function resetSubtasks(store: TaskStore, logger: Logger, taskId: Uuid): void {
  const reset = new Set<Uuid>();
  for (const subtask of store.listSubtasks(taskId)) {
    const next = CUT_OFF[subtask.status];
    if (!next) continue;
    store.setSubtaskStatus(subtask.id, next);
    reset.add(subtask.id);
    logger.info("recovery.subtaskReset", { taskId, subtaskId: subtask.id, was: subtask.status, attempts: subtask.attempts });
  }
  for (const lock of store.listWindowLocks()) {
    if (reset.has(lock.subtaskId)) store.releaseWindowLock(lock.windowId);
  }
}

function taskOfSubtask(store: TaskStore, subtaskId: Uuid): Task {
  const subtask: Subtask | undefined = store.getSubtask(subtaskId);
  const task = subtask && store.getTask(subtask.taskId);
  // A step always belongs to a subtask of a task: the database's foreign keys guarantee it.
  if (!task) throw new Error(`Step of subtask ${subtaskId} has no task`);
  return task;
}

/**
 * The device the interrupted step ran on, for its action log line. The harness learns its own device id only after
 * the Mac app connects, so this is the device of the task's last logged action, which is where its steps run, or the
 * device the user spoke to when nothing was logged yet.
 */
function deviceFor(store: TaskStore, task: Task): string {
  return store.listActionLog(task.id).at(-1)?.deviceId ?? task.originDeviceId;
}
