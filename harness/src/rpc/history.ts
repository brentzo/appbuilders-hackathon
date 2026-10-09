import { RpcFailure, type Handler } from "@yumi/protocol";
import type { ListTasksParams, SearchTasksParams, TaskDetail, TaskList, TaskRef } from "@yumi/protocol/types";
import type { Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";

/**
 * The history methods the Mac app calls for the past-tasks screen (SPEC-02 r11): `listTasks`, `searchTasks`, and
 * `getTask`, which returns the task with its subtasks, steps, and action log. `RpcPeer` checks params and results against the contract.
 */
export function historyHandlers(store: TaskStore, logger: Logger): Record<string, Handler> {
  return {
    listTasks: (params): TaskList => {
      const { limit, before } = params as ListTasksParams;
      return {
        tasks: store.listTasks({ ...(limit !== undefined ? { limit } : {}), ...(before !== undefined ? { before } : {}) }),
      };
    },
    searchTasks: (params): TaskList => {
      const { query, limit } = params as SearchTasksParams;
      return { tasks: store.searchTasks({ query, ...(limit !== undefined ? { limit } : {}) }) };
    },
    getTask: (params): TaskDetail => {
      const { taskId } = params as TaskRef;
      const history = store.getTaskHistory(taskId);
      if (!history) {
        // The app only asks for tasks it was given, so a missing one is a bug or a different database: log it and
        // let the app show the generic copy.
        logger.warn("history.taskNotFound", { taskId });
        throw new RpcFailure({ kind: "unexpected" }, "Task not found");
      }
      return history;
    },
  };
}
