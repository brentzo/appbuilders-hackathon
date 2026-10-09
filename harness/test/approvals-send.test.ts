import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@yumi/protocol";
import type { Approval, ApprovalDecision, Observation, Step, Subtask, Task } from "@yumi/protocol/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalFlow, type ApprovalContext, type SendFields } from "../src/approvals/approval-flow.ts";
import { listNames, sendText } from "../src/approvals/copy.ts";
import { findRecipientFields, parseRecipients } from "../src/approvals/recipients.ts";
import { RunControl } from "../src/control/run-control.ts";
import { MemoryLogger } from "../src/log.ts";
import { HarnessRpcServer } from "../src/rpc/server.ts";
import { checkAction, type GateDecision } from "../src/safety/gate.ts";
import type { TaskStore } from "../src/store/task-store.ts";
import { tempDir } from "./helpers.ts";
import { openStore, runningSubtask } from "./store-helpers.ts";
import { connectScriptedMac, later, until, type ScriptedMac } from "./support/mock-mac.ts";

/**
 * Sending (SPEC-07 r13-r15, OBJ-38.1 and OBJ-38.2) through the approval seam, with a fake `gui_act` step: the step
 * loop is OBJ-36, built at the same time, so these tests do what it will do. The gate checks a click on Mail's Send
 * button, the step is written, and `ApprovalFlow.request` asks. The Mac side is the protocol's mock Mac app on a
 * real socket, scripted per test for the To and Cc fields and the user's answer.
 */

const TO = "AXWindow/AXTextField[0]";
const CC = "AXWindow/AXTextField[1]";
const MAIL: SendFields = { target: { bundleId: "com.apple.mail", windowId: 5120 }, app: "Mail", to: [TO], cc: [CC] };

/** A Mail draft as the Mac app reports it: the To and Cc fields, and Send. */
const DRAFT: Observation = {
  app: "Mail",
  windowTitle: "Invoice",
  elements: [
    { n: 1, role: "button", label: "Send", enabled: true },
    { n: 2, role: "textField", label: "To:", value: "Ana", enabled: true },
    { n: 3, role: "textField", label: "Cc:", value: "", enabled: true },
    { n: 4, role: "textField", label: "Subject:", value: "Invoice", enabled: true },
  ],
};

let dir: { path: string; cleanup: () => void };
let home: string;
let logger: MemoryLogger;
let store: TaskStore;
let server: HarnessRpcServer;
let mac: ScriptedMac | undefined;
let flow: ApprovalFlow;
let task: Task;
let subtask: Subtask;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  mkdirSync(home);
  logger = new MemoryLogger();
  store = openStore(join(dir.path, "store"));
  server = await HarnessRpcServer.start({ socketPath: join(dir.path, "h.sock"), logger });
  ({ task, subtask } = runningSubtask(store, "email the invoice to Ana"));
  flow = new ApprovalFlow({
    store,
    logger,
    mac: server,
    emit: (event, payload) => server.emit(event, payload),
    userError: () => undefined,
    home,
  });
});

afterEach(async () => {
  mac?.close();
  mac = undefined;
  await server.close();
  store.close();
  dir.cleanup();
});

/** The Mac app with To and Cc fields the test can change, and the user's answers to the cards in order. */
async function connect(fields: { to?: string; cc?: string }, answers: (() => Promise<ApprovalDecision> | ApprovalDecision)[]) {
  let card = 0;
  mac = await connectScriptedMac(server.socketPath, {
    readFieldValues: (params) => ({
      fields: (params as { elementPaths: string[] }).elementPaths.map((path) => {
        const value = path === TO ? fields.to : fields.cc;
        return value === undefined ? { elementPath: path } : { elementPath: path, value };
      }),
    }),
    showApprovalCard: () => {
      const answer = answers[card++];
      if (!answer) throw new Error("No answer scripted for this card");
      return answer();
    },
  });
  await until(() => server.readyConnections === 1);
  return mac;
}

