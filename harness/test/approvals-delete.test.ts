import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@yumi/protocol";
import type { Approval, ApprovalDecision, MoveToTrashParams, Step, UserError } from "@yumi/protocol/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteText } from "../src/approvals/copy.ts";
import { MemoryLogger } from "../src/log.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";
import { tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer } from "./mock-model-server.ts";
import { finish, plan, scriptModel, startWithMac, tool, trashInto, type RunningHarness } from "./support/harness-run.ts";
import { later, until } from "./support/mock-mac.ts";

/**
 * Strict delete (SPEC-07 r7-r12, OBJ-38.1, OBJ-38.3) and blocked actions (SPEC-07 r5, OBJ-38.4), end to end: the
 * planner and worker (mocked model) ask for `move_to_trash` on the helper lane, the gate asks, the approval flow
 * shows the card on the protocol's mock Mac app, and the scripted Mac app moves approved files into the test's own
 * Trash folder. Nothing touches the real user folders.
 */

vi.setConfig({ testTimeout: 30_000 });

const INVOICES = ["old-invoice.pdf", ...Array.from({ length: 11 }, (_, i) => `receipt-${String(i + 1).padStart(2, "0")}.pdf`)];
const DELETE_PLAN = plan({
  id: "clean",
  title: "Delete the old invoices",
  instruction: "Move the old invoices in Downloads to the Trash.",
});

let dir: { path: string; cleanup: () => void };
let home: string;
let trash: string;
let model: MockModelServer;
let logger: MemoryLogger;
let run: RunningHarness | undefined;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  trash = join(dir.path, "Trash");
  mkdirSync(join(home, "Downloads"), { recursive: true });
  mkdirSync(join(home, "Documents"), { recursive: true });
  for (const name of INVOICES) writeFileSync(join(home, "Downloads", name), `${name}\n`);
  model = await startMockModelServer();
  logger = new MemoryLogger();
});

afterEach(async () => {
  await run?.close();
  run = undefined;
  await model.close();
  dir.cleanup();
});

const decided = (approved: boolean, method: "tap" | "voice"): ApprovalDecision => ({
  approved,
  method,
  decidedAt: new Date().toISOString(),
});

const downloads = () => readdirSync(join(home, "Downloads")).sort();
const real = (relative: string) => join(realpathSync(home), relative);

/** A worker that asks to trash `paths` once, then finishes when its last step says what happened. */
function trashOnce(paths: string[]) {
  return ({ text }: { text: string }) =>
    /Moved .+ to the Trash/.test(text) || text.includes("Not done:")
      ? finish("Handled the old invoices.")
      : tool({ tool: "move_to_trash", paths });
}

const invoicePaths = () => INVOICES.map((name) => `~/Downloads/${name}`);

async function start(answers: Parameters<typeof startWithMac>[0]["answers"] = {}) {
  run = await startWithMac({
    dir: dir.path,
    home,
    logger,
    model,
    lanes: { helper: fileHelperLane({ home }) },
    answers: { moveToTrash: trashInto(trash), ...answers },
  });
  return run;
}

const cards = () =>
  run!.mac.calls.filter((c) => c.method === "showApprovalCard").map((c) => (c.params as { approval: Approval }).approval);
const trashCalls = () =>
  run!.mac.calls.filter((c) => c.method === "moveToTrash").map((c) => (c.params as MoveToTrashParams).paths);
const steps = (taskId: string): Step[] =>
  run!.harness.store.listSubtasks(taskId).flatMap((s) => run!.harness.store.listSteps(s.id));
const ended = (taskId: string) => () => ["done", "failed", "cancelled"].includes(run!.harness.store.getTask(taskId)!.status);

