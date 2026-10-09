import type {
  CursorState,
  DeviceId,
  ExecuteActionResult,
  Lane,
  ModelAction,
  Observation,
  Path,
  ResolvedElement,
  ResultStatus,
  Step,
  StepOutcome,
  Subtask,
  SubtaskResult,
  Target,
  ToolName,
  UserError,
  Uuid,
} from "@yumi/protocol/types";
import type { ApprovalAnswer, ApprovalGate, SendFields } from "../approvals/approval-flow.ts";
import { findRecipientFields, sendApp } from "../approvals/recipients.ts";
import { DEFAULT_LIMITS, type Limits } from "../config.ts";
import type { RunControl } from "../control/run-control.ts";
import type { DebugLog } from "../debug/debug-log.ts";
import { describeSees } from "../debug/thoughts.ts";
import { SubtaskTrail, type TrailDeps } from "../debug/trail.ts";
import type { Logger } from "../log.ts";
import type { ModelClient } from "../model/client.ts";
import { checkAction } from "../safety/gate.ts";
import { withPlainNames } from "../file-names.ts";
import { describeGuiAction, describeNotDone, describeSkipped, type NotDone } from "../scheduler/describe.ts";
import { buildSubtaskResult } from "../scheduler/result.ts";
import { describeFinished } from "../scheduler/subtask-runner.ts";
import { buildWorkerInput } from "../scheduler/worker-input.ts";
import type { TaskStore } from "../store/task-store.ts";
import { ACTION, isElementAction } from "../worker/actions.ts";
import { runWorkerStep } from "../worker/step.ts";
import { PASSWORD_QUESTION } from "./copy.ts";
import { watchHome as realWatchHome, type FileChange, type FileWatch, type WatchHome } from "./file-watch.ts";
import { MacGuiFailure, type MacGui } from "./mac.ts";
import type { QuestionBroker } from "./questions.ts";
import {
  DEFAULT_SETTLE,
  describeChange,
  readableObservation,
  sameTreeAndTitle,
  settledObservation,
  type SettleTiming,
} from "./screen.ts";

/**
 * `gui_act`: one attempt at a subtask in an app's window, on the ghost or main lane (SPEC-05, OBJ-36). It runs a
 * short step loop on the same model with a fresh context each step: look at the target window, pick one action,
 * check it with the permission gate, run it through the Mac app, and see whether anything changed. The orchestrator
 * gets back a `SubtaskResult` the harness builds from the step log, never a transcript, so screen text cannot reach
 * or steer it (SPEC-05 r4, r8).
 *
 * Each step:
 * 1. Stop if the task is cancelled or paused, the attempt has used its 10 steps, or the subtask its 25.
 * 2. Build the worker input from the confirmed goal, the instruction, the last steps, the fresh observation, and the
 *    direct tools (OBJ-05 builder), set the cursor to thinking, and ask the model for one action, with the step's
 *    schema sent for constrained decoding (SPEC-05 r10). An invalid reply is retried once.
 * 3. `finish` ends the attempt. An action that would fill a password field becomes a request for the user to type
 *    it (SPEC-05 r7), and `ask` waits for the user's answer, which the next step reads.
 * 4. Resolve the element, check the action with the gate, check the task is still not paused, and write the step
 *    row before anything runs (SPEC-02 r3). `blocked` never runs; `ask` runs only after the user approves.
 * 5. Run it through the Mac app, which moves the cursor to the element first (SPEC-05 r3), then look again until two
 *    looks match, and write the outcome: `noEffect` when the tree and title did not change (SPEC-05 r6) or the
 *    accessibility API refused the action (OBJ-36.10).
 */

/** The direct tools `gui_act` offers its worker (SPEC-05 r1). They run in the Mac app. */
export const GUI_TOOLS: readonly ToolName[] = ["open_app", "open_file", "open_url", "reveal_in_finder"];

/** Steps per attempt (SPEC-05 r5). Reaching it ends the attempt with `partial`. */
export const STEPS_PER_ATTEMPT = 10;
/** Consecutive `noEffect` steps that end an attempt (docs/task-record-schema.md "Limits"). */
export const NO_EFFECT_LIMIT = 3;
/** Consecutive invalid replies that end an attempt: the first one is retried with the validation error (SPEC-02 r6). */
export const INVALID_OUTPUT_LIMIT = 2;

/** Longest step observation (`Step.observation`). */
const MAX_OBSERVATION = 300;

/** What the worker reads about an action that was not done, by reason. */
const NOT_DONE: Record<NotDone, string> = {
  needsApproval: "Not done: this needs the user's approval, and there is no way to ask for it here.",
  blocked: "Not done: Yumi's safety rules do not allow this action. Do not try it again.",
  declined: "Not done: the user said no to this action. Do not try it again.",
  paused: "Not done: the task was paused before this action could run.",
  filesChanged: "Not done: the files changed or are gone.",
  noRecipients: "Not done: the recipients could not be read, so nothing was sent.",
  couldNotAsk: "Not done: the approval could not be shown.",
  actionChanged: "Not done: the screen changed while the user was asked. Look again before trying it.",
};

const UNAVAILABLE: Record<Extract<ApprovalAnswer, { outcome: "unavailable" }>["reason"], NotDone> = {
  noApprovalCard: "needsApproval",
  noRecipients: "noRecipients",
  filesGone: "filesChanged",
  couldNotAsk: "couldNotAsk",
  actionChanged: "actionChanged",
};

/** What the loop needs besides the model, the store, and the approvals: the Mac app and questions to the user. */
export interface GuiServices {
  mac: MacGui;
  questions: QuestionBroker;
  /** Watches the home folder for files an app writes. Tests pass their own. */
  watchHome?: WatchHome;
  /** How long to wait for the screen to settle after an action. */
  settle?: SettleTiming;
  /** The windows the lane router opened for a task, which Yumi may close without asking (SPEC-07, 2026-10-10). */
  openedWindows?: (taskId: Uuid) => ReadonlySet<number>;
}