const decided = (approved: boolean, method: "tap" | "voice"): ApprovalDecision => ({
  approved,
  method,
  decidedAt: new Date().toISOString(),
});

/** The fake gui_act step: the gate checks pressing Send in Mail, and the step is written before anything runs. */
function pressSend(lane: "main" | "ghost" = "main"): { decision: GateDecision; step: Step } {
  const decision = checkAction(
    {
      action: { kind: "click", element: 1 },
      element: { path: "AXWindow/AXToolbar/AXButton[Send]", role: "button", label: "Send" },
    },
    { home, app: "Mail" },
  );
  expect(decision).toMatchObject({ level: "ask", rule: "send" });
  return { decision, step: store.beginStep({ subtaskId: subtask.id, lane, action: decision.recorded }) };
}

function context(step: Step, control: RunControl, send: SendFields = MAIL): ApprovalContext {
  return { subtask: store.getSubtask(subtask.id)!, step, lane: "main", control, send };
}

const cards = () =>
  mac!.calls.filter((c) => c.method === "showApprovalCard").map((c) => (c.params as { approval: Approval }).approval);

describe("SPEC-07 Sending", () => {
  it("Scenario: Sending an email needs approval", async () => {
    // Given Yumi has drafted an email to Ana
    const answer = later<ApprovalDecision>();
    await connect({ to: "Ana", cc: "" }, [() => answer.promise]);
    // When the next action is pressing Send
    const { decision, step } = pressSend();
    const control = new RunControl();
    const signal = control.enter(subtask.id, "main");
    const pending = flow.request(decision, context(step, control), signal);

    // Then Yumi pauses: the subtask needs approval and the task waits for the user
    await until(() => cards().length === 1);
    expect(store.getSubtask(subtask.id)!.status).toBe("needsApproval");
    expect(store.getTask(task.id)!.status).toBe("waitingForUser");
    // And says "I'm about to send this email to Ana. Should I send it?"
    const [card] = cards();
    expect(card).toMatchObject({ kind: "send", stepId: step.id, recipients: ["Ana"] });
    expect(card!.text).toBe("I'm about to send this email to Ana. Should I send it?");
    expect(card!.decision).toBeUndefined();
    expect(validate("Approval", card).valid).toBe(true);
    expect(store.listOpenApprovals(task.id).map((a) => a.approval.id)).toEqual([card!.id]);
    // (The "Send" and "Don't send" buttons are the Mac app's card, OBJ-40.)

    // When the user says "send it"
    answer.resolve(decided(true, "voice"));
    const result = await pending;

    // Then the email is sent: the step loop may press Send now, once
    expect(result.outcome).toBe("approved");
    expect(store.getApproval(card!.id)).toMatchObject({
      closed: "used",
      approval: { decision: { approved: true, method: "voice" } },
    });
    expect(store.listOpenApprovals(task.id)).toEqual([]);
    expect(store.getSubtask(subtask.id)!.status).toBe("running");
    expect(store.getTask(task.id)!.status).toBe("running");
    // The To and Cc fields were read twice: to build the card, and again right before pressing Send (r14).
    expect(mac!.calls.filter((c) => c.method === "readFieldValues")).toHaveLength(2);
    expect(mac!.calls[0]!.params).toEqual({ target: MAIL.target, elementPaths: [TO, CC] });
  });

  it("Scenario: Approval text comes from the real recipients", async () => {
    // Given the To field of the draft contains "mallory@example.com"
    // And the model says it is sending to Ana (the goal and the subtask both say Ana)
    await connect({ to: "mallory@example.com", cc: "" }, [() => decided(false, "tap")]);
    const { decision, step } = pressSend();
    // When Yumi asks for approval
    const control = new RunControl();
    const result = await flow.request(decision, context(step, control), control.enter(subtask.id, "main"));
    // Then the approval names "mallory@example.com"
    expect(cards()[0]!.text).toBe("I'm about to send this email to mallory@example.com. Should I send it?");
    expect(cards()[0]!.recipients).toEqual(["mallory@example.com"]);
    expect(cards()[0]!.text).not.toContain("Ana");
    expect(result.outcome).toBe("declined");
    expect(store.getApproval(cards()[0]!.id)!.closed).toBe("declined");
  });

  it("Scenario: Recipients changed after approval", async () => {
    // Given the user approved sending to Ana
    const fields = { to: "Ana", cc: "" };
    await connect(fields, [
      () => {
        // When the To field changes before Send is pressed
        fields.to = "Mallory";
        return decided(true, "tap");
      },
      () => decided(false, "tap"),
    ]);
    const { decision, step } = pressSend();
    const control = new RunControl();
    const result = await flow.request(decision, context(step, control), control.enter(subtask.id, "main"));

    // Then the email is not sent
    expect(result.outcome).toBe("declined");
    // And Yumi asks again, with the new recipients
    const [first, second] = cards();
    expect(first!.text).toBe("I'm about to send this email to Ana. Should I send it?");
    expect(second!.text).toBe("I'm about to send this email to Mallory. Should I send it?");
    expect(second!.id).not.toBe(first!.id);
    expect(store.getApproval(first!.id)!.closed).toBe("changed");
    expect(logger.entries.some((e) => e.event === "approval.changed")).toBe(true);
  });

  it("asks again until the recipients stay the same between the approval and the send", async () => {
    const fields = { to: "Ana", cc: "" };
    await connect(fields, [
      () => {
        fields.to = "Ana, Ben";
        return decided(true, "tap");
      },
      () => decided(true, "voice"),
    ]);
    const { decision, step } = pressSend();
    const control = new RunControl();
    const result = await flow.request(decision, context(step, control), control.enter(subtask.id, "main"));
    expect(result).toMatchObject({ outcome: "approved", approval: { recipients: ["Ana", "Ben"] } });
    expect(cards().map((c) => c.text)).toEqual([
      "I'm about to send this email to Ana. Should I send it?",
      "I'm about to send this email to Ana and Ben. Should I send it?",
    ]);
  });

  it("names several recipients and the Cc field in the SPEC-07 draft forms", async () => {
    await connect({ to: "Ana, Ben; Carla, Dan, Eve", cc: "Finn" }, [() => decided(true, "tap")]);
    const { decision, step } = pressSend();
    const control = new RunControl();
    const result = await flow.request(decision, context(step, control), control.enter(subtask.id, "main"));
    expect(result.outcome).toBe("approved");
    expect(cards()[0]).toMatchObject({
      text: "I'm about to send this email to Ana, Ben, and 3 others, with a copy to Finn. Should I send it?",
      recipients: ["Ana", "Ben", "Carla", "Dan", "Eve", "Finn"],
    });
  });

  it("says message, not email, for Messages, which has no Cc", async () => {
    await connect({ to: "Ana" }, [() => decided(true, "tap")]);
    const { decision, step } = pressSend();
    const control = new RunControl();
    const messages: SendFields = { target: { bundleId: "com.apple.MobileSMS" }, app: "Messages", to: [TO], cc: [CC] };
    await flow.request(decision, context(step, control, messages), control.enter(subtask.id, "main"));
    expect(cards()[0]!.text).toBe("I'm about to send this message to Ana. Should I send it?");
    expect(mac!.calls[0]!.params).toMatchObject({ elementPaths: [TO] });
  });

  it("does not ask, and the send does not run, when the To field cannot be read", async () => {
    await connect({ cc: "" }, []);
    const { decision, step } = pressSend();
    const control = new RunControl();
    const result = await flow.request(decision, context(step, control), control.enter(subtask.id, "main"));
    expect(result).toEqual({ outcome: "unavailable", reason: "noRecipients" });
    expect(cards()).toEqual([]);
    expect(store.getSubtask(subtask.id)!.status).toBe("running");
  });

  it("has no card for an unclassified ask without its window, so the action is not run", async () => {
    await connect({ to: "Ana" }, []);
    const decision = checkAction(
      { action: { kind: "click", element: 1 }, element: { path: "AXWindow/AXButton[0]", role: "button", label: "Share" } },
      { home, app: "Finder" },
    );
    expect(decision).toMatchObject({ level: "ask", rule: "unclassified" });
    const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: decision.recorded });
    const control = new RunControl();
    const result = await flow.request(decision, context(step, control), control.enter(subtask.id, "main"));
    expect(result).toEqual({ outcome: "unavailable", reason: "noApprovalCard" });
    expect(mac!.calls).toEqual([]);
  });
});

