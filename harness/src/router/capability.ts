import { RpcErrorCode, RpcRemoteError, validate } from "@yumi/protocol";
import type { AppCapability, ProbeAppCapabilityParams, UserError } from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";

/**
 * What a target app supports for background control (SPEC-03 r3 and r4), probed through the Mac app's
 * `probeAppCapability` and cached in the task store per app bundle id and version.
 */

/** Asks the Mac app what an app supports. Throws `ProbeFailure` when it cannot answer. */
export type CapabilityProbe = (bundleId: string) => Promise<AppCapability>;

/**
 * The installed version of an app, in the same format the probe reports as `appVersion`, without probing it.
 * Undefined when the version cannot be read.
 */
export type InstalledVersion = (bundleId: string) => Promise<string | undefined>;

/** The probe failed. `userError` is the SPEC-11 error for it; the detail is in the log. Nothing is cached. */
export class ProbeFailure extends Error {
  constructor(
    readonly bundleId: string,
    readonly userError: UserError,
  ) {
    super(`Could not probe ${bundleId}: ${userError.kind}`);
    this.name = "ProbeFailure";
  }
}

/** Something that can call a method on the Mac app, such as `HarnessRpcServer`. */
export interface MacAppCaller {
  request(method: string, params: unknown): Promise<unknown>;
}

/**
 * The probe through the Mac app. A failure the app reports keeps its `UserError` (for example
 * `accessibilityPermissionMissing`). Anything else, such as no app connected or a broken answer, is `unexpected`.
 */
export function macAppProbe(app: MacAppCaller, logger: Logger): CapabilityProbe {
  return async (bundleId) => {
    const params: ProbeAppCapabilityParams = { bundleId };
    let result: unknown;
    try {
      result = await app.request("probeAppCapability", params);
    } catch (error) {
      const reported = reportedUserError(error);
      logger.warn("router.probeFailed", { bundleId, ...(reported ? { kind: reported.kind } : {}), ...describeError(error) });
      throw new ProbeFailure(bundleId, reported ?? { kind: "unexpected" });
    }
    const capability = result as AppCapability;
    if (capability.bundleId !== bundleId) {
      // Caching it would file one app's capability under another's name.
      logger.warn("router.probeWrongApp", { bundleId, answeredFor: capability.bundleId });
      throw new ProbeFailure(bundleId, { kind: "unexpected" });
    }
    return capability;
  };
}

/** The UserError in a `-32000` reply, the only error reply whose data is meant for the user. */
function reportedUserError(error: unknown): UserError | undefined {
  if (!(error instanceof RpcRemoteError) || error.error.code !== RpcErrorCode.failed) return undefined;
  return validate("UserError", error.error.data).valid ? (error.error.data as UserError) : undefined;
}

export interface AppCapabilitiesOptions {
  store: TaskStore;
  probe: CapabilityProbe;
  logger: Logger;
  /**
   * Reads an app's installed version without probing it. With it, a stored result is reused across restarts and the
   * app is probed again only when its version changes. Without it, each app is probed once per harness run, because
   * only the probe reports the version.
   */
  installedVersion?: InstalledVersion;
}

/** The capability cache. The router asks it; it probes only when it has no result for the app's current version. */
export class AppCapabilities {
  /** The newest result per app in this run. */
  private readonly known = new Map<string, AppCapability>();
  /** Probes in flight, so two subtasks routed at once for the same app probe it once. */
  private readonly probing = new Map<string, Promise<AppCapability>>();

  constructor(private readonly options: AppCapabilitiesOptions) {}

  async capabilityOf(bundleId: string): Promise<AppCapability> {
    const cached = await this.cached(bundleId);
    if (cached) return cached;
    const inFlight = this.probing.get(bundleId);
    if (inFlight) return inFlight;
    const probe = this.probeAndStore(bundleId).finally(() => this.probing.delete(bundleId));
    this.probing.set(bundleId, probe);
    return probe;
  }

  private async cached(bundleId: string): Promise<AppCapability | undefined> {
    const { installedVersion, store, logger } = this.options;
    if (!installedVersion) return this.known.get(bundleId);
    const version = await installedVersion(bundleId);
    if (version === undefined) return undefined;
    const stored = store.getAppCapability(bundleId, version);
    if (stored) logger.info("router.capabilityCached", { bundleId, appVersion: version });
    return stored;
  }

  private async probeAndStore(bundleId: string): Promise<AppCapability> {
    const { probe, store, logger } = this.options;
    const capability = await probe(bundleId);
    store.putAppCapability(capability);
    this.known.set(bundleId, capability);
    logger.info("router.probed", {
      bundleId,
      appVersion: capability.appVersion,
      accessibility: capability.accessibility,
      devtools: capability.devtools,
    });
    return capability;
  }
}

/** An app can be driven in the background through its accessibility tree or the DevTools protocol (SPEC-03 r3). */
export function isBackgroundCapable(capability: AppCapability): boolean {
  return capability.accessibility || capability.devtools;
}