export interface GuiActDeps extends GuiServices {
  store: TaskStore;
  client: ModelClient;
  logger: Logger;
  deviceId: DeviceId;
  /** The user's home folder: for the gate, and the folder watched for new files. */
  home: string;
  limits?: Limits;
  /**
   * The approval flow (OBJ-38): asks the user about an action the gate says asks for, and about a blocked one. The
   * running harness always has it. Without it, an action that asks is recorded as not done, and a blocked action
   * ends the attempt.
   */
  approvals?: ApprovalGate;
  /** The detailed debug log (OBJ-52): each step's observation, decision, reason, and outcome, in Debug mode. */
  debug?: DebugLog | undefined;
  /** Sends each step's thoughts to the app for the thoughts panel; the harness sends them only in Debug mode. */
  thoughts?: TrailDeps["thoughts"];
}

export interface GuiActOptions {
  confirmedGoal: string;
  /** The subtask's signal: aborts on a cancel, a pause of every lane, or a take-over of the UI lanes. */
  signal: AbortSignal;
  /** The run's pause state (OBJ-38): `mayAct` is checked right before every action is written and sent. */
  control: RunControl;
  /** Carry on with the attempt a pause or restart cut off, without counting a new one. */
  continuing?: boolean;
}

/** Why an attempt ended. */
export type EndReason =
  /** The model finished, with its status checked against the step log. */
  | "finished"
  /** 10 steps in this attempt. */
  | "stepLimit"
  /** 25 steps in the subtask, across attempts. */
  | "subtaskStepLimit"
  /** The subtask's attempts were used up before this one started. */
  | "attemptLimit"
  | "noEffect"
  | "invalidOutput"
  /** The gate blocked the next action, or the Mac app refused it (SPEC-07 r5), and the user did not keep going. */
  | "blocked"
  /** The Mac app could not read the window or run the action. */
  | "macFailure"
  /** The file the instruction asked for appeared, so the attempt is done without asking the model again. */
  | "saved";

/** How many of the last steps had no effect, and how many replies in a row were invalid, for OBJ-09's handoff. */
export interface Streaks {
  noEffect: number;
  invalidOutput: number;
}

export type GuiActRun =
  | { outcome: "ended"; reason: EndReason; result: SubtaskResult; userError?: UserError; streaks: Streaks; steps: number }
  /** The model could not answer. */
  | { outcome: "error"; result: SubtaskResult; userError: UserError }
  /**
   * A cancel or a pause stopped the attempt before its next action. After a take-over the scheduler starts the
   * subtask again as the same attempt (OBJ-38).
   */
  | { outcome: "aborted"; result: SubtaskResult };

/**
 * Runs one attempt at a running ghost or main subtask with a target app. Counts the attempt on the subtask unless it
 * continues one. Leaves the subtask's status to the caller.
 */
export async function guiAct(subtaskId: Uuid, deps: GuiActDeps, options: GuiActOptions): Promise<GuiActRun> {
  let subtask = deps.store.getSubtask(subtaskId);
  if (!subtask) throw new Error(`No subtask ${subtaskId}`);
  const { lane, target } = subtask;
  if (subtask.status !== "running" || (lane !== "ghost" && lane !== "main") || !target) {
    throw new Error(`gui_act needs a running ghost or main subtask with a target, got ${subtask.status} on ${lane ?? "no lane"}`);
  }
  if (options.signal.aborted) {
    // Paused or cancelled while the subtask was being routed: no attempt starts, and the pause or cancel flow sets
    // the statuses (Brent's run, 2026-10-10: a take-over right after "Go ahead" ended as "Stuck on screen").
    deps.logger.info("gui.notStarted", { taskId: subtask.taskId, subtaskId, reason: "stopped" });
    return { outcome: "aborted", result: buildSubtaskResult("partial", "Stopped before it started.", []) };
  }
  const limits = deps.limits ?? DEFAULT_LIMITS;
  if (!options.continuing) {
    if (subtask.attempts >= limits.attemptsPerSubtask) {
      deps.logger.warn("gui.attemptLimit", { taskId: subtask.taskId, subtaskId, attempts: subtask.attempts });
      return {
        outcome: "ended",
        reason: "attemptLimit",
        result: buildSubtaskResult("stuck", `Stopped after ${subtask.attempts} attempts without finishing.`, []),
        userError: { kind: "stepFailed", taskId: subtask.taskId, step: subtask.title },
        streaks: { noEffect: 0, invalidOutput: 0 },
        steps: 0,
      };
    }
    subtask = deps.store.updateSubtask(subtaskId, { attempts: subtask.attempts + 1 });
  }
  const watch = await (deps.watchHome ?? realWatchHome)(deps.home, deps.logger);
  const attempt = new Attempt(subtask, lane, target, deps, options, limits, watch);
  try {
    const run = await attempt.run();
    // The files this attempt created or changed, as the file system reports them (SPEC-05 r4).
    const ended = { ...run, result: buildSubtaskResult(run.result.status, run.result.note, await attempt.files()) };
    if (ended.outcome === "ended") {
      deps.logger.info("gui.attemptEnded", {
        taskId: subtask.taskId,
        subtaskId,
        lane,
        reason: ended.reason,
        status: ended.result.status,
        steps: ended.steps,
        files: ended.result.files.length,
        ms: attempt.elapsedMs(),
        ...(ended.userError ? { kind: ended.userError.kind } : {}),
      });
    }
    attempt.trail.ended({
      outcome: ended.outcome,
      ...(ended.outcome === "ended" ? { reason: ended.reason, steps: ended.steps } : {}),
      result: ended.result,
      ...("userError" in ended && ended.userError ? { userError: ended.userError } : {}),
    });
    return ended;
  } finally {
    attempt.close();
  }
}

