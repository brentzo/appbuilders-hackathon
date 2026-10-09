import type { Handler } from "@yumi/protocol";
import { DEFAULT_LIMITS, type HarnessConfig } from "./config.ts";
import { describeError, type Logger } from "./log.ts";
import { historyHandlers } from "./rpc/history.ts";
import { taskControlHandlers } from "./rpc/tasks.ts";
import { createLaneRouter, type LaneRouter } from "./router/index.ts";
import { HarnessRpcServer } from "./rpc/server.ts";
import { routeWith } from "./scheduler/lanes.ts";
import { recoverAfterRestart, type Recovery } from "./scheduler/recovery.ts";
import { localVoice, type RunTaskDeps } from "./scheduler/run-task.ts";
import { TaskControl } from "./scheduler/task-control.ts";
import { TaskStore } from "./store/task-store.ts";

/** The running harness's parts, wired together. */
export interface Harness {
  store: TaskStore;
  server: HarnessRpcServer;
  /** The lane router (OBJ-07), created once and shared by every task. */
  router: LaneRouter;
  /** Starts, resumes, and cancels tasks (OBJ-06). */
  tasks: TaskControl;
  /** What startup recovery found: tasks a restart cut off, and steps it finished as noEffect. */
  recovery: Recovery;
  close(): Promise<void>;
}

/**
 * What running tasks needs beyond what the harness makes itself (the store, the lane router, the voice on the local
 * socket, and the limits from the configuration). Tests may replace the route and the voice.
 */
export type HarnessWork = Omit<RunTaskDeps, "store" | "route" | "voice" | "limits"> &
  Partial<Pick<RunTaskDeps, "route" | "voice">>;

/** Extra parts wired into the RPC server, such as the Mac bridge client's methods. */
export interface HarnessOptions {
  /** More RPC methods, added to the history methods. A name used by both is a bug and is refused. */
  handlers?: Record<string, Handler>;
  /** Called when an app has said hello. */
  onReady?: () => void;
  /** The model, lanes, and device for running tasks. Without it, tasks can be cancelled but not started or resumed. */
  work?: HarnessWork;
}

/**
 * Opens the task store in the support folder and recovers what a restart cut off (OBJ-06), starts the local RPC
 * server with the history and task methods, and sends every task and subtask status change to the connected apps
 * as a `taskStatusChanged` event. Each time an app says hello, it gets one `interruptedTaskFound` per task a
 * restart cut off that the user has not answered about yet.
 */
export async function startHarness(
  config: Pick<HarnessConfig, "supportDir" | "socketPath"> & Partial<Pick<HarnessConfig, "limits">>,
  logger: Logger,
  options: HarnessOptions = {},
): Promise<Harness> {
  const limits = config.limits ?? DEFAULT_LIMITS;
  const store = TaskStore.open({ dir: config.supportDir, logger, maxSubtaskDepth: limits.subtaskDepth });
  try {
    // Before the server starts, so no app can ask about a task while its records are being repaired.
    const recovery = recoverAfterRestart(store, logger);
    if (recovery.interrupted.length > 0 || recovery.steps > 0) logger.info("recovery.done", { ...recovery });
    // The task methods need the server's voice and the router, which need the server: they are wired just below,
    // before any message can arrive.
    // eslint-disable-next-line prefer-const
    let tasks: TaskControl | undefined;
    const ownHandlers = {
      ...historyHandlers(store, logger),
      ...taskControlHandlers(() => tasks!, store),
    };
    const clash = Object.keys(options.handlers ?? {}).filter((name) => name in ownHandlers);
    if (clash.length > 0) throw new Error(`RPC methods registered twice: ${clash.join(", ")}`);
    const server: HarnessRpcServer = await HarnessRpcServer.start({
      socketPath: config.socketPath,
      logger,
      handlers: { ...ownHandlers, ...options.handlers },
      onReady: () => {
        options.onReady?.();
        // After the hello answer is written, so the app knows the harness before it hears about a task.
        setImmediate(() => announceInterrupted(store, server, logger));
      },
    });
    store.onStatusChanged((event) => server.emit("taskStatusChanged", event));
    const router = createLaneRouter({ store, server, logger });
    const work = options.work;
    tasks = new TaskControl(
      store,
      logger,
      work && {
        ...work,
        store,
        limits,
        route: work.route ?? routeWith(router),
        voice: work.voice ?? localVoice(server, logger, work.deviceId),
      },
    );
    const control = tasks;
    return {
      store,
      server,
      router,
      tasks: control,
      recovery,
      close: async () => {
        await control.close();
        await server.close();
        store.close();
      },
    };
  } catch (error) {
    store.close();
    throw error;
  }
}

/**
 * Asks the app about every task a restart cut off (SPEC-02 "Resume after the app crashes"): the app says "I was
 * interrupted while working on your task. Want me to pick up where I left off?" and calls `resumeTask` or
 * `cancelTask` with the answer. A task the user paused is not announced; the app lists it with a Resume button.
 */
function announceInterrupted(store: TaskStore, server: HarnessRpcServer, logger: Logger): void {
  try {
    for (const task of store.listInterruptedTasks()) {
      server.emit("interruptedTaskFound", { taskId: task.id });
      logger.info("recovery.announced", { taskId: task.id });
    }
  } catch (error) {
    // The store closed while the app said hello: the harness is shutting down, and the next start announces it.
    logger.warn("recovery.announceFailed", describeError(error));
  }
}
