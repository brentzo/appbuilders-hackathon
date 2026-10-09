import type { ConfirmationReply, CursorCommand, ReviseGoalParams, SubmitGoalParams, UserError, Uuid } from "@yumi/protocol/types";
import type { DebugLog } from "../debug/debug-log.ts";
import { userErrorForModelFailure } from "../errors.ts";
import { describeError, type Logger } from "../log.ts";
import type { ModelClient, ModelFailure } from "../model/client.ts";
import type { TaskVoice } from "../scheduler/run-task.ts";
import { GoalRevisionFailed, TaskControlError, type TaskControl } from "../scheduler/task-control.ts";
import type { TaskStore } from "../store/task-store.ts";
import { asksForList } from "../planner/list-note.ts";
import { classifyReply, fixedReply, noteReply, type ReplyKind } from "./classify.ts";
import { confirmedGoalFrom, repeatBack, restateGoal } from "./restate.ts";
import { reviseGoalWords } from "./revision.ts";

/**
 * The goal confirmation loop (OBJ-17, SPEC-01 r4 to r7). A goal arrives with `submitGoal`: the harness creates the
 * task in awaitingConfirmation with the raw transcript as `goal`, spawns the main cursor near the user's pointer,
 * and sends the repeat-back as `goalRestated`. The app speaks and shows it, listens, and sends the answer with
 * `replyToConfirmation`.
 *
 * The Mac app (`mac/Yumi/Confirmation/GoalConfirmation.swift`) owns what happens on screen around it: it spawns the
 * cursor as soon as the user submits (the harness's spawn then keeps it where it is), shows the listening state
 * while it listens, and says "Okay, I won't do anything." and fades the cursor when the task turns cancelled. So the
 * harness sends no listening state, no cancel line, and no fade, which would otherwise come twice.
 *
 * - Go ahead: `confirmedGoal` is saved, the task moves to planning, and only then does its work start.
 * - Cancel: the task ends cancelled with no confirmed goal and no plan; the app says the cancel line.
 * - A correction is combined with the goal and repeated back again ("Got it. You want me to ...").
 * - Change it (the button): the app listens again, and the next spoken answer is the correction.
 * - Unclear: asked once more (the same repeat-back again); after that, Yumi waits for a button.
 * - A goal that asks for a list ends its repeat-back with "Want me to put the list in a new note too?" instead of
 *   "Should I go ahead?" (SPEC-02 r13, OBJ-74). "Yes, in a note" goes ahead with the note, which the task store
 *   keeps; a plain yes, or Go ahead, goes ahead without it.
 *
 * Auto mode (SPEC-01 r14, OBJ-50): a goal sent with `autoMode` skips all of this. The task is created straight in
 * planning with the transcript, trimmed, as its `confirmedGoal`, and its work starts at once. The app shows what it
 * heard and says "On it."; approvals for sends and deletes still ask, since they are the scheduler's, not this loop's.
 *
 * Without Auto mode, nothing plans or acts before a confirm (OBJ-17.7): the only call that starts work is in `confirm`. Answers for one
 * task are handled one at a time, in order. The state of an open question lives only in memory; after a restart,
 * `abandonUnconfirmed` cancels the tasks still waiting, since nothing ran and the app's question is gone.
 */

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
  /** The last repeat-back offered to put the list in a new note (SPEC-02 r13). */
  offersNote?: boolean;
  /** Unclear answers since the last repeat-back. */
  unclear: number;
  /** "Change it" was pressed: the next spoken answer is the correction. */
  expectCorrection: boolean;
  kind: "goal" | "revision";
  autoMode?: boolean;
  revisionOriginalGoal?: string;
  revisionBaseGoal?: string;
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
  /** The detailed debug log (OBJ-52): what was heard, how each answer was read, and what Yumi said back. */
  debug?: DebugLog;
}

