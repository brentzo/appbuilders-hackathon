import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import type {
  Approval,
  ApprovalCancelled,
  ApprovalDecision,
  FileSummary,
  Lane,
  LayerKind,
  MoveToTrashResult,
  Observation,
  Path,
  ReadFieldValuesResult,
  RecordedAction,
  Step,
  Subtask,
  Target,
  Uuid,
} from "@yumi/protocol/types";
import { aborted, type RunControl } from "../control/run-control.ts";
import { describeError, type Logger } from "../log.ts";
import type { MacAppCaller } from "../router/index.ts";
import type { GateDecision } from "../safety/gate.ts";
import { realHome } from "../safety/paths.ts";
import { checkTrash } from "../safety/trash.ts";
import { describeSkipped } from "../scheduler/describe.ts";
import type { TaskStore } from "../store/task-store.ts";
import { actionText, deleteText, sendText, type SendKind } from "./copy.ts";
import { parseRecipients, sendApp } from "./recipients.ts";

/**
 * The approval flow (SPEC-07 r5, r10-r15, SPEC-06 r5, OBJ-38.1 to OBJ-38.4): what happens when the permission gate
 * says an action asks, or that it is blocked.
 *
 * `ApprovalGate` is the seam the step loops call: the helper lane's tool steps here, and OBJ-36's `gui_act` step
 * loop for a Send button or key. OBJ-36 is built at the same time; if it lands with its own seam, this is the
 * interface to reconcile it with.
 *
 * For an action that asks, `request`:
 * 1. builds the approval from real data only: the To and Cc fields read through `readFieldValues` for a send, and
 *    the real file list for a delete. Never from model text.
 * 2. writes the `Approval`, sets the subtask to `needsApproval` and the task to `waitingForUser`, and shows the card
 *    on the Mac with `showApprovalCard`.
 * 3. accepts a delete only by a tap (r11): a voice "yes" shows the same card again. A send may be approved by a tap
 *    or by saying "send it" (r15), which the Mac app reports as `method: voice`. An unclassified risky click or key
 *    press (r6) gets an `action` card, worded from the resolved action, and is tap-only like a delete (OBJ-38.11).
 * 4. right before the action runs, reads the recipients, lists the files, or looks at the window again; if anything
 *    changed, it drops the approval and asks again with the new data (r12, r14). For an action, the element it acts
 *    on must still be there with the same role and label.
 * 5. closes the approval as used: it covers exactly this one action, once.
 *
 * A pause or cancel cancels every open approval (`cancelAll`) and tells the apps with `approvalCancelled`, so the
 * card closes and a late tap is ignored (SPEC-06 r5). The step loop then records the step as not done, and after a
 * resume the action goes through the gate and asks again.
 */

/** The approval text says, for example, "I'm about to send this email to Ana." Approvals expire after 5 minutes. */
export const APPROVAL_LIFETIME_MS = 5 * 60_000;

/** For a send: the window it happens in and the element paths of its To and Cc fields, from the real tree. */
export interface SendFields {
  target: Target;
  /** The app's name as the Mac app reported it (`Observation.app`). */
  app: string;
  /** Element paths of the To fields (`findRecipientFields`, resolved by the step loop). */
  to: string[];
  /** Element paths of the Cc fields. Empty in apps without Cc. */
  cc: string[];
}

export interface ApprovalContext {
  /** The subtask, which is running. */
  subtask: Subtask;
  /** The step, already written with the gate's level before anything runs (SPEC-02 r3). */
  step: Step;
  lane: Lane;
  /** The run's pause state. */
  control: RunControl;
  /** Required for a send. */
  send?: SendFields;
  /** The app the action was in, as the Mac app reported it, to name a blocked action (SPEC-07 r5). */
  app?: string | undefined;
  /** The window a GUI action happens in. Required for an `action` card, which looks at it again before the action. */
  target?: Target;
  /** What was in front in the window when the model chose the action, to name it. */
  layer?: LayerKind | undefined;
}

/** Why there is nothing the user can approve, so the action is not run. */
export type Unavailable =
  /** The gate asks, but there is no card for this action: only sends and `move_to_trash` deletes have one. */
  | "noApprovalCard"
  /** The To field could not be read, or has nobody in it. */
  | "noRecipients"
  /** The files to delete are no longer there to list. */
  | "filesGone"
  /** The Mac app could not show the card. */
  | "couldNotAsk"
  /** The element an unclassified action acts on is gone or is a different one now. */
  | "actionChanged";

