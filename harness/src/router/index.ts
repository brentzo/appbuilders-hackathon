import type { Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { AppCapabilities, macAppProbe, type InstalledVersion, type MacAppCaller } from "./capability.ts";
import { LaneRouter } from "./router.ts";

export { AppCapabilities, isBackgroundCapable, macAppProbe, ProbeFailure } from "./capability.ts";
export type { CapabilityProbe, InstalledVersion, MacAppCaller } from "./capability.ts";
export { KEYSTROKE_ACTIONS, LANE_ACTIONS, LANE_COST, laneAllows } from "./lanes.ts";
export { LaneRouter, type RouteDecision } from "./router.ts";

/**
 * The router for the running harness: it probes apps through the connected Mac app, caches the results in the task
 * store, and sends every decision to the apps. Pass the harness's store and RPC server.
 */
export function createLaneRouter(deps: {
  store: TaskStore;
  server: MacAppCaller & { emit(event: string, payload: unknown): unknown };
  logger: Logger;
  installedVersion?: InstalledVersion;
}): LaneRouter {
  const { store, server, logger, installedVersion } = deps;
  const capabilities = new AppCapabilities({
    store,
    probe: macAppProbe(server, logger),
    logger,
    ...(installedVersion ? { installedVersion } : {}),
  });
  return new LaneRouter({ store, capabilities, logger, emit: (event, payload) => server.emit(event, payload) });
}
