import type { Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { AppCapabilities, macAppProbe, macAppResolve, macAppVersion, type MacAppCaller } from "./capability.ts";
import { LaneRouter } from "./router.ts";
import type { WindowCoordinatorOptions } from "./windows.ts";
import { macAppWindows, WindowCoordinator } from "./windows.ts";

export { AppCapabilities, isBackgroundCapable, macAppProbe, macAppResolve, macAppVersion, ProbeFailure } from "./capability.ts";
export type { AppResolver, CapabilityProbe, InstalledVersion, MacAppCaller } from "./capability.ts";
export { KEYSTROKE_ACTIONS, LANE_ACTIONS, LANE_COST, laneAllows } from "./lanes.ts";
export { LaneRouter, type RouteDecision } from "./router.ts";
export { LOCK_TTL_MS, macAppWindows, WAIT_NOTICE_MS, WindowCoordinator } from "./windows.ts";
export type { CursorClaim, CursorHold, WindowCoordinatorOptions, WindowSource } from "./windows.ts";

/**
 * The router for the running harness: it reads app versions and probes apps through the connected Mac app, caches
 * the results in the task store per app version, locks windows through the Mac app's window list, and sends every
 * decision, the waiting notice, and tiling suggestions to the apps. Pass the harness's store and RPC server.
 */
export function createLaneRouter(deps: {
  store: TaskStore;
  server: MacAppCaller & { emit(event: string, payload: unknown): unknown };
  logger: Logger;
  /** `HarnessConfig.cursorCap`. */
  cursorCap?: number;
  /** For tests: the window coordinator's lock lifetime and waiting notice delay. */
  windows?: Pick<WindowCoordinatorOptions, "lockTtlMs" | "waitNoticeMs">;
}): LaneRouter {
  const { store, server, logger } = deps;
  const windows = new WindowCoordinator({
    store,
    windows: macAppWindows(server, logger),
    emit: (event: string, payload: unknown) => server.emit(event, payload),
    logger,
    ...(deps.cursorCap !== undefined ? { cursorCap: deps.cursorCap } : {}),
    ...deps.windows,
  });
  const capabilities = new AppCapabilities({
    store,
    probe: macAppProbe(server, logger),
    installedVersion: macAppVersion(server, logger),
    logger,
  });
  return new LaneRouter({
    store,
    capabilities,
    resolveApp: macAppResolve(server, logger),
    windows,
    logger,
    emit: (event, payload) => server.emit(event, payload),
  });
}
