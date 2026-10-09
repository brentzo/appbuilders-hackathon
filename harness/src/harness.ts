import type { HarnessConfig } from "./config.ts";
import type { Handler } from "@yumi/protocol";
import type { Logger } from "./log.ts";
import { historyHandlers } from "./rpc/history.ts";
import { HarnessRpcServer } from "./rpc/server.ts";
import { TaskStore } from "./store/task-store.ts";

/** The running harness's parts, wired together. */
export interface Harness {
  store: TaskStore;
  server: HarnessRpcServer;
  close(): Promise<void>;
}

/** Extra parts wired into the RPC server, such as the Mac bridge client's methods. */
export interface HarnessOptions {
  /** More RPC methods, added to the history methods. A name used by both is a bug and is refused. */
  handlers?: Record<string, Handler>;
  /** Called when an app has said hello. */
  onReady?: () => void;
}

/**
 * Opens the task store in the support folder, starts the local RPC server with the history methods, and sends every
 * task and subtask status change to the connected apps as a `taskStatusChanged` event.
 */
export async function startHarness(
  config: Pick<HarnessConfig, "supportDir" | "socketPath">,
  logger: Logger,
  options: HarnessOptions = {},
): Promise<Harness> {
  const store = TaskStore.open({ dir: config.supportDir, logger });
  try {
    const history = historyHandlers(store, logger);
    const clash = Object.keys(options.handlers ?? {}).filter((name) => name in history);
    if (clash.length > 0) throw new Error(`RPC methods registered twice: ${clash.join(", ")}`);
    const server = await HarnessRpcServer.start({
      socketPath: config.socketPath,
      logger,
      handlers: { ...history, ...options.handlers },
      ...(options.onReady ? { onReady: options.onReady } : {}),
    });
    store.onStatusChanged((event) => server.emit("taskStatusChanged", event));
    return {
      store,
      server,
      close: async () => {
        await server.close();
        store.close();
      },
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
