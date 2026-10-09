import type { Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { AppCapabilities, macAppProbe, macAppVersion, type MacAppCaller } from "./capability.ts";
import { LaneRouter } from "./router.ts";

export { AppCapabilities, isBackgroundCapable, macAppProbe, macAppVersion, ProbeFailure } from "./capability.ts";
export type { CapabilityProbe, InstalledVersion, MacAppCaller } from "./capability.ts";
export { KEYSTROKE_ACTIONS, LANE_ACTIONS, LANE_COST, laneAllows } from "./lanes.ts";
export { LaneRouter, type RouteDecision } from "./router.ts";

/**
 * The router for the running harness: it reads app versions and probes apps through the connected Mac app, caches
 * the results in the task store per app version, and sends every decision to the apps. Pass the harness's store and
 * RPC server.
 */
export function createLaneRouter(deps: {
  store: TaskStore;
  server: MacAppCaller & { emit(event: string, payload: unknown): unknown };
  logger: Logger;
}): LaneRouter {
  const { store, server, logger } = deps;
  const capabilities = new AppCapabilities({
    store,
    probe: macAppProbe(server, logger),
    installedVersion: macAppVersion(server, logger),
    logger,
  });
  return new LaneRouter({ store, capabilities, logger, emit: (event, payload) => server.emit(event, payload) });
}
