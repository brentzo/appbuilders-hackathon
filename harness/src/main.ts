// Starts the harness: the log file and the local RPC server the Mac app connects to.
// Run: npm start (configuration from environment variables, see src/config.ts).
import { loadConfig } from "./config.ts";
import { describeError, FileLogger } from "./log.ts";
import { HarnessRpcServer } from "./rpc/server.ts";

const config = loadConfig();
const logger = new FileLogger(config.logPath);
logger.info("harness.starting", {
  pid: process.pid,
  socketPath: config.socketPath,
  model: config.model.model,
  modelBaseUrl: config.model.baseUrl,
});

try {
  const server = await HarnessRpcServer.start({ socketPath: config.socketPath, logger });
  console.log(`Yumi harness listening on ${config.socketPath}. Log: ${config.logPath}`);
  const stop = async (signal: string) => {
    logger.info("harness.stopping", { signal });
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
} catch (error) {
  logger.error("harness.startFailed", describeError(error));
  console.error(`Yumi harness could not start. Details are in ${config.logPath}`);
  process.exit(1);
}
