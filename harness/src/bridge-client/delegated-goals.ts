import { validateMessagePayload } from "@yumi/protocol/messages";
import type {
  DeviceId,
  EnvelopeType,
  GoalFinishedPayload,
  PairedDevice,
  Payload,
  ProgressPayload,
  Task,
  TaskStatus,
  TaskStatusChanged,
  UserError,
  Uuid,
} from "@yumi/protocol/types";
import { MAIN_CURSOR_ID } from "../confirm/confirmation.ts";
import { describeError, type Logger } from "../log.ts";
import type { TaskVoice } from "../scheduler/run-task.ts";
import { TaskControlError, type TaskControl } from "../scheduler/task-control.ts";
import type { TaskStore } from "../store/task-store.ts";

/**
 * Goals sent from the paired phone (SPEC-09 r4 to r9, OBJ-68). The phone confirmed the goal with the user, so it
 * goes straight to planning with no repeat-back (r5). The task's id is the goal id and its origin is the phone, so
 * the result and progress go back there (r7, r9) while the cursor works on the Mac as for any task (r8).
 *
 * - `delegateGoal`: the task starts and the answer is `goalAccepted`. The same goal sent again is accepted again,
 *   not run twice.
 * - `progress` goes to the phone on every task and subtask status change, and at least every 30 seconds until the
 *   task ends, with the title of the subtask in progress.
 * - `goalFinished` carries what the Mac would have said: the summary, the failure in SPEC-11 words, or the cancel
 *   line. None of it is spoken on the Mac.
 * - `pause`, `resume`, and `cancel` from the phone control its own goals. `pauseConfirmed` and `cancelConfirmed`
 *   are sent only once the pause or cancel is in effect (r12).
 *
 * Not built yet: queueing behind a busy Mac (r14, every goal answers `started`) and approvals on the phone (r10).
 */

export interface PhoneBridge {
  /** True when the device is a paired phone, so a task from it is answered over the bridge. */
  isPaired(deviceId: DeviceId): boolean;
  sendMessage(
    deviceId: DeviceId,
    type: "command" | "result" | "event",
    payload: Payload,
    replyTo?: Uuid,
    taskId?: Uuid,
  ): Promise<string>;
}

export interface DelegatedGoalsDeps {
  store: TaskStore;
  logger: Logger;
  tasks: () => TaskControl;
  /** Events to the Mac app, for the cursor. */
  app: { emit(event: string, payload: unknown): number };
  bridge: PhoneBridge;
  /** How often progress repeats while nothing changes. SPEC-09 r9 asks for at least every 30 seconds. */
  heartbeatMs?: number;
}

const HEARTBEAT_MS = 25_000;
const ENDED: readonly TaskStatus[] = ["done", "failed", "cancelled"];
const TITLE_MAX = 60;
/** SPEC-06 "Cancel a task". */
const CANCELLED_LINE = "Okay, I stopped. Nothing else will happen.";