/** What the model reads for an action it repeats after it was blocked. */
const BLOCKED_AGAIN = "Not run: this exact action was blocked before. Choose a different action.";

/** The most new or changed files one step's observation names, so a burst of writes never floods the model. */
const FILE_LINES = 3;

/** What happened to an action the loop tried to run: the attempt goes on with a new look, or it ends. */
type ActResult = { next: Observation } | { end: GuiActRun };

class Attempt {
  private readonly taskId: Uuid;
  private readonly cursorId: string;
  /** This attempt's lines in the debug log and its thoughts for the thoughts panel (OBJ-52). */
  readonly trail: SubtaskTrail;
  private readonly settle: SettleTiming;
  private readonly startedMs = Date.now();
  private steps = 0;
  /** Steps of this attempt whose action worked. */
  private worked = 0;
  private readonly streaks: Streaks = { noEffect: 0, invalidOutput: 0 };
  /** Vision clicks skipped because the window moved, so a window that keeps moving cannot loop forever. */
  private movedSkips = 0;
  /** Actions blocked in this attempt, so the same one is never asked about again. */
  private readonly blockedActions = new Set<string>();
  /** How often the model proposed an action that was already blocked. */
  private blockedRepeats = 0;
  /** This attempt opened the app with `open_app`, because it had no window: that window is Yumi's. */
  private openedApp = false;
  private last: Observation | undefined;

  constructor(
    private readonly subtask: Subtask,
    private readonly lane: Extract<Lane, "ghost" | "main">,
    private readonly target: Target,
    private readonly deps: GuiActDeps,
    private readonly options: GuiActOptions,
    private readonly limits: Limits,
    private readonly watch: FileWatch,
  ) {
    this.taskId = subtask.taskId;
    // The main cursor is the main lane; a ghost is its worker's own cursor (OBJ-39: the Mac app reads the lane from it).
    this.cursorId = lane === "main" ? "main" : (subtask.workerId ?? `ghost-${subtask.id.slice(0, 8)}`);
    this.settle = deps.settle ?? DEFAULT_SETTLE;
    this.trail = new SubtaskTrail(deps, subtask, lane, this.cursorId);
  }

  close(): void {
    this.watch.close();
  }

  async run(): Promise<GuiActRun> {
    const { store, logger } = this.deps;
    logger.info("gui.attemptStarted", {
      taskId: this.taskId,
      subtaskId: this.subtask.id,
      lane: this.lane,
      attempt: store.getSubtask(this.subtask.id)?.attempts,
      continuing: this.options.continuing === true,
    });
    this.trail.started({
      attempt: store.getSubtask(this.subtask.id)?.attempts,
      continuing: this.options.continuing === true,
      target: this.target,
    });
    this.deps.mac.cursor({
      command: "spawn",
      cursorId: this.cursorId,
      cursorKind: this.lane,
      ...(this.lane === "ghost" ? { label: this.subtask.title.slice(0, 60) } : {}),
    });

    const first = await this.firstLook();
    // A look that failed because the run stopped meanwhile is a stop, not a failure.
    if ("end" in first) return this.stopped() ?? first.end;
    let observation = first.next;

    for (;;) {
      const stop = this.stopped();
      if (stop) return stop;
      if (this.steps >= STEPS_PER_ATTEMPT) return this.end("stepLimit", "partial");
      const steps = store.listSteps(this.subtask.id);
      if (steps.length >= this.limits.stepsPerSubtask) {
        const finished = describeFinished(store, this.subtask);
        return this.end("subtaskStepLimit", "partial", {
          kind: "taskTookTooLong",
          taskId: this.taskId,
          ...(finished ? { finishedSoFar: finished } : {}),
        });
      }

      const input = buildWorkerInput({
        confirmedGoal: this.options.confirmedGoal,
        instruction: this.subtask.instruction,
        steps,
        observation,
        tools: GUI_TOOLS,
      });
      this.cursorState("thinking");
      const lastAction = store.listActionLog(this.taskId).at(-1)?.description;
      const step = await runWorkerStep(
        input,
        { client: this.deps.client, logger, debug: this.deps.debug },
        {
          lane: this.lane,
          signal: this.options.signal,
          taskId: this.taskId,
          subtaskId: this.subtask.id,
          ...(lastAction ? { lastAction } : {}),
          secureFields: "handOff",
          scrubber: this.trail.scrubber,
        },
      );
      switch (step.outcome) {
        case "aborted":
          return this.aborted();
        case "error":
          this.cursorState("stuck");
          return { outcome: "error", result: this.result("stuck", "The model could not answer."), userError: step.userError };
        case "invalidOutput":
          this.streaks.invalidOutput += step.attempts.length;
          return this.end("invalidOutput", "stuck");
        case "ok":
          this.streaks.invalidOutput = 0;
          break;
      }

      const action = step.output.action;
      this.trail.decided(steps.length + 1, observation, step.output, step.attempts.length);
      if (action.kind === ACTION.finish) return this.finish(action.status);
      let outcome: ActResult;
      if (needsPassword(action, observation)) outcome = await this.ask(PASSWORD_QUESTION, observation);
      // The user never sees a path: the worker asked for "/Users/brent/Documents/Expert my keynote tech.key"
      // (task d608891a, 2026-10-10). Each one becomes the file's plain name.
      else if (action.kind === ACTION.ask) outcome = await this.ask(withPlainNames(action.question, this.deps.home), observation);
      else outcome = await this.act(action, observation);
      if ("end" in outcome) return outcome.end;
      observation = outcome.next;
    }
  }

