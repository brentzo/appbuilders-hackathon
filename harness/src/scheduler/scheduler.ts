import type { Subtask, UserError, Uuid } from "@yumi/protocol/types";
import { describeError } from "../log.ts";
import type { LaneRunners, RouteSubtask } from "./lanes.ts";
import { runSubtask, type SubtaskRun, type SubtaskRunDeps } from "./subtask-runner.ts";

/**
 * Runs a saved plan (OBJ-05.4): a subtask becomes ready when every subtask it depends on is done, and ready
 * subtasks run at the same time, up to the model server's parallel slots, each as its own request to the one model
 * (SPEC-02 r7). Each subtask is routed through `route` first, so the lane router (OBJ-07) plugs in without changing
 * this file. If a subtask fails, the others are stopped and the task fails: replanning is not part of OBJ-05.
 */

export interface SchedulerDeps extends SubtaskRunDeps {
  route: RouteSubtask;
  lanes: LaneRunners;
  /** How many subtasks run at once: `ModelConfig.parallelSlots`. */
  slots: number;
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
  signal?: AbortSignal,
): Promise<ScheduleOutcome> {
  const { store, logger } = deps;
  if (!Number.isInteger(deps.slots) || deps.slots < 1)
    throw new Error(`The scheduler needs at least one slot, got ${deps.slots}`);
  const stop = new AbortController();
  const stopSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  const active = new Map<Uuid, Promise<void>>();
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
    const decision = await deps.route(subtask);
    const runner = deps.lanes[decision.lane];
    const running = store.setSubtaskStatus(subtask.id, "running", {
      lane: decision.lane,
      routeReason: decision.reason,
      workerId: `${decision.lane}-${++workers}`,
      attempts: subtask.attempts + 1,
    });
    if (!runner) {
      logger.error("schedule.noLane", { taskId, subtaskId: subtask.id, lane: decision.lane });
      store.setSubtaskStatus(subtask.id, "failed", {
        result: { status: "blocked", files: [], note: "No worker for this lane yet." },
      });
      return fail(subtask.id);
    }
    logger.info("schedule.started", { taskId, subtaskId: subtask.id, lane: decision.lane, active: active.size });
    const run: SubtaskRun = await runSubtask(running, decision.lane, runner, confirmedGoal, deps, stopSignal);
    logger.info("schedule.finished", { taskId, subtaskId: subtask.id, outcome: run.outcome, status: run.result.status });
    if (run.outcome === "finished" && run.result.status === "done") {
      store.setSubtaskStatus(subtask.id, "done", { result: run.result });
      promoteReady(taskId);
      return;
    }
    // Cancelled from outside (pause or cancel): what happens to the subtask is the pause and cancel flow's call (OBJ-38).
    if (run.outcome === "aborted" && signal?.aborted) return;
    store.setSubtaskStatus(subtask.id, "failed", { result: run.result });
    if (run.outcome !== "aborted") fail(subtask.id, "userError" in run ? run.userError : undefined);
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
    if (!failure && !stopSignal.aborted) {
      const ready = store.listSubtasks(taskId).filter((s) => s.status === "ready" && !active.has(s.id));
      for (const subtask of ready.slice(0, Math.max(0, deps.slots - active.size))) start(subtask);
    }
    if (active.size === 0) break;
    await Promise.race(active.values());
  }

  if (failure) return failure;
  if (signal?.aborted) return { outcome: "aborted" };
  const left = store.listSubtasks(taskId).filter((s) => s.status !== "done");
  if (left.length > 0) {
    // Cannot happen with a checked plan: every dependency is in the plan and there are no cycles.
    logger.error("schedule.stuck", { taskId, left: left.map((s) => ({ id: s.id, status: s.status })) });
    return { outcome: "failed", subtaskId: left[0]!.id };
  }
  return { outcome: "done" };
}