export class DelegatedGoals {
  private readonly heartbeats = new Map<Uuid, NodeJS.Timeout>();
  /** Goals accepted but not answered yet: their progress waits until `goalAccepted` is on its way. */
  private readonly accepting = new Set<Uuid>();
  /** The error a phone task failed with, for its `goalFinished`. */
  private readonly failures = new Map<Uuid, UserError>();
  private readonly finished = new Set<Uuid>();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: DelegatedGoalsDeps) {
    this.unsubscribe = deps.store.onStatusChanged((event) => this.statusChanged(event));
  }

  /** True when the task came from the paired phone, so its words go there, not to the Mac. */
  isFromPhone(originDeviceId: DeviceId): boolean {
    try {
      return this.deps.bridge.isPaired(originDeviceId);
    } catch {
      // The bridge database is closed: the harness is shutting down.
      return false;
    }
  }

  /**
   * The task voice for every task: Mac tasks speak on the Mac as before. A phone task's summary and final failure
   * go to the phone in `goalFinished` instead; anything said while it still runs (a blocked action, a question)
   * stays on the Mac, where the cursor works and the buttons are.
   */
  voice(mac: TaskVoice): TaskVoice {
    return {
      speak: (originDeviceId, payload) => {
        const task = payload.taskId ? this.deps.store.getTask(payload.taskId) : undefined;
        if (task && this.isFromPhone(originDeviceId) && ENDED.includes(task.status)) {
          this.deps.logger.info("delegated.summaryNotSpoken", { taskId: task.id });
          return;
        }
        mac.speak(originDeviceId, payload);
      },
      userError: (originDeviceId, error) => {
        const task = error.taskId ? this.deps.store.getTask(error.taskId) : undefined;
        if (task && this.isFromPhone(originDeviceId) && ENDED.includes(task.status)) {
          this.failures.set(task.id, error);
          this.deps.logger.info("delegated.failureSentToPhone", { taskId: task.id, kind: error.kind });
          return;
        }
        mac.userError(originDeviceId, error);
      },
    };
  }

  /** The bridge client's `onMessage`: what a paired device sent. A command's return value is its result. */
  async handle(message: unknown, peer: PairedDevice, type: EnvelopeType): Promise<Payload | undefined> {
    const valid = validateMessagePayload(message, type);
    if (!valid.valid) {
      this.deps.logger.warn("delegated.invalidMessage", { from: peer.deviceId, type, errors: valid.errors.slice(0, 3) });
      return undefined;
    }
    const payload = message as Payload;
    switch (payload.kind) {
      case "delegateGoal":
        return this.accept(payload.goalId, payload.confirmedGoal, payload.originDeviceId, peer);
      case "pause":
        return this.control(payload.goalId, peer, "pause");
      case "resume":
        return this.control(payload.goalId, peer, "resume");
      case "cancel":
        return this.control(payload.goalId, peer, "cancel");
      case "ping":
        return { kind: "pingResult" };
      default:
        this.deps.logger.info("delegated.ignored", { from: peer.deviceId, kind: payload.kind });
        return undefined;
    }
  }

  close(): void {
    this.unsubscribe();
    for (const timer of this.heartbeats.values()) clearInterval(timer);
    this.heartbeats.clear();
  }

  private accept(goalId: Uuid, confirmedGoal: string, claimedOrigin: DeviceId, peer: PairedDevice): Payload {
    const { store, logger } = this.deps;
    const accepted: Payload = { kind: "goalAccepted", goalId, status: "started" };
    if (claimedOrigin !== peer.deviceId) {
      // The phone that sent it is the origin, whatever the message says: the result must go back to it.
      logger.warn("delegated.originMismatch", { goalId, from: peer.deviceId });
    }
    const existing = store.getTask(goalId);
    if (existing) {
      // The phone sent the same goal again, for example after it missed the answer. It runs once.
      logger.info("delegated.repeated", { goalId, status: existing.status });
      return accepted;
    }
    const goal = confirmedGoal.trim();
    // Before the task exists, since creating it is already a status change.
    this.accepting.add(goalId);
    store.createTask({ id: goalId, originDeviceId: peer.deviceId, goal: confirmedGoal, confirmedGoal: goal, status: "planning" });
    logger.info("delegated.accepted", { taskId: goalId, from: peer.deviceId, goalChars: goal.length });
    // The main cursor, as for a goal spoken on the Mac (SPEC-09 r8).
    this.deps.app.emit("cursorCommand", { command: "spawn", cursorId: MAIN_CURSOR_ID, cursorKind: "main" });
    // After the answer is on its way, so the phone hears goalAccepted before any progress.
    setImmediate(() => {
      this.accepting.delete(goalId);
      this.sendProgress(goalId);
      this.keepAlive(goalId);
      try {
        void this.deps.tasks().start(goalId);
      } catch (error) {
        if (!(error instanceof TaskControlError)) throw error;
        // The harness has no model or lanes to run it; logged by TaskControl.
        this.failures.set(goalId, { kind: "unexpected", taskId: goalId });
        store.setTaskStatus(goalId, "failed");
      }
    });
    return accepted;
  }

  private async control(goalId: Uuid, peer: PairedDevice, action: "pause" | "resume" | "cancel"): Promise<Payload | undefined> {
    const task = this.deps.store.getTask(goalId);
    if (!task || task.originDeviceId !== peer.deviceId) {
      this.deps.logger.warn("delegated.unknownGoal", { goalId, from: peer.deviceId, action });
      return undefined;
    }
    this.deps.logger.info("delegated.control", { taskId: goalId, action, status: task.status });
    try {
      switch (action) {
        case "pause":
          await this.deps.tasks().pause(goalId);
          return { kind: "pauseConfirmed", goalId };
        case "cancel":
          await this.deps.tasks().cancel(goalId);
          return { kind: "cancelConfirmed", goalId };
        case "resume":
          this.deps.tasks().resume(goalId);
          // The protocol has no resume confirmation; the phone learns it from progress, and the answer says started.
          return { kind: "goalAccepted", goalId, status: "started" };
      }
    } catch (error) {
      this.deps.logger.warn("delegated.controlFailed", { taskId: goalId, action, ...describeError(error) });
      return undefined;
    }
  }

  private statusChanged(event: TaskStatusChanged): void {
    const task = this.phoneTask(event.taskId);
    if (!task || this.accepting.has(task.id)) return;
    if (ENDED.includes(event.status)) {
      if (event.subtaskId !== undefined) return;
      // After the voice had its say: the failure arrives right after the status.
      setImmediate(() => this.finish(task.id));
      return;
    }
    this.sendProgress(task.id);
    this.keepAlive(task.id);
  }

  private phoneTask(taskId: Uuid): Task | undefined {
    const task = this.deps.store.getTask(taskId);
    return task && this.isFromPhone(task.originDeviceId) ? task : undefined;
  }

  private keepAlive(taskId: Uuid): void {
    if (this.heartbeats.has(taskId)) return;
    const timer = setInterval(() => {
      const task = this.deps.store.getTask(taskId);
      if (!task || ENDED.includes(task.status)) {
        clearInterval(timer);
        this.heartbeats.delete(taskId);
        return;
      }
      this.sendProgress(taskId);
    }, this.deps.heartbeatMs ?? HEARTBEAT_MS);
    timer.unref();
    this.heartbeats.set(taskId, timer);
  }

  private sendProgress(taskId: Uuid): void {
    const task = this.deps.store.getTask(taskId);
    if (!task || ENDED.includes(task.status)) return;
    const payload: ProgressPayload = {
      kind: "progress",
      goalId: taskId,
      status: task.status,
      currentSubtaskTitle: this.currentTitle(task),
      updatedAt: new Date().toISOString(),
    };
    this.send(task, payload);
  }

  private finish(taskId: Uuid): void {
    if (this.finished.has(taskId)) return;
    const task = this.deps.store.getTask(taskId);
    if (!task || !ENDED.includes(task.status)) return;
    this.finished.add(taskId);
    clearInterval(this.heartbeats.get(taskId));
    this.heartbeats.delete(taskId);
    const status = task.status as GoalFinishedPayload["status"];
    const summary =
      status === "done"
        ? (task.summary ?? "Done.")
        : status === "cancelled"
          ? CANCELLED_LINE
          : failureLine(this.failures.get(taskId) ?? { kind: "unexpected", taskId });
    this.failures.delete(taskId);
    this.deps.logger.info("delegated.finished", { taskId, status });
    this.send(task, { kind: "goalFinished", goalId: taskId, status, summary });
  }

  /** What the phone shows under "Working on your Mac": the subtask in progress, else the task's stage. */
  private currentTitle(task: Task): string {
    const subtasks = this.deps.store.listSubtasks(task.id);
    const current =
      subtasks.find((s) => s.status === "running") ??
      subtasks.find((s) => s.status === "needsApproval" || s.status === "handoff") ??
      subtasks.find((s) => s.status === "ready" || s.status === "queued" || s.status === "pending");
    const title = current?.title ?? (task.status === "planning" ? "Making a plan" : (task.confirmedGoal ?? task.goal));
    return clip(title);
  }

  private send(task: Task, payload: Payload): void {
    this.deps.bridge
      .sendMessage(task.originDeviceId, "event", payload, undefined, task.id)
      .catch((error: unknown) =>
        this.deps.logger.warn("delegated.sendFailed", { taskId: task.id, kind: payload.kind, ...describeError(error) }),
      );
  }
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim() || "Working on it";
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 3).trimEnd()}...` : flat;
}

/**
 * What the phone says when the goal failed on the Mac: the SPEC-11 copy for the error, without the sentences that
 * point at buttons only the Mac has.
 */
export function failureLine(error: UserError): string {
  switch (error.kind) {
    case "stepFailed":
      return error.step
        ? `I couldn't finish this step: ${error.step}. I stopped there before anything else ran on top of it.`
        : "I couldn't finish a step, so I stopped there before anything else ran on top of it.";
    case "stuckOnScreen":
      return "I'm stuck. I tried a few times but couldn't find what I need on this screen.";
    case "taskTookTooLong":
      return "This is taking longer than it should, so I stopped.";
    case "modelFailedToLoad":
      return "I couldn't start my brain on your Mac. Closing other apps usually helps.";
    case "screenPermissionMissing":
      return "I need permission to see your screen before I can help with this.";
    case "accessibilityPermissionMissing":
      return "I need permission to control your Mac before I can help with this.";
    default:
      return error.lastAction
        ? `Something went wrong and I stopped to be safe. Here's the last thing I did: ${error.lastAction}.`
        : "Something went wrong and I stopped to be safe.";
  }
}
