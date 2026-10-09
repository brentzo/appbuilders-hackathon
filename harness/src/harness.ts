import { join } from "node:path";
import { RpcFailure, type Handler } from "@yumi/protocol";
import type { AnswerQuestionParams, Empty, WorkerThought } from "@yumi/protocol/types";
import { ActionLogFile } from "./action-log/text-log.ts";
import { ApprovalFlow } from "./approvals/approval-flow.ts";
import { DEFAULT_LIMITS, type HarnessConfig } from "./config.ts";
import { abandonUnconfirmed, GoalConfirmation } from "./confirm/confirmation.ts";
import { DEBUG_LOG_FOLDER, DebugLog } from "./debug/debug-log.ts";
import type { GuiServices } from "./gui/gui-act.ts";
import { macAppGui } from "./gui/mac.ts";
import { NoQuestionError, QuestionBroker } from "./gui/questions.ts";
import { describeError, type Logger } from "./log.ts";
import { confirmationHandlers } from "./rpc/confirmation.ts";
import { debugHandlers } from "./rpc/debug.ts";
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
  /** Starts, pauses, resumes, and cancels tasks (OBJ-06, OBJ-38). */
  tasks: TaskControl;
  /** Approvals and blocked-action cards (OBJ-38). Absent when the harness cannot run tasks. */
  approvals?: ApprovalFlow;
  /** The action log file (OBJ-38.7). */
  actionLog: ActionLogFile;
  /** Repeats goals back and starts them once the user confirms (OBJ-17). */
  confirmation: GoalConfirmation;
  /** Questions from gui_act to the user, answered through `answerQuestion` (OBJ-36.9). */
  questions: QuestionBroker;
  /** What startup recovery found: tasks a restart cut off, and steps it finished as noEffect. */
  recovery: Recovery;
  /** The detailed debug log, and with it Debug mode (OBJ-52). */
  debug: DebugLog;
  close(): Promise<void>;
}

/**
 * What running tasks needs beyond what the harness makes itself (the store, the lane router, the voice on the local
 * socket, the approval flow, and the limits from the configuration). Tests may replace the route and the voice.
 */
export type HarnessWork = Omit<RunTaskDeps, "store" | "route" | "voice" | "limits" | "approvals" | "gui" | "debug" | "thoughts"> &
  Partial<Pick<RunTaskDeps, "route" | "voice">> & {
    /** Replaces parts of the ghost and main lanes, which by default act through the connected Mac app. */
    gui?: Partial<Omit<GuiServices, "questions">>;
  };

/** Extra parts wired into the RPC server, such as the Mac bridge client's methods. */
export interface HarnessOptions {
  /** More RPC methods, added to the history methods. A name used by both is a bug and is refused. */
  handlers?: Record<string, Handler>;
  /** Called when an app has said hello. */
  onReady?: () => void;
  /** The model, lanes, and device for running tasks. Without it, tasks can be cancelled but not started or resumed. */
  work?: HarnessWork;
  /**
   * The detailed debug log, shared with the model client (OBJ-52). Without it, the harness keeps one in the support
   * folder that starts off, so only `setDebugMode` turns it on.
   */
  debug?: DebugLog;
}

/**
 * Opens the task store in the support folder and recovers what a restart cut off (OBJ-06), starts the local RPC
 * server with the history and task methods, and sends every task and subtask status change to the connected apps
 * as a `taskStatusChanged` event. Each time an app says hello, it gets one `interruptedTaskFound` per task a
 * restart cut off that the user has not answered about yet. Every action log line also goes to the action log file
 * in the support folder (OBJ-38.7). Debug logs older than 7 days are deleted, and `setDebugMode` turns Debug mode on
 * and off (OBJ-52).
 */