  /**
   * The first look at the target window. When the router gave the subtask no window, because the app had none, the
   * app is opened with `open_app` first, the cheapest way in (SPEC-05 r1), as a step of its own. A window the router
   * locked gets until the settle timeout to become readable, since the router may have just opened it; after that the
   * attempt fails: the lane never picks another window (OBJ-08).
   */
  private async firstLook(): Promise<ActResult> {
    const { signal } = this.options;
    const locked = this.target.windowId !== undefined;
    try {
      const { observation, looks } = await readableObservation(
        () => this.deps.mac.observe(this.target, signal),
        (error) => locked && isMissingWindow(error),
        this.settle,
        signal,
      );
      if (looks > 1) this.deps.logger.info("gui.windowAppeared", { taskId: this.taskId, subtaskId: this.subtask.id, looks });
      return { next: this.remember(observation) };
    } catch (error) {
      if (locked || !isMissingWindow(error)) return this.lookFailed(error);
    }
    const opened = await this.act({ kind: ACTION.tool, call: { tool: "open_app", bundleId: this.target.bundleId } }, undefined);
    // The app had no window, so the one it opens is Yumi's.
    this.openedApp = true;
    if ("end" in opened) return opened;
    return { next: opened.next };
  }

  /** Ends the attempt when the window cannot be read. Anything but a Mac app failure is a bug and goes up. */
  private lookFailed(error: unknown): ActResult {
    if (!(error instanceof MacGuiFailure)) throw error;
    return { end: this.macFailure(error.userError) };
  }

  /** Looks at the window until it settles, after an action. */
  private async look(): Promise<Observation> {
    const { observation, settled, looks } = await settledObservation(
      () => this.deps.mac.observe(this.target, this.options.signal),
      this.settle,
      this.options.signal,
    );
    if (!settled) this.deps.logger.info("gui.notSettled", { taskId: this.taskId, subtaskId: this.subtask.id, looks });
    return this.remember(observation);
  }

  private remember(observation: Observation): Observation {
    this.last = observation;
    return observation;
  }

  /**
   * One fresh look at the window without waiting for it to settle, for the check before a vision click
   * (SPEC-05 r13). The click's coordinates point into this look's screenshot, so a moved window is seen
   * before the model's click is sent.
   */
  private async lookWithoutSettling(): Promise<ActResult> {
    try {
      return { next: this.remember(await this.deps.mac.observe(this.target, this.options.signal)) };
    } catch (error) {
      return this.lookFailed(error);
    }
  }

