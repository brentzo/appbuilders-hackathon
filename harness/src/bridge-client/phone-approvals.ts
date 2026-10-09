import type {
  Approval,
  ApprovalAnsweredElsewhere,
  ApprovalDecision,
  ApprovalWaitingElsewhere,
  DeviceId,
  Payload,
  Uuid,
} from "@yumi/protocol/types";
import type { AskElsewhere } from "../approvals/approval-flow.ts";
import { describeError, type Logger } from "../log.ts";
import type { UndeliveredReason } from "./client.ts";
import type { PhoneBridge } from "./delegated-goals.ts";

/**
 * Approvals for a goal from the phone are asked on the phone (SPEC-09 r10, OBJ-70): the approval goes out as an
 * `approvalRequest` command, and the phone's answer comes back as its `approvalResponse` result. Meanwhile the Mac app
 * shows only a banner (`approvalWaitingElsewhere`), closed by `approvalAnsweredElsewhere` or `approvalCancelled`.
 * The approval flow keeps every rule it has for the Mac's own cards: a delete answered by voice is asked again, the
 * real data is checked again before acting, and with no answer in 5 minutes the task pauses.
 */
export class PhoneApprovals implements AskElsewhere {
  /** Approvals waiting on the phone, by command id. */
  private readonly waiting = new Map<Uuid, { approvalId: Uuid; answer: (answer: ApprovalDecision | "failed") => void }>();

  constructor(
    private readonly deps: {
      bridge: PhoneBridge;
      /** The Mac app, for the banner. */
      app: { emit(event: string, payload: unknown): unknown };
      logger: Logger;
    },
  ) {}

  isOtherDevice(deviceId: DeviceId): boolean {
    try {
      return this.deps.bridge.isPaired(deviceId);
    } catch {
      // The bridge database is closed: the harness is shutting down.
      return false;
    }
  }

  async askElsewhere(
    originDeviceId: DeviceId,
    approval: Approval,
    taskId: Uuid,
    abort: Promise<void>,
  ): Promise<ApprovalDecision | "failed" | "aborted"> {
    const request: Payload = {
      kind: "approvalRequest",
      id: approval.id,
      stepId: approval.stepId,
      approvalKind: approval.kind,
      ...(approval.recipients ? { recipients: approval.recipients } : {}),
      ...(approval.files ? { files: approval.files } : {}),
      text: approval.text,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
    };
    let answer!: (value: ApprovalDecision | "failed") => void;
    const answered = new Promise<ApprovalDecision | "failed">((resolve) => (answer = resolve));
    let messageId: Uuid;
    try {
      messageId = await this.deps.bridge.sendMessage(originDeviceId, "command", request, undefined, taskId);
    } catch (error) {
      this.deps.logger.warn("phoneApprovals.notSent", { approvalId: approval.id, ...describeError(error) });
      return "failed";
    }
    this.waiting.set(messageId, { approvalId: approval.id, answer });
    const banner: ApprovalWaitingElsewhere = {
      approvalId: approval.id,
      taskId,
      askingDeviceId: originDeviceId,
      approvalKind: approval.kind,
    };
    this.deps.app.emit("approvalWaitingElsewhere", banner);
    this.deps.logger.info("phoneApprovals.asked", { taskId, approvalId: approval.id, kind: approval.kind });
    try {
      const result = await Promise.race([answered, abort.then(() => "aborted" as const)]);
      if (result !== "aborted" && result !== "failed") {
        const closed: ApprovalAnsweredElsewhere = { approvalId: approval.id };
        this.deps.app.emit("approvalAnsweredElsewhere", closed);
      }
      return result;
    } finally {
      this.waiting.delete(messageId);
    }
  }

  /** The phone's answer, as the result of the request it answers. */
  answered(payload: Extract<Payload, { kind: "approvalResponse" }>, replyTo: Uuid | undefined): void {
    const waiting = this.waiting.get(replyTo ?? "");
    if (waiting?.approvalId === payload.approvalId) waiting.answer(payload.decision);
    else this.deps.logger.info("phoneApprovals.lateAnswer", { approvalId: payload.approvalId });
  }

  /** The relay could not deliver the request: the flow treats it as an approval it could not ask. */
  undelivered(messageId: Uuid, _reason: UndeliveredReason): void {
    this.waiting.get(messageId)?.answer("failed");
  }

  /** An approval the phone was asked is no longer open, so the phone closes its card (SPEC-06 r5). */
  approvalCancelled(originDeviceId: DeviceId, approvalId: Uuid): void {
    this.deps.bridge
      .sendMessage(originDeviceId, "event", { kind: "approvalCancelled", approvalId })
      .catch((error: unknown) => this.deps.logger.warn("phoneApprovals.cancelNotSent", { approvalId, ...describeError(error) }));
  }
}