describe("SPEC-06 Pause cancels a pending approval, at the seam", () => {
  it("a take-over cancels the Send card, a late tap is ignored, and after the resume Yumi asks again", async () => {
    // Given Yumi is waiting for approval to send an email
    const late = later<ApprovalDecision>();
    await connect({ to: "Ana", cc: "" }, [() => late.promise, () => decided(true, "tap")]);
    const control = new RunControl();
    const first = pressSend();
    const pending = flow.request(first.decision, context(first.step, control), control.enter(subtask.id, "main"));
    await until(() => cards().length === 1);

    // When the user presses the stop shortcut (here, takes the mouse: the main lane pauses)
    control.pauseUiLanes();
    flow.cancelAll(task.id);
    const result = await pending;
    expect(result).toEqual({ outcome: "cancelled" });
    // The card closes: the app gets approvalCancelled for it
    await until(() => mac!.events.some((e) => e.event === "approvalCancelled"));
    expect(mac!.events.filter((e) => e.event === "approvalCancelled")).toEqual([
      { event: "approvalCancelled", payload: { approvalId: cards()[0]!.id } },
    ]);
    expect(store.getApproval(cards()[0]!.id)!.closed).toBe("cancelled");
    // A late tap on the closed card changes nothing.
    late.resolve(decided(true, "tap"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getApproval(cards()[0]!.id)!.approval.decision).toBeUndefined();
    control.leave(subtask.id);

    // And then resumes the task: the step loop records the step as not done, and its next try goes through the gate
    store.finishStep(first.step.id, { outcome: "noEffect", log: { deviceId: "mac-brent", description: "Did not press Send" } });
    store.setSubtaskStatus(subtask.id, "running");
    control.resumeUiLanes();
    const second = pressSend();
    const again = await flow.request(second.decision, context(second.step, control), control.enter(subtask.id, "main"));
    // Then Yumi asks for approval to send again
    expect(cards()).toHaveLength(2);
    expect(cards()[1]!.id).not.toBe(cards()[0]!.id);
    expect(again.outcome).toBe("approved");
  });
});

describe("recipients and names", () => {
  it("finds the To and Cc fields in the real tree by role and label", () => {
    expect(findRecipientFields(DRAFT)).toEqual({ to: [2], cc: [3] });
  });

  it("reads each recipient as the field shows it", () => {
    expect(parseRecipients("Ana Cruz, ben@example.com; Carla\nDan")).toEqual(["Ana Cruz", "ben@example.com", "Carla", "Dan"]);
    expect(parseRecipients(" , ")).toEqual([]);
    expect(parseRecipients(undefined)).toEqual([]);
  });

  it("lists names the way SPEC-07's draft copy says them", () => {
    expect(listNames(["Ana"])).toBe("Ana");
    expect(listNames(["Ana", "Ben"])).toBe("Ana and Ben");
    expect(listNames(["Ana", "Ben", "Carla"])).toBe("Ana, Ben, and Carla");
    expect(listNames(["Ana", "Ben", "Carla", "Dan", "Eve"])).toBe("Ana, Ben, and 3 others");
    expect(sendText("email", ["Ana"], ["Ben"])).toBe(
      "I'm about to send this email to Ana, with a copy to Ben. Should I send it?",
    );
  });
});