  /**
   * Resolves, checks, records, and runs one action, then looks again. `before` is what the model saw; it is absent
   * only for the `open_app` the harness runs when the app had no window.
   */
  private async act(action: ModelAction, before: Observation | undefined): Promise<ActResult> {
    const { store } = this.deps;
    const app = before?.app;
    const layer = before?.layer?.kind;
    const decision = checkAction(
      { action, element: resolveElement(action, before) },
      { home: this.deps.home, app, layer, mayCloseWindow: this.mayCloseWindow() },
    );
    // SPEC-06 r4: nothing is written or sent once a pause covers this lane. Checked right before the step is written.
    const stop = this.stopped();
    if (stop) return { end: stop };
    // SPEC-05 r13: a vision click is only sent when the target window has not moved, resized, or
    // lost focus since the screenshot. Read the window again; if it changed, the click is skipped
    // and the model is asked again from the fresh screen.
    if (action.kind === ACTION.clickAt && before?.screenshotPath !== undefined) {
      const fresh = await this.lookWithoutSettling();
      if ("end" in fresh) return fresh;
      if (!sameWindow(before, fresh.next)) {
        this.deps.logger.info("gui.windowMoved", { taskId: this.taskId, subtaskId: this.subtask.id });
        this.movedSkips++;
        if (this.movedSkips >= NO_EFFECT_LIMIT) {
          return { end: this.end("noEffect", "stuck", { kind: "stuckOnScreen", taskId: this.taskId }) };
        }
        return { next: fresh.next };
      }
      this.movedSkips = 0;
    }
    const step = store.beginStep({ subtaskId: this.subtask.id, lane: this.lane, action: decision.recorded });
    this.steps++;
    const notDone = (outcome: "blocked" | "declined" | "noEffect", why: NotDone) =>
      this.finishStep(step, outcome, NOT_DONE[why], describeNotDone(decision.recorded, app, why, layer));
    const key = JSON.stringify(action);

    if (this.blockedActions.has(key)) {
      // The same action again after "Keep going": the user already heard about it, so it is not asked about again,
      // and a model that keeps repeating it is stuck (live Keynote runs, 2026-10-10).
      this.finishStep(step, "blocked", BLOCKED_AGAIN, describeNotDone(decision.recorded, app, "blocked", layer));
      this.blockedRepeats++;
      if (this.blockedRepeats >= INVALID_OUTPUT_LIMIT) return { end: this.end("invalidOutput", "stuck") };
      return { next: before ?? (await this.look()) };
    }
    if (decision.level === "blocked") {
      this.deps.logger.warn("gui.blocked", { taskId: this.taskId, subtaskId: this.subtask.id, rule: decision.rule });
      notDone("blocked", "blocked");
      this.blockedActions.add(key);
      return this.afterBlocked(step, before);
    }
    if (decision.level === "ask") {
      this.cursorState("waitingForUser");
      const answer: ApprovalAnswer = this.deps.approvals
        ? await this.deps.approvals.request(
            decision,
            {
              subtask: this.subtask,
              step,
              lane: this.lane,
              control: this.options.control,
              app,
              target: this.target,
              layer,
              ...(before ? sendFields(before, this.target) : {}),
            },
            this.options.signal,
          )
        : { outcome: "unavailable", reason: "noApprovalCard" };
      switch (answer.outcome) {
        case "approved":
          break;
        case "declined":
          // Recorded, and the model reads that the user said no; it does not try again (SPEC-07 "Declined email send").
          notDone("declined", "declined");
          return { next: before ?? (await this.look()) };
        case "cancelled":
          notDone("noEffect", "paused");
          return this.stopped() ? { end: this.aborted() } : { next: before ?? (await this.look()) };
        case "unavailable":
          notDone(answer.reason === "filesGone" ? "noEffect" : "blocked", UNAVAILABLE[answer.reason]);
          return { next: before ?? (await this.look()) };
      }
      // The answer took time: a pause or cancel that came since still wins over running it.
      if (this.stopped()) {
        notDone("noEffect", "paused");
        return { end: this.aborted() };
      }
    }

    this.cursorState("acting");
    let ran: ExecuteActionResult;
    try {
      ran = await this.deps.mac.execute({
        stepId: step.id,
        target: this.target,
        action: decision.recorded,
        cursorId: this.cursorId,
      });
    } catch (error) {
      if (!(error instanceof MacGuiFailure)) throw error;
      if (error.userError?.kind === "blockedAction") {
        // A password field or a keystroke from a ghost: the Mac app's own guard (OBJ-39).
        notDone("blocked", "blocked");
        this.blockedActions.add(key);
        return this.afterBlocked(step, before);
      }
      this.finishStep(
        step,
        "error",
        "The Mac app could not run this action.",
        describeGuiAction(decision.recorded, app, false, layer),
      );
      return { end: this.macFailure(error.userError) };
    }

    let after: Observation;
    try {
      after = await this.look();
    } catch (error) {
      if (!(error instanceof MacGuiFailure)) throw error;
      this.finishStep(
        step,
        ran.outcome === "ok" ? "ok" : "error",
        fit(`${ran.observation} Then the window could not be read.`),
        describeGuiAction(decision.recorded, app, ran.outcome === "ok", layer),
      );
      return { end: this.macFailure(error.userError) };
    }

    const files = await this.watch.takeNew();
    const outcome = stepOutcome(action, ran, before, after, files);
    const line = fit(observationLine(action, ran, outcome, before, after, files));
    if (outcome === "blocked") {
      this.finishStep(step, "blocked", line, describeNotDone(decision.recorded, app, "blocked", layer));
      // Only typing can stop partway, at a password field (SPEC-05 r7). Any other action the Mac app answers as
      // blocked never ran: the app is stopped on its side, for example after it saw the user take over. That is a
      // pause, not a blocked action, so the task pauses and the user's Resume carries on (live Keynote runs,
      // 2026-10-10: the blocked-action card came back on every "Keep going").
      if (action.kind !== ACTION.type) return { end: this.macStopped() };
      this.blockedActions.add(key);
      return this.afterBlocked(step, after);
    }
    this.finishStep(step, outcome, line, describeGuiAction(decision.recorded, app, outcome === "ok", layer));
    if (outcome === "ok") this.worked++;
    // The file the instruction asked for exists now: the job is done. The model, asked again, kept checking where
    // the file went instead of finishing (live Keynote runs, 2026-10-10), so the harness ends it here.
    const saved = files.find((file) => file.created && isAskedFile(file.path, this.subtask.instruction));
    if (saved) {
      this.deps.logger.info("gui.saved", { taskId: this.taskId, subtaskId: this.subtask.id });
      return { end: this.end("saved", "done", undefined, `Saved ${fileAndFolder(saved.path)}.`) };
    }
    this.streaks.noEffect = outcome === "noEffect" ? this.streaks.noEffect + 1 : 0;
    this.streaks.invalidOutput = outcome === "invalidOutput" ? this.streaks.invalidOutput + 1 : 0;
    if (this.streaks.noEffect >= NO_EFFECT_LIMIT) {
      return { end: this.end("noEffect", "stuck", { kind: "stuckOnScreen", taskId: this.taskId }) };
    }
    if (this.streaks.invalidOutput >= INVALID_OUTPUT_LIMIT) return { end: this.end("invalidOutput", "stuck") };
    return { next: after };
  }

  /**
   * The Mac app refused to act because it is stopped on its side. Pauses the UI lanes as a take-over does (SPEC-06 r2),
   * so the task shows as paused and the user's Resume (`resumeTask`) starts the lanes again; the step stays recorded
   * as not done, so the same action is tried again after the resume.
   */
  private macStopped(): GuiActRun {
    this.deps.logger.warn("gui.macStopped", { taskId: this.taskId, subtaskId: this.subtask.id });
    this.options.control.pauseUiLanes();
    const status = this.deps.store.getTask(this.taskId)?.status;
    if (status === "running" || status === "waitingForUser") this.deps.store.setTaskStatus(this.taskId, "paused");
    return this.aborted();
  }

  /**
   * A blocked action never runs (SPEC-07 r5). The step is already recorded as blocked; the user is told, and on
   * "Keep going" (the app's `resumeTask`) the attempt goes on. "Stop" is the app's `cancelTask` (OBJ-45), which stops
   * the run, so the attempt ends without sending anything more. Without the approval flow it ends with
   * `blockedAction`.
   */
  private async afterBlocked(step: Step, screen: Observation | undefined): Promise<ActResult> {
    const { approvals } = this.deps;
    if (!approvals) {
      const skippedAction = describeSkipped(step.action, screen?.app, screen?.layer?.kind);
      return {
        end: this.end("blocked", "blocked", {
          kind: "blockedAction",
          taskId: this.taskId,
          ...(skippedAction ? { skippedAction } : {}),
        }),
      };
    }
    this.cursorState("waitingForUser");
    const choice = await approvals.blocked(
      { subtask: this.subtask, step, lane: this.lane, control: this.options.control, app: screen?.app },
      this.options.signal,
    );
    if (choice === "keepGoing" && !this.stopped()) return { next: screen ?? (await this.look()) };
    // "Stop" cancelled the task, which sets the statuses; a pause or cancel that came first did too.
    return { end: this.stopped() ?? this.end("blocked", "blocked") };
  }

