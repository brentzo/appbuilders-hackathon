import type { PauseScope, TaskStatus, Uuid } from "@yumi/protocol/types";
import { RunControl } from "../control/run-control.ts";
import { describeError, type Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { resetSubtasks } from "./recovery.ts";
import { continueTask, runTask, type RunTaskDeps, type RunTaskOutcome } from "./run-task.ts";

/**
 * Starts, pauses, resumes, and cancels tasks, and keeps track of the ones running in this process (OBJ-06.3,
 * OBJ-38.5, OBJ-38.6). It is the one place a task's work starts, so a pause or cancel can always find and stop it.
 *
 * - `start` runs a confirmed task from planning (OBJ-17 calls it after the user confirms).
 * - `pause` is the one pause path, with two scopes (SPEC-06 r1, r2, r4, r5). Every lane: the run stops before its
 *   next action, the step in progress gets its outcome (the checkpoint), the working subtasks go back to ready, and
 *   the task is paused. UI lanes only: the ghost and main lanes stop before their next action and helpers keep
 *   running. Both cancel every pending approval, which tells the apps with `approvalCancelled`.
 * - `resume` only ever runs because the user asked: the app calls `resumeTask` after the user says yes to "Want me
 *   to pick up where I left off?", presses Resume, or says "continue" or "resume". Nothing else calls it, so nothing
 *   resumes on its own. A risky action asks again after it (SPEC-06 r5).
 * - `cancel` stops every lane, helpers included, drops every queued subtask and every approval or card not yet
 *   answered, and sets the task to cancelled. Nothing runs after it (SPEC-06 r8).
 */

/** Statuses of a task whose work is under way, which a pause can stop. */
const WORKING: readonly TaskStatus[] = ["planning", "running", "waitingForUser"];

/** Statuses of a task that ended. */
const ENDED: readonly TaskStatus[] = ["done", "failed", "cancelled"];

/** What a cancel or pause needs from the approval flow: dropping a task's open approvals and cards. */
export interface PendingApprovals {
  cancelAll(taskId: Uuid): void;
}

/** Why a request about a task was refused. A bug or a race in the app; logged, and the app shows "Unexpected". */
export class TaskControlError extends Error {
  constructor(
    readonly rule: "unknownTask" | "notPaused" | "alreadyRunning" | "cannotRun",
    readonly taskId: Uuid,
    message: string,
  ) {
    super(message);
    this.name = "TaskControlError";
  }
}

interface ActiveRun {
  control: RunControl;
  settled: Promise<RunTaskOutcome>;
}

export class TaskControl {
  private readonly active = new Map<Uuid, ActiveRun>();

  /**
   * `work` is what running a task needs: the model, the lanes, and this device. Without it, the harness can still
   * cancel tasks but refuses to start or resume them.
   */
  constructor(
    private readonly store: TaskStore,
    private readonly logger: Logger,
    private readonly work?: RunTaskDeps,
    private readonly approvals?: PendingApprovals,
  ) {}

  /** True while the task's work runs in this process. */
  isRunning(taskId: Uuid): boolean {
    return this.active.has(taskId);
  }

  /** Resolves when the task's current run ends, or right away when nothing runs. */
  async settled(taskId: Uuid): Promise<RunTaskOutcome | undefined> {
    return this.active.get(taskId)?.settled;
  }

  /** Runs a confirmed task, which must be planning, to the end. */
  start(taskId: Uuid): Promise<RunTaskOutcome> {
    if (this.active.has(taskId)) throw this.refuse("alreadyRunning", taskId, `Task ${taskId} is already running`);
    const work = this.requireWork(taskId);
    return this.track(taskId, (control) => runTask(taskId, work, control));
  }

  /**
   * Pauses a task (SPEC-06 r1, r2, r4, r5). A pause of UI lanes while the task waits for the user and no UI lane is
   * acting is ignored, as a second guard behind the Mac app: the user is answering Yumi, not taking over (SPEC-06
   * r2). Pausing a task that is not working does nothing. Returns once the pause is in effect: for every lane, after
   * the step in progress got its outcome; for UI lanes, at once, since helpers go on.
   */
  async pause(taskId: Uuid, scope: PauseScope = "everyLane"): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) throw this.refuse("unknownTask", taskId, `No task ${taskId}`);
    const run = this.active.get(taskId);
    // While planning, no lane works yet and nothing could keep running, so taking over stops the planner too, and
    // the resume plans again.
    if (scope === "uiLanes" && task.status !== "planning") return this.pauseUiLanes(taskId, task.status, run);

    if (!WORKING.includes(task.status) && !(task.status === "paused" && run)) {
      this.logger.info("task.pauseIgnored", { taskId, scope, status: task.status });
      return;
    }
    // Nothing is sent after this line: every step loop checks the run before its next action (SPEC-06 r4).
    run?.control.stop("paused");
    this.approvals?.cancelAll(taskId);
    if (task.status !== "paused") this.store.setTaskStatus(taskId, "paused");
    // The checkpoint: the step in progress gets its outcome, then the working subtasks wait for the resume.
    await run?.settled;
    resetSubtasks(this.store, this.logger, taskId);
    this.logger.info("task.paused", { taskId, scope, was: task.status });
  }

  /**
   * Resumes a paused task because the user asked (OBJ-06.3). Returns once the task is planning or running again; the
   * work goes on in the background. A task with no plan yet plans again, and a task with a saved plan carries on
   * from where each subtask stopped, each with a fresh observation before its next step. Resuming a task that is
   * already running here does nothing, so a second tap on Resume is harmless.
   */
  resume(taskId: Uuid): void {
    const task = this.store.getTask(taskId);
    if (!task) throw this.refuse("unknownTask", taskId, `No task ${taskId}`);
    const run = this.active.get(taskId);
    if (run && task.status === "paused" && run.control.uiLanesPaused && !run.control.stopped) {
      // The user gave the mouse back: the helpers never stopped, so the UI lanes start again in the same run.
      this.store.setTaskStatus(taskId, task.plan.length > 0 ? "running" : "planning");
      run.control.resumeUiLanes();
      this.logger.info("task.resumed", { taskId, scope: "uiLanes" });
      return;
    }
    if (run) {
      this.logger.info("task.resumeIgnored", { taskId, status: task.status });
      return;
    }
    if (task.status !== "paused") throw this.refuse("notPaused", taskId, `Task ${taskId} is ${task.status}, not paused`);
    const work = this.requireWork(taskId);
    const planned = task.plan.length > 0;
    this.store.setTaskStatus(taskId, planned ? "running" : "planning");
    this.logger.info("task.resumed", { taskId, planned });
    void this.track(taskId, (control) => (planned ? continueTask(taskId, work, control) : runTask(taskId, work, control)));
  }

  /**
   * Cancels a task (SPEC-06 r8): stops every lane, helpers included, drops every approval and card not yet answered,
   * waits for the step in progress to be recorded, marks every subtask that had started as failed and every queued
   * one as dropped, and sets the task to cancelled. A task that already ended is left as it is.
   */
  async cancel(taskId: Uuid): Promise<void> {
    const run = this.active.get(taskId);
    // Nothing is sent after this line: every step loop checks the run before its next action.
    run?.control.stop("cancelled");
    this.approvals?.cancelAll(taskId);
    await run?.settled;
    const task = this.store.getTask(taskId);
    if (!task) throw this.refuse("unknownTask", taskId, `No task ${taskId}`);
    if (ENDED.includes(task.status)) {
      this.logger.info("task.cancelIgnored", { taskId, status: task.status });
      return;
    }
    for (const subtask of this.store.listSubtasks(taskId)) {
      if (subtask.status === "done" || subtask.status === "failed") continue;
      const started = subtask.attempts > 0;
      this.store.setSubtaskStatus(subtask.id, "failed", {
        result: {
          status: "partial",
          files: subtask.result?.files ?? [],
          note: started ? "Cancelled before it finished." : "Cancelled before it started.",
        },
      });
    }
    this.store.setTaskStatus(taskId, "cancelled");
    this.logger.info("task.cancelled", { taskId, was: task.status });
  }

  /**
   * Stops every run without changing any status, for shutting down: the next start finds them cut off and asks the
   * user, the same as after a crash.
   */
  async close(): Promise<void> {
    const runs = [...this.active.values()];
    for (const run of runs) run.control.stop("paused");
    await Promise.all(runs.map((run) => run.settled));
  }

  /** The UI-lanes scope of `pause`: the ghost and main lanes stop, helpers go on (SPEC-06 r2). */
  private pauseUiLanes(taskId: Uuid, status: TaskStatus, run: ActiveRun | undefined): void {
    if (!WORKING.includes(status)) {
      this.logger.info("task.pauseIgnored", { taskId, scope: "uiLanes", status });
      return;
    }
    if (status === "waitingForUser" && !run?.control.uiLaneActing()) {
      // The user is answering Yumi, for example on an approval card or in a password field Yumi handed over.
      this.logger.info("task.pauseIgnored", { taskId, scope: "uiLanes", status, reason: "waitingForUser" });
      return;
    }
    run?.control.pauseUiLanes();
    this.approvals?.cancelAll(taskId);
    this.store.setTaskStatus(taskId, "paused");
    this.logger.info("task.paused", { taskId, scope: "uiLanes", was: status });
  }

  private track(taskId: Uuid, run: (control: RunControl) => Promise<RunTaskOutcome>): Promise<RunTaskOutcome> {
    const control = new RunControl();
    const settled = run(control)
      .catch((error: unknown): RunTaskOutcome => {
        // A bug in the harness, such as a refused status change. Tell the user plainly and keep the record honest.
        this.logger.error("task.crashed", { taskId, ...describeError(error) });
        const task = this.store.getTask(taskId);
        const lastAction = this.store.listActionLog(taskId).at(-1)?.description;
        const userError = {
          kind: "unexpected" as const,
          taskId,
          ...(lastAction ? { lastAction: lastAction.slice(0, 200) } : {}),
        };
        try {
          if (task && task.status !== "done" && task.status !== "failed" && task.status !== "cancelled") {
            this.store.setTaskStatus(taskId, "failed");
          }
          if (task) this.work?.voice.userError(task.originDeviceId, userError);
        } catch (failure) {
          this.logger.error("task.crashReportFailed", { taskId, ...describeError(failure) });
        }
        return { outcome: "failed", userError };
      })
      .finally(() => {
        if (this.active.get(taskId) === entry) this.active.delete(taskId);
      });
    const entry: ActiveRun = { control, settled };
    this.active.set(taskId, entry);
    return settled;
  }

  private requireWork(taskId: Uuid): RunTaskDeps {
    if (!this.work)
      throw this.refuse("cannotRun", taskId, "This harness was started without the model and lanes, so it cannot run tasks");
    return this.work;
  }

  private refuse(rule: TaskControlError["rule"], taskId: Uuid, message: string): TaskControlError {
    this.logger.warn("task.refused", { taskId, rule, detail: message });
    return new TaskControlError(rule, taskId, message);
  }
}
