import { RpcFailure, type Handler } from "@yumi/protocol";
import type { Empty, ReplyToConfirmationParams, SubmitGoalParams, SubmitGoalResult } from "@yumi/protocol/types";
import { ConfirmationError, type GoalConfirmation } from "../confirm/confirmation.ts";

/**
 * `submitGoal` and `replyToConfirmation` (OBJ-17), which the Mac app calls when the user speaks or types a goal and
 * when they answer the repeat-back. `RpcPeer` checks params and results against the contract. A refused request
 * answers the "Unexpected" kind; the reason is in the log.
 */
export function confirmationHandlers(confirmation: () => GoalConfirmation): Record<string, Handler> {
  return {
    submitGoal: (params): SubmitGoalResult => {
      try {
        return { taskId: confirmation().submit(params as SubmitGoalParams) };
      } catch (error) {
        throw refused(error);
      }
    },
    replyToConfirmation: (params): Empty => {
      const { taskId, reply } = params as ReplyToConfirmationParams;
      try {
        confirmation().reply(taskId, reply);
      } catch (error) {
        throw refused(error);
      }
      return {};
    },
  };
}

function refused(error: unknown): unknown {
  if (!(error instanceof ConfirmationError)) return error;
  return new RpcFailure({ kind: "unexpected" }, error.message);
}