  /**
   * Asks the user and waits (OBJ-36.9). The question is written as a step before it goes out, the subtask waits for
   * the user as an approval does (OBJ-38), so the task is `waitingForUser` and the user's own clicks and typing do
   * not pause it (SPEC-06 r2), and the answer goes into the step's observation, which the next step reads. For a
   * password field the question is the SPEC-07 copy, never model text, and nothing on the screen is read or filled.
   */
  private async ask(question: string, observation: Observation): Promise<ActResult> {
    const { store } = this.deps;
    const { control } = this.options;
    const action: ModelAction = { kind: ACTION.ask, question };
    const decision = checkAction({ action }, { home: this.deps.home, app: observation.app });
    // Nothing asks while a pause holds: a pause cancels everything that waits for the user (SPEC-06 r5).
    const stop = this.stopped() ?? (control.mayAsk() ? undefined : this.aborted());
    if (stop) return { end: stop };
    const step = store.beginStep({ subtaskId: this.subtask.id, lane: this.lane, action: decision.recorded });
    this.steps++;

    control.setWaiting(this.subtask.id, true);
    if (store.getTask(this.taskId)?.status === "running") store.setTaskStatus(this.taskId, "waitingForUser");
    this.cursorState("waitingForUser");
    const answer = await this.deps.questions.ask(
      { taskId: this.taskId, subtaskId: this.subtask.id, question },
      { signal: this.options.signal, stillWaiting: () => control.mayAct(this.lane) },
    );
    control.setWaiting(this.subtask.id, false);
    if (control.waitingCount === 0 && store.getTask(this.taskId)?.status === "waitingForUser") {
      store.setTaskStatus(this.taskId, "running");
    }
    const description = describeGuiAction(decision.recorded, observation.app, true);
    if (answer.outcome === "stopped") {
      this.finishStep(step, "noEffect", "The task stopped before the user answered.", description);
      return { end: this.aborted() };
    }
    const password = question === PASSWORD_QUESTION;
    this.finishStep(
      step,
      "ok",
      fit(
        password
          ? `The user was asked to type the password themselves and answered: ${JSON.stringify(answer.answer)}`
          : `The user answered: ${JSON.stringify(answer.answer)}`,
      ),
      description,
    );
    this.worked++;
    this.streaks.noEffect = 0;
    try {
      return { next: await this.look() };
    } catch (error) {
      return this.lookFailed(error);
    }
  }

  /**
   * The Mac app could not read the window or run an action: a missing permission ends the attempt as blocked with
   * that error (SPEC-05 r11), a window that is gone as stuck on screen, and anything else as unexpected.
   */
  private macFailure(reported: UserError | undefined): GuiActRun {
    const kind = reported?.kind;
    if (kind === "accessibilityPermissionMissing" || kind === "screenPermissionMissing") {
      return this.end("macFailure", "blocked", { kind, taskId: this.taskId });
    }
    if (kind === "stuckOnScreen") return this.end("macFailure", "stuck", { kind, taskId: this.taskId });
    const lastAction = this.deps.store.listActionLog(this.taskId).at(-1)?.description;
    return this.end("macFailure", "stuck", {
      kind: "unexpected",
      taskId: this.taskId,
      ...(lastAction ? { lastAction: lastAction.slice(0, 200) } : {}),
    });
  }

  /**
   * The model finished. Its status is checked against the step log: `done` after an attempt in which no action
   * worked is `stuck`, because nothing the model did this time changed anything. An attempt that finishes before
   * any action keeps `done`: the work may have been done already.
   */
  private finish(status: "done" | "stuck"): GuiActRun {
    const checked: ResultStatus = status === "done" && this.steps > 0 && this.worked === 0 ? "stuck" : status;
    if (checked !== status) {
      this.deps.logger.warn("gui.finishCorrected", {
        taskId: this.taskId,
        subtaskId: this.subtask.id,
        from: status,
        to: checked,
      });
    }
    return this.end("finished", checked);
  }

  /** Ends the attempt with a result built from the step log, never from model text or screen text. */
  private end(reason: EndReason, status: ResultStatus, userError?: UserError, note?: string): GuiActRun {
    const result = this.result(status, note ?? noteFor(reason, status, this.steps, this.streaks, this.last, this.limits));
    this.cursorState(status === "done" ? "done" : "stuck");
    if (this.lane === "ghost") this.deps.mac.cursor({ command: "fade", cursorId: this.cursorId });
    // Logged by `guiAct` once the files the attempt made are known.
    return {
      outcome: "ended",
      reason,
      result,
      ...(userError ? { userError } : {}),
      streaks: { ...this.streaks },
      steps: this.steps,
    };
  }

  private aborted(): GuiActRun {
    if (this.lane === "ghost") this.deps.mac.cursor({ command: "fade", cursorId: this.cursorId });
    return { outcome: "aborted", result: this.result("partial", "Stopped before it finished.") };
  }

  /** Cancelled or paused: the attempt must not write or send anything more (SPEC-06 r4, r8). */
  private stopped(): GuiActRun | undefined {
    return this.options.signal.aborted || !this.options.control.mayAct(this.lane) ? this.aborted() : undefined;
  }

  /**
   * Whether closing the target window needs no approval (SPEC-07, decided 2026-10-10 by Brent): the task started in
   * Auto mode, or Yumi opened the window for this task, with the router's `openNewWindow` or this attempt's
   * `open_app`. Any other window is the user's.
   */
  private mayCloseWindow(): boolean {
    if (this.deps.store.isAutoMode(this.taskId) || this.openedApp) return true;
    const windowId = this.target.windowId;
    return windowId !== undefined && (this.deps.openedWindows?.(this.taskId).has(windowId) ?? false);
  }

  /** How long the attempt has run. */
  elapsedMs(): number {
    return Date.now() - this.startedMs;
  }