/** Why `submitGoal` or `replyToConfirmation` was refused; the app shows "Unexpected", the reason is in the log. */
export class ConfirmationError extends Error {
  constructor(
    readonly rule: "noModel" | "unknownTask" | "emptyGoal" | "notPaused",
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

  /**
   * `submitGoal`: creates the task, spawns the cursor, and repeats the goal back. Returns before the repeat-back is
   * ready. In Auto mode it starts the task instead, with no repeat-back.
   */
  submit(params: SubmitGoalParams): Uuid {
    const { store, logger, client } = this.deps;
    if (!client) {
      logger.warn("confirm.refused", { rule: "noModel" });
      throw new ConfirmationError("noModel", "This harness was started without a model, so it cannot repeat a goal back");
    }
    if (params.autoMode === true) return this.startRightAway(params);
    const task = store.createTask({ originDeviceId: params.originDeviceId, goal: params.transcript });
    const question: OpenQuestion = {
      taskId: task.id,
      originDeviceId: task.originDeviceId,
      transcript: params.transcript,
      corrections: [],
      unclear: 0,
      expectCorrection: false,
      kind: "goal",
      queue: Promise.resolve(),
    };
    this.open.set(task.id, question);
    logger.info("confirm.goalReceived", { taskId: task.id, transcriptChars: params.transcript.length });
    this.deps.debug?.write("voice.goal", {
      taskId: task.id,
      originDeviceId: params.originDeviceId,
      transcript: params.transcript,
    });
    this.cursor({ command: "spawn", cursorId: MAIN_CURSOR_ID, cursorKind: "main" });
    this.enqueue(question, () => this.restate(question, false));
    return task.id;
  }

  /** Accepts a revised-goal utterance for an existing paused task. */
  revise(params: ReviseGoalParams): void {
    const { store, logger, client } = this.deps;
    if (!client) throw new ConfirmationError("noModel", "This harness was started without a model, so it cannot revise a goal");
    const task = store.getTask(params.taskId);
    if (!task) throw new ConfirmationError("unknownTask", `No task ${params.taskId}`);
    if (task.status !== "paused" || !task.confirmedGoal)
      throw new ConfirmationError("notPaused", `Task ${params.taskId} is not paused with a confirmed goal`);
    const question: OpenQuestion = {
      taskId: task.id,
      originDeviceId: task.originDeviceId,
      transcript: params.transcript,
      corrections: [],
      unclear: 0,
      expectCorrection: false,
      kind: "revision",
      autoMode: params.autoMode === true,
      revisionOriginalGoal: task.goal,
      revisionBaseGoal: task.confirmedGoal,
      queue: Promise.resolve(),
    };
    this.open.set(task.id, question);
    logger.info("revision.received", { taskId: task.id, transcriptChars: params.transcript.length, autoMode: question.autoMode });
    this.deps.debug?.write("voice.revision", { taskId: task.id, transcript: params.transcript, autoMode: question.autoMode });
    this.enqueue(question, () => this.restate(question, false));
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
      this.deps.debug?.write("voice.answer", { taskId, reply, ignored: task.status });
      return;
    }
    this.deps.debug?.write("voice.answer", { taskId, reply });
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
    // "none": Change it was pressed, the model failed, or the harness is stopping.
    this.deps.debug?.write("confirm.read", { taskId: question.taskId, reply, kind: kind ?? "none" });
    if (kind === undefined || !this.stillOpen(question)) return;
    switch (kind) {
      case "confirm":
        return this.confirm(question, false);
      case "confirmWithNote":
        return this.confirm(question, true);
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
    const fixed = fixedReply(reply.text) ?? (question.offersNote ? noteReply(reply.text) : undefined);
    if (fixed) {
      logger.info("confirm.answer", { taskId, kind: fixed, by: "fixed", answerChars: reply.text.length });
      return fixed;
    }
    this.cursor({ command: "setState", cursorId: MAIN_CURSOR_ID, state: "thinking" });
    const result = await classifyReply(question.said!, reply.text, this.model(), {
      taskId,
      signal: this.stopping.signal,
      offersNote: question.offersNote === true,
    });
    if (result.by === "failure" && result.failure.kind !== "invalidOutput") {
      this.modelFailed(question, result.failure);
      return undefined;
    }
    logger.info("confirm.answer", { taskId, kind: result.kind, by: result.by, answerChars: reply.text.length });
    this.deps.debug?.write("confirm.classified", {
      taskId,
      text: reply.text,
      kind: result.kind,
      by: result.by,
      ...(result.by === "failure" ? { failure: result.failure.kind } : {}),
    });
    return result.kind;
  }

  private async restate(question: OpenQuestion, afterCorrection: boolean): Promise<void> {
    if (question.kind === "revision") return this.restateRevision(question);
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
    question.offersNote = asksForList(result.goal);
    question.said = repeatBack(result.goal, afterCorrection, question.offersNote);
    this.deps.debug?.write("confirm.repeatBack", {
      taskId: question.taskId,
      transcript: question.transcript,
      corrections: question.corrections,
      goal: result.goal,
      said: question.said,
    });
    this.ask(question);
  }

  private async restateRevision(question: OpenQuestion): Promise<void> {
    if (!question.revisionBaseGoal) return;
    const result = await reviseGoalWords(
      {
        originalGoal: question.revisionOriginalGoal ?? question.revisionBaseGoal,
        currentGoal: question.revisionBaseGoal,
        transcript: question.transcript,
        corrections: question.corrections,
        subtasks: this.deps.store.listSubtasks(question.taskId),
      },
      this.model(),
      { taskId: question.taskId, signal: this.stopping.signal },
    );
    if (!this.stillOpen(question)) return;
    if (!result.ok) {
      if (result.failure.kind === "invalidOutput") this.end(question, { kind: "unexpected", taskId: question.taskId });
      else this.modelFailed(question, result.failure);
      return;
    }
    question.goal = result.goal;
    const leftBehind = result.leftBehindSubtaskIds
      .map((id) => this.deps.store.getSubtask(id)?.result?.note)
      .filter((note): note is string => !!note)
      .map((note) => "I already " + note[0]!.toLowerCase() + note.slice(1).replace(/[.!?]+$/, "") + ". I'll leave it there.");
    question.said = [...leftBehind, repeatBack(result.goal, true)].join(" ");
    this.deps.debug?.write("revision.repeatBack", {
      taskId: question.taskId,
      previousGoal: question.revisionBaseGoal,
      goal: result.goal,
      leftBehind,
    });
    if (!question.autoMode) {
      this.ask(question);
      return;
    }
    this.open.delete(question.taskId);
    try {
      await this.deps
        .tasks()
        .applyGoalRevision(
          question.taskId,
          [question.transcript, ...question.corrections].join(" "),
          confirmedGoalFrom(result.goal),
          () => {
            this.deps.app.emit("goalRestated", { taskId: question.taskId, text: result.goal, autoMode: true });
            this.deps.voice.speak(question.originDeviceId, { text: "On it." });
          },
        );
    } catch (error) {
      this.deps.logger.error("revision.applyFailed", { taskId: question.taskId, ...describeError(error) });
      const errorMessage =
        error instanceof GoalRevisionFailed ? error.userError : { kind: "unexpected" as const, taskId: question.taskId };
      this.deps.voice.userError(question.originDeviceId, errorMessage);
    }
  }

  /** Sends the repeat-back for the app to speak, show, and listen after. */
  private ask(question: OpenQuestion): void {
    // The app shows the listening state while it listens for the answer.
    this.deps.app.emit("goalRestated", {
      taskId: question.taskId,
      text: question.said!,
      ...(question.autoMode ? { autoMode: true } : {}),
    });
    this.deps.logger.info("confirm.asked", {
      taskId: question.taskId,
      corrections: question.corrections.length,
      unclear: question.unclear,
    });
  }

  private unclear(question: OpenQuestion): void {
    question.unclear++;
    this.deps.debug?.write("confirm.unclear", { taskId: question.taskId, times: question.unclear });
    if (question.unclear === 1) {
      this.ask(question);
      return;
    }
    // Asked twice: the panel stays up with its buttons, and the app does not listen again.
    this.cursor({ command: "setState", cursorId: MAIN_CURSOR_ID, state: "waitingForUser" });
    this.deps.logger.info("confirm.waitingForButton", { taskId: question.taskId });
  }

  /**
   * Where a task's work starts from a goal, with the repeat-back: after the user said yes to this exact repeat-back.
   * `withNote`: they also said yes to putting the list in a new note.
   */
  private async confirm(question: OpenQuestion, withNote: boolean): Promise<void> {
    const { store, logger } = this.deps;
    const taskId = question.taskId;
    this.open.delete(taskId);
    if (question.kind === "revision") {
      try {
        await this.deps
          .tasks()
          .applyGoalRevision(taskId, [question.transcript, ...question.corrections].join(" "), confirmedGoalFrom(question.goal!));
      } catch (error) {
        logger.error("revision.applyFailed", { taskId, ...describeError(error) });
        const errorMessage = error instanceof GoalRevisionFailed ? error.userError : { kind: "unexpected" as const, taskId };
        this.deps.voice.userError(question.originDeviceId, errorMessage);
      }
      return;
    }
    if (withNote) store.setListToNote(taskId);
    store.setTaskStatus(taskId, "planning", { confirmedGoal: confirmedGoalFrom(question.goal!) });
    logger.info("confirm.confirmed", { taskId, corrections: question.corrections.length, withNote });
    this.deps.debug?.write("confirm.confirmed", { taskId, confirmedGoal: confirmedGoalFrom(question.goal!), withNote });
    this.startWork(taskId, question.originDeviceId);
  }

  /** Where a task's work starts from a goal in Auto mode: the user asked for no repeat-back (SPEC-01 r14). */
  private startRightAway(params: SubmitGoalParams): Uuid {
    const { store, logger } = this.deps;
    const confirmedGoal = params.transcript.trim();
    if (confirmedGoal === "") {
      logger.warn("confirm.refused", { rule: "emptyGoal" });
      throw new ConfirmationError("emptyGoal", "The transcript is only whitespace, so there is no goal to start");
    }
    const task = store.createTask({
      originDeviceId: params.originDeviceId,
      goal: params.transcript,
      confirmedGoal,
      status: "planning",
      autoMode: true,
    });
    logger.info("confirm.autoMode", { taskId: task.id, transcriptChars: params.transcript.length });
    this.deps.debug?.write("voice.goal", {
      taskId: task.id,
      originDeviceId: params.originDeviceId,
      transcript: params.transcript,
      autoMode: true,
    });
    this.cursor({ command: "spawn", cursorId: MAIN_CURSOR_ID, cursorKind: "main" });
    this.startWork(task.id, task.originDeviceId);
    return task.id;
  }

  private startWork(taskId: Uuid, originDeviceId: string): void {
    try {
      void this.deps.tasks().start(taskId);
    } catch (error) {
      if (!(error instanceof TaskControlError)) throw error;
      // The harness has no model or lanes to run it. Logged by TaskControl; the user hears "Unexpected".
      this.deps.store.setTaskStatus(taskId, "failed");
      this.deps.voice.userError(originDeviceId, { kind: "unexpected", taskId });
    }
  }

  private async cancel(question: OpenQuestion): Promise<void> {
    this.open.delete(question.taskId);
    if (question.kind === "revision") {
      await this.deps.tasks().cancel(question.taskId);
      return;
    }
    // The app says "Okay, I won't do anything." and fades the cursor when it sees the task cancelled.
    this.deps.store.setTaskStatus(question.taskId, "cancelled");
    this.deps.logger.info("confirm.cancelled", { taskId: question.taskId });
    this.deps.debug?.write("confirm.cancelled", { taskId: question.taskId });
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
    this.deps.debug?.write("confirm.ended", { taskId: question.taskId, userError });
    try {
      // The error goes first, so the app knows this cancel came with one and says only the error copy, not
      // "Okay, I won't do anything." (Brent's decision, 2026-10-10).
      this.deps.voice.userError(question.originDeviceId, userError);
      const task = this.deps.store.getTask(question.taskId);
      if (question.kind === "goal" && task?.status === "awaitingConfirmation")
        this.deps.store.setTaskStatus(question.taskId, "cancelled");
    } catch (error) {
      this.deps.logger.error("confirm.endFailed", { taskId: question.taskId, ...describeError(error) });
    }
  }

  private stillOpen(question: OpenQuestion): boolean {
    return this.open.get(question.taskId) === question && !this.stopping.signal.aborted;
  }

  private model(): { client: ModelClient; logger: Logger; debug?: DebugLog | undefined } {
    return { client: this.deps.client!, logger: this.deps.logger, debug: this.deps.debug };
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
