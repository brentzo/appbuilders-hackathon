import {
  APPROVAL_REQUEST_EXPIRY_SECONDS,
  COMMAND_EXPIRY_SECONDS,
  EVENT_EXPIRY_SECONDS,
  RESULT_EXPIRY_SECONDS,
  type ApprovalDecision,
  type ApprovalKind,
  type EnvelopeType,
  type ErrorKind,
} from "../generated/ts/index.ts";
import { MAX_EXPIRY_CLOCK_SKEW_SECONDS } from "./expiry.ts";
import { validate, type ValidationResult } from "./index.ts";

export type MessageExpiryKind = "command" | "approvalRequest" | "result" | "event";

const EXPIRY_SECONDS: Record<MessageExpiryKind, number> = {
  command: COMMAND_EXPIRY_SECONDS,
  approvalRequest: APPROVAL_REQUEST_EXPIRY_SECONDS,
  result: RESULT_EXPIRY_SECONDS,
  event: EVENT_EXPIRY_SECONDS,
};

const ENVELOPE_TYPE_BY_KIND: Record<string, EnvelopeType> = {
  toolList: "event",
  toolCall: "command",
  toolResult: "result",
  delegateGoal: "command",
  goalAccepted: "result",
  progress: "event",
  goalFinished: "event",
  approvalRequest: "command",
  approvalResponse: "result",
  approvalCancelled: "event",
  pause: "command",
  resume: "command",
  cancel: "command",
  pauseConfirmed: "result",
  cancelConfirmed: "result",
  resumeConfirmed: "result",
  commandExpired: "result",
  ping: "command",
  pingResult: "result",
};

const EXPIRY_KIND_BY_PAYLOAD_KIND: Record<string, MessageExpiryKind> = {
  toolList: "event",
  toolCall: "command",
  toolResult: "result",
  delegateGoal: "command",
  goalAccepted: "result",
  progress: "event",
  goalFinished: "event",
  approvalRequest: "approvalRequest",
  approvalResponse: "result",
  approvalCancelled: "event",
  pause: "command",
  resume: "command",
  cancel: "command",
  pauseConfirmed: "result",
  cancelConfirmed: "result",
  resumeConfirmed: "result",
  commandExpired: "result",
  ping: "command",
  pingResult: "result",
};

/** Validates an encrypted payload and ensures its kind uses the matching envelope type. */
export function validateMessagePayload(payload: unknown, envelopeType: EnvelopeType): ValidationResult {
  const result = validate("Payload", payload);
  if (!result.valid) return result;
  const kind = (payload as { kind: string }).kind;
  if (ENVELOPE_TYPE_BY_KIND[kind] !== envelopeType) {
    return { valid: false, errors: [`/kind ${kind} requires envelope type ${ENVELOPE_TYPE_BY_KIND[kind]}`] };
  }
  if (kind === "approvalRequest") {
    const request = payload as { requestedAt: string; expiresAt: string };
    if (Date.parse(request.expiresAt) - Date.parse(request.requestedAt) !== APPROVAL_REQUEST_EXPIRY_SECONDS * 1000) {
      return { valid: false, errors: ["/expiresAt must be exactly five minutes after /requestedAt"] };
    }
  }
  return result;
}

/** Returns the expiry policy for a valid payload, or null for an invalid payload/envelope pairing. */
export function getMessageExpiryKind(payload: unknown, envelopeType: EnvelopeType): MessageExpiryKind | null {
  if (!validateMessagePayload(payload, envelopeType).valid) return null;
  return EXPIRY_KIND_BY_PAYLOAD_KIND[(payload as { kind: string }).kind] ?? null;
}

/** Checks that an opened payload is current and has no more than its kind's lifetime plus clock-skew allowance remaining. */
export function validateMessageExpiry(
  payload: unknown,
  envelopeType: EnvelopeType,
  expiresAt: string,
  now: Date = new Date(),
): { valid: true; kind: MessageExpiryKind } | { valid: false; reason: "invalidPayload" | "expired" | "badExpiry" } {
  const kind = getMessageExpiryKind(payload, envelopeType);
  if (!kind) return { valid: false, reason: "invalidPayload" };
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return { valid: false, reason: "badExpiry" };
  if (kind === "approvalRequest" && Date.parse((payload as { expiresAt: string }).expiresAt) !== expiry) {
    return { valid: false, reason: "badExpiry" };
  }
  if (now.getTime() >= expiry) return { valid: false, reason: "expired" };
  const maxRemaining = (EXPIRY_SECONDS[kind] + MAX_EXPIRY_CLOCK_SKEW_SECONDS) * 1000;
  if (expiry - now.getTime() > maxRemaining) return { valid: false, reason: "badExpiry" };
  return { valid: true, kind };
}

/** An approved delete or unclassified action must have a tap decision, even if an app fails to enforce the payload schema. */
export function isApprovalDecisionAllowed(approvalKind: ApprovalKind, decision: ApprovalDecision): boolean {
  if (!validate("ApprovalDecision", decision).valid) return false;
  return approvalKind === "send" || !decision.approved || decision.method === "tap";
}

/** Returns the structured ErrorKind from a failed tool result, never a user-facing free-text error. */
export function toolResultError(payload: unknown): ErrorKind | null {
  if (!validateMessagePayload(payload, "result").valid) return null;
  const result = payload as { kind: string; success: boolean; error?: ErrorKind };
  return result.kind === "toolResult" && !result.success ? (result.error ?? null) : null;
}