  /** The files this attempt created or changed that still exist. */
  async files(): Promise<Path[]> {
    return (await this.watch.all()).map((change) => change.path);
  }

  /** A result without its files, which `guiAct` adds once the attempt is over. */
  private result(status: ResultStatus, note: string): SubtaskResult {
    return buildSubtaskResult(status, note, []);
  }

  private finishStep(
    step: Step,
    outcome: Exclude<StepOutcome, "invalidOutput"> | "invalidOutput",
    observation: string,
    description: string,
  ) {
    const finished =
      outcome === "invalidOutput"
        ? this.deps.store.finishStep(step.id, { outcome, observation })
        : this.deps.store.finishStep(step.id, { outcome, observation, log: { deviceId: this.deps.deviceId, description } });
    // What the worker sees now: the window after the action when it was looked at, else the one it acted in.
    this.trail.finished(finished, this.last ? describeSees(this.last) : "Opening the app");
  }

  private cursorState(state: CursorState): void {
    this.deps.mac.cursor({ command: "setState", cursorId: this.cursorId, state });
  }

  /** Moves the task between running and waiting for the user, only from the status it is expected to have. */
  private setTaskStatus(from: "running" | "waitingForUser", to: "running" | "waitingForUser"): void {
    if (this.deps.store.getTask(this.taskId)?.status === from) this.deps.store.setTaskStatus(this.taskId, to);
  }
}

/**
 * Whether the model's action would put text into a password field: setting its value, typing while it has focus,
 * or clicking it to start typing. Such an action never runs; the user is asked to type the password (SPEC-05 r7).
 * An `ask` while a password field is on screen is about that field, so it gets the same copy.
 */
function needsPassword(action: ModelAction, observation: Observation): boolean {
  const role = (n: number | undefined) => observation.elements.find((element) => element.n === n)?.role;
  switch (action.kind) {
    case ACTION.click:
    case ACTION.setValue:
      return role(action.element) === "secureTextField";
    case ACTION.type:
      return role(observation.focused) === "secureTextField";
    case ACTION.ask:
      return observation.elements.some((element) => element.role === "secureTextField" && element.enabled);
    default:
      return false;
  }
}

/**
 * For an action in an app that sends (Mail, Messages), the To and Cc fields the approval flow reads the real
 * recipients from (SPEC-07 r13). Their paths are the same stand-in as in `resolveElement`.
 */
function sendFields(observation: Observation, target: Target): { send: SendFields } | Record<string, never> {
  if (!observation.app || !sendApp(observation.app)) return {};
  const { to, cc } = findRecipientFields(observation);
  return { send: { target, app: observation.app, to: to.map(elementPath), cc: cc.map(elementPath) } };
}

/**
 * STAND-IN until the Mac app returns paths (OBJ-39 Outcome, "Protocol asks"): the observation carries no element
 * paths, so the harness names an element by its number. The Mac app resolves numbers for `executeAction` itself and
 * ignores this; `readFieldValues` cannot resolve it yet.
 */
function elementPath(n: number): string {
  return `#${n}`;
}

/**
 * The element an action acts on, as the gate and the action log see it. For `type`, the focused element the text
 * goes into. The path is a stand-in (`elementPath`): the Mac app resolves the number against its own last look and
 * checks only the role.
 */
function resolveElement(action: ModelAction, observation: Observation | undefined): ResolvedElement | undefined {
  if (!observation) return undefined;
  const n =
    isElementAction(action.kind) && "element" in action
      ? action.element
      : action.kind === ACTION.type
        ? observation.focused
        : undefined;
  const element = n === undefined ? undefined : observation.elements.find((e) => e.n === n);
  return element && { path: elementPath(element.n), role: element.role, label: element.label };
}

/**
 * The step's outcome. A UI action that left the tree and the title as they were had no effect (SPEC-05 r6), unless
 * a file appeared; an accessibility error from the Mac app is no effect too, never ok (OBJ-36.10). A direct tool acts
 * outside the window, so the Mac app's word decides.
 */
function stepOutcome(
  action: ModelAction,
  ran: ExecuteActionResult,
  before: Observation | undefined,
  after: Observation,
  files: readonly FileChange[],
): Exclude<StepOutcome, "declined"> {
  const ui = action.kind !== ACTION.tool;
  switch (ran.outcome) {
    case "ok":
      return ui && before !== undefined && files.length === 0 && sameTreeAndTitle(before, after) ? "noEffect" : "ok";
    case "error":
      return ui ? "noEffect" : "error";
    case "declined":
      return "error";
    default:
      return ran.outcome;
  }
}

/** The step's one line for the next steps: what the Mac app did, what changed, and any new file. */
function observationLine(
  action: ModelAction,
  ran: ExecuteActionResult,
  outcome: StepOutcome,
  before: Observation | undefined,
  after: Observation,
  files: readonly FileChange[],
): string {
  const shown = files
    .slice(0, FILE_LINES)
    .map((file) => `${file.created ? "New file" : "Changed file"}: ${fileAndFolder(file.path)}.`);
  const more = files.length - FILE_LINES;
  const fileLine = [...shown, ...(more > 0 ? [`And ${more} more ${more === 1 ? "file" : "files"}.`] : [])].join(" ");
  if (outcome === "noEffect") {
    const why =
      ran.outcome === "error"
        ? `Nothing happened: ${ran.observation}`
        : `${ran.observation} But nothing changed: ${noEffectHint(action, before)}`;
    return `${why} Choose a different action.`;
  }
  const change = before ? describeChange(before, after) : `the window ${JSON.stringify(after.windowTitle)} is open`;
  return [ran.observation, outcome === "ok" ? `Changes: ${change}.` : "", fileLine].filter(Boolean).join(" ");
}

