import { RpcFailure, type Handler } from "@yumi/protocol";
import type { Empty, PauseParams, ReplyToBlockedActionParams, TaskRef, UserError } from "@yumi/protocol/types";
import type { Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { TaskControl, TaskControlError } from "../scheduler/task-control.ts";

/**
 * The task control methods the Mac app calls: `resumeTask` and `cancelTask` (OBJ-06.3) when the user answers "Want
 * me to pick up where I left off?" or presses Resume or Cancel; `pause` (OBJ-38.5) for the stop shortcut, the menu
 * bar "Stop", and a take-over; and `replyToBlockedAction` (OBJ-38.4) for the blocked-action card. `RpcPeer` checks
 * params and results against the contract. A refused request answers the "Unexpected" kind; the reason is in the log.
 */
export function taskControlHandlers(
  control: () => TaskControl,
  store: TaskStore,
  blocked: () => { keepGoing(stepId: string): boolean } | undefined,
  logger: Logger,
): Record<string, Handler> {
  /** Every task whose work is under way, for a pause with no task id. */
  const working = () => store.listTasksByStatus(["planning", "running", "waitingForUser", "paused"]).map((task) => task.id);
  return {
    pause: async (params): Promise<Empty> => {
      const { taskId, scope } = params as PauseParams;
      for (const id of taskId ? [taskId] : working()) {
        try {
          await control().pause(id, scope ?? "everyLane");
        } catch (error) {
          throw refused(error, store, id);
        }
      }
      return {};
    },
    replyToBlockedAction: async (params): Promise<Empty> => {
      const { taskId, stepId, choice } = params as ReplyToBlockedActionParams;
      if (choice === "stop") {
        // "Stop" pauses the task like the menu bar "Stop", which also closes the card. A late Stop still pauses.
        try {
          await control().pause(taskId, "everyLane");
        } catch (error) {
          throw refused(error, store, taskId);
        }
        return {};
      }
      // A late "Keep going" for a card a pause or cancel already closed changes nothing.
      if (!blocked()?.keepGoing(stepId)) logger.info("blocked.lateAnswer", { taskId, stepId });
      return {};
    },
    resumeTask: (params): Empty => {
      const { taskId } = params as TaskRef;
      try {
        control().resume(taskId);
      } catch (error) {
        throw refused(error, store, taskId);
      }
      return {};
    },
    cancelTask: async (params): Promise<Empty> => {
      const { taskId } = params as TaskRef;
      try {
        await control().cancel(taskId);
      } catch (error) {
        throw refused(error, store, taskId);
      }
      return {};
    },
  };
}

/** A refusal becomes the "Unexpected" kind, naming the task's last action when there is one. Anything else is a bug and goes up as it is. */
function refused(error: unknown, store: TaskStore, taskId: string): unknown {
  if (!(error instanceof TaskControlError)) return error;
  const lastAction = store.getTask(taskId) && store.listActionLog(taskId).at(-1)?.description;
  const data: UserError = {
    kind: "unexpected",
    ...(error.rule === "unknownTask" ? {} : { taskId }),
    ...(lastAction ? { lastAction: lastAction.slice(0, 200) } : {}),
  };
  return new RpcFailure(data, error.message);
}
