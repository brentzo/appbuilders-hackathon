import type { ConfirmationReply, CursorCommand, SubmitGoalParams, UserError, Uuid } from "@yumi/protocol/types";
import { userErrorForModelFailure } from "../errors.ts";
import { describeError, type Logger } from "../log.ts";
import type { ModelClient, ModelFailure } from "../model/client.ts";
import type { TaskVoice } from "../scheduler/run-task.ts";
import { TaskControlError, type TaskControl } from "../scheduler/task-control.ts";
import type { TaskStore } from "../store/task-store.ts";
import { classifyReply, fixedReply, type ReplyKind } from "./classify.ts";
import { confirmedGoalFrom, repeatBack, restateGoal } from "./restate.ts";

/**
 * The goal confirmation loop (OBJ-17, SPEC-01 r4 to r7). A goal arrives with `submitGoal`: the harness creates the
 * task in awaitingConfirmation with the raw transcript as `goal`, spawns the main cursor near the user's pointer,
 * and sends the repeat-back as `goalRestated`. The app speaks and shows it, listens, and sends the answer with
 * `replyToConfirmation`.
 *
 * - Go ahead: `confirmedGoal` is saved, the task moves to planning, and only then does its work start.
 * - Cancel: Yumi says "Okay, I won't do anything.", the cursor fades, and the task ends cancelled with no plan.
 * - A correction is combined with the goal and repeated back again ("Got it. You want me to ...").
 * - Change it (the button): the app listens again, and the next spoken answer is the correction.
 * - Unclear: asked once more (the same repeat-back again); after that, Yumi waits for a button.
 *
 * Nothing plans or acts before a confirm (OBJ-17.7): the only call that starts work is in `confirm`. Answers for one
 * task are handled one at a time, in order. The state of an open question lives only in memory; after a restart,
 * `abandonUnconfirmed` cancels the tasks still waiting, since nothing ran and the app's question is gone.
 */

/** Said when the user cancels before work starts (SPEC-01 "User cancels before work starts"). */
export const CANCELLED_TEXT = "Okay, I won't do anything.";

/** The one cursor that does the user's work (SPEC-04 r1); ghosts get their own ids. */
export const MAIN_CURSOR_ID = "main";

interface OpenQuestion {
  taskId: Uuid;
  originDeviceId: string;
  transcript: string;
  corrections: string[];
  /** The clause Yumi last repeated back; undefined until the first repeat-back is ready. */
  goal?: string;
  /** The sentence Yumi last said. */
  said?: string;
  /** Unclear answers since the last repeat-back. */
  unclear: number;
  /** "Change it" was pressed: the next spoken answer is the correction. */
  expectCorrection: boolean;
  /** Answers for this task, handled one at a time. */
  queue: Promise<void>;
}

export interface ConfirmationDeps {
  store: TaskStore;
  logger: Logger;
  /** Events to the app: `goalRestated` and `cursorCommand`. */
  app: { emit(event: string, payload: unknown): number };
  voice: TaskVoice;
  /** Starts a confirmed task's work. */
  tasks: () => TaskControl;
  /** The model for the repeat-back and for reading answers. Without it, goals are refused. */
  client?: ModelClient;
}

/** Why `submitGoal` or `replyToConfirmation` was refused; the app shows "Unexpected", the reason is in the log. */
export class ConfirmationError extends Error {
  constructor(
    readonly rule: "noModel" | "unknownTask",
    message: string,
  ) {
    super(message);
    this.name = "ConfirmationError";
  }
}