export type ApprovalAnswer =
  /** Approved, checked again, and closed as used: the action may run now, once. */
  | { outcome: "approved"; approval: Approval; files?: FileSummary }
  /** The user said no. */
  | { outcome: "declined"; approval: Approval }
  /** A pause or cancel dropped the approval before the action ran. Nothing ran. */
  | { outcome: "cancelled" }
  | { outcome: "unavailable"; reason: Unavailable };

/**
 * "Keep going" on the blocked-action card, which the app sends as `resumeTask`, or "cancelled" when the user pressed
 * "Stop" (`cancelTask`) or a pause or cancel closed the card first (gap G6, resolved in OBJ-45).
 */
export type BlockedAnswer = "keepGoing" | "cancelled";

export interface ApprovalGate {
  /** Asks the user about one action the gate said asks for (`decision.level === "ask"`). */
  request(decision: GateDecision, context: ApprovalContext, signal: AbortSignal): Promise<ApprovalAnswer>;
  /**
   * Tells the user a blocked action was skipped (SPEC-07 r5) and waits for "Keep going" or "Stop". The step is
   * already recorded as blocked; the action never runs, whatever the answer.
   */
  blocked(context: Omit<ApprovalContext, "send">, signal: AbortSignal): Promise<BlockedAnswer>;
  /** Moves exactly these approved paths to the Trash through the Mac app. Never deletes permanently (SPEC-07 r7). */
  moveToTrash(paths: readonly Path[]): Promise<{ trashed: Path[] } | { failed: true }>;
}

export interface ApprovalFlowDeps {
  store: TaskStore;
  logger: Logger;
  /** The Mac app: `showApprovalCard`, `readFieldValues`, and `moveToTrash`. */
  mac: MacAppCaller;
  /** Sends an event to the apps: `approvalCancelled`. */
  emit(event: string, payload: unknown): unknown;
  /** Sends a `userError` to the device the user spoke to. */
  userError(originDeviceId: string, error: { kind: "blockedAction"; taskId: Uuid; skippedAction?: string }): void;
  /** The user's home folder, for listing the files again. Tests pass a temporary one. */
  home: string;
  now?: () => Date;
  /** Asks on the other device for a task from it (SPEC-09 r10). Without it, every card shows on the Mac. */
  elsewhere?: AskElsewhere;
  /** An approval got no answer by its `expiresAt`: the task pauses (SPEC-09 r10). */
  onExpired?: (taskId: Uuid) => void;
}

/** The device link's part in approvals: asking on the phone, and closing the phone's card. */
export interface AskElsewhere {
  isOtherDevice(deviceId: string): boolean;
  askElsewhere(
    originDeviceId: string,
    approval: Approval,
    taskId: Uuid,
    abort: Promise<void>,
  ): Promise<ApprovalDecision | "failed" | "aborted">;
  approvalCancelled(originDeviceId: string, approvalId: Uuid): void;
}

type Subject =
  | { kind: "send"; send: SendFields; sendKind: SendKind; cc: boolean }
  | { kind: "delete"; paths: string[] }
  | { kind: "action"; recorded: RecordedAction; target: Target; app: string | undefined; text: string };

type Content =
  | { kind: "send"; to: string[]; cc: string[]; text: string }
  | { kind: "delete"; files: FileSummary; fingerprints: string[]; text: string }
  | { kind: "action"; app: string | undefined; element: string; text: string };

type Built = { ok: true; content: Content } | { ok: false; reason: Unavailable };

type CardAnswer = ApprovalDecision | "cancelled" | "failed";

export class ApprovalFlow implements ApprovalGate {
  /** Cards on screen, by approval id: how to end the wait when a pause or cancel drops the approval. */
  private readonly cards = new Map<Uuid, { taskId: Uuid; cancel: () => void }>();
  /** Blocked-action cards on screen, by step id. */
  private readonly blockedCards = new Map<Uuid, { taskId: Uuid; answer: (choice: BlockedAnswer) => void }>();
  private readonly now: () => Date;