describe("SPEC-07 Strict delete", () => {
  it("Scenario: Delete needs a tap", async () => {
    // Given Yumi wants to delete 12 files in Downloads
    scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(invoicePaths()) });
    const tapped = later<ApprovalDecision>();
    await start({ showApprovalCard: () => tapped.promise });
    const task = run!.startTask("delete my old invoices");
    await until(() => cards().length === 1);

    // Then Yumi says "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?"
    const [card] = cards();
    expect(card!.text).toBe(
      "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?",
    );
    // And the card lists the first 5 names and "and 7 more" (the Mac app adds "and N more" for count minus 5)
    expect(card!.files).toMatchObject({ count: 12, firstNames: INVOICES.slice(0, 5), folder: real("Downloads") });
    expect(card!.files!.count - card!.files!.firstNames.length).toBe(7);
    expect(card!.files!.allPaths).toEqual(INVOICES.map((name) => real(`Downloads/${name}`)));
    expect(validate("Approval", card).valid).toBe(true);
    // (The "Delete" and "Don't delete" buttons are the Mac app's card, OBJ-40.)
    expect(run!.harness.store.getTask(task.id)!.status).toBe("waitingForUser");
    expect(run!.harness.store.listSubtasks(task.id)[0]!.status).toBe("needsApproval");
    expect(trashCalls()).toEqual([]);

    // When the user taps "Delete"
    tapped.resolve(decided(true, "tap"));
    await until(ended(task.id));
    expect(run!.harness.store.getTask(task.id)!.status).toBe("done");

    // Then the 12 files are in the Trash
    expect(trashCalls()).toEqual([INVOICES.map((name) => real(`Downloads/${name}`))]);
    expect(downloads()).toEqual([]);
    expect(readdirSync(trash)).toHaveLength(12);
    // And every path is in the action log
    const line = run!.harness.store.listActionLog(task.id).find((entry) => entry.paths);
    expect(line).toMatchObject({ description: "Moved 12 files from Downloads to the Trash", outcome: "ok", lane: "helper" });
    expect(line!.paths).toEqual(INVOICES.map((name) => real(`Downloads/${name}`)));
    const file = readFileSync(join(run!.harness.actionLog.dir, readdirSync(run!.harness.actionLog.dir)[0]!), "utf8");
    for (const name of INVOICES) expect(file).toContain(`    ${real(`Downloads/${name}`)}`);
    expect(run!.harness.store.getApproval(card!.id)!.closed).toBe("used");
  });

  it("Scenario: Saying yes is not enough to delete", async () => {
    // Given Yumi is asking to delete 12 files
    scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(invoicePaths()) });
    const answers = [later<ApprovalDecision>(), later<ApprovalDecision>()];
    let shown = 0;
    await start({ showApprovalCard: () => answers[shown++]!.promise });
    const task = run!.startTask("delete my old invoices");
    await until(() => cards().length === 1);

    // When the user says "yes"
    answers[0]!.resolve(decided(true, "voice"));
    // Then the card stays open until the user taps a button: the same approval is shown again
    await until(() => cards().length === 2);
    expect(cards()[1]!.id).toBe(cards()[0]!.id);
    // And nothing is deleted
    expect(trashCalls()).toEqual([]);
    expect(downloads()).toEqual(INVOICES.slice().sort());
    expect(run!.harness.store.getApproval(cards()[0]!.id)).toMatchObject({ approval: { id: cards()[0]!.id } });
    expect(run!.harness.store.getApproval(cards()[0]!.id)!.approval.decision).toBeUndefined();
    expect(logger.entries.some((e) => e.event === "approval.deleteNeedsTap")).toBe(true);

    answers[1]!.resolve(decided(false, "tap"));
    await until(ended(task.id));
    expect(trashCalls()).toEqual([]);
    expect(downloads()).toEqual(INVOICES.slice().sort());
  });

  it("Scenario: User declines a delete", async () => {
    // Given Yumi asks to delete 12 files
    const worker = scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(invoicePaths()) });
    // When the user taps "Don't delete"
    await start({ showApprovalCard: () => decided(false, "tap") });
    const task = run!.startTask("delete my old invoices");
    await until(ended(task.id));

    // Then nothing is deleted
    expect(trashCalls()).toEqual([]);
    expect(downloads()).toEqual(INVOICES.slice().sort());
    const trashStep = steps(task.id).find((s) => s.action.action.kind === "tool")!;
    expect(trashStep).toMatchObject({ outcome: "declined", observation: "Not done: the user said no to this move_to_trash." });
    expect(run!.harness.store.listActionLog(task.id)[0]).toMatchObject({
      description: "Did not move 12 items to the Trash, because you said no",
      outcome: "declined",
    });
    // The worker is told, and decides what to do next.
    expect(worker.at(-1)!.text).toContain("Not done: the user said no to this move_to_trash.");
    // (Yumi then says "Okay, I left the files alone. Want me to do anything else with them?": the Mac app, OBJ-40.4.)
    expect(run!.harness.store.getApproval(cards()[0]!.id)!.closed).toBe("declined");
  });

  it("Scenario: File list changed after approval", async () => {
    // Given the user approved deleting 12 files (the "old" folder holds them)
    mkdirSync(join(home, "Downloads", "old"));
    for (const name of INVOICES) writeFileSync(join(home, "Downloads", "old", name), `${name}\n`);
    scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(["~/Downloads/old"]) });
    let shown = 0;
    await start({
      showApprovalCard: () => {
        // When a 13th file is added to the request before it runs
        if (shown++ === 0) writeFileSync(join(home, "Downloads", "old", "zz-late.pdf"), "late\n");
        return decided(true, "tap");
      },
    });
    const task = run!.startTask("delete the old folder's files");
    await until(ended(task.id));

    // Then nothing is deleted with the first approval
    const [first, second] = cards();
    expect(first!.files!.count).toBe(12);
    expect(run!.harness.store.getApproval(first!.id)!.closed).toBe("changed");
    // And Yumi asks again with the new list
    expect(second!.files!.count).toBe(13);
    expect(second!.text).toBe(
      "I'm about to move 13 files from old to the Trash, starting with old-invoice.pdf. Should I delete them?",
    );
    // Only the second, approved and checked again, moved anything, and exactly its list.
    expect(trashCalls()).toEqual([second!.files!.allPaths]);
    expect(trashCalls()[0]).toContain(real("Downloads/old/zz-late.pdf"));
  });

  it("asks again when a listed file changed, not only when the list did", async () => {
    scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(["~/Downloads/old-invoice.pdf"]) });
    let shown = 0;
    await start({
      showApprovalCard: () => {
        if (shown++ === 0) writeFileSync(join(home, "Downloads", "old-invoice.pdf"), "changed, and longer than before\n");
        return decided(true, "tap");
      },
    });
    const task = run!.startTask("delete the old invoice");
    await until(ended(task.id));
    expect(cards().map((c) => c.text)).toEqual([
      "I'm about to move old-invoice.pdf from Downloads to the Trash. Should I delete it?",
      "I'm about to move old-invoice.pdf from Downloads to the Trash. Should I delete it?",
    ]);
    expect(run!.harness.store.getApproval(cards()[0]!.id)!.closed).toBe("changed");
    expect(trashCalls()).toEqual([[real("Downloads/old-invoice.pdf")]]);
  });

  it("does not delete, and does not ask again, when the files are gone before the action runs", async () => {
    scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(["~/Downloads/old-invoice.pdf"]) });
    await start({
      showApprovalCard: () => {
        // The user moved the file away themselves while the card was open.
        renameSync(join(home, "Downloads", "old-invoice.pdf"), join(dir.path, "moved-away.pdf"));
        return decided(true, "tap");
      },
    });
    const task = run!.startTask("delete the old invoice");
    await until(ended(task.id));
    expect(cards()).toHaveLength(1);
    expect(trashCalls()).toEqual([]);
    expect(steps(task.id).find((s) => s.action.action.kind === "tool")).toMatchObject({
      outcome: "noEffect",
      observation: "Not done: the files changed or are gone, so nothing was moved to the Trash.",
    });
  });
});

