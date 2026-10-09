// Starts the harness: the log file, the task store, and the local RPC server the Mac app connects to.
// Run: npm start (configuration from environment variables, see src/config.ts).
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { BridgeClient } from "./bridge-client/client.ts";
import { LEGACY_MAC_DEVICE_ID, wakeAddresses } from "./device.ts";
import { DebugLog } from "./debug/debug-log.ts";
import { describeError, FileLogger } from "./log.ts";
import { startHarness } from "./harness.ts";
import { ModelClient } from "./model/client.ts";
import { ModelReadiness } from "./model/readiness.ts";
import { fileHelperLane } from "./scheduler/lanes.ts";

const config = loadConfig();
const logger = new FileLogger(config.logPath);
logger.info("harness.starting", {
  pid: process.pid,
  socketPath: config.socketPath,
  model: config.model.model,
  modelBaseUrl: config.model.baseUrl,
  debugMode: config.debugMode,
});
// Shared by the model client and the harness, so `setDebugMode` turns every part of the debug log on or off.
const debug = new DebugLog({ dir: config.debugLogDir, enabled: config.debugMode, logger });
// Whether the model server answers with the configured model, for the Mac app's status line (OBJ-47).
const model = new ModelReadiness({ config: config.model, logger, loadTimeoutMs: config.modelLoadTimeoutMs });

try {
  const bridge = new BridgeClient({
    bridgeUrl: process.env.YUMI_BRIDGE_URL || "wss://yumibridge.studiokova.co",
    deviceName: hostname(),
    databasePath: join(config.supportDir, "bridge.sqlite"),
    onLog: (event) => logger.warn(`bridge.${event}`),
    // Goals, pause, resume, and cancel, tool lists and results, and approval answers from the paired phone (SPEC-09).
    onMessage: (message, peer, type, replyTo) => harness.delegated?.handle(message, peer, type, replyTo),
    // Each paired device gets this Mac's tool list, with its wake addresses, on every connection (SPEC-09 r1, r19).
    onConnected: () => harness.phoneTools?.connected(),
    // A phone call or approval request the relay could not deliver fails at once (SPEC-09 r16).
    onUndelivered: (messageId, reason) => {
      harness.phoneTools?.undelivered(messageId, reason);
      harness.phoneApprovals?.undelivered(messageId, reason);
    },
    rpc: {
      request: (method, params) => harness.server.request(method, params),
      notify: (event, payload) => {
        harness.server.emit(event, payload);
      },
    },
  });
  const home = homedir();
  const harness = await startHarness(config, logger, {
    handlers: bridge.handlers,
    phone: bridge,
    deviceId: () => bridge.deviceId,
    wakeAddresses: () => wakeAddresses(),
    work: {
      client: new ModelClient(config.model, logger, fetch, debug, (failure) => model.noteFailure(failure)),
      logger,
      // Until the bridge client has loaded this Mac's keys.
      deviceId: LEGACY_MAC_DEVICE_ID,
      home,
      lanes: { helper: fileHelperLane({ home, logger }) },
      slots: config.model.parallelSlots,
    },
    debug,
    model,
    onReady: () => {
      void bridge.start().catch((error: unknown) => logger.error("bridge.startFailed", { error: String(error) }));
    },
  });
  model.start();
  console.log(
    `Yumi harness listening on ${config.socketPath}. Tasks: ${harness.store.dbPath}. Log: ${config.logPath}. ` +
      `Debug log (${debug.enabled ? "on" : "off"}): ${config.debugLogDir}`,
  );
  const stop = async (signal: string) => {
    logger.info("harness.stopping", { signal });
    bridge.stop();
    model.stop();
    await harness.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
} catch (error) {
  logger.error("harness.startFailed", describeError(error));
  console.error(`Yumi harness could not start. Details are in ${config.logPath}`);
  process.exit(1);
}
