import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordedAction, Step } from "@yumi/protocol/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTION_LOG_DIR, ActionLogFile, activityCounts, clockTime, dayFile } from "../src/action-log/text-log.ts";
import { MemoryLogger } from "../src/log.ts";
import { recoverAfterRestart } from "../src/scheduler/recovery.ts";
import { describeGuiAction, describeInterrupted, describeNotDone, describeTrashed } from "../src/scheduler/describe.ts";
import type { TaskStore } from "../src/store/task-store.ts";
import { tempDir } from "./helpers.ts";
import { openStore, runningSubtask, TestClock } from "./store-helpers.ts";

/**
 * The action log file (SPEC-07 r18, OBJ-38.7) and what never reaches it (SPEC-07 r20, OBJ-38.8): lines are written
 * from the task store as they are committed, one file a day in the support folder, with local am/pm times.
 */

let dir: { path: string; cleanup: () => void };
let clock: TestClock;
let store: TaskStore;
let file: ActionLogFile;

/** 3:42 pm on 9 October 2026, in this machine's time zone, as the user would read it. */
const AT_3_42_PM = new Date(2026, 9, 9, 15, 42, 5);

beforeEach(() => {
  dir = tempDir();
  clock = new TestClock(AT_3_42_PM);
  store = openStore(join(dir.path, "store"), clock);
  file = new ActionLogFile({ supportDir: dir.path, store, logger: new MemoryLogger(), macDeviceId: () => "mac-brent" }).start();
});

afterEach(() => {
  file.stop();
  store.close();
  dir.cleanup();
});

const click = (label: string): RecordedAction => ({
  action: { kind: "click", element: 4 },
  element: { path: "AXWindow/AXToolbar/AXButton[0]", role: "button", label },
  permission: "allowed",
});
const read = (path: string): RecordedAction => ({
  action: { kind: "tool", call: { tool: "read_file", path } },
  permission: "allowed",
});

/** Runs one step to its outcome, with the line the step loop would write. */
function step(
  subtaskId: string,
  lane: "main" | "helper",
  action: RecordedAction,
  outcome: Step["outcome"] = "ok",
  app = "Keynote",
): Step {
  const begun = store.beginStep({ subtaskId, lane, action });
  const description =
    action.action.kind === "tool"
      ? `Read ${action.action.call.tool === "read_file" ? "notes.txt" : "a file"}`
      : describeGuiAction(action, app, outcome === "ok");
  return store.finishStep(begun.id, { outcome: outcome as "ok", log: { deviceId: "mac-brent", description } });
}

const fileText = () => readFileSync(join(dir.path, ACTION_LOG_DIR, dayFile(AT_3_42_PM)), "utf8");

describe("SPEC-07 Action log", () => {
  it("Scenario: Every action is logged", () => {
    // Given Yumi clicked "Export" in Keynote at 3:42 pm
    const { subtask } = runningSubtask(store);
    step(subtask.id, "main", click("Export"));
    // When the user opens the action log file
    expect(readdirSync(join(dir.path, ACTION_LOG_DIR))).toEqual(["2026-10-09.txt"]);
    // Then it shows "3:42 pm, Mac, main cursor: Clicked Export in Keynote"
    expect(fileText()).toBe("3:42 pm, Mac, main cursor: Clicked Export in Keynote\n");
  });

  it("Scenario: Task summary includes activity counts", () => {
    // Given a task finished after 3 file reads and 12 clicks
    const { task, subtask } = runningSubtask(store);
    for (let i = 0; i < 3; i++) step(subtask.id, "main", read(`/Users/ana/Documents/notes-${i}.txt`));
    for (let i = 0; i < 12; i++) step(subtask.id, "main", click(`Slide ${i + 1}`));
    // Steps that did not run do not count.
    step(subtask.id, "main", { ...click("Quit Keynote"), permission: "blocked" }, "blocked");
    store.setSubtaskStatus(subtask.id, "done");
    clock.advance(60_000);
    store.setTaskStatus(task.id, "done", { summary: "Exported." });
    // When the user opens the task in the action log
    const lines = fileText().trim().split("\n");
    // Then it shows "Read 3 files and clicked 12 times"
    expect(lines.at(-1)).toBe('3:43 pm, Mac, task done ("export my Keynote deck as a PDF"): Read 3 files and clicked 12 times');
    expect(lines).toHaveLength(17);
  });

  it("lists every path of a delete on its own line, and names the lane", () => {
    const { subtask } = runningSubtask(store);
    store.updateSubtask(subtask.id, { lane: "helper" });
    const paths = ["/Users/ana/Downloads/old-invoice.pdf", "/Users/ana/Downloads/old-receipt.pdf"];
    const begun = store.beginStep({
      subtaskId: subtask.id,
      lane: "helper",
      action: { action: { kind: "tool", call: { tool: "move_to_trash", paths } }, permission: "ask" },
    });
    store.finishStep(begun.id, { outcome: "ok", log: { deviceId: "mac-brent", description: describeTrashed(paths), paths } });
    expect(fileText()).toBe(
      [
        "3:42 pm, Mac, helper: Moved 2 files from Downloads to the Trash",
        "    /Users/ana/Downloads/old-invoice.pdf",
        "    /Users/ana/Downloads/old-receipt.pdf",
        "",
      ].join("\n"),
    );
  });

  it("names the phone for lines from the phone, and leaves the lane out when there is none", () => {
    const { task } = runningSubtask(store);
    store.appendActionLog({ deviceId: "phone-ana", taskId: task.id, description: "Set an alarm for 7:00 am", outcome: "ok" });
    expect(fileText()).toBe("3:42 pm, phone: Set an alarm for 7:00 am\n");
  });
});

