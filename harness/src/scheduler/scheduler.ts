import type { Subtask, SubtaskResult, UserError, Uuid } from "@yumi/protocol/types";
import { DEFAULT_LIMITS } from "../config.ts";
import { isUiLane, RunControl } from "../control/run-control.ts";
import type { GuiServices } from "../gui/gui-act.ts";
import { describeError } from "../log.ts";
import { ProbeFailure, type RouteDecision } from "../router/index.ts";
import { runGuiSubtask } from "./gui-lane.ts";
import { lastGoodStep } from "./handoff.ts";
import type { LaneRunners, RouteSubtask } from "./lanes.ts";
import type { TaskVoice } from "./run-task.ts";
import { runSubtask, type SubtaskRun, type SubtaskRunDeps } from "./subtask-runner.ts";

/**
 * Runs a saved plan (OBJ-05.4): a subtask becomes ready when every subtask it depends on is done, and ready
 * subtasks run at the same time, up to the model server's parallel slots, each as its own request to the one model
 * (SPEC-02 r7). Each subtask is routed through `route` first: the lane router (OBJ-07) in the running harness. If a subtask fails, the others are stopped and the task fails: replanning is not part of OBJ-05.
 *
 * A ghost or main subtask with no free cursor or window is queued by the router (OBJ-08): it waits in `queued`
 * without taking a slot, since it uses no model, and is routed again when there may be room. Its cursor and window
 * lock are given back when its run ends.
 *
 * Starting a subtask starts an attempt, up to the attempt limit (SPEC-02 r8). A subtask a resume continues
 * (`ScheduleOptions.continuing`) carries on with the attempt a pause or restart cut off, so it is not counted again.
 *
 * The run's `RunControl` stops it (OBJ-38): a pause of every lane or a cancel stops everything, and the statuses are
 * the pause or cancel flow's to set. While the user has taken over (a UI-lanes pause), each ghost or main subtask
 * stops before its next action and goes back to ready, no new one starts, and helpers keep running; the schedule
 * waits for the resume and then starts the UI subtasks again as the same attempt (SPEC-06 r2).
 *
 * A ghost that gets stuck hands its subtask off (SPEC-03 r8, r9, OBJ-09): the subtask goes to `handoff` with its
 * last good step, which releases its window lock and cursor, then joins the main cursor's queue and is routed again
 * to `main`. If the main cursor gets stuck on it too, the UI lanes pause and Yumi asks the user for help with
 * "Stuck on screen" (SPEC-11); the user's Resume tries again on the main cursor.
 */

export interface SchedulerDeps extends SubtaskRunDeps {
  route: RouteSubtask;
  /** Each lane's runner. The running harness has only the helper's; tests may stand in for a UI lane. */
  lanes: LaneRunners;
  /** What the ghost and main lanes need: subtasks routed to a lane with no runner run through `gui_act` (OBJ-36). */
  gui?: GuiServices;
  /** How many subtasks run at once: `ModelConfig.parallelSlots`. */
  slots: number;
  /** Tells the user the main cursor is stuck on a handed-off subtask (OBJ-09). */
  voice?: Pick<TaskVoice, "userError">;
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
  /** Subtasks a stuck ghost handed off: they are routed to the main cursor from now on (OBJ-09). */
  const promoted = new Set<Uuid>();
  // The model's slots. A subtask queued for a cursor or a window gives its slot back while it waits, since it uses
  // no model, and takes one again before it runs; those waiting for a slot go before subtasks not started yet.
  let busy = 0;
  const slotWaiters: (() => void)[] = [];
  let nudge = () => {};
  const nudged = () => new Promise<void>((resolve) => (nudge = resolve));
  const giveSlot = () => {
    const next = slotWaiters.shift();
    if (next) return next();
    busy--;
    nudge();
  };
  const takeSlot = (): Promise<void> => {
    if (busy < deps.slots) {
      busy++;
      return Promise.resolve();
    }
    return new Promise((resolve) => slotWaiters.push(resolve));
  };
  let failure: Extract<ScheduleOutcome, { outcome: "failed" }> | undefined;
  let workers = 0;
  const currentSubtasks = () => {
    const ids = new Set(store.getTask(taskId)?.plan ?? []);
    return store.listSubtasks(taskId).filter((subtask) => ids.has(subtask.id));
  };

  const fail = (subtaskId: Uuid, userError?: UserError) => {
    failure ??= { outcome: "failed", subtaskId, ...(userError ? { userError } : {}) };
    stop.abort();
  };

  const start = (subtask: Subtask) => {
    busy++;
    const slot = { held: true };
    const work = (async () => {
      // Yield first, so the work is in `active` before any of it runs, even if routing throws right away.
      await Promise.resolve();
      try {
        await runOne(subtask, slot);
      } catch (error) {
        // A bug, such as a refused status change. Stop everything rather than run on a record that may be wrong.
        logger.error("schedule.crashed", { taskId, subtaskId: subtask.id, ...describeError(error) });
        fail(subtask.id);
      } finally {
        active.delete(subtask.id);
        if (slot.held) giveSlot();
      }
    })();
    active.set(subtask.id, work);
  };

