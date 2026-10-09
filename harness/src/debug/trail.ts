import type { Lane, Observation, Step, Subtask, WorkerOutput, WorkerThought } from "@yumi/protocol/types";
import type { TaskStore } from "../store/task-store.ts";
import type { DebugLog } from "./debug-log.ts";
import { PasswordScrubber } from "./scrub.ts";
import { describeDecision, describeSees, thought } from "./thoughts.ts";

/**
 * What one subtask's step loop leaves behind in Debug mode (OBJ-52): its lines in the debug log, all scrubbed of
 * password text, and the `workerThought` events for the thoughts panel (SPEC-07 r22, r23). The helper lane's runner
 * and `gui_act` both use it, so every worker reports the same way.
 */

export interface TrailDeps {
  store: TaskStore;
  debug?: DebugLog | undefined;
  /** Sends a worker's thoughts to the app; the harness sends them only in Debug mode. */
  thoughts?: ((thought: WorkerThought) => void) | undefined;
}

export class SubtaskTrail {
  /** One for the whole subtask, so text learned in one step's reply is removed from every later line. */
  readonly scrubber = new PasswordScrubber();
  private decision: string | undefined;
  private reason: string | undefined;

  constructor(
    private readonly deps: TrailDeps,
    private readonly subtask: Subtask,
    private readonly lane: Lane,
    /** The cursor doing the work: `main`, a ghost's own id, or none for a helper. */
    private readonly cursorId?: string,
  ) {}

  write(event: string, fields: Record<string, unknown> = {}): void {
    this.deps.debug?.write(event, { taskId: this.subtask.taskId, subtaskId: this.subtask.id, ...fields }, this.scrubber.scrub);
  }

  started(fields: Record<string, unknown> = {}): void {
    this.write("subtask.started", {
      title: this.subtask.title,
      instruction: this.subtask.instruction,
      lane: this.lane,
      ...(this.cursorId ? { cursorId: this.cursorId } : {}),
      ...fields,
    });
  }

  /** The model chose an action: written with the full observation, and sent as the worker's thought. */
  decided(step: number, observation: Observation, output: WorkerOutput, attempts: number, lastStep?: Step): void {
    this.scrubber.learn(output.action, observation);
    const sees = describeSees(observation, lastStep);
    this.decision = describeDecision(output.action, observation);
    this.reason = output.reason;
    this.write("step.decided", {
      step,
      lane: this.lane,
      observation,
      sees,
      action: output.action,
      decision: this.decision,
      ...(this.reason ? { reason: this.reason } : {}),
      attempts,
    });
    this.think(sees);
  }

  /** A step got its outcome: written, and the thought updated with the last action and what the worker sees now. */
  finished(step: Step, sees: string): void {
    this.write("step.finished", {
      stepId: step.id,
      outcome: step.outcome,
      permission: step.action.permission,
      observation: step.observation,
      ...(step.toolOutput !== undefined ? { toolOutput: step.toolOutput } : {}),
      durationMs: step.durationMs,
    });
    this.think(sees);
  }

  ended(fields: Record<string, unknown>): void {
    this.write("subtask.ended", fields);
  }

  private think(sees: string): void {
    const { thoughts, debug, store } = this.deps;
    if (!thoughts || debug?.enabled === false) return;
    const lastAction = store.listSubtaskActionLog(this.subtask.id).at(-1)?.description;
    thoughts(
      thought({
        taskId: this.subtask.taskId,
        subtaskId: this.subtask.id,
        ...(this.cursorId ? { cursorId: this.cursorId } : {}),
        title: this.subtask.title,
        lane: this.lane,
        sees,
        ...(lastAction ? { lastAction } : {}),
        ...(this.decision ? { decision: this.decision } : {}),
        ...(this.reason ? { reason: this.reason } : {}),
      }),
    );
  }
}