describe("SPEC-01 r14 Auto mode still asks before a delete (OBJ-50.5)", () => {
  it("a goal sent in Auto mode starts without a repeat-back and still shows the delete card, and nothing moves before a tap", async () => {
    scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(invoicePaths()) });
    const tapped = later<ApprovalDecision>();
    await start({ showApprovalCard: () => tapped.promise });
    const submitted = (await run!.mac.call("submitGoal", {
      transcript: "delete my old invoices",
      originDeviceId: "mac-brent",
      autoMode: true,
    })) as { taskId: string };
    await until(() => cards().length === 1);

    expect(run!.mac.events.some((e) => e.event === "goalRestated")).toBe(false);
    expect(run!.harness.store.getTask(submitted.taskId)).toMatchObject({
      confirmedGoal: "delete my old invoices",
      status: "waitingForUser",
    });
    expect(cards()[0]!.text).toBe(
      "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?",
    );
    expect(trashCalls()).toEqual([]);
    expect(downloads()).toEqual(INVOICES.slice().sort());

    tapped.resolve(decided(false, "tap"));
    await until(ended(submitted.taskId));
    expect(trashCalls()).toEqual([]);
    expect(downloads()).toEqual(INVOICES.slice().sort());
  });
});

describe("SPEC-07 Blocked action is refused even with a yes (OBJ-38.4)", () => {
  it("records the step as blocked, sends blockedAction, and Keep going (resumeTask) carries on without running it", async () => {
    // The model asks to trash the Downloads folder itself, which SPEC-07 r9 blocks.
    const worker = scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(["~/Downloads"]) });
    await start();
    const task = run!.startTask("clear out Downloads");
    await until(() => run!.mac.events.some((e) => e.event === "userError"));

    const error = run!.mac.events.find((e) => e.event === "userError")!.payload as UserError;
    const blocked = steps(task.id).find((s) => s.outcome === "blocked")!;
    expect(error).toEqual({ kind: "blockedAction", taskId: task.id });
    expect(blocked.action.permission).toBe("blocked");
    // Yumi waits for "Keep going" or "Stop"
    expect(run!.harness.store.getTask(task.id)!.status).toBe("waitingForUser");

    // The user says yes, keep going, which the app sends as resumeTask: the blocked action still never runs
    expect(await run!.mac.call("resumeTask", { taskId: task.id })).toEqual({});
    await until(ended(task.id));
    expect(run!.harness.store.getTask(task.id)!.status).toBe("done");
    expect(downloads()).toEqual(INVOICES.slice().sort());
    expect(cards()).toEqual([]);
    expect(trashCalls()).toEqual([]);
    expect(run!.harness.store.listActionLog(task.id)[0]).toMatchObject({
      description: "Did not move Downloads to the Trash, because Yumi's safety rules do not allow it",
      outcome: "blocked",
    });
    expect(worker.at(-1)!.text).toContain("Not done: Yumi's safety rules do not allow this move_to_trash.");
  });

  it("Stop (cancelTask) cancels the task, and nothing else runs", async () => {
    const worker = scriptModel(model, { plan: DELETE_PLAN, worker: trashOnce(["~/Downloads"]) });
    await start();
    const task = run!.startTask("clear out Downloads");
    await until(() => run!.mac.events.some((e) => e.event === "userError"));
    const requests = worker.length;

    await run!.mac.call("cancelTask", { taskId: task.id });
    expect(run!.harness.store.getTask(task.id)!.status).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(worker.length).toBe(requests);
    expect(downloads()).toEqual(INVOICES.slice().sort());
  });
});

describe("delete copy (SPEC-07 Draft copy)", () => {
  const summary = (paths: string[]) => ({ folder: "/Users/ana", count: paths.length, firstNames: [], allPaths: paths });

  it("names one file, files in one folder, and files in several folders", () => {
    expect(deleteText(summary(["/Users/ana/Downloads/old-invoice.pdf"]))).toBe(
      "I'm about to move old-invoice.pdf from Downloads to the Trash. Should I delete it?",
    );
    const twelve = INVOICES.map((name) => `/Users/ana/Downloads/${name}`);
    expect(deleteText(summary(twelve))).toBe(
      "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?",
    );
    const spread = [
      "/Users/ana/Downloads/old-invoice.pdf",
      ...INVOICES.slice(1, 6).map((name) => `/Users/ana/Documents/${name}`),
      ...INVOICES.slice(6).map((name) => `/Users/ana/Desktop/${name}`),
    ];
    expect(deleteText(summary(spread))).toBe(
      "I'm about to move 12 files from 3 folders to the Trash, starting with old-invoice.pdf in Downloads. Should I delete them?",
    );
  });
});