describe("OBJ-38.8 Text typed into password fields is never logged (SPEC-07 r20)", () => {
  it("never puts typed or set text in a line, in the store or the file", () => {
    const secret = "hunter2-correct-horse";
    const { task, subtask } = runningSubtask(store);
    // Typing into whatever field has focus, which may be a password field the user did not hand over.
    const typed: RecordedAction = { action: { kind: "type", text: secret }, permission: "allowed" };
    // Setting a field's text, which may hold a password in a field that is not marked secure.
    const set: RecordedAction = {
      action: { kind: "setValue", element: 3, text: secret },
      element: { path: "AXWindow/AXTextField[2]", role: "textField", label: "Password" },
      permission: "allowed",
    };
    step(subtask.id, "main", typed, "ok", "Safari");
    step(subtask.id, "main", set, "ok", "Safari");
    step(subtask.id, "main", set, "error", "Safari");

    expect(store.listActionLog(task.id).map((line) => line.description)).toEqual([
      "Typed in Safari",
      "Filled in Password in Safari",
      "Tried to fill in Password in Safari",
    ]);
    expect(JSON.stringify(store.listActionLog(task.id))).not.toContain(secret);
    expect(fileText()).not.toContain(secret);
    expect(describeNotDone(set, "Safari", "blocked")).not.toContain(secret);
    expect(describeInterrupted(typed)).toBe("Started to type, but was interrupted before it finished");
    // A secure text field cannot even be recorded as set: the contract refuses it (SPEC-05 r7).
    const secure: RecordedAction = {
      ...set,
      element: { path: "AXWindow/AXSecureTextField[0]", role: "secureTextField", label: "Password" },
    };
    expect(() => store.beginStep({ subtaskId: subtask.id, lane: "main", action: secure })).toThrow(/Invalid Step/);
  });
});

describe("times and counts", () => {
  it("shows times as am/pm", () => {
    expect(clockTime(new Date(2026, 9, 9, 0, 5))).toBe("12:05 am");
    expect(clockTime(new Date(2026, 9, 9, 9, 7))).toBe("9:07 am");
    expect(clockTime(new Date(2026, 9, 9, 12, 30))).toBe("12:30 pm");
    expect(clockTime(new Date(2026, 9, 9, 23, 59))).toBe("11:59 pm");
  });

  it("names each kind of activity once, in a sentence", () => {
    const ok = (action: RecordedAction): Step =>
      ({ id: "s", subtaskId: "t", index: 0, lane: "main", action, startedAt: "2026-10-09T07:42:00Z", outcome: "ok" }) as Step;
    expect(activityCounts([])).toBe("Did nothing on your devices");
    expect(activityCounts([ok(click("A"))])).toBe("Clicked once");
    expect(
      activityCounts([ok(read("/a")), ok(click("A")), ok({ action: { kind: "key", combo: "cmd+s" }, permission: "allowed" })]),
    ).toBe("Read 1 file, clicked once, and pressed 1 key");
    const trash: RecordedAction = {
      action: { kind: "tool", call: { tool: "move_to_trash", paths: ["/a", "/b"] } },
      permission: "ask",
    };
    expect(activityCounts([ok(trash)], () => 12)).toBe("Moved 12 files to the Trash");
  });

  it("describes UI actions from the element and the app, never from the model", () => {
    expect(describeGuiAction(click("Export"), "Keynote", true)).toBe("Clicked Export in Keynote");
    expect(describeGuiAction({ action: { kind: "key", combo: "cmd+shift+d" }, permission: "ask" }, "Mail", true)).toBe(
      "Pressed Command-Shift-D in Mail",
    );
    expect(describeNotDone(click("Send"), "Mail", "declined")).toBe("Did not click Send in Mail, because you said no");
  });
});

describe("recovery and approvals", () => {
  it("closes an approval a restart left open, so a resume asks again", () => {
    const { subtask } = runningSubtask(store);
    const begun = store.beginStep({ subtaskId: subtask.id, lane: "main", action: { ...click("Send"), permission: "ask" } });
    store.setSubtaskStatus(subtask.id, "needsApproval");
    const approval = {
      id: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80",
      stepId: begun.id,
      kind: "send" as const,
      recipients: ["Ana"],
      text: "I'm about to send this email to Ana. Should I send it?",
      requestedAt: AT_3_42_PM.toISOString(),
      expiresAt: new Date(AT_3_42_PM.getTime() + 300_000).toISOString(),
    };
    store.addApproval(approval);
    recoverAfterRestart(store, new MemoryLogger());
    expect(store.getApproval(approval.id)!.closed).toBe("cancelled");
    expect(store.getSubtask(subtask.id)!.status).toBe("ready");
  });
});
