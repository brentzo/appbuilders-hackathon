import { validate } from "@yumi/protocol";
import type { UserError, WorkerInput, WorkerOutput } from "@yumi/protocol/types";
import { userErrorForModelFailure } from "../errors.ts";
import type { Logger } from "../log.ts";
import type { ModelClient, Usage } from "../model/client.ts";
import { buildWorkerMessages } from "./prompt.ts";
import { workerOutputSchemaFor } from "./schema.ts";
import { checkWorkerOutput } from "./validate.ts";

/**
 * Runs the model for one step and returns exactly one validated action (SPEC-02 r5 and r6). An invalid reply is
 * retried once with the validation error in the prompt; a second invalid reply ends the step as `invalidOutput`
 * (SPEC-02 scenario "Worker returns an invalid action").
 */

export interface StepAttempt {
  /** Each attempt is "ok" or "invalidOutput", the step outcomes it maps to. */
  outcome: "ok" | "invalidOutput";
  /** Why the reply was rejected. For the retry prompt and the log only. */
  validationError?: string;
  durationMs: number;
  usage: Usage;
}

export type WorkerStepResult =
  | { outcome: "ok"; output: WorkerOutput; attempts: StepAttempt[] }
  /** Both attempts were invalid. */
  | { outcome: "invalidOutput"; validationError: string; attempts: StepAttempt[] }
  /** The model could not answer. `userError` is the SPEC-11 error to show. */
  | { outcome: "error"; userError: UserError; attempts: StepAttempt[] }
  /** The caller cancelled the step. Nothing to show. */
  | { outcome: "aborted"; attempts: StepAttempt[] };

export interface WorkerStepOptions {
  signal?: AbortSignal;
  taskId?: string;
  /** Fills {last action} if the step ends in the Unexpected error. */
  lastAction?: string;
}

/** One retry after the first invalid reply. */
const MAX_ATTEMPTS = 2;

export async function runWorkerStep(
  input: WorkerInput,
  deps: { client: ModelClient; logger: Logger },
  options: WorkerStepOptions = {},
): Promise<WorkerStepResult> {
  const inputCheck = validate("WorkerInput", input);
  if (!inputCheck.valid) throw new Error(`Invalid WorkerInput: ${inputCheck.errors.join("; ")}`);

  const attempts: StepAttempt[] = [];
  let current = input;
  for (;;) {
    const reply = await deps.client.chat({
      messages: await buildWorkerMessages(current),
      responseFormat: { name: "WorkerOutput", schema: workerOutputSchemaFor(current) },
      signal: options.signal,
      purpose: "workerStep",
    });

    if (!reply.ok) {
      const userError = userErrorForModelFailure(reply.failure, {
        ...(options.taskId ? { taskId: options.taskId } : {}),
        ...(options.lastAction ? { lastAction: options.lastAction } : {}),
      });
      return userError ? { outcome: "error", userError, attempts } : { outcome: "aborted", attempts };
    }

    const check = checkWorkerOutput(reply.content, current);
    if (check.ok) {
      attempts.push({ outcome: "ok", durationMs: reply.durationMs, usage: reply.usage });
      deps.logger.info("step.output", { taskId: options.taskId, attempt: attempts.length, action: check.output.action.kind });
      return { outcome: "ok", output: check.output, attempts };
    }

    attempts.push({ outcome: "invalidOutput", validationError: check.error, durationMs: reply.durationMs, usage: reply.usage });
    deps.logger.warn("step.invalidOutput", {
      taskId: options.taskId,
      attempt: attempts.length,
      finishReason: reply.finishReason,
      validationError: check.error,
    });
    if (attempts.length >= MAX_ATTEMPTS) return { outcome: "invalidOutput", validationError: check.error, attempts };
    current = { ...input, validationError: check.error };
  }
}
