import type { Lane, RouteDecided, RouteReason, Subtask, Target, WindowLock } from "@yumi/protocol/types";
import type { Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { isBackgroundCapable, ProbeFailure, type AppCapabilities, type AppResolver } from "./capability.ts";
import type { WindowCoordinator } from "./windows.ts";

/**
 * The lane router (SPEC-03, docs/lane-router.md). The planner only proposes a lane; the router checks what the target
 * app actually supports and picks the cheapest lane that passes every check, because a small model guesses wrong.
 * Every decision is stored on the subtask and sent to the dashboard as a `routeDecided` event (SPEC-03 r10).
 *
 * Checks, in order:
 * 0. The app is the subtask's `target`, or the planner's `targetApp`, with a name resolved through the Mac app.
 * 1. No target app: `helper`, reason `noUI` (SPEC-03 r2).
 * 2. The planner marked the subtask as needing the keyboard: `main`, reason `needsKeyboard`, because only `main`
 *    sends keystrokes (SPEC-03 r7 and r17). The app is not probed.
 * 3. The target app is background-capable (an actionable accessibility tree or the DevTools protocol): `ghost`,
 *    reason `backgroundCapable`. Otherwise `main`, reason `appNotBackgroundCapable`, which always accepts work
 *    (SPEC-03 r1 and r3).
 * 4. A ghost or main subtask claims a cursor and a window (`WindowCoordinator`, OBJ-08): it gets a locked window,
 *    or a new window of the app with reason `openedSecondWindow`, or it is queued with reason `atCapacity` (the
 *    cursor cap) or `windowLocked` (a busy window the app cannot open a second one of). A queued decision is stored
 *    and sent like any other, and the caller routes again once `queued.wait` resolves.
 *
 * Ghost handoff comes in OBJ-09.
 */

export interface RouteDecision {
  lane: Lane;
  /** Why this lane, for the dashboard and the log. */
  reason: RouteReason;
  /** The window lock held for a ghost or main subtask. */
  lock?: WindowLock;
  /** The app and window a ghost or main subtask works in, also stored on the subtask. */
  target?: Target;
  /**
   * Set when the subtask cannot start yet (reason `atCapacity` or `windowLocked`). Nothing is held. `wait` resolves
   * when there may be room, or when `signal` aborts; then route again.
   */
  queued?: { wait(signal?: AbortSignal): Promise<void> };
  /** Gives back the cursor and window lock a started subtask holds. Call it when its run ends; safe to call twice. */
  release?: () => void;
}

export interface LaneRouterOptions {
  store: TaskStore;
  capabilities: AppCapabilities;
  /** Resolves a planned subtask's app name to a bundle id (`TargetApp.name`). Without it, names cannot be routed. */
  resolveApp?: AppResolver;
  /** Cursors and window locks. Without it, ghost and main subtasks are routed without a window or a lock. */
  windows?: WindowCoordinator;
  /** Sends the decision to the apps, for example `server.emit("routeDecided", decided)`. */
  emit: (event: "routeDecided", payload: RouteDecided) => void;
  logger: Logger;
}

export class LaneRouter {
  constructor(private readonly options: LaneRouterOptions) {}

  /** Stops the window coordinator's timers. */
  close(): void {
    this.options.windows?.close();
  }

  /**
   * Picks the lane for a subtask, stores the lane and its reason on the subtask, and emits `routeDecided`.
   * Rejects with `ProbeFailure` (carrying the SPEC-11 `UserError`) when the target app's capability cannot be
   * learned; nothing is stored or emitted then.
   */
  async route(subtask: Subtask, proposed: Lane): Promise<RouteDecision> {
    const { store, emit, logger } = this.options;
    const bundleId = await this.bundleIdOf(subtask);
    const decision = await this.claim(subtask, bundleId, await this.decide(subtask, bundleId));
    // The app the planner named, resolved, and the window the subtask got, so the lane knows where to work.
    const target = decision.target ?? (bundleId !== undefined && !subtask.target ? { bundleId } : undefined);
    store.updateSubtask(subtask.id, { lane: decision.lane, routeReason: decision.reason, ...(target ? { target } : {}) });
    logger.info("router.decided", {
      taskId: subtask.taskId,
      subtaskId: subtask.id,
      ...(bundleId !== undefined ? { bundleId } : {}),
      proposed,
      lane: decision.lane,
      reason: decision.reason,
      ...(decision.target?.windowId !== undefined ? { windowId: decision.target.windowId } : {}),
      ...(decision.queued ? { queued: true } : {}),
    });
    emit("routeDecided", { taskId: subtask.taskId, subtaskId: subtask.id, lane: decision.lane, reason: decision.reason });
    return decision;
  }

  /**
   * The bundle id of the app the subtask works in: its resolved `target`, else the planner's `targetApp`, resolving a
   * name through the Mac app. Undefined when the subtask names no app. Rejects with `ProbeFailure` when the name
   * matches no installed app (`unsupportedRequest`, as the probe answers for an app that is not installed).
   */
  private async bundleIdOf(subtask: Subtask): Promise<string | undefined> {
    if (subtask.target) return subtask.target.bundleId;
    const app = subtask.targetApp;
    if (!app) return undefined;
    if (app.bundleId !== undefined) return app.bundleId;
    const name = app.name!;
    if (!this.options.resolveApp) throw new ProbeFailure(name, { kind: "unexpected" });
    const bundleId = await this.options.resolveApp(name);
    if (bundleId === undefined) {
      this.options.logger.warn("router.appNotFound", { taskId: subtask.taskId, subtaskId: subtask.id });
      throw new ProbeFailure(name, { kind: "unsupportedRequest" });
    }
    return bundleId;
  }

  /** A ghost or main subtask's cursor and window (check 4). */
  private async claim(subtask: Subtask, bundleId: string | undefined, decision: RouteDecision): Promise<RouteDecision> {
    const windows = this.options.windows;
    if (!windows || bundleId === undefined || decision.lane === "helper") return decision;
    const claim = await windows.claim(subtask, decision.lane, bundleId);
    if (!claim.granted) return { lane: decision.lane, reason: claim.reason, queued: { wait: claim.wait } };
    return {
      lane: decision.lane,
      reason: claim.reason ?? decision.reason,
      target: claim.target,
      ...(claim.lock ? { lock: claim.lock } : {}),
      release: () => claim.hold.release(),
    };
  }

  private async decide(subtask: Subtask, bundleId: string | undefined): Promise<RouteDecision> {
    if (bundleId === undefined) return { lane: "helper", reason: "noUI" };
    if (subtask.needsKeyboard) return { lane: "main", reason: "needsKeyboard" };
    const capability = await this.options.capabilities.capabilityOf(bundleId);
    return isBackgroundCapable(capability)
      ? { lane: "ghost", reason: "backgroundCapable" }
      : { lane: "main", reason: "appNotBackgroundCapable" };
  }
}