  const runOne = async (subtask: Subtask, slot: { held: boolean }) => {
    // Paused, cancelled, or stopped by another subtask's failure: nothing is routed or started after that.
    if (stopSignal.aborted) return;
    const continues = continuing.has(subtask.id) && subtask.attempts > 0;
    if (!continues && subtask.attempts >= limits.attemptsPerSubtask) {
      // Its attempts are used up (SPEC-02 r8): fail it before routing, so nothing runs and no app is probed.
      logger.warn("subtask.attemptLimit", { taskId, subtaskId: subtask.id, attempts: subtask.attempts });
      store.setSubtaskStatus(subtask.id, "failed", {
        result: { status: "stuck", files: [], note: `Stopped after ${subtask.attempts} attempts without finishing.` },
      });
      return fail(subtask.id, { kind: "stepFailed", taskId, step: subtask.title });
    }
    // A handoff routes the subtask again, to the main cursor, once the ghost's cursor and window are given back.
    for (let current = subtask, carryOn = continues; ; current = store.getSubtask(subtask.id)!, carryOn = false) {
      let decision;
      try {
        decision = await routeWhenThereIsRoom(current, slot);
      } catch (error) {
        if (!(error instanceof ProbeFailure)) throw error;
        if (stopSignal.aborted) {
          // The check failed after the stop: the subtask never started, and the stop decides what happens to it.
          notStarted(subtask.id);
          return;
        }
        // The router could not learn what the target app supports, so no lane can work in it (OBJ-07 Outcome).
        logger.warn("schedule.routeFailed", { taskId, subtaskId: subtask.id, kind: error.userError.kind });
        store.setSubtaskStatus(subtask.id, "failed", {
          result: { status: "blocked", files: [], note: "Could not check the app." },
        });
        return fail(subtask.id, error.userError);
      }
      if (!decision) return;
      let ended;
      try {
        if (stopSignal.aborted) {
          // Stopped while it was routed (Brent's run, 2026-10-10: a pause during routing still started a ghost). The
          // lock and cursor are given back below, and the subtask waits where routing left it.
          notStarted(subtask.id);
          return;
        }
        ended = await runRouted(current, decision, carryOn);
      } finally {
        decision.release?.();
      }
      if (ended !== "handoff") return;
    }
  };

  /**
   * A subtask the stop kept from starting. Paused or cancelled: a queued one goes back to ready, so a resume routes it
   * again, unless the pause flow already moved it. Stopped by another subtask's failure: failed, like the other
   * subtasks that were stopped.
   */
  const notStarted = (subtaskId: Uuid) => {
    const current = store.getSubtask(subtaskId)!;
    logger.info("schedule.notStarted", { taskId, subtaskId, status: current.status });
    if (current.status !== "queued") return;
    if (signal.aborted) store.setSubtaskStatus(subtaskId, "ready");
    else {
      store.setSubtaskStatus(subtaskId, "failed", {
        result: { status: "partial", files: [], note: "Stopped before it started." },
      });
    }
  };

  /**
   * Routes the subtask, and while the router queues it, waits in `queued` and routes it again. Undefined when the
   * task was stopped while it waited.
   */
  const routeWhenThereIsRoom = async (subtask: Subtask, slot: { held: boolean }): Promise<RouteDecision | undefined> => {
    let current = subtask;
    for (;;) {
      const decision = await deps.route(current, promoted.has(current.id));
      if (!decision.queued) {
        if (!slot.held) {
          await takeSlot();
          slot.held = true;
        }
        return decision;
      }
      if (current.status !== "queued") current = store.setSubtaskStatus(current.id, "queued");
      if (slot.held) {
        slot.held = false;
        giveSlot();
      }
      await decision.queued.wait(stopSignal);
      current = store.getSubtask(current.id)!;
      if (stopSignal.aborted) {
        notStarted(current.id);
        return undefined;
      }
    }
  };