export async function startHarness(
  config: Pick<HarnessConfig, "supportDir" | "socketPath"> & Partial<Pick<HarnessConfig, "limits" | "cursorCap">>,
  logger: Logger,
  options: HarnessOptions = {},
): Promise<Harness> {
  const limits = config.limits ?? DEFAULT_LIMITS;
  const debug = options.debug ?? new DebugLog({ dir: join(config.supportDir, DEBUG_LOG_FOLDER), enabled: false, logger });
  debug.deleteOld();
  const store = TaskStore.open({ dir: config.supportDir, logger, maxSubtaskDepth: limits.subtaskDepth });
  // Before recovery, so the lines recovery writes for interrupted steps are in the file too.
  const actionLog = new ActionLogFile({
    supportDir: config.supportDir,
    store,
    logger,
    macDeviceId: () => options.work?.deviceId,
  }).start();
  try {
    // Before the server starts, so no app can ask about a task while its records are being repaired.
    const recovery = recoverAfterRestart(store, logger);
    if (recovery.interrupted.length > 0 || recovery.steps > 0) logger.info("recovery.done", { ...recovery });
    abandonUnconfirmed(store, logger);
    // The task methods need the server's voice and the router, which need the server: they are wired just below,
    // before any message can arrive.
    // eslint-disable-next-line prefer-const
    let tasks: TaskControl | undefined;
    // eslint-disable-next-line prefer-const
    let approvals: ApprovalFlow | undefined;
    // eslint-disable-next-line prefer-const
    let confirmation: GoalConfirmation | undefined;
    // The broker sends through the server, which is created just below, before any question can be asked.
    // eslint-disable-next-line prefer-const
    let server: HarnessRpcServer;
    const questions = new QuestionBroker((payload) => server.emit("questionAsked", payload), logger);
    const ownHandlers = {
      ...historyHandlers(store, logger),
      ...taskControlHandlers(
        () => tasks!,
        store,
        () => approvals,
        logger,
      ),
      ...confirmationHandlers(() => confirmation!),
      answerQuestion: (params: unknown): Empty => {
        try {
          questions.answer(params as AnswerQuestionParams);
        } catch (error) {
          if (!(error instanceof NoQuestionError)) throw error;
          // A late answer, after a pause or cancel dropped the question. The app shows "Unexpected".
          throw new RpcFailure({ kind: "unexpected", taskId: (params as AnswerQuestionParams).taskId }, error.message);
        }
        return {};
      },
      ...debugHandlers(debug),
    };
    const clash = Object.keys(options.handlers ?? {}).filter((name) => name in ownHandlers);
    if (clash.length > 0) throw new Error(`RPC methods registered twice: ${clash.join(", ")}`);
    server = await HarnessRpcServer.start({
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
    const router = createLaneRouter({
      store,
      server,
      logger,
      ...(config.cursorCap !== undefined ? { cursorCap: config.cursorCap } : {}),
    });
    const work = options.work;
    // Each worker's thoughts, for the thoughts panel, only in Debug mode (SPEC-07 r23).
    const thoughts = (thought: WorkerThought) => {
      if (debug.enabled) server.emit("workerThought", thought);
    };
    const voice = work && (work.voice ?? localVoice(server, logger, work.deviceId));
    approvals =
      work &&
      voice &&
      new ApprovalFlow({
        store,
        logger,
        mac: server,
        emit: (event, payload) => server.emit(event, payload),
        userError: (originDeviceId, error) => voice.userError(originDeviceId, error),
        home: work.home,
      });
    tasks = new TaskControl(
      store,
      logger,
      work &&
        voice && {
          ...work,
          store,
          limits,
          route: work.route ?? routeWith(router),
          voice,
          debug,
          thoughts,
          ...(approvals ? { approvals } : {}),
          gui: { mac: macAppGui(server, logger), ...work.gui, questions },
        },
      approvals,
    );
    const control = tasks;
    confirmation = new GoalConfirmation({
      store,
      logger,
      app: server,
      voice: voice ?? localVoice(server, logger),
      tasks: () => control,
      debug,
      ...(work ? { client: work.client } : {}),
    });
    const confirming = confirmation;
    return {
      store,
      server,
      router,
      tasks: control,
      ...(approvals ? { approvals } : {}),
      actionLog,
      confirmation: confirming,
      questions,
      recovery,
      debug,
      close: async () => {
        await confirming.close();
        await control.close();
        router.close();
        await server.close();
        actionLog.stop();
        store.close();
      },
    };
  } catch (error) {
    actionLog.stop();
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
