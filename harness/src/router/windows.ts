import { RpcErrorCode, RpcRemoteError } from "@yumi/protocol";
import type {
  Lane,
  ListWindowsParams,
  OpenNewWindowParams,
  OpenNewWindowResult,
  Subtask,
  Target,
  TaskStatusChanged,
  TilingSuggested,
  Uuid,
  WaitingForWindow,
  WindowInfo,
  WindowList,
  WindowLock,
} from "@yumi/protocol/types";
import { DEFAULT_CURSOR_CAP } from "../config.ts";
import { describeError, type Logger } from "../log.ts";
import { HOLDS_WINDOW, type TaskStore } from "../store/task-store.ts";
import { ProbeFailure, reportedUserError, type MacAppCaller } from "./capability.ts";

/**
 * Cursors and windows (SPEC-03 r5, r6, r11 to r13, OBJ-08): which window a ghost or main subtask works in, the lock
 * that keeps every other cursor out of it, the cap on visible cursors, and what happens when there is no room.
 *
 * Claiming a cursor, in order:
 * 1. The cursor cap. Every ghost is a cursor and `main` is one more; at most `cursorCap` are visible at once,
 *    including `main`, and there is only one main cursor, so a second main subtask waits for it. Either way the
 *    subtask queues with reason `atCapacity`. This comes before the window, so a subtask with no room never opens a
 *    window it cannot use yet.
 * 2. The window: the one the subtask already worked in, else the app's first window, else a window another subtask
 *    of the same task worked in. The first of those that no other cursor holds is locked in the task store.
 * 3. A busy window: every candidate is held by another cursor, so the Mac app opens a new window of the app
 *    (`openNewWindow`) and the subtask works there, reason `openedSecondWindow`. If the app cannot, the subtask
 *    queues with reason `windowLocked` until a lock is released. After `WAIT_NOTICE_MS` of waiting for a window, the
 *    apps get `waitingForWindow` once, and the Mac app says what Yumi is waiting for. The copy lives in the app.
 * 4. When a task holds more windows at once than it did before, and at least 2, the apps get `tilingSuggested` with
 *    those windows. The Mac app asks before it arranges anything (SPEC-03 r14, OBJ-20).
 *
 * Locks live in the task store with an expiry, and the coordinator renews the locks of its cursors while they work,
 * so a worker that stopped renewing (a crash, a hang) loses its window after `LOCK_TTL_MS`. A lock is released when
 * its subtask stops working (the store releases it in the same transaction as the status change), when the run that
 * claimed it ends, or when it expires. Waiting subtasks are woken by each of those.
 */

/** How long a lock lasts without being renewed. Cursors that are working renew theirs every third of this. */
export const LOCK_TTL_MS = 60_000;

/** How long a subtask waits for a busy window before the user is told (SPEC-03 r13). */
export const WAIT_NOTICE_MS = 2 * 60_000;

/** The Mac app's windows of one app, and opening another one. */
export interface WindowSource {
  /** The app's windows, in the order the app lists them, so the first is its frontmost. */
  list(bundleId: string): Promise<WindowInfo[]>;
  /** Opens a new window of the app (SPEC-03 r11) and returns its id, or undefined when the app cannot. */
  open(bundleId: string): Promise<number | undefined>;
}

/** What a claim holds until its run ends. */
export interface CursorHold {
  readonly lock?: WindowLock;
  /** Gives back the cursor and the window. Safe to call more than once, and after the subtask stopped working. */
  release(): void;
}

export type CursorClaim =
  | {
      granted: true;
      /** The app and window the subtask works in. No `windowId` when the app has no window and cannot open one. */
      target: Target;
      lock?: WindowLock;
      /** Set when the subtask's window was busy and it works in a new one. */
      reason?: "openedSecondWindow";
      hold: CursorHold;
    }
  | {
      granted: false;
      reason: "windowLocked" | "atCapacity";
      /**
       * Resolves when something changed that may make room (a cursor finished, a lock was released or expired), or
       * when `signal` aborts. Then claim again.
       */
      wait(signal?: AbortSignal): Promise<void>;
    };

export interface WindowCoordinatorOptions {
  store: TaskStore;
  windows: WindowSource;
  emit(event: "waitingForWindow", payload: WaitingForWindow): void;
  emit(event: "tilingSuggested", payload: TilingSuggested): void;
  logger: Logger;
  /** Visible cursors, including `main` (`HarnessConfig.cursorCap`). */
  cursorCap?: number;
  lockTtlMs?: number;
  waitNoticeMs?: number;
  /** The clock for lock times; the task store's clock in tests. */
  now?: () => Date;
}

interface Cursor {
  subtaskId: Uuid;
  taskId: Uuid;
  lane: Lane;
  target: Target;
  lock?: WindowLock;
}

