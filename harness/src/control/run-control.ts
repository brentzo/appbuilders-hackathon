import type { Lane, Uuid } from "@yumi/protocol/types";

/**
 * The pause state of one task's run (SPEC-06 r1, r2, r4, OBJ-38.5). Every step loop checks `mayAct` right before
 * it writes and sends an action, so nothing is sent once a pause covers its lane. There is one pause path with two
 * scopes:
 *
 * - `everyLane` (the stop shortcut, the menu bar "Stop", the blocked-action "Stop") and cancel stop the whole run:
 *   `signal` aborts, and every subtask's signal with it.
 * - `uiLanes` (the user took the mouse or keyboard) stops only the ghost and main lanes: each of their subtasks'
 *   signals aborts, helpers keep running, and nothing new starts on a UI lane until `resumeUiLanes`.
 *
 * While any pause holds, no lane asks the user anything: a helper that needs an approval waits for the resume
 * (`untilMayAsk`), because a pause cancels every pending approval (SPEC-06 r5).
 */

/** The lanes that act in an app's UI. Helpers have no window (SPEC-03 r2). */
export const UI_LANES: readonly Lane[] = ["ghost", "main"];

export function isUiLane(lane: Lane): boolean {
  return UI_LANES.includes(lane);
}

/** Why a whole run stopped. */
export type RunStop = "paused" | "cancelled";

interface RunningSubtask {
  lane: Lane;
  controller: AbortController;
}

export class RunControl {
  private readonly controller = new AbortController();
  private readonly subtasks = new Map<Uuid, RunningSubtask>();
  private readonly waiting = new Set<Uuid>();
  private uiPaused = false;
  private stopReason: RunStop | undefined;
  private waiters: (() => void)[] = [];

  /** Aborts when the whole run stops: a pause of every lane, a cancel, or the harness shutting down. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Why the whole run stopped, once it did. */
  get stopped(): RunStop | undefined {
    return this.stopReason;
  }

  /** True while the user has taken over: the UI lanes are paused and helpers run on. */
  get uiLanesPaused(): boolean {
    return this.uiPaused;
  }

  /**
   * The check before every action (SPEC-06 r4): false once a pause covers this lane or the run stopped. A step loop
   * that gets false sends nothing and returns.
   */
  mayAct(lane: Lane): boolean {
    return !this.controller.signal.aborted && !(this.uiPaused && isUiLane(lane));
  }

  /**
   * True when a lane may ask the user something: nothing is paused at all. Pausing cancels every pending approval,
   * so nothing asks again until the user resumes (SPEC-06 r5).
   */
  mayAsk(): boolean {
    return !this.controller.signal.aborted && !this.uiPaused;
  }

  /**
   * A subtask starts working on its lane. Returns the signal that stops it: the run's, plus the UI pause for a UI
   * lane. A UI subtask that starts while the UI lanes are paused gets a signal that has already aborted.
   */
  enter(subtaskId: Uuid, lane: Lane): AbortSignal {
    const controller = new AbortController();
    this.subtasks.set(subtaskId, { lane, controller });
    if (this.uiPaused && isUiLane(lane)) controller.abort();
    return AbortSignal.any([this.controller.signal, controller.signal]);
  }

  /** The subtask stopped working, for any reason. */
  leave(subtaskId: Uuid): void {
    this.subtasks.delete(subtaskId);
    this.waiting.delete(subtaskId);
  }

  /** Stops one obsolete subtask while the rest of the revised task carries on. */
  cancelSubtask(subtaskId: Uuid): void {
    this.subtasks.get(subtaskId)?.controller.abort();
    this.wake();
  }

  /** Marks a subtask as waiting for the user (an approval card or the blocked-action card), or done waiting. */
  setWaiting(subtaskId: Uuid, waiting: boolean): void {
    if (waiting) this.waiting.add(subtaskId);
    else this.waiting.delete(subtaskId);
  }

  /** How many subtasks wait for the user. The task is `waitingForUser` while this is above 0. */
  get waitingCount(): number {
    return this.waiting.size;
  }

  /** True when a ghost or main subtask is working and not waiting for the user: a UI lane is acting (SPEC-06 r2). */
  uiLaneActing(): boolean {
    return [...this.subtasks].some(([id, subtask]) => isUiLane(subtask.lane) && !this.waiting.has(id));
  }

  /** Stops the whole run: every lane, helpers included. */
  stop(reason: RunStop): void {
    this.stopReason ??= reason;
    this.controller.abort();
    this.wake();
  }

  /** Pauses the ghost and main lanes: each UI subtask stops before its next action. Helpers keep running. */
  pauseUiLanes(): void {
    this.uiPaused = true;
    for (const subtask of this.subtasks.values()) if (isUiLane(subtask.lane)) subtask.controller.abort();
    this.wake();
  }

  /** Lifts a UI-lanes pause, so the UI subtasks it stopped start again and lanes may ask the user again. */
  resumeUiLanes(): void {
    this.uiPaused = false;
    this.wake();
  }

  /** Resolves on the next pause, resume, or stop. The scheduler waits on it while UI subtasks are held. */
  changed(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Waits until lanes may ask the user again, for a helper that needs an approval while the UI lanes are paused.
   * Resolves false when `signal` aborts first.
   */
  async untilMayAsk(signal: AbortSignal): Promise<boolean> {
    while (!this.mayAsk()) {
      if (signal.aborted) return false;
      await Promise.race([this.changed(), aborted(signal)]);
    }
    return !signal.aborted;
  }

  private wake(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}

/** Resolves when `signal` aborts. */
export function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
