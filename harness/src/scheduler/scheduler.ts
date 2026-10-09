import type { Subtask, UserError, Uuid } from "@yumi/protocol/types";
import { DEFAULT_LIMITS } from "../config.ts";
import { isUiLane, RunControl } from "../control/run-control.ts";
import { describeError } from "../log.ts";
import { ProbeFailure } from "../router/index.ts";
import type { LaneRunners, RouteSubtask } from "./lanes.ts";
import { runSubtask, type SubtaskRun, type SubtaskRunDeps } from "./subtask-runner.ts";

/**
 * Runs a saved plan (OBJ-05.4): a subtask becomes ready when every subtask it depends on is done, and ready
 * subtasks run at the same time, up to the model server's parallel slots, each as its own request to the one model
 * (SPEC-02 r7). Each subtask is routed through `route` first: the lane router (OBJ-07) in the running harness. If a subtask fails, the others are stopped and the task fails: replanning is not part of OBJ-05.
 *
 * Starting a subtask starts an attempt, up to the attempt limit (SPEC-02 r8). A subtask a resume continues
 * (`ScheduleOptions.continuing`) carries on with the attempt a pause or restart cut off, so it is not counted again.
 *
 * The run's `RunControl` stops it (OBJ-38): a pause of every lane or a cancel stops everything, and the statuses are
 * the pause or cancel flow's to set. While the user has taken over (a UI-lanes pause), each ghost or main subtask
 * stops before its next action and goes back to ready, no new one starts, and helpers keep running; the schedule
 * waits for the resume and then starts the UI subtasks again as the same attempt (SPEC-06 r2).
 */

export interface SchedulerDeps extends SubtaskRunDeps {
  route: RouteSubtask;
  lanes: LaneRunners;
  /** How many subtasks run at once: `ModelConfig.parallelSlots`. */
  slots: number;
}

export interface ScheduleOptions {
  /**
   * Subtasks whose interrupted attempt this run continues (OBJ-06): they were running when the task was paused or
   * the harness stopped, and went back to ready. Every other subtask that starts begins a new attempt.
   */
  continuing?: ReadonlySet<Uuid>;
}

export type ScheduleOutcome =
  | { outcome: "done" }
  /** A subtask failed. `userError` is what to tell the user, when the failure has its own SPEC-11 row. */
  | { outcome: "failed"; subtaskId: Uuid; userError?: UserError }
  | { outcome: "aborted" };

