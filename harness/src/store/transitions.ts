import type { SubtaskStatus, TaskStatus } from "@yumi/protocol/types";

/**
 * The status changes the harness allows. SPEC-02 r2 lists the statuses; this table is the harness's reading of
 * how they connect, from the status descriptions in docs/task-record-schema.md, SPEC-03 (handoff, queueing),
 * SPEC-06 (pause, resume, cancel), and SPEC-09 r14 (queued delegated goals). Anything not listed is a bug in the
 * caller: the store logs it and refuses it. Changing a status to the one it already has is also refused, so every
 * accepted change is a real change and emits exactly one event.
 *
 * For OBJ-05 (approved as written for OBJ-04): the planner may need running -> planning to replan after a subtask
 * fails, and planning -> waitingForUser to ask a clarifying question. Add them with a spec reference if needed.
 */

/** Statuses a new task may start in: repeated back to the user, or already confirmed on the other device. */
export const INITIAL_TASK_STATUSES: readonly TaskStatus[] = ["awaitingConfirmation", "queued", "planning"];

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  // Confirmed (to planning, or queued behind a busy Mac), or the user said no.
  awaitingConfirmation: ["queued", "planning", "cancelled"],
  queued: ["planning", "cancelled", "failed"],
  planning: ["running", "paused", "failed", "cancelled"],
  running: ["waitingForUser", "paused", "done", "failed", "cancelled"],
  // An approval or question was answered, the approval timed out and paused the task (SPEC-09 r10), or it ended.
  waitingForUser: ["running", "paused", "failed", "cancelled"],
  // Resume goes back to the work that was paused: planning or running.
  paused: ["planning", "running", "cancelled", "failed"],
  done: [],
  failed: [],
  cancelled: [],
};

/** Statuses a new subtask may start in: waiting for its dependencies, or ready to route. */
export const INITIAL_SUBTASK_STATUSES: readonly SubtaskStatus[] = ["pending", "ready"];

export const SUBTASK_TRANSITIONS: Readonly<Record<SubtaskStatus, readonly SubtaskStatus[]>> = {
  pending: ["ready", "failed"],
  // Routed and waiting for a lock or capacity, or started right away.
  ready: ["queued", "running", "failed"],
  queued: ["running", "ready", "failed"],
  // Back to ready when its lane is paused or its lock is lost, so it is routed again on resume.
  running: ["needsApproval", "handoff", "ready", "queued", "done", "failed"],
  // Approved, declined into another attempt, or a pause cancelled the approval (SPEC-06 r5).
  needsApproval: ["running", "ready", "failed"],
  // Moving to the main lane (SPEC-03 r8): queued for the main cursor or started on it.
  handoff: ["queued", "running", "failed"],
  done: [],
  failed: [],
};

export function canChangeTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function canChangeSubtaskStatus(from: SubtaskStatus, to: SubtaskStatus): boolean {
  return SUBTASK_TRANSITIONS[from].includes(to);
}

/** A status change the table does not allow. It is a bug in the caller, logged and never applied. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly record: "task" | "subtask",
    readonly id: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${record} status change ${from} -> ${to} for ${id}`);
    this.name = "IllegalTransitionError";
  }
}
