import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@yumi/protocol";
import type { Approval, ApprovalDecision, Observation, Subtask, Target } from "@yumi/protocol/types";
import { ApprovalFlow } from "../src/approvals/approval-flow.ts";
import { RunControl } from "../src/control/run-control.ts";
import { MemoryLogger } from "../src/log.ts";
import { checkAction } from "../src/safety/gate.ts";
import type { TaskStore } from "../src/store/task-store.ts";
import { tempDir } from "./helpers.ts";
import { openStore, runningSubtask } from "./store-helpers.ts";

/**
 * OBJ-38.11: an unclassified risky click or key press (SPEC-07 r6) asks with an `action` card. Its text is built from
 * the resolved action, never model text; only a tap approves it; and the window is looked at again right before it
 * runs. Uses a scripted Mac app, with no socket.
 */

const MAIL: Target = { bundleId: "com.apple.mail", windowId: 12 };

let dir: { path: string; cleanup: () => void };
let store: TaskStore;
let subtask: Subtask;
/** The Mac app's answers: the window as it is on each look, and the decision on each card. */
let looks: Observation[];
let decisions: ApprovalDecision[];
let cards: Approval[];

const mailWindow = (label: string): Observation => ({
  app: "Mail",
  windowTitle: "Inbox",
  layer: { kind: "window" },
  elements: [
    { n: 1, role: "button", label: "New Message", enabled: true },
    { n: 2, role: "button", label, enabled: true },
  ],
});
const tap: ApprovalDecision = { approved: true, method: "tap", decidedAt: "2026-10-10T04:00:00+08:00" };
const voiceYes: ApprovalDecision = { approved: true, method: "voice", decidedAt: "2026-10-10T04:00:00+08:00" };

beforeEach(() => {
  dir = tempDir();
  store = openStore(dir.path);
  subtask = runningSubtask(store).subtask;
  looks = [];
  decisions = [];
  cards = [];
});

afterEach(() => {
  store.close();
  dir.cleanup();
});

function flow(): ApprovalFlow {
  return new ApprovalFlow({
    store,
    logger: new MemoryLogger(),
    home: dir.path,
    emit: () => {},
    userError: () => {},
    mac: {
      request: (method, params) => {
        if (method === "observeWindow") {
          // The last look stays on screen.
          return Promise.resolve((looks.length > 1 ? looks.shift() : looks[0]) ?? mailWindow("Archive"));
        }
        if (method === "showApprovalCard") {
          cards.push((params as { approval: Approval }).approval);
          return Promise.resolve(decisions.shift() ?? tap);
        }
        return Promise.reject(new Error(`unexpected ${method}`));
      },
    },
  });
}

/** Clicking "Archive" in Mail: no rule classifies it, and Mail is a risky app, so it asks. */
async function askToArchive() {
  const decision = checkAction(
    { action: { kind: "click", element: 2 }, element: { path: "#2", role: "button", label: "Archive" } },
    { home: dir.path, app: "Mail" },
  );
  expect(decision).toMatchObject({ level: "ask", rule: "unclassified" });
  const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: decision.recorded });
  const control = new RunControl();
  const signal = control.enter(subtask.id, "main");
  return flow().request(decision, { subtask, step, lane: "main", control, app: "Mail", target: MAIL }, signal);
}

describe("unclassified risky actions (OBJ-38.11, SPEC-07 r6)", () => {
  it("asks with an action card worded from the resolved action, and runs it after a tap", async () => {
    const answer = await askToArchive();

    expect(answer.outcome).toBe("approved");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "action", text: "I'm about to click Archive in Mail. Should I allow it?" });
    expect(cards[0]).not.toHaveProperty("recipients");
    expect(cards[0]).not.toHaveProperty("files");
    expect(validate("Approval", cards[0]).valid).toBe(true);
  });

  it("does not count a voice yes: the card stays until a tap", async () => {
    decisions = [voiceYes, tap];
    const answer = await askToArchive();

    expect(answer.outcome).toBe("approved");
    expect(cards).toHaveLength(2);
    expect(answer.outcome === "approved" && answer.approval.decision?.method).toBe("tap");
  });

  it("does not run when the element changed while the user was asked", async () => {
    // The first look builds the card; the look right before acting finds another button at the same number.
    looks = [mailWindow("Archive"), mailWindow("Delete")];
    const answer = await askToArchive();

    expect(answer).toEqual({ outcome: "unavailable", reason: "actionChanged" });
    expect(cards).toHaveLength(1);
  });
});
