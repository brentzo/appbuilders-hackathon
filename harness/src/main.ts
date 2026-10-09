// Starts the harness: the log file, the task store, and the local RPC server the Mac app connects to.
// Run: npm start (configuration from environment variables, see src/config.ts).
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { BridgeClient } from "./bridge-client/client.ts";
import { describeError, FileLogger } from "./log.ts";
import { startHarness } from "./harness.ts";
import { ModelClient } from "./model/client.ts";
import { fileHelperLane } from "./scheduler/lanes.ts";

/**
 * This Mac in task records and the action log: the `originDeviceId` the Mac app sends with `submitGoal`
 * (`mac/Yumi/Harness/HarnessLink.swift`), so a goal spoken here is known to be from here.
 */
const MAC_DEVICE_ID = "mac-local";

const config = loadConfig();
const logger = new FileLogger(config.logPath);
logger.info("harness.starting", {
  pid: process.pid,
  socketPath: config.socketPath,
  model: config.model.model,
  modelBaseUrl: config.model.baseUrl,
});

try {
  const bridge = new BridgeClient({
    bridgeUrl: process.env.YUMI_BRIDGE_URL || "wss://yumibridge.studiokova.co",
    deviceName: hostname(),
    databasePath: join(config.supportDir, "bridge.sqlite"),
    onLog: (event) => logger.warn(`bridge.${event}`),
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
    work: {
      client: new ModelClient(config.model, logger),
      logger,
      deviceId: MAC_DEVICE_ID,
      home,
      lanes: { helper: fileHelperLane({ home, logger }) },
      slots: config.model.parallelSlots,
    },
    onReady: () => {
      void bridge.start().catch((error: unknown) => logger.error("bridge.startFailed", { error: String(error) }));
    },
  });
  console.log(`Yumi harness listening on ${config.socketPath}. Tasks: ${harness.store.dbPath}. Log: ${config.logPath}`);
  const stop = async (signal: string) => {
    logger.info("harness.stopping", { signal });
    bridge.stop();
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
