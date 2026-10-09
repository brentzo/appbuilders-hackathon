import { describe, expect, it } from "vitest";
import { getMessageExpiryKind, isApprovalDecisionAllowed, toolResultError, validateMessageExpiry, validateMessagePayload } from "../src/messages.ts";
import { expiresAt } from "../src/crypto.ts";

const now = new Date("2026-10-09T12:00:00.000Z");
const approvalRequest = {
  kind: "approvalRequest",
  id: "5b0c6f8e-2f4d-4c1a-9a57-1f0e2d3c4b5a",
  stepId: "6b0c6f8e-2f4d-4c1a-9a57-1f0e2d3c4b5a",
  approvalKind: "send",
  recipients: ["ana@example.com"],
  text: "I'm about to send this email to Ana. Should I send it?",
  requestedAt: now.toISOString(),
  expiresAt: "2026-10-09T12:05:00.000Z",
};
const pause = { kind: "pause", goalId: "5b0c6f8e-2f4d-4c1a-9a57-1f0e2d3c4b5a" };
const delegateGoal = {
  kind: "delegateGoal",
  goalId: "5b0c6f8e-2f4d-4c1a-9a57-1f0e2d3c4b5a",
  confirmedGoal: "Export my Keynote deck as a PDF",
  originDeviceId: "3f2a9c1e7b4d6a8f0e1c2b3a4d5e6f70",
  spokenAt: now.toISOString(),
};

describe("cross-device message payloads", () => {
  it("accepts a phone alarm call only in a command envelope", () => {
    const payload = { kind: "toolCall", call: { tool: "set_alarm", time: "06:30" } };
    expect(validateMessagePayload(payload, "command").valid).toBe(true);
    expect(validateMessagePayload(payload, "event").valid).toBe(false);
  });

  it("requires structured ErrorKind failures instead of raw error text", () => {
    expect(validateMessagePayload({ kind: "toolResult", success: false, error: "otherDeviceOffline" }, "result").valid).toBe(true);
    expect(validateMessagePayload({ kind: "toolResult", success: false, error: "offline because socket closed" }, "result").valid).toBe(false);
  });

  it("rejects voice approval for an approved delete", () => {
    const payload = {
      kind: "approvalResponse",
      approvalId: "5b0c6f8e-2f4d-4c1a-9a57-1f0e2d3c4b5a",
      decision: { approved: true, method: "voice" as const, decidedAt: "2026-10-09T12:00:00.000Z" },
    };
    expect(validateMessagePayload(payload, "result").valid).toBe(true);
    expect(isApprovalDecisionAllowed("send", payload.decision)).toBe(true);
    expect(isApprovalDecisionAllowed("delete", payload.decision)).toBe(false);
  });

  it("accepts a generic action request and rejects voice approval", () => {
    const { recipients: _recipients, ...withoutRecipients } = approvalRequest;
    const request = {
      ...withoutRecipients,
      approvalKind: "action",
      text: "I'm about to click Save in Finder. Should I allow it?",
    };
    const voice = { approved: true, method: "voice" as const, decidedAt: now.toISOString() };
    const tap = { approved: true, method: "tap" as const, decidedAt: now.toISOString() };
    expect(validateMessagePayload(request, "command").valid).toBe(true);
    expect(validateMessagePayload({ ...request, recipients: ["ana@example.com"] }, "command").valid).toBe(false);
    expect(isApprovalDecisionAllowed("action", voice)).toBe(false);
    expect(isApprovalDecisionAllowed("action", tap)).toBe(true);
  });

  it("uses the five-minute expiry for approval requests and two minutes for other commands", () => {
    expect(getMessageExpiryKind(approvalRequest, "command")).toBe("approvalRequest");
    expect(getMessageExpiryKind(delegateGoal, "command")).toBe("command");
    expect(getMessageExpiryKind(approvalRequest, "event")).toBeNull();
    expect(validateMessageExpiry(approvalRequest, "command", expiresAt("approvalRequest", now), now)).toEqual({ valid: true, kind: "approvalRequest" });
    expect(validateMessageExpiry(approvalRequest, "command", "2026-10-09T12:04:59.000Z", now)).toMatchObject({ valid: false, reason: "badExpiry" });
    expect(validateMessageExpiry(delegateGoal, "command", expiresAt("command", now), now)).toEqual({ valid: true, kind: "command" });
    expect(validateMessagePayload({ ...approvalRequest, expiresAt: "2026-10-09T12:04:00.000Z" }, "command").valid).toBe(false);
  });

  it("rejects stale and overlong message expiries", () => {
    expect(validateMessageExpiry(pause, "command", "2026-10-09T11:59:59.999Z", now)).toMatchObject({ valid: false, reason: "expired" });
    expect(validateMessageExpiry(pause, "command", "2026-10-09T12:04:00.000Z", now)).toMatchObject({ valid: false, reason: "badExpiry" });
  });

  it("returns only structured tool failure codes", () => {
    expect(toolResultError({ kind: "toolResult", success: false, error: "otherDeviceOffline" })).toBe("otherDeviceOffline");
    expect(toolResultError({ kind: "toolResult", success: false, error: "offline because socket closed" })).toBeNull();
    expect(toolResultError({ kind: "toolResult", success: true })).toBeNull();
  });
});
