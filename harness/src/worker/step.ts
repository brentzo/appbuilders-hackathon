import { validate } from "@yumi/protocol";
import type { Lane, UserError, WorkerInput, WorkerOutput } from "@yumi/protocol/types";
import { PasswordScrubber } from "../debug/scrub.ts";
import { userErrorForModelFailure } from "../errors.ts";
import type { Logger } from "../log.ts";
import type { DebugLog } from "../debug/debug-log.ts";
import type { ModelClient, Usage } from "../model/client.ts";
import { buildWorkerMessages } from "./prompt.ts";
import { workerOutputSchemaFor } from "./schema.ts";
import { checkWorkerOutput, type SecureFieldRule } from "./validate.ts";

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
  /** The subtask's lane. The model is offered, and may use, only this lane's actions (SPEC-03 r7). */
  lane: Lane;
  signal?: AbortSignal;
  taskId?: string;
  subtaskId?: string;
  /** Fills {last action} if the step ends in the Unexpected error. */
  lastAction?: string;
  /** How an action that would fill a password field is treated. Defaults to `reject`. */
  secureFields?: SecureFieldRule;
  /** Ask the model for its reason too. Defaults to whether Debug mode is on. */
  explain?: boolean;
  /**
   * Keeps password text out of the debug log for the whole subtask (`src/debug/scrub.ts`), so text learned in one
   * step's reply is also removed from the next step's prompt. Defaults to one for this step.
   */
  scrubber?: PasswordScrubber;
}

/** One retry after the first invalid reply. */
const MAX_ATTEMPTS = 2;

export async function runWorkerStep(
  input: WorkerInput,
  deps: { client: ModelClient; logger: Logger; debug?: DebugLog | undefined },
  options: WorkerStepOptions,
): Promise<WorkerStepResult> {
  const inputCheck = validate("WorkerInput", input);
  if (!inputCheck.valid) throw new Error(`Invalid WorkerInput: ${inputCheck.errors.join("; ")}`);

  const attempts: StepAttempt[] = [];
  const explain = options.explain ?? deps.debug?.enabled === true;
  const scrubber = options.scrubber ?? new PasswordScrubber();
  let current = input;
  for (;;) {
    const observation = current.observation;
    const reply = await deps.client.chat({
      messages: await buildWorkerMessages(current, options.lane, explain),
      responseFormat: { name: "WorkerOutput", schema: workerOutputSchemaFor(current, options.lane, { explain }) },
      signal: options.signal,
      purpose: "workerStep",
      taskId: options.taskId,
      subtaskId: options.subtaskId,
      redact: { reply: (content) => scrubber.reply(content, observation), scrub: scrubber.scrub },
    });

    if (!reply.ok) {
      const userError = userErrorForModelFailure(reply.failure, {
        ...(options.taskId ? { taskId: options.taskId } : {}),
        ...(options.lastAction ? { lastAction: options.lastAction } : {}),
      });
      return userError ? { outcome: "error", userError, attempts } : { outcome: "aborted", attempts };
    }

    const check = checkWorkerOutput(reply.content, current, options.lane, options.secureFields);
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
    deps.debug?.write(
      "step.invalidOutput",
      { taskId: options.taskId, subtaskId: options.subtaskId, attempt: attempts.length, validationError: check.error },
      scrubber.scrub,
    );
    if (attempts.length >= MAX_ATTEMPTS) return { outcome: "invalidOutput", validationError: check.error, attempts };
    current = { ...input, validationError: check.error };
  }
}
