import type { Uuid } from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { continueTask, runTask, type RunTaskDeps, type RunTaskOutcome } from "./run-task.ts";

/**
 * Starts, resumes, and cancels tasks, and keeps track of the ones running in this process (OBJ-06.3). It is the one
 * place a task's work starts, so a cancel can always find and stop it.
 *
 * - `start` runs a confirmed task from planning (OBJ-17 calls it after the user confirms).
 * - `resume` only ever runs because the user asked: the app calls `resumeTask` after the user says yes to "Want me
 *   to pick up where I left off?" or presses Resume. Nothing else calls it, so nothing resumes on its own.
 * - `cancel` stops the task's work if it is running and sets it to cancelled. OBJ-38 extends it to every lane and
 *   every command not yet run (SPEC-06 r8).
 */

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
  controller: AbortController;
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
    return this.track(taskId, (signal) => runTask(taskId, work, signal));
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
    if (this.active.has(taskId)) {
      this.logger.info("task.resumeIgnored", { taskId, status: task.status });
      return;
    }
    if (task.status !== "paused") throw this.refuse("notPaused", taskId, `Task ${taskId} is ${task.status}, not paused`);
    const work = this.requireWork(taskId);
    const planned = task.plan.length > 0;
    this.store.setTaskStatus(taskId, planned ? "running" : "planning");
    this.logger.info("task.resumed", { taskId, planned });
    void this.track(taskId, (signal) => (planned ? continueTask(taskId, work, signal) : runTask(taskId, work, signal)));
  }

  /**
   * Cancels a task: stops its work if it runs here, waits for the step in progress to be recorded, marks every
   * subtask that had started as failed, and sets the task to cancelled. Subtasks that never started stay as they are.
   * A task that already ended is left as it is.
   */
  async cancel(taskId: Uuid): Promise<void> {
    const run = this.active.get(taskId);
    if (run) {
      run.controller.abort();
      await run.settled;
    }
    const task = this.store.getTask(taskId);
    if (!task) throw this.refuse("unknownTask", taskId, `No task ${taskId}`);
    if (task.status === "done" || task.status === "failed" || task.status === "cancelled") {
      this.logger.info("task.cancelIgnored", { taskId, status: task.status });
      return;
    }
    for (const subtask of this.store.listSubtasks(taskId)) {
      if (subtask.status === "done" || subtask.status === "failed" || subtask.attempts === 0) continue;
      this.store.setSubtaskStatus(subtask.id, "failed", {
        result: { status: "partial", files: subtask.result?.files ?? [], note: "Cancelled before it finished." },
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
    for (const run of runs) run.controller.abort();
    await Promise.all(runs.map((run) => run.settled));
  }

  private track(taskId: Uuid, run: (signal: AbortSignal) => Promise<RunTaskOutcome>): Promise<RunTaskOutcome> {
    const controller = new AbortController();
    const settled = run(controller.signal)
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
    const entry: ActiveRun = { controller, settled };
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
