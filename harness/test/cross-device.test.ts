import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { PROTOCOL_VERSION } from "@yumi/protocol/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_LIFETIME_MS } from "../src/approvals/approval-flow.ts";
import { MemoryLogger } from "../src/log.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../src/planner/summary.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";
import { tempDir } from "./helpers.ts";
import { startMockModelServer, type MockReply } from "./mock-model-server.ts";
import { content, finish, plan, tool } from "./support/harness-run.ts";
import { later, until } from "./support/mock-mac.ts";
import { startWithPhone, WAKE_ADDRESS, type PhoneRun } from "./support/phone-run.ts";

/**
 * SPEC-09 on the Mac's side beyond the delegated goal itself (which `delegated-goals.test.ts` covers): phone tools
 * (OBJ-65), approvals asked on the phone (OBJ-70), the edge cases (OBJ-77), and waking a locked Mac (OBJ-80). Each
 * runs with a scripted phone on the relay stand-in, the real bridge client, harness, and approval flow, and a mocked
 * model.
 */

vi.setConfig({ testTimeout: 30_000 });

const GOAL_ID = "5b0c6f8e-2f4d-4c1a-9a57-1f0e2d3c4b5a";
const DECK = "Export my Keynote deck as a PDF";

describe.skipIf(platform() === "win32")("SPEC-09 cross-device routing on the Mac", () => {
  let dir: { path: string; cleanup: () => void };
  let home: string;
  let model: Awaited<ReturnType<typeof startMockModelServer>>;
  let run: PhoneRun | undefined;
  let logger: MemoryLogger;

  beforeEach(async () => {
    dir = tempDir();
    home = join(dir.path, "home");
    mkdirSync(join(home, "Downloads"), { recursive: true });
    model = await startMockModelServer();
    logger = new MemoryLogger();
  });

  afterEach(async () => {
    await run?.close();
    run = undefined;
    await model.close();
    dir.cleanup();
  });

  /** A model that plans one helper subtask, answers worker steps with `worker`, and summarizes with `summary`. */
  function script(worker: (text: string, step: number) => MockReply | Promise<MockReply>, summary = "Done.") {
    let step = 0;
    const plannerTexts: string[] = [];
    model.respond((body) => {
      const request = body as unknown as ChatRequest;
      const system = request.messages[0]!.content as string;
      const text = request.messages[1]!.content as string;
      if (system === PLANNER_SYSTEM_PROMPT) {
        plannerTexts.push(text);
        return { kind: "content", content: plan({ id: "a", title: "Do the work", instruction: "Do what the goal asks." }) };
      }
      if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary });
      return worker(text, step++);
    });
    return { plannerTexts };
  }

  const start = async (extra: Partial<Parameters<typeof startWithPhone>[0]> = {}) => {
    run = await startWithPhone({ dir: dir.path, home, logger, model, lanes: { helper: fileHelperLane({ home }) }, ...extra });
    return run;
  };

  const delegate = (goalId = GOAL_ID, goal = DECK) =>
    run!.ask({
      kind: "delegateGoal",
      goalId,
      confirmedGoal: goal,
      originDeviceId: run!.phone.deviceId,
      spokenAt: new Date().toISOString(),
    });

  describe("Mac to phone (OBJ-65, OBJ-77)", () => {
    it("answers the phone's tool list with its own, carrying the Mac's wake addresses (SPEC-09 r1, r19)", async () => {
      script(() => finish("nothing"));
      const { phone, bridge } = await start();
      run!.sendPhoneTools();
      const list = await phone.next("toolList");
      expect(list.payload).toEqual({ kind: "toolList", deviceId: bridge.deviceId, tools: [], wakeAddresses: [WAKE_ADDRESS] });
    });

    it("tells the Mac app this Mac's bridge device id in hello (OBJ-64)", async () => {
      script(() => finish("nothing"));
      const { mac, bridge } = await start();
      expect(await mac.app.peer.request("hello", { protocolVersion: PROTOCOL_VERSION })).toMatchObject({
        deviceId: bridge.deviceId,
      });
    });

    it("leaves the phone tool out while no phone tool list is known", async () => {
      script(() => finish("nothing"));
      const { harness } = await start();
      expect(harness.phoneTools!.phoneTools()).toBeUndefined();
    });

    it("Set an alarm on the phone from the Mac", async () => {
      const { plannerTexts } = script(
        (_text, step) =>
          step === 0 ? tool({ tool: "phone", call: { tool: "set_alarm", time: "06:30" } }) : finish("Alarm set."),
        "Your alarm is set for 6:30 am on your phone.",
      );
      const { phone, harness, mac } = await start();
      run!.sendPhoneTools();
      await until(() => harness.phoneTools!.phoneTools() !== undefined);
      const task = run!.startMacTask("set an alarm on my phone for 6:30 am");

      const call = await phone.next("toolCall");
      expect(call.payload).toEqual({ kind: "toolCall", call: { tool: "set_alarm", time: "06:30" } });
      phone.envelope("result", { kind: "toolResult", success: true, data: "Alarm set for 06:30." }, call.id);

      await until(() => harness.store.getTask(task.id)?.status === "done");
      // The planner was offered one `phone` tool, described from the phone's own list (SPEC-09 r2).
      expect(plannerTexts[0]).toMatch(/phone[\s\S]*set_alarm/);
      expect(harness.store.listActionLog(task.id).at(-1)).toMatchObject({
        deviceId: phone.deviceId,
        description: "Set an alarm for 6:30 am on your phone",
      });
      await until(() => mac.events.some((e) => e.event === "speak"));
      expect(mac.events.find((e) => e.event === "speak")?.payload).toEqual({
        taskId: task.id,
        text: "Your alarm is set for 6:30 am on your phone.",
      });
    });

    it("Phone is offline when the Mac calls a tool: fails at once, unqueued, with the offline error", async () => {
      script((_text, step) =>
        step === 0 ? tool({ tool: "phone", call: { tool: "set_timer", seconds: 600 } }) : finish("Phone offline."),
      );
      const { phone, harness, mac } = await start();
      run!.sendPhoneTools();
      await until(() => harness.phoneTools!.phoneTools() !== undefined);
      phone.disconnect();
      const started = Date.now();
      const task = run!.startMacTask("set a timer on my phone for 10 minutes");
      await until(() => mac.events.some((e) => e.event === "userError"));
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(mac.events.find((e) => e.event === "userError")?.payload).toMatchObject({
        kind: "otherDeviceOffline",
        device: phone.deviceId,
        taskId: task.id,
      });
      await until(() => ["done", "failed"].includes(harness.store.getTask(task.id)!.status));
      const steps = harness.store.listSubtasks(task.id).flatMap((subtask) => harness.store.listSteps(subtask.id));
      expect(steps.find((s) => s.action.action.kind === "tool")?.outcome).toBe("error");
    });
  });

  describe("Phone to Mac (OBJ-70, OBJ-77)", () => {
    it("tells the phone why a goal failed, with its error kind as well as the line it says", async () => {
      script(() => ({ kind: "httpError", status: 500, detail: "boom" }));
      const { phone } = await start();
      await delegate();
      const finished = await phone.next("goalFinished");
      expect(finished.payload).toMatchObject({
        kind: "goalFinished",
        goalId: GOAL_ID,
        status: "failed",
        error: { kind: expect.any(String) },
      });
      expect((finished.payload as { summary: string }).summary.length).toBeGreaterThan(0);
    });

    it("Mac is busy: the phone goal queues behind the running task, then starts", async () => {
      const hold = later<MockReply>();
      script((text, step) => (step === 0 ? hold.promise : finish(text.slice(0, 20))));
      const { phone, harness } = await start();
      const busy = run!.startMacTask("Summarize the open report");
      await until(() => harness.store.getTask(busy.id)?.status === "running");
      expect(await delegate()).toEqual({
        kind: "goalAccepted",
        goalId: GOAL_ID,
        status: "queued",
        activeTaskTitle: "Do the work",
      });
      expect(harness.store.getTask(GOAL_ID)?.status).toBe("queued");
      hold.resolve(finish("Summarized."));
      await phone.next("goalFinished");
      expect(harness.store.getTask(busy.id)?.status).toBe("done");
      expect(harness.store.getTask(GOAL_ID)?.status).toBe("done");
    });

    it("Approval is asked on the phone: the Mac shows only the banner, and acts on the phone's answer", async () => {
      const file = join(home, "Downloads", "old-invoice.pdf");
      writeFileSync(file, "invoice");
      script((_text, step) => (step === 0 ? tool({ tool: "move_to_trash", paths: [file] }) : finish("Trashed.")));
      const { phone, harness, mac } = await start();
      await delegate(GOAL_ID, "Delete my old invoice");

      const request = await phone.next("approvalRequest");
      expect(request.type).toBe("command");
      expect(request.payload).toMatchObject({ kind: "approvalRequest", approvalKind: "delete" });
      const approvalId = (request.payload as { id: string }).id;
      await until(() => mac.events.some((e) => e.event === "approvalWaitingElsewhere"));
      expect(mac.events.find((e) => e.event === "approvalWaitingElsewhere")?.payload).toEqual({
        approvalId,
        taskId: GOAL_ID,
        askingDeviceId: phone.deviceId,
        approvalKind: "delete",
      });
      expect(mac.calls.map((c) => c.method)).not.toContain("showApprovalCard");

      phone.envelope(
        "result",
        {
          kind: "approvalResponse",
          approvalId,
          decision: { approved: true, method: "tap", decidedAt: new Date().toISOString() },
        },
        request.id,
      );
      await phone.next("goalFinished");
      expect(mac.events.find((e) => e.event === "approvalAnsweredElsewhere")?.payload).toEqual({ approvalId });
      expect(mac.calls.find((c) => c.method === "moveToTrash")?.params).toEqual({ paths: [file] });
      expect(harness.store.getTask(GOAL_ID)?.status).toBe("done");
    });

    it("never approves a delete said by voice on the phone (SPEC-07 r11)", async () => {
      const file = join(home, "Downloads", "old-invoice.pdf");
      writeFileSync(file, "invoice");
      script((_text, step) => (step === 0 ? tool({ tool: "move_to_trash", paths: [file] }) : finish("Trashed.")));
      const { phone, mac } = await start();
      await delegate(GOAL_ID, "Delete my old invoice");
      const first = await phone.next("approvalRequest");
      const approvalId = (first.payload as { id: string }).id;
      phone.envelope(
        "result",
        {
          kind: "approvalResponse",
          approvalId,
          decision: { approved: true, method: "voice", decidedAt: new Date().toISOString() },
        },
        first.id,
      );
      // Asked again, and nothing moved.
      const again = await phone.next("approvalRequest", 0, (m) => m.id !== first.id);
      expect((again.payload as { id: string }).id).toBe(approvalId);
      expect(mac.calls.map((c) => c.method)).not.toContain("moveToTrash");
      expect(existsSync(file)).toBe(true);
    });

    it("No answer to an approval: after 5 minutes the task pauses and the phone hears it", async () => {
      const file = join(home, "Downloads", "old-invoice.pdf");
      writeFileSync(file, "invoice");
      script((_text, step) => (step === 0 ? tool({ tool: "move_to_trash", paths: [file] }) : finish("Trashed.")));
      // The approval flow's clock runs 5 minutes behind, less a moment, so the approval expires almost at once.
      const behind = APPROVAL_LIFETIME_MS - 400;
      const { phone, harness, mac } = await start({ approvalClock: () => new Date(Date.now() - behind) });
      await delegate(GOAL_ID, "Delete my old invoice");
      const request = await phone.next("approvalRequest");
      const approvalId = (request.payload as { id: string }).id;
      expect((await phone.next("approvalCancelled")).payload).toEqual({ kind: "approvalCancelled", approvalId });
      await phone.next("progress", 0, (m) => (m.payload as { status: string }).status === "paused");
      expect(harness.store.getTask(GOAL_ID)?.status).toBe("paused");
      expect(mac.events.find((e) => e.event === "approvalCancelled")?.payload).toEqual({ approvalId });
      expect(existsSync(file)).toBe(true);
    });
  });

  describe("Mac wakes up locked (OBJ-80)", () => {
    it("holds a phone goal while the screen is locked, and starts it once unlocked", async () => {
      let locked = true;
      script(() => finish("Exported."), "Done. Your deck is exported as a PDF on your Mac.");
      const { phone, harness } = await start({ screen: { isLocked: () => Promise.resolve(locked) } });
      expect(await delegate()).toEqual({ kind: "goalAccepted", goalId: GOAL_ID, status: "waitingForUnlock" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(harness.store.getTask(GOAL_ID)).toBeUndefined();
      locked = false;
      await phone.next("progress");
      expect((await phone.next("goalFinished")).payload).toMatchObject({ status: "done" });
    });

    it("drops a held goal the phone cancels before the Mac is unlocked", async () => {
      script(() => finish("Exported."));
      // Locked as the Mac app reads it from the console session.
      const { harness } = await start({ answers: { getScreenLock: () => ({ locked: true }) } });
      expect((await delegate()) as { status: string }).toMatchObject({ status: "waitingForUnlock" });
      expect(await run!.ask({ kind: "cancel", goalId: GOAL_ID })).toEqual({ kind: "cancelConfirmed", goalId: GOAL_ID });
      expect(harness.store.getTask(GOAL_ID)).toBeUndefined();
    });
  });
});
