import { describe, expect, it } from "vitest";
import {
  getMessageExpiryKind,
  isApprovalDecisionAllowed,
  toolResultError,
  validateMessageExpiry,
  validateMessagePayload,
} from "../src/messages.ts";
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

describe("SPEC-09 edge cases and waking the Mac (OBJ-76)", () => {
  const toolList = {
    kind: "toolList",
    deviceId: "3f2a9c1e7b4d6a8f0e1c2b3a4d5e6f70",
    tools: [],
  };

  it("lets a device advertise the hardware addresses the other device can wake it on (SPEC-09 r19)", () => {
    expect(
      validateMessagePayload(
        {
          ...toolList,
          wakeAddresses: ["a4:83:e7:1c:2b:9f", "3c:22:fb:00:12:ab"],
        },
        "event",
      ).errors,
    ).toEqual([]);
    expect(validateMessagePayload(toolList, "event").errors).toEqual([]);
    for (const bad of [
      "A4:83:E7:1C:2B:9F",
      "a4-83-e7-1c-2b-9f",
      "a4:83:e7:1c:2b",
      "",
    ]) {
      expect(
        validateMessagePayload({ ...toolList, wakeAddresses: [bad] }, "event")
          .valid,
        bad,
      ).toBe(false);
    }
    expect(
      validateMessagePayload({ ...toolList, wakeAddresses: [] }, "event").valid,
    ).toBe(false);
  });

  it("confirms a resume as a result, so a resume command has an answer like pause and cancel (SPEC-09 r11)", () => {
    expect(
      validateMessagePayload(
        { kind: "resumeConfirmed", goalId: delegateGoal.goalId },
        "result",
      ).errors,
    ).toEqual([]);
    expect(
      validateMessagePayload(
        { kind: "resumeConfirmed", goalId: delegateGoal.goalId },
        "event",
      ).valid,
    ).toBe(false);
  });

  it("finishes a failed goal with its error kind as well as a summary line, and only a failed one", () => {
    const finished = { kind: "goalFinished", goalId: delegateGoal.goalId };
    expect(
      validateMessagePayload(
        {
          ...finished,
          status: "done",
          summary: "Done. Your deck is exported.",
        },
        "event",
      ).errors,
    ).toEqual([]);
    expect(
      validateMessagePayload({ ...finished, status: "done" }, "event").valid,
    ).toBe(false);
    const failed = {
      ...finished,
      status: "failed",
      summary: "I couldn't finish that on your Mac.",
    };
    expect(
      validateMessagePayload(
        { ...failed, error: { kind: "otherDeviceOffline", device: "phone" } },
        "event",
      ).errors,
    ).toEqual([]);
    expect(validateMessagePayload(failed, "event").errors).toEqual([]);
    expect(
      validateMessagePayload(
        { ...finished, status: "cancelled", summary: "Cancelled." },
        "event",
      ).errors,
    ).toEqual([]);
    expect(
      validateMessagePayload(
        {
          ...finished,
          status: "done",
          summary: "Done.",
          error: { kind: "unexpected" },
        },
        "event",
      ).valid,
    ).toBe(false);
  });

  it("lets a locked Mac accept a goal it starts once unlocked, with no running task title (SPEC-09 r20)", () => {
    const accepted = {
      kind: "goalAccepted",
      goalId: delegateGoal.goalId,
      status: "waitingForUnlock",
    };
    expect(validateMessagePayload(accepted, "result").errors).toEqual([]);
    expect(
      validateMessagePayload(
        { ...accepted, activeTaskTitle: "Export the deck" },
        "result",
      ).valid,
    ).toBe(false);
  });
});

describe("cross-device message payloads", () => {
  it("accepts a phone alarm call only in a command envelope", () => {
    const payload = {
      kind: "toolCall",
      call: { tool: "set_alarm", time: "06:30" },
    };
    expect(validateMessagePayload(payload, "command").valid).toBe(true);
    expect(validateMessagePayload(payload, "event").valid).toBe(false);
  });

  it("requires structured ErrorKind failures instead of raw error text", () => {
    expect(
      validateMessagePayload(
        { kind: "toolResult", success: false, error: "otherDeviceOffline" },
        "result",
      ).valid,
    ).toBe(true);
    expect(
      validateMessagePayload(
        {
          kind: "toolResult",
          success: false,
          error: "offline because socket closed",
        },
        "result",
      ).valid,
    ).toBe(false);
  });

  it("rejects voice approval for an approved delete", () => {
    const payload = {
      kind: "approvalResponse",
      approvalId: "5b0c6f8e-2f4d-4c1a-9a57-1f0e2d3c4b5a",
      decision: {
        approved: true,
        method: "voice" as const,
        decidedAt: "2026-10-09T12:00:00.000Z",
      },
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
    const voice = {
      approved: true,
      method: "voice" as const,
      decidedAt: now.toISOString(),
    };
    const tap = {
      approved: true,
      method: "tap" as const,
      decidedAt: now.toISOString(),
    };
    expect(validateMessagePayload(request, "command").valid).toBe(true);
    expect(
      validateMessagePayload(
        { ...request, recipients: ["ana@example.com"] },
        "command",
      ).valid,
    ).toBe(false);
    expect(isApprovalDecisionAllowed("action", voice)).toBe(false);
    expect(isApprovalDecisionAllowed("action", tap)).toBe(true);
  });

  it("uses the five-minute expiry for approval requests and two minutes for other commands", () => {
    expect(getMessageExpiryKind(approvalRequest, "command")).toBe(
      "approvalRequest",
    );
    expect(getMessageExpiryKind(delegateGoal, "command")).toBe("command");
    expect(getMessageExpiryKind(approvalRequest, "event")).toBeNull();
    expect(
      validateMessageExpiry(
        approvalRequest,
        "command",
        expiresAt("approvalRequest", now),
        now,
      ),
    ).toEqual({ valid: true, kind: "approvalRequest" });
    expect(
      validateMessageExpiry(
        approvalRequest,
        "command",
        "2026-10-09T12:04:59.000Z",
        now,
      ),
    ).toMatchObject({ valid: false, reason: "badExpiry" });
    expect(
      validateMessageExpiry(
        delegateGoal,
        "command",
        expiresAt("command", now),
        now,
      ),
    ).toEqual({ valid: true, kind: "command" });
    expect(
      validateMessagePayload(
        { ...approvalRequest, expiresAt: "2026-10-09T12:04:00.000Z" },
        "command",
      ).valid,
    ).toBe(false);
  });

  it("rejects stale and overlong message expiries", () => {
    expect(
      validateMessageExpiry(pause, "command", "2026-10-09T11:59:59.999Z", now),
    ).toMatchObject({ valid: false, reason: "expired" });
    expect(
      validateMessageExpiry(pause, "command", "2026-10-09T12:04:00.000Z", now),
    ).toMatchObject({ valid: false, reason: "badExpiry" });
  });

  it("returns only structured tool failure codes", () => {
    expect(
      toolResultError({
        kind: "toolResult",
        success: false,
        error: "otherDeviceOffline",
      }),
    ).toBe("otherDeviceOffline");
    expect(
      toolResultError({
        kind: "toolResult",
        success: false,
        error: "offline because socket closed",
      }),
    ).toBeNull();
    expect(toolResultError({ kind: "toolResult", success: true })).toBeNull();
  });
});