export class GoalConfirmation {
  private readonly open = new Map<Uuid, OpenQuestion>();
  private readonly stopping = new AbortController();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: ConfirmationDeps) {
    // A task that leaves awaitingConfirmation some other way (a cancelTask from the app) closes its question.
    this.unsubscribe = deps.store.onStatusChanged((event) => {
      if (event.subtaskId === undefined && event.status !== "awaitingConfirmation") this.open.delete(event.taskId);
    });
  }

  /** True while the task's repeat-back waits for an answer. */
  isOpen(taskId: Uuid): boolean {
    return this.open.has(taskId);
  }

  /** Resolves when every answer received so far has been handled. */
  async settled(taskId: Uuid): Promise<void> {
    await this.open.get(taskId)?.queue;
  }

  /** `submitGoal`: creates the task, spawns the cursor, and repeats the goal back. Returns before the repeat-back is ready. */
  submit(params: SubmitGoalParams): Uuid {
    const { store, logger, client } = this.deps;
    if (!client) {
      logger.warn("confirm.refused", { rule: "noModel" });
      throw new ConfirmationError("noModel", "This harness was started without a model, so it cannot repeat a goal back");
    }
    const task = store.createTask({ originDeviceId: params.originDeviceId, goal: params.transcript });
    const question: OpenQuestion = {
      taskId: task.id,
      originDeviceId: task.originDeviceId,
      transcript: params.transcript,
      corrections: [],
      unclear: 0,
      expectCorrection: false,
      queue: Promise.resolve(),
    };
    this.open.set(task.id, question);
    logger.info("confirm.goalReceived", { taskId: task.id, transcriptChars: params.transcript.length });
    this.cursor({ command: "spawn", cursorId: MAIN_CURSOR_ID, cursorKind: "main" });
    this.enqueue(question, () => this.restate(question, false));
    return task.id;
  }

  /**
   * `replyToConfirmation`: queues the answer and returns. An answer for a task that is no longer waiting (a second
   * tap on Go ahead, or an answer that crossed a cancel) is ignored; an unknown task is refused.
   */
  reply(taskId: Uuid, reply: ConfirmationReply): void {
    const { store, logger } = this.deps;
    const question = this.open.get(taskId);
    if (!question) {
      const task = store.getTask(taskId);
      if (!task) {
        logger.warn("confirm.refused", { taskId, rule: "unknownTask" });
        throw new ConfirmationError("unknownTask", `No task ${taskId}`);
      }
      logger.info("confirm.replyIgnored", { taskId, status: task.status, reply: reply.kind });
      return;
    }
    this.enqueue(question, () => this.answer(question, reply));
  }

  /** Stops waiting for the model, for shutting down. Open tasks stay awaitingConfirmation until the next start abandons them. */
  async close(): Promise<void> {
    this.stopping.abort();
    this.unsubscribe();
    await Promise.all([...this.open.values()].map((q) => q.queue));
  }

  private enqueue(question: OpenQuestion, work: () => Promise<void>): void {
    question.queue = question.queue.then(work).catch((error: unknown) => {
      // A bug in the harness. Nothing started, so end the question plainly instead of leaving the user waiting.
      this.deps.logger.error("confirm.crashed", { taskId: question.taskId, ...describeError(error) });
      this.end(question, { kind: "unexpected", taskId: question.taskId });
    });
  }

  private async answer(question: OpenQuestion, reply: ConfirmationReply): Promise<void> {
    if (!this.stillOpen(question)) return;
    const kind = await this.kindOf(question, reply);
    if (kind === undefined || !this.stillOpen(question)) return;
    switch (kind) {
      case "confirm":
        return this.confirm(question);
      case "cancel":
        return this.cancel(question);
      case "correction":
        question.corrections.push((reply as { text: string }).text);
        question.unclear = 0;
        return this.restate(question, true);
      case "unclear":
        return this.unclear(question);
    }
  }

  /** What the answer means. Undefined when nothing more should happen (Change it, a model failure, or shutting down). */
  private async kindOf(question: OpenQuestion, reply: ConfirmationReply): Promise<ReplyKind | undefined> {
    const { logger } = this.deps;
    const taskId = question.taskId;
    if (reply.kind === "button") {
      logger.info("confirm.answer", { taskId, button: reply.choice });
      if (reply.choice === "goAhead") return "confirm";
      if (reply.choice === "cancel") return "cancel";
      // Change it: the app listens for the correction and sends it as speech.
      question.expectCorrection = true;
      return undefined;
    }
    if (question.expectCorrection) {
      question.expectCorrection = false;
      logger.info("confirm.answer", { taskId, kind: "correction", by: "changeIt", answerChars: reply.text.length });
      return "correction";
    }
    const fixed = fixedReply(reply.text);
    if (fixed) {
      logger.info("confirm.answer", { taskId, kind: fixed, by: "fixed", answerChars: reply.text.length });
      return fixed;
    }
    this.cursor({ command: "setState", cursorId: MAIN_CURSOR_ID, state: "thinking" });
    const result = await classifyReply(question.said!, reply.text, this.model(), { taskId, signal: this.stopping.signal });
    if (result.by === "failure" && result.failure.kind !== "invalidOutput") {
      this.modelFailed(question, result.failure);
      return undefined;
    }
    logger.info("confirm.answer", { taskId, kind: result.kind, by: result.by, answerChars: reply.text.length });
    return result.kind;
  }

  private async restate(question: OpenQuestion, afterCorrection: boolean): Promise<void> {
    this.cursor({ command: "setState", cursorId: MAIN_CURSOR_ID, state: "thinking" });
    const result = await restateGoal(
      {
        transcript: question.transcript,
        corrections: question.corrections,
        ...(question.goal ? { previous: question.goal } : {}),
      },
      this.model(),
      { taskId: question.taskId, signal: this.stopping.signal },
    );
    if (!this.stillOpen(question)) return;
    if (!result.ok) {
      if (result.failure.kind === "invalidOutput") {
        this.deps.logger.warn("confirm.restateFailed", { taskId: question.taskId, failure: "invalidOutput" });
        this.end(question, { kind: "unexpected", taskId: question.taskId });
      } else this.modelFailed(question, result.failure);
      return;
    }
    question.goal = result.goal;
    question.said = repeatBack(result.goal, afterCorrection);
    this.ask(question);
  }

  /** Sends the repeat-back for the app to speak, show, and listen after. */
  private ask(question: OpenQuestion): void {
    this.deps.app.emit("goalRestated", { taskId: question.taskId, text: question.said! });
    this.cursor({ command: "setState", cursorId: MAIN_CURSOR_ID, state: "waitingForUser" });
    this.deps.logger.info("confirm.asked", {
      taskId: question.taskId,
      corrections: question.corrections.length,
      unclear: question.unclear,
    });
  }

  private unclear(question: OpenQuestion): void {
    question.unclear++;
    if (question.unclear === 1) {
      this.ask(question);
      return;
    }
    // Asked twice: the panel stays up with its buttons, and the app does not listen again.
    this.cursor({ command: "setState", cursorId: MAIN_CURSOR_ID, state: "waitingForUser" });
    this.deps.logger.info("confirm.waitingForButton", { taskId: question.taskId });
  }

  /** The only place a task's work starts from a goal: after the user said yes to this exact repeat-back. */
  private confirm(question: OpenQuestion): void {
    const { store, logger, voice } = this.deps;
    const taskId = question.taskId;
    this.open.delete(taskId);
    store.setTaskStatus(taskId, "planning", { confirmedGoal: confirmedGoalFrom(question.goal!) });
    logger.info("confirm.confirmed", { taskId, corrections: question.corrections.length });
    try {
      void this.deps.tasks().start(taskId);
    } catch (error) {
      if (!(error instanceof TaskControlError)) throw error;
      // The harness has no model or lanes to run it. Logged by TaskControl; the user hears "Unexpected".
      store.setTaskStatus(taskId, "failed");
      voice.userError(question.originDeviceId, { kind: "unexpected", taskId });
    }
  }

  private cancel(question: OpenQuestion): void {
    this.open.delete(question.taskId);
    this.deps.store.setTaskStatus(question.taskId, "cancelled");
    this.deps.voice.speak(question.originDeviceId, { taskId: question.taskId, text: CANCELLED_TEXT });
    this.cursor({ command: "fade", cursorId: MAIN_CURSOR_ID });
    this.deps.logger.info("confirm.cancelled", { taskId: question.taskId });
  }

  private modelFailed(question: OpenQuestion, failure: ModelFailure): void {
    const userError = userErrorForModelFailure(failure, { taskId: question.taskId });
    // Aborted: the harness is shutting down, and the next start abandons the question.
    if (!userError) return;
    this.deps.logger.warn("confirm.modelFailed", { taskId: question.taskId, failure: failure.kind });
    this.end(question, userError);
  }

  /** Ends a question that cannot go on: the task is cancelled with nothing run, and the user hears why. */
  private end(question: OpenQuestion, userError: UserError): void {
    this.open.delete(question.taskId);
    try {
      const task = this.deps.store.getTask(question.taskId);
      if (task?.status === "awaitingConfirmation") this.deps.store.setTaskStatus(question.taskId, "cancelled");
      this.deps.voice.userError(question.originDeviceId, userError);
      this.cursor({ command: "fade", cursorId: MAIN_CURSOR_ID });
    } catch (error) {
      this.deps.logger.error("confirm.endFailed", { taskId: question.taskId, ...describeError(error) });
    }
  }

  private stillOpen(question: OpenQuestion): boolean {
    return this.open.get(question.taskId) === question && !this.stopping.signal.aborted;
  }

  private model(): { client: ModelClient; logger: Logger } {
    return { client: this.deps.client!, logger: this.deps.logger };
  }

  private cursor(command: CursorCommand): void {
    this.deps.app.emit("cursorCommand", command);
  }
}

/**
 * Cancels every task still waiting for its confirmation when the harness starts. Its question lived in the last
 * process's memory, so no answer can reach it, and nothing ran, so there is nothing to resume.
 */
export function abandonUnconfirmed(store: TaskStore, logger: Logger): Uuid[] {
  const abandoned: Uuid[] = [];
  for (const task of store.listTasksByStatus(["awaitingConfirmation"])) {
    store.setTaskStatus(task.id, "cancelled");
    abandoned.push(task.id);
  }
  if (abandoned.length > 0) logger.info("confirm.abandoned", { tasks: abandoned });
  return abandoned;
}