/** A subtask waiting for a busy window. Its app could not open another one, so the claim does not ask again. */
interface WindowWait {
  notice: NodeJS.Timeout;
}

export class WindowCoordinator {
  private readonly cursors = new Map<Uuid, Cursor>();
  private readonly waits = new Map<Uuid, WindowWait>();
  /** The most windows suggested for tiling per task, so the app is asked again only when a task uses more. */
  private readonly suggested = new Map<Uuid, number>();
  private readonly wakers = new Set<() => void>();
  private readonly stopListening: () => void;
  private readonly cap: number;
  private readonly ttl: number;
  private readonly noticeAfter: number;
  private readonly now: () => Date;
  private renewing: NodeJS.Timeout | undefined;
  private turn: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: WindowCoordinatorOptions) {
    this.cap = options.cursorCap ?? DEFAULT_CURSOR_CAP;
    if (!Number.isInteger(this.cap) || this.cap < 1) throw new Error(`The cursor cap must be at least 1, got ${this.cap}`);
    this.ttl = options.lockTtlMs ?? LOCK_TTL_MS;
    this.noticeAfter = options.waitNoticeMs ?? WAIT_NOTICE_MS;
    this.now = options.now ?? (() => new Date());
    this.stopListening = options.store.onStatusChanged((event) => this.statusChanged(event));
  }

  /** Visible cursors right now, `main` included. */
  get visibleCursors(): number {
    return this.cursors.size;
  }

  /**
   * Claims a cursor and a window of `bundleId` for a ghost or main subtask. Claims run one at a time, so two
   * subtasks never see the same free window. Rejects with `ProbeFailure` when the Mac app cannot list or open the
   * app's windows; nothing is held then.
   */
  claim(subtask: Subtask, lane: Exclude<Lane, "helper">, bundleId: string): Promise<CursorClaim> {
    const next = this.turn.then(() => this.tryClaim(subtask, lane, bundleId));
    this.turn = next.catch(() => undefined);
    return next;
  }

  /** Stops renewing, waiting, and listening. Locks stay in the store until they expire or a restart releases them. */
  close(): void {
    this.stopListening();
    clearInterval(this.renewing);
    this.renewing = undefined;
    for (const wait of this.waits.values()) clearTimeout(wait.notice);
    this.waits.clear();
    this.wake();
  }

  private async tryClaim(subtask: Subtask, lane: Exclude<Lane, "helper">, bundleId: string): Promise<CursorClaim> {
    const { store, logger } = this.options;
    this.releaseExpired();
    const others = [...this.cursors.values()].filter((cursor) => cursor.subtaskId !== subtask.id);
    if (lane === "main" && others.some((cursor) => cursor.lane === "main")) {
      return this.queued(subtask, "atCapacity", { mainBusy: true });
    }
    if (others.length >= this.cap) return this.queued(subtask, "atCapacity", { visible: others.length });

    const windows = await this.options.windows.list(bundleId);
    const candidates = this.candidates(subtask, bundleId, windows);
    for (const windowId of candidates) {
      const lock = this.lock(subtask, lane, windowId);
      if (lock) return this.grant(subtask, lane, { bundleId, windowId }, lock);
    }
    // Every window is held by another cursor, or the app has none. A wait means the app already could not open one.
    if (candidates.length === 0 || !this.waits.has(subtask.id)) {
      const opened = await this.options.windows.open(bundleId);
      const lock = opened === undefined ? undefined : this.lock(subtask, lane, opened);
      if (lock) {
        const busy = candidates.length > 0;
        return this.grant(subtask, lane, { bundleId, windowId: lock.windowId }, lock, busy ? "openedSecondWindow" : undefined);
      }
    }
    if (candidates.length === 0) {
      // Nothing to lock: the lane opens the app itself. It still counts against the cap.
      logger.warn("windows.noWindow", { taskId: subtask.taskId, subtaskId: subtask.id, bundleId });
      return this.grant(subtask, lane, { bundleId }, undefined);
    }
    const heldBy = store.getWindowLock(candidates[0]!)?.subtaskId;
    const appName = windows.find((window) => window.windowId === candidates[0])?.appName || subtask.targetApp?.name || bundleId;
    return this.queued(subtask, "windowLocked", { bundleId, windowId: candidates[0], heldBy, appName });
  }

  /**
   * The windows a subtask may work in, best first, among the app's windows that still exist: the one it worked in
   * before (a resume), the app's first window, then windows other subtasks of its task worked in, such as one Yumi
   * opened for an earlier subtask.
   */
  private candidates(subtask: Subtask, bundleId: string, windows: readonly WindowInfo[]): number[] {
    const open = new Set(windows.map((window) => window.windowId));
    const ids = [
      subtask.target?.bundleId === bundleId ? subtask.target.windowId : undefined,
      windows[0]?.windowId,
      ...this.options.store
        .listSubtasks(subtask.taskId)
        .map((other) => (other.target?.bundleId === bundleId ? other.target.windowId : undefined)),
    ];
    return [...new Set(ids.filter((id): id is number => id !== undefined && open.has(id)))];
  }

  /** Locks a window for the subtask, unless another cursor holds it. */
  private lock(subtask: Subtask, lane: Lane, windowId: number): WindowLock | undefined {
    const now = this.now();
    const result = this.options.store.acquireWindowLock({
      windowId,
      subtaskId: subtask.id,
      lane,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttl).toISOString(),
    });
    return result.acquired ? result.lock : undefined;
  }

  private grant(
    subtask: Subtask,
    lane: Lane,
    target: Target,
    lock: WindowLock | undefined,
    reason?: "openedSecondWindow",
  ): CursorClaim {
    this.endWait(subtask.id);
    const cursor: Cursor = { subtaskId: subtask.id, taskId: subtask.taskId, lane, target, ...(lock ? { lock } : {}) };
    this.cursors.set(subtask.id, cursor);
    if (lock) this.renew();
    this.options.logger.info("windows.claimed", {
      taskId: subtask.taskId,
      subtaskId: subtask.id,
      lane,
      bundleId: target.bundleId,
      ...(target.windowId !== undefined ? { windowId: target.windowId } : {}),
      ...(reason ? { reason } : {}),
      visible: this.cursors.size,
    });
    this.suggestTiling(subtask.taskId);
    return {
      granted: true,
      target,
      ...(lock ? { lock } : {}),
      ...(reason ? { reason } : {}),
      hold: { ...(lock ? { lock } : {}), release: () => this.release(cursor) },
    };
  }

  private queued(subtask: Subtask, reason: "windowLocked" | "atCapacity", detail: Record<string, unknown>): CursorClaim {
    if (reason === "windowLocked" && !this.waits.has(subtask.id)) {
      const appName = String(detail["appName"]);
      const notice = setTimeout(() => this.notice(subtask, appName), this.noticeAfter);
      notice.unref();
      this.waits.set(subtask.id, { notice });
    }
    this.options.logger.info("windows.queued", { taskId: subtask.taskId, subtaskId: subtask.id, reason, ...detail });
    return { granted: false, reason, wait: (signal) => this.waitForChange(subtask.id, signal) };
  }

  /** The 2-minute notice: once per wait, and only while the subtask still waits for its window. */
  private notice(subtask: Subtask, appName: string): void {
    if (!this.waits.has(subtask.id)) return;
    this.options.logger.info("windows.waitNotice", { taskId: subtask.taskId, subtaskId: subtask.id, appName });
    this.options.emit("waitingForWindow", { taskId: subtask.taskId, subtaskId: subtask.id, appName });
  }

  private endWait(subtaskId: Uuid): void {
    const wait = this.waits.get(subtaskId);
    if (!wait) return;
    clearTimeout(wait.notice);
    this.waits.delete(subtaskId);
  }

  private waitForChange(subtaskId: Uuid, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let expiry: NodeJS.Timeout | undefined;
      const done = () => {
        clearTimeout(expiry);
        signal?.removeEventListener("abort", aborted);
        this.wakers.delete(done);
        resolve();
      };
      // A pause or cancel ends the wait; a later route starts a new one, with a new 2 minutes.
      const aborted = () => {
        this.endWait(subtaskId);
        done();
      };
      if (signal?.aborted) return aborted();
      this.wakers.add(done);
      signal?.addEventListener("abort", aborted, { once: true });
      // Locks no cursor here renews (left by a worker that stopped) free their window when they expire.
      const stale = this.options.store
        .listLiveWindowLocks()
        .filter((lock) => this.cursors.get(lock.subtaskId)?.lock?.windowId !== lock.windowId)
        .map((lock) => Date.parse(lock.expiresAt) - this.now().getTime());
      if (stale.length > 0) {
        expiry = setTimeout(done, Math.max(0, Math.min(...stale)) + 1);
        expiry.unref();
      }
    });
  }

  private wake(): void {
    const wakers = [...this.wakers];
    this.wakers.clear();
    for (const wake of wakers) wake();
  }

  /** Gives back a cursor, if it is still this claim's: a later claim by the same subtask is not touched. */
  private release(cursor: Cursor): void {
    if (this.cursors.get(cursor.subtaskId) !== cursor) return;
    this.cursors.delete(cursor.subtaskId);
    const { store, logger } = this.options;
    const lock = cursor.lock;
    const held = lock && store.getWindowLock(lock.windowId);
    if (lock && held && held.subtaskId === lock.subtaskId && held.acquiredAt === lock.acquiredAt) {
      store.releaseWindowLock(lock.windowId);
    }
    logger.info("windows.released", {
      taskId: cursor.taskId,
      subtaskId: cursor.subtaskId,
      ...(lock ? { windowId: lock.windowId } : {}),
      visible: this.cursors.size,
    });
    this.wake();
  }

  /** A subtask that stops working gives back its cursor; the store has already released its lock. */
  private statusChanged(event: TaskStatusChanged): void {
    if (event.subtaskId === undefined || event.subtaskStatus === undefined) {
      if (["done", "failed", "cancelled"].includes(event.status)) this.suggested.delete(event.taskId);
      return;
    }
    if (HOLDS_WINDOW.includes(event.subtaskStatus)) return;
    if (event.subtaskStatus !== "queued") this.endWait(event.subtaskId);
    const cursor = this.cursors.get(event.subtaskId);
    if (cursor) this.release(cursor);
    else this.wake();
  }

  private releaseExpired(): void {
    for (const lock of this.options.store.releaseExpiredWindowLocks()) {
      // Its worker stopped renewing it without ending its subtask, so the window is free again (SPEC-03 r5).
      this.options.logger.warn("windows.lockExpired", { windowId: lock.windowId, subtaskId: lock.subtaskId });
    }
  }

  /** Keeps the locks of working cursors from expiring, while any are held. */
  private renew(): void {
    if (this.renewing) return;
    this.renewing = setInterval(
      () => {
        const locked = [...this.cursors.values()].filter((cursor) => cursor.lock);
        if (locked.length === 0) {
          clearInterval(this.renewing);
          this.renewing = undefined;
          return;
        }
        const expiresAt = new Date(this.now().getTime() + this.ttl).toISOString();
        for (const cursor of locked) {
          try {
            if (!this.options.store.renewWindowLock(cursor.lock!.windowId, cursor.subtaskId, expiresAt)) {
              this.options.logger.error("windows.lockLost", { subtaskId: cursor.subtaskId, windowId: cursor.lock!.windowId });
            }
          } catch (error) {
            // The store closed while the harness shuts down.
            this.options.logger.warn("windows.renewFailed", { subtaskId: cursor.subtaskId, ...describeError(error) });
          }
        }
      },
      Math.max(1, Math.floor(this.ttl / 3)),
    );
    this.renewing.unref();
  }

  private suggestTiling(taskId: Uuid): void {
    const windows = [...this.cursors.values()]
      .filter((cursor) => cursor.taskId === taskId && cursor.target.windowId !== undefined)
      .map((cursor) => cursor.target);
    if (windows.length < 2 || windows.length <= (this.suggested.get(taskId) ?? 0)) return;
    this.suggested.set(taskId, windows.length);
    this.options.logger.info("windows.tilingSuggested", { taskId, windows: windows.length });
    this.options.emit("tilingSuggested", { taskId, windows });
  }
}