  const runRouted = async (subtask: Subtask, decision: RouteDecision, continues: boolean): Promise<"handoff" | void> => {
    if (isUiLane(decision.lane) && control.uiLanesPaused) {
      // The user has the mouse and keyboard: a UI subtask waits, still ready, for the resume (SPEC-06 r2).
      logger.info("schedule.held", { taskId, subtaskId: subtask.id, lane: decision.lane });
      held.add(subtask.id);
      return;
    }
    // A lane with its own runner uses it; the ghost and main lanes otherwise run through gui_act.
    const runner = deps.lanes[decision.lane];
    const gui = !runner && isUiLane(decision.lane) ? deps.gui : undefined;
    const running = store.setSubtaskStatus(subtask.id, "running", {
      lane: decision.lane,
      routeReason: decision.reason,
      workerId: `${decision.lane}-${++workers}`,
      // Each gui_act call counts its own attempt (OBJ-36.1).
      attempts: continues || gui ? subtask.attempts : subtask.attempts + 1,
    });
    if (!runner && !gui) {
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
      const runSignal = AbortSignal.any([subtaskSignal, stop.signal]);
      const latestGoal = store.getTask(taskId)?.confirmedGoal ?? confirmedGoal;
      run = gui
        ? await runGuiSubtask(running, latestGoal, { ...deps, ...gui }, runSignal, control, continues, promoted.has(subtask.id))
        : await runSubtask(running, decision.lane, runner!, latestGoal, deps, runSignal, control);
    } finally {
      control.leave(subtask.id);
    }
    logger.info("schedule.finished", { taskId, subtaskId: subtask.id, outcome: run.outcome, status: run.result.status });
    if (store.getSubtask(subtask.id)?.status === "cancelled") {
      logger.info("schedule.cancelledAfterRevision", { taskId, subtaskId: subtask.id });
      return;
    }
    if (run.outcome === "finished" && run.result.status === "done") {
      store.setSubtaskStatus(subtask.id, "done", { result: run.result });
      promoteReady();
      return;
    }
    // Stopped from outside (a pause of every lane, or a cancel): the pause and cancel flow sets the statuses (OBJ-38),
    // even when the run ended with a failure after the stop.
    if (signal.aborted) {
      logger.info("schedule.endedAfterStop", { taskId, subtaskId: subtask.id, outcome: run.outcome });
      return;
    }
    if (run.outcome === "handoff" && !stop.signal.aborted) {
      handOff(subtask.id, run.result);
      return "handoff";
    }
    if (promoted.has(subtask.id) && run.outcome === "failed" && stuckOnScreen(run)) {
      askForHelp(subtask.id);
      return;
    }
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

  /**
   * Hands a stuck ghost's subtask to the main cursor (SPEC-03 r8, r9): `handoff` with the last good step releases its
   * window lock in the same change, and it joins the main cursor's queue with its step log as it is.
   */
  const handOff = (subtaskId: Uuid, result: SubtaskResult) => {
    const good = lastGoodStep(store.listSteps(subtaskId));
    store.setSubtaskStatus(subtaskId, "handoff", { result, ...(good ? { lastGoodStep: good } : {}) });
    store.setSubtaskStatus(subtaskId, "queued");
    promoted.add(subtaskId);
    logger.info("schedule.handoff", { taskId, subtaskId, ...(good ? { lastGoodStep: good } : {}) });
  };

  /**
   * The main cursor got stuck on a handed-off subtask: the UI lanes pause as they do when the user takes over, the
   * task shows as paused, and the user is asked for help with "Stuck on screen" (SPEC-03 "Main cursor also gets
   * stuck"). The user's Resume routes the subtask to the main cursor again.
   */
  const askForHelp = (subtaskId: Uuid) => {
    logger.warn("schedule.mainStuck", { taskId, subtaskId });
    control.pauseUiLanes();
    store.setSubtaskStatus(subtaskId, "ready");
    held.add(subtaskId);
    const task = store.getTask(taskId)!;
    if (task.status === "running" || task.status === "waitingForUser") store.setTaskStatus(taskId, "paused");
    deps.voice?.userError(task.originDeviceId, { kind: "stuckOnScreen", taskId });
  };

  /** Marks pending subtasks ready once every subtask they depend on is done. */
  const promoteReady = () => {
    const subtasks = currentSubtasks();
    const done = new Set(subtasks.filter((s) => s.status === "done").map((s) => s.id));
    for (const subtask of subtasks) {
      if (subtask.status === "pending" && subtask.dependsOn.every((dependency) => done.has(dependency))) {
        store.setSubtaskStatus(subtask.id, "ready");
      }
    }
  };

  promoteReady();
  for (;;) {
    if (!control.uiLanesPaused) held.clear();
    if (!failure && !stopSignal.aborted) {
      const ready = currentSubtasks().filter((s) => s.status === "ready" && !active.has(s.id) && !held.has(s.id));
      for (const subtask of ready.slice(0, Math.max(0, deps.slots - busy - slotWaiters.length))) start(subtask);
    }
    if (active.size === 0 && (held.size === 0 || failure || stopSignal.aborted)) break;
    // Wait for a subtask to end, for one to give its slot back while it waits for a cursor or a window, or for a
    // pause, resume, or stop that changes what may start.
    await Promise.race([...active.values(), nudged(), control.changed()]);
  }

  // A pause or cancel from outside wins over a failure: the pause and cancel flow owns the statuses.
  if (signal.aborted) return { outcome: "aborted" };
  if (failure) return failure;
  const left = currentSubtasks().filter((s) => s.status !== "done" && s.status !== "cancelled");
  if (left.length > 0) {
    // Cannot happen with a checked plan: every dependency is in the plan and there are no cycles.
    logger.error("schedule.stuck", { taskId, left: left.map((s) => ({ id: s.id, status: s.status })) });
    return { outcome: "failed", subtaskId: left[0]!.id };
  }
  return { outcome: "done" };
}

/** A run that ended stuck on the screen: no effect, replies that did not fit, or a window that is gone. */
function stuckOnScreen(run: Extract<SubtaskRun, { outcome: "failed" }>): boolean {
  return run.result.status === "stuck" && (!run.userError || run.userError.kind === "stuckOnScreen");
}
