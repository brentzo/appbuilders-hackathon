import type { AnswerQuestionParams, QuestionAsked, Uuid } from "@yumi/protocol/types";
import type { Logger } from "../log.ts";

/**
 * Questions from a step loop to the user (OBJ-36.9): the question goes out as the `questionAsked` event, the Mac app
 * speaks and shows it, and the answer comes back through `answerQuestion` (OBJ-01). One question per subtask at a
 * time. The answer is data for the next step; nothing here reads or logs its text.
 */

export type QuestionOutcome = { outcome: "answered"; answer: string } | { outcome: "stopped" };

interface Waiting {
  taskId: Uuid;
  resolve: (outcome: QuestionOutcome) => void;
}

/** An answer for a subtask that is not waiting for one: a late answer, or a bug in the app. */
export class NoQuestionError extends Error {
  constructor(readonly subtaskId: Uuid) {
    super(`Subtask ${subtaskId} is not waiting for an answer`);
    this.name = "NoQuestionError";
  }
}

export class QuestionBroker {
  private readonly waiting = new Map<Uuid, Waiting>();

  constructor(
    private readonly send: (payload: QuestionAsked) => void,
    private readonly logger: Logger,
  ) {}

  /**
   * Asks and waits for the answer. Resolves `stopped` when the signal aborts or `stillWaiting` turns false (a pause
   * or cancel), checked every `pollMs`; the question is then dropped and a late answer is refused.
   */
  ask(
    question: QuestionAsked,
    options: { signal: AbortSignal; stillWaiting: () => boolean; pollMs?: number },
  ): Promise<QuestionOutcome> {
    const { subtaskId, taskId } = question;
    if (this.waiting.has(subtaskId)) throw new Error(`Subtask ${subtaskId} is already waiting for an answer`);
    return new Promise<QuestionOutcome>((resolve) => {
      const finish = (outcome: QuestionOutcome) => {
        clearInterval(poll);
        options.signal.removeEventListener("abort", stop);
        if (this.waiting.get(subtaskId)?.resolve === finish) this.waiting.delete(subtaskId);
        resolve(outcome);
      };
      const stop = () => finish({ outcome: "stopped" });
      const poll = setInterval(() => {
        if (!options.stillWaiting()) stop();
      }, options.pollMs ?? 250);
      this.waiting.set(subtaskId, { taskId, resolve: finish });
      options.signal.addEventListener("abort", stop, { once: true });
      if (options.signal.aborted) return stop();
      this.logger.info("question.asked", { taskId, subtaskId, chars: question.question.length });
      this.send(question);
    });
  }

  /** Whether any subtask of the task is waiting for an answer. */
  isWaiting(taskId: Uuid): boolean {
    return [...this.waiting.values()].some((waiting) => waiting.taskId === taskId);
  }

  /** Delivers the user's answer. Throws `NoQuestionError` when the subtask is not waiting for one. */
  answer(params: AnswerQuestionParams): void {
    const waiting = this.waiting.get(params.subtaskId);
    if (!waiting || waiting.taskId !== params.taskId) {
      this.logger.warn("question.noneWaiting", { taskId: params.taskId, subtaskId: params.subtaskId });
      throw new NoQuestionError(params.subtaskId);
    }
    this.logger.info("question.answered", { taskId: params.taskId, subtaskId: params.subtaskId, chars: params.answer.length });
    waiting.resolve({ outcome: "answered", answer: params.answer });
  }
}
