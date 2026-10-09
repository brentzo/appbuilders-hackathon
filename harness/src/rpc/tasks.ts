import { RpcFailure, type Handler } from "@yumi/protocol";
import type { Empty, TaskRef, UserError } from "@yumi/protocol/types";
import type { TaskStore } from "../store/task-store.ts";
import { TaskControl, TaskControlError } from "../scheduler/task-control.ts";

/**
 * `resumeTask` and `cancelTask` (OBJ-06.3), which the Mac app calls when the user answers "Want me to pick up where
 * I left off?", or presses Resume or Cancel on a paused task. `RpcPeer` checks params and results against the
 * contract. A refused request answers the "Unexpected" kind; the reason is in the log.
 */
export function taskControlHandlers(control: () => TaskControl, store: TaskStore): Record<string, Handler> {
  return {
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