export async function runSchedule(
  taskId: Uuid,
  confirmedGoal: string,
  deps: SchedulerDeps,
  control: RunControl = new RunControl(),
  options: ScheduleOptions = {},
): Promise<ScheduleOutcome> {
  const signal = control.signal;
  const { store, logger } = deps;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  if (!Number.isInteger(deps.slots) || deps.slots < 1)
    throw new Error(`The scheduler needs at least one slot, got ${deps.slots}`);
  const stop = new AbortController();
  const stopSignal = AbortSignal.any([signal, stop.signal]);
  const active = new Map<Uuid, Promise<void>>();
  /** UI subtasks a take-over stopped or kept from starting, until the resume (SPEC-06 r2). */
  const held = new Set<Uuid>();
  /** Subtasks whose attempt goes on when they start again: a resume's, and those a take-over stopped. */
  const continuing = new Set(options.continuing ?? []);
  let failure: Extract<ScheduleOutcome, { outcome: "failed" }> | undefined;
  let workers = 0;

  const fail = (subtaskId: Uuid, userError?: UserError) => {
    failure ??= { outcome: "failed", subtaskId, ...(userError ? { userError } : {}) };
    stop.abort();
  };

  const start = (subtask: Subtask) => {
    const work = (async () => {
      // Yield first, so the work is in `active` before any of it runs, even if routing throws right away.
      await Promise.resolve();
      try {
        await runOne(subtask);
      } catch (error) {
        // A bug, such as a refused status change. Stop everything rather than run on a record that may be wrong.
        logger.error("schedule.crashed", { taskId, subtaskId: subtask.id, ...describeError(error) });
        fail(subtask.id);
      } finally {
        active.delete(subtask.id);
      }
    })();
    active.set(subtask.id, work);
  };

  const runOne = async (subtask: Subtask) => {
    const continues = continuing.has(subtask.id) && subtask.attempts > 0;
    if (!continues && subtask.attempts >= limits.attemptsPerSubtask) {
      // Its attempts are used up (SPEC-02 r8): fail it before routing, so nothing runs and no app is probed.
      logger.warn("subtask.attemptLimit", { taskId, subtaskId: subtask.id, attempts: subtask.attempts });
      store.setSubtaskStatus(subtask.id, "failed", {
        result: { status: "stuck", files: [], note: `Stopped after ${subtask.attempts} attempts without finishing.` },
      });
      return fail(subtask.id, { kind: "stepFailed", taskId, step: subtask.title });
    }
    let decision;
    try {
      decision = await deps.route(subtask);
    } catch (error) {
      if (!(error instanceof ProbeFailure)) throw error;
      // The router could not learn what the target app supports, so no lane can work in it (OBJ-07 Outcome).
      logger.warn("schedule.routeFailed", { taskId, subtaskId: subtask.id, kind: error.userError.kind });
      store.setSubtaskStatus(subtask.id, "failed", {
        result: { status: "blocked", files: [], note: "Could not check the app." },
      });
      return fail(subtask.id, error.userError);
    }
    if (isUiLane(decision.lane) && control.uiLanesPaused) {
      // The user has the mouse and keyboard: a UI subtask waits, still ready, for the resume (SPEC-06 r2).
      logger.info("schedule.held", { taskId, subtaskId: subtask.id, lane: decision.lane });
      held.add(subtask.id);
      return;
    }
    const runner = deps.lanes[decision.lane];
    const running = store.setSubtaskStatus(subtask.id, "running", {
      lane: decision.lane,
      routeReason: decision.reason,
      workerId: `${decision.lane}-${++workers}`,
      attempts: continues ? subtask.attempts : subtask.attempts + 1,
    });
    if (!runner) {
      logger.error("schedule.noLane", { taskId, subtaskId: subtask.id, lane: decision.lane });
      store.setSubtaskStatus(subtask.id, "failed", {
        result: { status: "blocked", files: [], note: "No worker for this lane yet." },
      });
      return fail(subtask.id);
    }
    logger.info("schedule.started", {
      taskId,
      subtaskId: subtask.id,
      lane: decision.lane,
      attempt: running.attempts,
      continuing: continues,
      active: active.size,
    });
    const subtaskSignal = control.enter(subtask.id, decision.lane);
    let run: SubtaskRun;
    try {
      run = await runSubtask(
        running,
        decision.lane,
        runner,
        confirmedGoal,
        deps,
        AbortSignal.any([subtaskSignal, stop.signal]),
        control,
      );
    } finally {
      control.leave(subtask.id);
    }
    logger.info("schedule.finished", { taskId, subtaskId: subtask.id, outcome: run.outcome, status: run.result.status });
    if (run.outcome === "finished" && run.result.status === "done") {
      store.setSubtaskStatus(subtask.id, "done", { result: run.result });
      promoteReady(taskId);
      return;
    }
    // Stopped from outside (a pause of every lane, or a cancel): the pause and cancel flow sets the statuses (OBJ-38).
    if (run.outcome === "aborted" && signal.aborted) return;
    if (run.outcome === "aborted" && !stop.signal.aborted && !control.mayAct(decision.lane)) {
      // The user took over: the subtask goes back to ready and carries on with this attempt after the resume.
      store.setSubtaskStatus(subtask.id, "ready");
      held.add(subtask.id);
      continuing.add(subtask.id);
      logger.info("schedule.pausedSubtask", { taskId, subtaskId: subtask.id, lane: decision.lane });
      return;
    }
    store.setSubtaskStatus(subtask.id, "failed", { result: run.result });
    if (run.outcome === "aborted") return;
    // A subtask the worker could not finish is "Couldn't finish a step" (SPEC-11 r14), named by its title. Failures
    // with their own SPEC-11 row (the model, the step guard) keep theirs.
    fail(subtask.id, "userError" in run && run.userError ? run.userError : { kind: "stepFailed", taskId, step: subtask.title });
  };

  /** Marks pending subtasks ready once every subtask they depend on is done. */
  const promoteReady = (id: Uuid) => {
    const subtasks = store.listSubtasks(id);
    const done = new Set(subtasks.filter((s) => s.status === "done").map((s) => s.id));
    for (const subtask of subtasks) {
      if (subtask.status === "pending" && subtask.dependsOn.every((dependency) => done.has(dependency))) {
        store.setSubtaskStatus(subtask.id, "ready");
      }
    }
  };

  promoteReady(taskId);
  for (;;) {
    if (!control.uiLanesPaused) held.clear();
    if (!failure && !stopSignal.aborted) {
      const ready = store.listSubtasks(taskId).filter((s) => s.status === "ready" && !active.has(s.id) && !held.has(s.id));
      for (const subtask of ready.slice(0, Math.max(0, deps.slots - active.size))) start(subtask);
    }
    if (active.size === 0 && (held.size === 0 || failure || stopSignal.aborted)) break;
    // Wait for a subtask to end, or for a pause, resume, or stop that changes what may start.
    await Promise.race([...active.values(), control.changed()]);
  }

  if (failure) return failure;
  if (signal.aborted) return { outcome: "aborted" };
  const left = store.listSubtasks(taskId).filter((s) => s.status !== "done");
  if (left.length > 0) {
    // Cannot happen with a checked plan: every dependency is in the plan and there are no cycles.
    logger.error("schedule.stuck", { taskId, left: left.map((s) => ({ id: s.id, status: s.status })) });
    return { outcome: "failed", subtaskId: left[0]!.id };
  }
  return { outcome: "done" };
}
