import type { Lane, RouteDecided, RouteReason, Subtask, WindowLock } from "@yumi/protocol/types";
import type { Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { isBackgroundCapable, type AppCapabilities } from "./capability.ts";

/**
 * The lane router (SPEC-03, docs/lane-router.md). The planner only proposes a lane; the router checks what the target
 * app actually supports and picks the cheapest lane that passes every check, because a small model guesses wrong.
 * Every decision is stored on the subtask and sent to the dashboard as a `routeDecided` event (SPEC-03 r10).
 *
 * Checks, in order:
 * 1. No target app: `helper`, reason `noUI` (SPEC-03 r2).
 * 2. The target app is background-capable (an actionable accessibility tree or the DevTools protocol): `ghost`,
 *    reason `backgroundCapable`. Otherwise `main`, reason `appNotBackgroundCapable`, which always accepts work
 *    (SPEC-03 r1 and r3).
 *
 * Window locks, busy windows, and the cursor cap come in OBJ-08; ghost handoff in OBJ-09.
 */

export interface RouteDecision {
  lane: Lane;
  /** Why this lane, for the dashboard and the log. */
  reason: RouteReason;
  /** The window lock held for a ghost or main subtask. Set once locks exist (OBJ-08). */
  lock?: WindowLock;
}

export interface LaneRouterOptions {
  store: TaskStore;
  capabilities: AppCapabilities;
  /** Sends the decision to the apps, for example `server.emit("routeDecided", decided)`. */
  emit: (event: "routeDecided", payload: RouteDecided) => void;
  logger: Logger;
}

export class LaneRouter {
  constructor(private readonly options: LaneRouterOptions) {}

  /**
   * Picks the lane for a subtask, stores the lane and its reason on the subtask, and emits `routeDecided`.
   * Rejects with `ProbeFailure` (carrying the SPEC-11 `UserError`) when the target app's capability cannot be
   * learned; nothing is stored or emitted then.
   */
  async route(subtask: Subtask, proposed: Lane): Promise<RouteDecision> {
    const { store, emit, logger } = this.options;
    const decision = await this.decide(subtask);
    store.updateSubtask(subtask.id, { lane: decision.lane, routeReason: decision.reason });
    logger.info("router.decided", {
      taskId: subtask.taskId,
      subtaskId: subtask.id,
      ...(subtask.target ? { bundleId: subtask.target.bundleId } : {}),
      proposed,
      lane: decision.lane,
      reason: decision.reason,
    });
    emit("routeDecided", { taskId: subtask.taskId, subtaskId: subtask.id, lane: decision.lane, reason: decision.reason });
    return decision;
  }

  private async decide(subtask: Subtask): Promise<RouteDecision> {
    if (!subtask.target) return { lane: "helper", reason: "noUI" };
    const capability = await this.options.capabilities.capabilityOf(subtask.target.bundleId);
    return isBackgroundCapable(capability)
      ? { lane: "ghost", reason: "backgroundCapable" }
      : { lane: "main", reason: "appNotBackgroundCapable" };
  }
}
