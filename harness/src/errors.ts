import type { UserError } from "@yumi/protocol/types";
import type { ModelFailure } from "./model/client.ts";

/**
 * Maps harness failures to the structured `UserError` the apps turn into SPEC-11 copy. The harness never builds
 * user-facing text itself, and nothing technical (status codes, server detail, exception text) goes into a
 * UserError: that detail is in the harness log.
 */

export interface ErrorContext {
  taskId?: string;
  /** Fills {last action} in the Unexpected copy. */
  lastAction?: string;
}

/**
 * Model failures: an unreachable server is "Model failed to load" ("I couldn't start my brain on this device"),
 * because on a 16 GB Mac the usual cause is a server that never started or was stopped for memory. Anything else is
 * "Unexpected". A cancel the user asked for is not an error, so it returns undefined.
 */
export function userErrorForModelFailure(failure: ModelFailure, context: ErrorContext = {}): UserError | undefined {
  switch (failure.kind) {
    case "aborted":
      return undefined;
    case "unreachable":
      return withContext({ kind: "modelFailedToLoad" }, context);
    case "timeout":
    case "httpError":
    case "badResponse":
      return withContext({ kind: "unexpected" }, context);
  }
}

function withContext(error: UserError, context: ErrorContext): UserError {
  return {
    ...error,
    ...(context.taskId ? { taskId: context.taskId } : {}),
    ...(error.kind === "unexpected" && context.lastAction ? { lastAction: context.lastAction.slice(0, 200) } : {}),
  };
}