/**
 * The windows through the Mac app's `listWindows` and `openNewWindow`. A failure the app reports keeps its
 * `UserError` (for example `accessibilityPermissionMissing`) as a `ProbeFailure`; anything else is `unexpected`.
 * A Mac app from before `openNewWindow` answers "method not found", which means it cannot open a window.
 */
export function macAppWindows(app: MacAppCaller, logger: Logger): WindowSource {
  const failure = (event: string, bundleId: string, error: unknown) => {
    const reported = reportedUserError(error);
    logger.warn(event, { bundleId, ...(reported ? { kind: reported.kind } : {}), ...describeError(error) });
    return new ProbeFailure(bundleId, reported ?? { kind: "unexpected" });
  };
  return {
    async list(bundleId) {
      const params: ListWindowsParams = { bundleId };
      try {
        const { windows } = (await app.request("listWindows", params)) as WindowList;
        return windows.filter((window) => window.bundleId === bundleId);
      } catch (error) {
        throw failure("windows.listFailed", bundleId, error);
      }
    },
    async open(bundleId) {
      const params: OpenNewWindowParams = { bundleId };
      let result: OpenNewWindowResult;
      try {
        result = (await app.request("openNewWindow", params)) as OpenNewWindowResult;
      } catch (error) {
        if (error instanceof RpcRemoteError && error.error.code === RpcErrorCode.methodNotFound) {
          logger.warn("windows.openNotServed", { bundleId });
          return undefined;
        }
        throw failure("windows.openFailed", bundleId, error);
      }
      if (result.supported && result.windowId === undefined) logger.warn("windows.openedWithoutId", { bundleId });
      logger.info("windows.opened", { bundleId, ...result });
      return result.supported ? result.windowId : undefined;
    },
  };
}
