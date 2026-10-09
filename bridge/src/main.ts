import { loadConfig } from "./config.ts";
import { Relay } from "./relay.ts";

const config = loadConfig();
const relay = new Relay({
  ...config,
  log: (event, fields = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields })),
});

try {
  await relay.start();
  const stop = async (signal: string) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: "relay.stopping", signal }));
    await relay.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
} catch (error) {
  console.error(JSON.stringify({ at: new Date().toISOString(), event: "relay.startFailed", errorType: error instanceof Error ? error.name : "unknown" }));
  await relay.close();
  process.exitCode = 1;
}