  constructor(private readonly deps: ApprovalFlowDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async request(decision: GateDecision, context: ApprovalContext, signal: AbortSignal): Promise<ApprovalAnswer> {
    const { store, logger } = this.deps;
    const { subtask, step, control } = context;
    const log = { taskId: subtask.taskId, subtaskId: subtask.id, stepId: step.id };
    const target = this.targetOf(decision, context);
    if ("reason" in target) {
      logger.warn("approval.unavailable", { ...log, rule: decision.rule, reason: target.reason });
      return { outcome: "unavailable", reason: target.reason };
    }

    for (;;) {
      // Nothing asks while a pause holds (SPEC-06 r5); a helper waits here for the resume.
      if (!(await control.untilMayAsk(signal))) return { outcome: "cancelled" };
      // Read the recipients or list the files for this card, so it shows what is there now.
      const built = await this.build(target);
      if (!built.ok) {
        logger.warn("approval.unavailable", { ...log, rule: decision.rule, reason: built.reason });
        return { outcome: "unavailable", reason: built.reason };
      }
      if (!control.mayAsk() || signal.aborted) continue;
      const content = built.content;
      const approval = this.newApproval(step.id, content);
      store.addApproval(approval);
      logger.info("approval.requested", { ...log, approvalId: approval.id, kind: approval.kind, ...countOf(content) });

      const answer = await this.ask(approval, context, signal);
      if (answer === "cancelled") return { outcome: "cancelled" };
      if (answer === "failed") {
        this.close(approval.id, "cancelled");
        return { outcome: "unavailable", reason: "couldNotAsk" };
      }
      if (this.isClosed(approval.id)) return { outcome: "cancelled" };
      const decided = store.decideApproval(approval.id, answer).approval;
      if (!answer.approved) {
        store.closeApproval(approval.id, "declined");
        logger.info("approval.declined", { ...log, approvalId: approval.id, method: answer.method });
        return { outcome: "declined", approval: decided };
      }

      // Right before acting, check the recipients or the files again (r12, r14).
      const now = await this.build(target);
      if (this.isClosed(approval.id) || !control.mayAct(context.lane) || signal.aborted) {
        this.close(approval.id, "cancelled");
        return { outcome: "cancelled" };
      }
      if (!now.ok || !sameContent(content, now.content)) {
        // Ask again with what is there now, or stop if the files are gone.
        store.closeApproval(approval.id, "changed");
        logger.info("approval.changed", { ...log, approvalId: approval.id, kind: approval.kind });
        continue;
      }
      store.closeApproval(approval.id, "used");
      logger.info("approval.approved", { ...log, approvalId: approval.id, method: answer.method });
      return {
        outcome: "approved",
        approval: decided,
        ...(content.kind === "delete" ? { files: content.files } : {}),
      };
    }
  }

  async blocked(context: Omit<ApprovalContext, "send">, signal: AbortSignal): Promise<BlockedAnswer> {
    const { store, logger } = this.deps;
    const { subtask, step, control, app } = context;
    if (!(await control.untilMayAsk(signal))) return "cancelled";
    const task = store.getTask(subtask.taskId);
    if (!task) throw new Error(`No task ${subtask.taskId}`);
    const waiting = this.enterWait(context, false);
    try {
      const answer = new Promise<BlockedAnswer>((resolve) =>
        this.blockedCards.set(step.id, { taskId: subtask.taskId, answer: resolve }),
      );
      // Names what was skipped: "I can't click File in Keynote." (SPEC-07 r5).
      const skippedAction = describeSkipped(step.action, app);
      this.deps.userError(task.originDeviceId, {
        kind: "blockedAction",
        taskId: task.id,
        ...(skippedAction ? { skippedAction } : {}),
      });
      logger.info("blocked.asked", { taskId: task.id, subtaskId: subtask.id, stepId: step.id });
      const choice = await Promise.race([answer, aborted(signal).then(() => "cancelled" as const)]);
      logger.info("blocked.answered", { taskId: task.id, stepId: step.id, choice });
      return choice;
    } finally {
      this.blockedCards.delete(step.id);
      this.leaveWait(context, waiting);
    }
  }

  /**
   * The user's "Keep going" on a task's blocked-action card, which the app sends as `resumeTask`. Returns false when
   * no card of that task is waiting, so the call is an ordinary resume. "Stop" is `cancelTask`, which closes the card
   * through `cancelAll`.
   */
  keepGoing(taskId: Uuid): boolean {
    for (const [stepId, card] of this.blockedCards) {
      if (card.taskId !== taskId) continue;
      this.blockedCards.delete(stepId);
      card.answer("keepGoing");
      return true;
    }
    return false;
  }

  /**
   * Cancels every open approval and blocked-action card of a task (SPEC-06 r5, r8), for a pause or a cancel: each
   * open card gets `approvalCancelled`, so the app closes it and ignores a late tap.
   */
  cancelAll(taskId: Uuid): void {
    for (const open of this.deps.store.listOpenApprovals(taskId)) this.close(open.approval.id, "cancelled");
    for (const [stepId, card] of this.blockedCards) {
      if (card.taskId !== taskId) continue;
      this.blockedCards.delete(stepId);
      card.answer("cancelled");
    }
  }

  async moveToTrash(paths: readonly Path[]): Promise<{ trashed: Path[] } | { failed: true }> {
    try {
      const result = (await this.deps.mac.request("moveToTrash", { paths: [...paths] })) as MoveToTrashResult;
      // Only what was asked can count as moved, whatever the app answers.
      return { trashed: result.trashed.filter((path) => paths.includes(path)) };
    } catch (error) {
      this.deps.logger.error("trash.failed", { count: paths.length, ...describeError(error) });
      return { failed: true };
    }
  }

  /** What the approval is about, from the gate's decision and the real window. Never from model text. */
  private targetOf(decision: GateDecision, context: ApprovalContext): Subject | { reason: Unavailable } {
    const { action } = decision.recorded;
    if (decision.rule === "delete" && action.kind === "tool" && action.call.tool === "move_to_trash" && decision.files) {
      return { kind: "delete", paths: [...action.call.paths] };
    }
    if (decision.rule === "send" && context.send) {
      const app = sendApp(context.send.app);
      if (app && context.send.to.length > 0) return { kind: "send", send: context.send, sendKind: app.kind, cc: app.cc };
      return { reason: "noRecipients" };
    }
    const gui = ["click", "clickAt", "key"].includes(action.kind);
    if (decision.rule === "unclassified" && gui && context.target) {
      const what = describeSkipped(decision.recorded, context.app, context.layer);
      return {
        kind: "action",
        recorded: decision.recorded,
        target: context.target,
        app: context.app,
        text: actionText(what, context.app),
      };
    }
    return { reason: "noApprovalCard" };
  }

  /** Reads the real recipients, lists the real files, or looks at the real window. */
  private async build(target: Subject): Promise<Built> {
    if (target.kind === "action") return this.buildAction(target);
    if (target.kind === "delete") {
      // The same check the gate made, on the real home folder, so the list is the one it would build now.
      const check = checkTrash(target.paths, realHome(this.deps.home));
      if (check.level !== "ask") return { ok: false, reason: "filesGone" };
      return {
        ok: true,
        content: {
          kind: "delete",
          files: check.files,
          fingerprints: check.files.allPaths.map(fingerprint),
          text: deleteText(check.files),
        },
      };
    }
    const { send } = target;
    const cc = target.cc ? send.cc : [];
    let result: ReadFieldValuesResult;
    try {
      result = (await this.deps.mac.request("readFieldValues", {
        target: send.target,
        elementPaths: [...send.to, ...cc],
      })) as ReadFieldValuesResult;
    } catch (error) {
      this.deps.logger.error("approval.readFieldsFailed", describeError(error));
      return { ok: false, reason: "noRecipients" };
    }
    const values = new Map(result.fields.map((field) => [field.elementPath, field.value]));
    // A To field that is not there any more cannot be checked, so there is nothing to approve.
    if (send.to.some((path) => values.get(path) === undefined)) return { ok: false, reason: "noRecipients" };
    const to = send.to.flatMap((path) => parseRecipients(values.get(path)));
    const ccNames = cc.flatMap((path) => parseRecipients(values.get(path)));
    if (to.length === 0) return { ok: false, reason: "noRecipients" };
    return { ok: true, content: { kind: "send", to, cc: ccNames, text: sendText(target.sendKind, to, ccNames) } };
  }

  /**
   * Looks at the window the action happens in: the app must be the same, and an element action's element must still
   * be there with the role and label the gate checked. The text is the summary built from the resolved action.
   */
  private async buildAction(target: Extract<Subject, { kind: "action" }>): Promise<Built> {
    let observation: Observation;
    try {
      observation = (await this.deps.mac.request("observeWindow", { target: target.target })) as Observation;
    } catch (error) {
      this.deps.logger.error("approval.observeFailed", describeError(error));
      return { ok: false, reason: "actionChanged" };
    }
    if (target.app !== undefined && observation.app !== target.app) return { ok: false, reason: "actionChanged" };
    const { action, element } = target.recorded;
    let signature = "";
    if (action.kind === "click") {
      const now = observation.elements.find((candidate) => candidate.n === action.element);
      if (!now || !element || now.role !== element.role || now.label !== element.label) {
        return { ok: false, reason: "actionChanged" };
      }
      signature = `${now.role}:${now.label}`;
    }
    return { ok: true, content: { kind: "action", app: observation.app, element: signature, text: target.text } };
  }

  private newApproval(stepId: Uuid, content: Content): Approval {
    const requested = this.now();
    const common = {
      id: randomUUID(),
      stepId,
      text: content.text,
      requestedAt: requested.toISOString(),
      expiresAt: new Date(requested.getTime() + APPROVAL_LIFETIME_MS).toISOString(),
    };
    switch (content.kind) {
      case "send":
        return { ...common, kind: "send", recipients: [...content.to, ...content.cc] };
      case "delete":
        return { ...common, kind: "delete", files: content.files };
      case "action":
        return { ...common, kind: "action" };
    }
  }

  /** Shows the card until the user answers in a way that counts, or a pause or cancel drops the approval. */
  private async ask(approval: Approval, context: ApprovalContext, signal: AbortSignal): Promise<CardAnswer> {
    const waiting = this.enterWait(context, true);
    try {
      for (;;) {
        const answer = await this.showCard(approval, context.subtask.taskId, signal);
        if (typeof answer === "string") return answer;
        if (approval.kind !== "send" && answer.approved && answer.method !== "tap") {
          // Saying "yes" is not enough to delete (r11) or to allow an unclassified action (r6): the card stays until
          // the user taps a button.
          this.deps.logger.warn("approval.needsTap", { approvalId: approval.id, kind: approval.kind, method: answer.method });
          continue;
        }
        return answer;
      }
    } finally {
      this.leaveWait(context, waiting);
    }
  }

  /**
   * Shows the card on the device the user spoke to: the Mac app's card, or for a task from the phone, the phone's,
   * while the Mac app shows only a banner (SPEC-09 r10). With no answer by `expiresAt`, the approval closes and the
   * task pauses.
   */
  private async showCard(approval: Approval, taskId: Uuid, signal: AbortSignal): Promise<CardAnswer> {
    let cancel!: () => void;
    const cancelled = new Promise<"cancelled">((resolve) => (cancel = () => resolve("cancelled")));
    this.cards.set(approval.id, { taskId, cancel });
    const onAbort = () => this.close(approval.id, "cancelled");
    signal.addEventListener("abort", onAbort, { once: true });
    let expire!: () => void;
    const expired = new Promise<"expired">((resolve) => (expire = () => resolve("expired")));
    // Wall time: an approval lasts 5 minutes from when it was asked, whatever the flow's clock says.
    const timer = setTimeout(expire, Math.max(0, Date.parse(approval.expiresAt) - Date.now()));
    try {
      if (signal.aborted || this.isClosed(approval.id)) {
        this.close(approval.id, "cancelled");
        return "cancelled";
      }
      const origin = this.deps.store.getTask(taskId)?.originDeviceId;
      const elsewhere = origin !== undefined && this.deps.elsewhere?.isOtherDevice(origin) ? this.deps.elsewhere : undefined;
      const shown: Promise<CardAnswer> = elsewhere
        ? elsewhere
            .askElsewhere(
              origin!,
              approval,
              taskId,
              Promise.race([cancelled, expired]).then(() => undefined),
            )
            .then((answer) => (answer === "aborted" ? "cancelled" : answer))
        : this.deps.mac.request("showApprovalCard", { approval }).then(
            (decision) => decision as ApprovalDecision,
            (error: unknown) => {
              this.deps.logger.error("approval.cardFailed", { approvalId: approval.id, ...describeError(error) });
              return "failed" as const;
            },
          );
      const answer = await Promise.race([shown, cancelled, expired]);
      if (answer !== "expired") return answer;
      this.deps.logger.info("approval.expired", { taskId, approvalId: approval.id });
      this.close(approval.id, "cancelled");
      this.deps.onExpired?.(taskId);
      return "cancelled";
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      this.cards.delete(approval.id);
    }
  }

  /**
   * Closes an approval that is still open, if it is. A card still on screen gets `approvalCancelled` and its wait
   * ends.
   */
  private close(id: Uuid, closed: "cancelled"): void {
    const stored = this.deps.store.getApproval(id);
    if (!stored || stored.closed) return;
    this.deps.store.closeApproval(id, closed);
    if (!stored.approval.decision) {
      const payload: ApprovalCancelled = { approvalId: id };
      // The Mac app closes its card or banner; a phone asked for it closes its card too.
      this.deps.emit("approvalCancelled", payload);
      const origin = this.deps.store.getTask(stored.taskId)?.originDeviceId;
      if (origin !== undefined && this.deps.elsewhere?.isOtherDevice(origin)) this.deps.elsewhere.approvalCancelled(origin, id);
      this.deps.logger.info("approval.cancelled", { taskId: stored.taskId, approvalId: id });
    }
    this.cards.get(id)?.cancel();
  }

  private isClosed(id: Uuid): boolean {
    return this.deps.store.getApproval(id)?.closed !== undefined;
  }

  /**
   * The subtask waits for the user: an approval sets it to `needsApproval`, and the task is `waitingForUser` while
   * any of its subtasks waits. Returns whether this call moved the subtask.
   */
  private enterWait(context: Pick<ApprovalContext, "subtask" | "control">, approval: boolean): boolean {
    const { store } = this.deps;
    const { subtask, control } = context;
    control.setWaiting(subtask.id, true);
    let moved = false;
    if (approval && store.getSubtask(subtask.id)?.status === "running") {
      store.setSubtaskStatus(subtask.id, "needsApproval");
      moved = true;
    }
    if (store.getTask(subtask.taskId)?.status === "running") store.setTaskStatus(subtask.taskId, "waitingForUser");
    return moved;
  }

  /**
   * Done waiting. The subtask goes back to running unless a pause or cancel stopped it; then the pause or cancel
   * sets its status. The task goes back to running when nothing else waits and nothing paused it.
   */
  private leaveWait(context: Pick<ApprovalContext, "subtask" | "control" | "lane">, moved: boolean): void {
    const { store } = this.deps;
    const { subtask, control } = context;
    control.setWaiting(subtask.id, false);
    if (moved && control.mayAct(context.lane) && store.getSubtask(subtask.id)?.status === "needsApproval") {
      store.setSubtaskStatus(subtask.id, "running");
    }
    if (control.waitingCount === 0 && store.getTask(subtask.taskId)?.status === "waitingForUser") {
      store.setTaskStatus(subtask.taskId, "running");
    }
  }
}

/** A file's identity and last change, so a file changed after the card was shown asks again (r12). */
function fingerprint(path: string): string {
  try {
    const stat = lstatSync(path);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.isDirectory() ? "d" : "f"}`;
  } catch {
    return "missing";
  }
}

function sameContent(a: Content, b: Content): boolean {
  if (a.kind === "send" && b.kind === "send") return sameList(a.to, b.to) && sameList(a.cc, b.cc);
  if (a.kind === "delete" && b.kind === "delete") {
    return sameList(a.files.allPaths, b.files.allPaths) && sameList(a.fingerprints, b.fingerprints);
  }
  if (a.kind === "action" && b.kind === "action") return a.app === b.app && a.element === b.element;
  return false;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function countOf(content: Content): { count: number } {
  switch (content.kind) {
    case "delete":
      return { count: content.files.count };
    case "send":
      return { count: content.to.length + content.cc.length };
    case "action":
      return { count: 1 };
  }
}