/** Why an action that ran changed nothing, so the model tries something else (OBJ-26 round 2 fix 1, round 3 fix 3). */
function noEffectHint(action: ModelAction, before: Observation | undefined): string {
  const role = (n: number | undefined) => before?.elements.find((element) => element.n === n)?.role;
  const textRoles = ["textField", "textArea", "comboBox"];
  if (action.kind === ACTION.click && textRoles.includes(role(action.element) ?? "")) {
    return `clicking a text field only puts the cursor in it. Use ${ACTION.setValue} to fill it.`;
  }
  if (action.kind === ACTION.type && !textRoles.includes(role(before?.focused) ?? "")) {
    return "no text field has keyboard focus, so typing went nowhere.";
  }
  return "this action did not work here.";
}

/** The result's note, in the harness's words only: never screen text or model text (SPEC-05 r4, r8). */
function noteFor(
  reason: EndReason,
  status: ResultStatus,
  steps: number,
  streaks: Streaks,
  last: Observation | undefined,
  limits: Limits,
): string {
  const count = `${steps} ${steps === 1 ? "step" : "steps"}`;
  const kind = last?.layer?.kind;
  const front = kind && kind !== "window" ? `, with a ${kind} in front` : "";
  switch (reason) {
    case "finished":
    case "saved":
      return status === "done" ? `Done in ${count}.` : `Could not finish after ${count}${front}.`;
    case "stepLimit": {
      const stalled =
        streaks.noEffect > 0 ? ` The last ${streaks.noEffect === 1 ? "step" : `${streaks.noEffect} steps`} had no effect.` : "";
      return `Stopped after ${count} without finishing${front}.${stalled}`;
    }
    case "subtaskStepLimit":
      return `Stopped at the limit of ${limits.stepsPerSubtask} steps for this subtask${front}.`;
    case "attemptLimit":
      return `Stopped after ${limits.attemptsPerSubtask} attempts without finishing.`;
    case "noEffect":
      return `Stuck: ${streaks.noEffect} steps in a row had no effect${front}.`;
    case "invalidOutput":
      return `Stuck: ${streaks.invalidOutput} replies in a row did not fit the screen${front}.`;
    case "blocked":
      return "Stopped: Yumi's safety rules do not allow the next action.";
    case "macFailure":
      return status === "blocked"
        ? "Stopped: Yumi needs a permission to control the Mac."
        : "Stopped: the app's window could not be read.";
  }
}

function fit(line: string): string {
  return line.length <= MAX_OBSERVATION ? line : `${line.slice(0, MAX_OBSERVATION - 3)}...`;
}

/** The Mac app could not find the target window or app: "Stuck on screen". */
function isMissingWindow(error: unknown): boolean {
  return error instanceof MacGuiFailure && error.userError?.kind === "stuckOnScreen";
}

/**
 * Whether two looks show the same window in the same place: the title and the frame, within half a
 * point (an accessibility frame can shift by a fraction without the window having moved). A window
 * that moved, resized, or was replaced since the screenshot must not take a vision click (SPEC-05 r13).
 */
function sameWindow(before: Observation, after: Observation): boolean {
  if (before.windowTitle !== after.windowTitle) return false;
  const a = before.windowFrame;
  const b = after.windowFrame;
  if (a === undefined || b === undefined) return true;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * A file the step made, with the folder it is in, so the model knows where it went: "Q3 Report.pdf, in Documents".
 * Without the folder, a model told to save next to the deck went looking for the file (live Keynote runs, 2026-10-10).
 */
function fileAndFolder(path: Path): string {
  const parts = path.split("/");
  const name = parts.at(-1)!;
  const folder = parts.length > 2 ? parts.at(-2)! : "your home folder";
  return `${name}, in ${folder}`;
}

/** Text the instruction puts in quotes, such as a file name: "Q3 Report run 61". Straight or curly quotes. */
const QUOTED = /["\u201c]([^"\u201d]+)["\u201d]/g;

/** File types an instruction may ask for by name, and their extensions. */
const ASKED_TYPES: readonly (readonly [RegExp, readonly string[]])[] = [
  [/\bpdfs?\b/i, [".pdf"]],
  [/\bpowerpoint\b/i, [".pptx", ".ppt"]],
  [/\bpng\b/i, [".png"]],
  [/\bjpe?g\b/i, [".jpg", ".jpeg"]],
  [/\bgif\b/i, [".gif"]],
  [/\b(?:movie|video)\b/i, [".mov", ".m4v", ".mp4"]],
  [/\bword\b/i, [".docx", ".doc"]],
  [/\bexcel\b/i, [".xlsx", ".xls"]],
  [/\bcsv\b/i, [".csv"]],
];

/** Folders an instruction may ask for by name. */
const ASKED_FOLDERS = ["Desktop", "Documents", "Downloads"] as const;

/**
 * Whether a new file is the one the instruction asked for. When the instruction quotes names, the file's name,
 * with or without its extension, must be one of them. When it quotes nothing, the file must be of a type it names
 * ("as a PDF") and, if it names Desktop, Documents, or Downloads, in that folder. Compared without case.
 */
export function isAskedFile(path: Path, instruction: string): boolean {
  const name = path.split("/").at(-1)!.toLowerCase();
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const quoted = [...instruction.matchAll(QUOTED)].map((match) => match[1]!.trim().toLowerCase());
  if (quoted.length > 0) return quoted.some((text) => text === name || text === stem);
  const extension = dot > 0 ? name.slice(dot) : "";
  if (!ASKED_TYPES.some(([word, extensions]) => word.test(instruction) && extensions.includes(extension))) return false;
  const folder = (path.split("/").at(-2) ?? "").toLowerCase();
  const named = ASKED_FOLDERS.filter((asked) => new RegExp(`\\b${asked}\\b`, "i").test(instruction));
  return named.length === 0 || named.some((asked) => asked.toLowerCase() === folder);
}
