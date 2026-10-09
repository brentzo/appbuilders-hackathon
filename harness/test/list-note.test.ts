import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validate } from "@yumi/protocol";
import { PROTOCOL_VERSION, type Subtask } from "@yumi/protocol/types";
import { checkClassification, CLASSIFY_NOTE_SYSTEM_PROMPT, CLASSIFY_SYSTEM_PROMPT, noteReply } from "../src/confirm/classify.ts";
import { repeatBack, RESTATE_SYSTEM_PROMPT } from "../src/confirm/restate.ts";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import {
  asksForList,
  expandNoteText,
  foundList,
  isNoteSubtask,
  listTitle,
  NOTE_SUBTASK_TITLE,
  NOTE_TEXT,
  noteSubtask,
  noteText,
  noteTextOf,
} from "../src/planner/list-note.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT, type Finding } from "../src/planner/summary.ts";
import { fileHelperLane, helperLane, routeWith, type RouteSubtask } from "../src/scheduler/lanes.ts";
import { localVoice, runTask, type RunTaskDeps } from "../src/scheduler/run-task.ts";
import { TaskControl } from "../src/scheduler/task-control.ts";
import { modelConfig, rawClient, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";

/**
 * Lists in a new note (SPEC-02 r13, OBJ-74): the offer in the repeat-back, "yes, in a note", the note subtask after
 * the listing, the full list with the summary, and the "Save to Notes" follow-up. The real task store, planner,
 * scheduler, file tools, and local RPC server, with a mocked model server. The main lane, which needs the Mac app,
 * is a stand-in that records the note subtask it was given.
 */

vi.setConfig({ testTimeout: 20_000 });

const LISTED = ["invoice-oct.pdf", "notes.txt", "photo.jpg"];
const GOAL = "list the files in your Downloads folder";
const OFFER = "You want me to list the files in your Downloads folder. Want it in a note too?";
const ANSWER = "You have 3 files and 1 folder in Downloads. Some of them are invoice-oct.pdf, notes.txt and photo.jpg.";

const content = (value: unknown): MockReply => ({ kind: "content", content: JSON.stringify(value) });

describe("the offer and the answer", () => {
  it("offers the note only for a goal that asks for a list", () => {
    expect(asksForList("list the files in your Downloads folder")).toBe(true);
    expect(asksForList("show you what is in your Desktop folder")).toBe(true);
    expect(asksForList("tell you which files are in your Documents folder")).toBe(true);
    expect(asksForList("rename the invoices in your Downloads folder by date")).toBe(false);
    expect(asksForList("add milk to your shopping list")).toBe(false);
    expect(asksForList("show you the weather")).toBe(false);
  });

  it("asks about the note in place of the usual question", () => {
    expect(repeatBack(GOAL, false, true)).toBe(OFFER);
    expect(repeatBack(GOAL, true, true)).toBe(`Got it. ${OFFER}`);
    expect(repeatBack(GOAL, false)).toBe(`You want me to ${GOAL}. Should I go ahead?`);
  });

  it("reads a yes as yes to the note, since that is the question, and an answer that turns the note down as yes without it", () => {
    // Brent's live run, 2026-10-10 (task e11a8346): he answered "Yes." and got no note.
    for (const yes of [
      "Yes.",
      "yes please",
      "yes, in a note",
      "Yes please, put it in a note.",
      "in a new note",
      "sure, save it in Notes",
    ])
      expect(noteReply(yes)).toBe("confirmWithNote");
    for (const no of [
      "No.",
      "no thanks",
      "just list them",
      "no note, just list them",
      "yes, without a note",
      "don't put it in a note",
    ])
      expect(noteReply(no)).toBe("confirm");
    for (const other of ["never mind the note", "cancel the note", "cancel", "only the PDFs"])
      expect(noteReply(other)).toBeUndefined();
  });

  it("lets the model answer confirmWithNote only when the note was offered", () => {
    expect(checkClassification('{"reply":"confirmWithNote"}', true)).toBe("confirmWithNote");
    expect(checkClassification('{"reply":"confirmWithNote"}')).toBeUndefined();
    expect(checkClassification('{"reply":"confirm"}', true)).toBe("confirm");
  });
});

describe("the list and the note", () => {
  const downloads: Finding = {
    kind: "list",
    folder: "Downloads",
    files: LISTED,
    folders: ["Receipts"],
    total: 4,
    atLeast: false,
  };

  it("titles the list after the goal", () => {
    expect(listTitle("List the files in your Downloads folder")).toBe("Files in your Downloads folder");
    expect(listTitle("Show me all of the PDFs in your Desktop folder.")).toBe("PDFs in your Desktop folder");
    expect(listTitle("Count the photos")).toBe("Count the photos");
    expect(listTitle("List the files in your downloads folder")).toBe("Files in your Downloads folder");
  });

  it("holds every name the listing found, folders marked, and how many more there were", () => {
    const list = foundList([downloads], "Files in your Downloads folder", false)!;
    expect(list).toEqual({
      title: "Files in your Downloads folder",
      items: [...LISTED, "Receipts (folder)"],
      inNote: false,
    });
    expect(validate("FoundList", list).errors).toEqual([]);
    const cut = foundList([{ ...downloads, total: 504, atLeast: true }], "Files", true)!;
    expect(cut.more).toBe(500);
    expect(noteText(cut).split("\n").at(-1)).toBe("and 500 more");
    const two = foundList(
      [downloads, { ...downloads, folder: "Desktop", files: ["a.png"], folders: [], total: 1 }],
      "Files",
      false,
    )!;
    expect(two.items).toContain("Desktop: a.png");
    expect(two.items).toContain("Downloads: notes.txt");
    expect(foundList([{ ...downloads, files: [], folders: [], total: 0 }], "Files", false)).toBeUndefined();
    expect(foundList(undefined, "Files", false)).toBeUndefined();
  });

  it("writes the note with the title on the first line, and types the list in place of the placeholder", () => {
    const list = foundList([downloads], "Files in your Downloads folder", false)!;
    const subtask = noteSubtask(list);
    expect(subtask).toMatchObject({
      title: NOTE_SUBTASK_TITLE,
      proposedLane: "main",
      targetApp: { name: "Notes" },
      needsKeyboard: true,
    });
    expect(isNoteSubtask(subtask)).toBe(true);
    expect(isNoteSubtask({ title: NOTE_SUBTASK_TITLE, instruction: "Make a note." })).toBe(false);
    const text = noteTextOf(subtask.instruction)!;
    expect(text).toBe(["Files in your Downloads folder", ...LISTED, "Receipts (folder)"].join("\n"));
    expect(expandNoteText({ kind: "type", text: NOTE_TEXT }, subtask.instruction)).toEqual({ kind: "type", text });
    expect(expandNoteText({ kind: "type", text: "hello" }, subtask.instruction)).toEqual({ kind: "type", text: "hello" });
    expect(expandNoteText({ kind: "type", text: NOTE_TEXT }, "Type something.")).toEqual({ kind: "type", text: NOTE_TEXT });
    expect(expandNoteText({ kind: "key", combo: "cmd+n" }, subtask.instruction)).toEqual({ kind: "key", combo: "cmd+n" });
  });
});

// End to end on the harness side.

let dir: { path: string; cleanup: () => void };
let home: string;
let server: MockModelServer;
let logger: MemoryLogger;
let harness: Harness | undefined;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  mkdirSync(join(home, "Downloads", "Receipts"), { recursive: true });
  for (const name of LISTED) writeFileSync(join(home, "Downloads", name), name);
  server = await startMockModelServer();
  logger = new MemoryLogger();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await server.close();
  dir.cleanup();
});

/** The note subtasks the main lane stand-in ran, with what it saw. */
let noted: Subtask[] = [];

/**
 * A model that restates the Downloads goal, plans one helper subtask that lists Downloads, lists it, and answers.
 * The main lane's worker finishes the note at once: typing it is gui_act's, covered above and in gui-act.test.ts.
 */
function scriptedModel(classify: string[] = []) {
  const purposes: string[] = [];
  server.respond((body) => {
    const request = body as unknown as ChatRequest;
    const system = request.messages[0]!.content as string;
    const text = request.messages[1]!.content as string;
    if (system === RESTATE_SYSTEM_PROMPT) {
      purposes.push("restate");
      return content({ goal: GOAL });
    }
    if (system === CLASSIFY_SYSTEM_PROMPT || system === CLASSIFY_NOTE_SYSTEM_PROMPT) {
      purposes.push(system === CLASSIFY_NOTE_SYSTEM_PROMPT ? "classifyNote" : "classify");
      return content({ reply: classify.shift() ?? "unclear" });
    }
    if (system === PLANNER_SYSTEM_PROMPT) {
      purposes.push("planner");
      return content({
        subtasks: [
          {
            id: "list",
            title: "List Downloads",
            instruction: `List ${join(home, "Downloads")}.`,
            dependsOn: [],
            proposedLane: "helper",
          },
        ],
      });
    }
    if (system === SUMMARY_SYSTEM_PROMPT) {
      purposes.push("summary");
      return content({ summary: ANSWER });
    }
    if (text.includes(`Instruction: Make a new note in Notes`)) {
      purposes.push("note");
      return content({ action: { kind: "finish", status: "done", note: "Wrote the list into a new note." } });
    }
    purposes.push("worker");
    if (text.includes("invoice-oct.pdf"))
      return content({ action: { kind: "finish", status: "done", note: "Listed Downloads." } });
    return content({ action: { kind: "tool", call: { tool: "list_dir", path: join(home, "Downloads") } } });
  });
  return purposes;
}

/** The main lane stand-in: no Mac app, so no gui_act. It records each subtask that reaches it. */
const route = (h: Harness): RouteSubtask => {
  const real = routeWith(h.router);
  return (subtask) => {
    if (subtask.proposedLane !== "main") return real(subtask);
    noted.push(subtask);
    return Promise.resolve({ lane: "main", reason: "needsKeyboard" });
  };
};

function work(h: Harness): RunTaskDeps {
  return {
    store: h.store,
    client: new ModelClient(modelConfig(server.baseUrl), logger),
    logger,
    deviceId: "mac-brent",
    route: route(h),
    home,
    lanes: {
      helper: fileHelperLane({ home, logger }),
      main: helperLane({ tools: [], run: () => Promise.reject(new Error("the note stand-in runs no tools")) }),
    },
    slots: 1,
    voice: localVoice(h.server, logger, "mac-brent"),
  };
}

type RpcMessage = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { data?: unknown } };

async function app(h: Harness) {
  const client = await rawClient(h.server.socketPath);
  const events: { method: string; params: unknown }[] = [];
  const pending = new Map<number, (message: RpcMessage) => void>();
  let nextId = 1;
  void (async () => {
    for (;;) {
      const message = (await client.next()) as RpcMessage;
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)!(message);
        pending.delete(message.id);
      } else if (message.method) events.push({ method: message.method, params: message.params });
    }
  })().catch(() => undefined);
  const call = (method: string, params: unknown) =>
    new Promise<RpcMessage>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      client.send({ jsonrpc: "2.0", id, method, params });
    });
  await call("hello", { protocolVersion: PROTOCOL_VERSION });
  const named = (method: string) => events.filter((e) => e.method === method).map((e) => e.params as Record<string, unknown>);
  return { named, call, close: () => client.close() };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 1000 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

async function start(): Promise<Harness> {
  noted = [];
  const supportDir = dir.path;
  // The harness wires its own work from these; the route and the main lane stand-in need the harness, so they are
  // swapped in through a holder.
  const holder: { h?: Harness } = {};
  const lazyRoute: RouteSubtask = (subtask) => route(holder.h!)(subtask);
  harness = await startHarness({ supportDir, socketPath: join(supportDir, "h.sock") }, logger, {
    work: {
      client: new ModelClient(modelConfig(server.baseUrl), logger),
      logger,
      deviceId: "mac-brent",
      home,
      lanes: {
        helper: fileHelperLane({ home, logger }),
        main: helperLane({ tools: [], run: () => Promise.reject(new Error("the note stand-in runs no tools")) }),
      },
      slots: 1,
      route: lazyRoute,
    },
  });
  holder.h = harness;
  return harness;
}

describe("SPEC-02 r13 lists in a new note", () => {
  it('offers the note, and "yes" leaves the full list in a new note after the listing', async () => {
    const purposes = scriptedModel();
    const h = await start();
    const client = await app(h);
    const submitted = await client.call("submitGoal", {
      transcript: "list the files in my Downloads folder",
      originDeviceId: "mac-brent",
    });
    const taskId = (submitted.result as { taskId: string }).taskId;
    await until(() => client.named("goalRestated").length === 1);
    expect(client.named("goalRestated")[0]).toEqual({ taskId, text: OFFER });

    // Brent's answer in task e11a8346, which got no note before.
    await client.call("replyToConfirmation", { taskId, reply: { kind: "spoken", text: "Yes." } });
    await until(() => h.store.getTask(taskId)?.status === "done");
    expect(h.store.wantsListInNote(taskId)).toBe(true);
    // The note subtask comes after the listing, with the list from list_dir's real output.
    const subtasks = h.store.listSubtasks(taskId);
    expect(subtasks.map((s) => s.title)).toEqual(["List Downloads", NOTE_SUBTASK_TITLE]);
    expect(subtasks.every((s) => s.status === "done")).toBe(true);
    expect(noted).toHaveLength(1);
    expect(noteTextOf(noted[0]!.instruction)).toBe(
      ["Files in your Downloads folder", ...[...LISTED].sort(), "Receipts (folder)"].join("\n"),
    );
    // The fixed answer needs no model call. The note is written, then the summary says the answer and the note.
    expect(purposes).toEqual(["restate", "planner", "worker", "worker", "note", "summary"]);
    const summary =
      "You have 3 files and 1 folder in Downloads. I put the full list in a new note called Files in your Downloads folder.";
    await until(() => client.named("speak").length === 1);
    const speak = client.named("speak")[0]!;
    expect(speak).toEqual({
      taskId,
      text: summary,
      list: { title: "Files in your Downloads folder", items: [...[...LISTED].sort(), "Receipts (folder)"], inNote: true },
    });
    expect(validate("Speak", speak).errors).toEqual([]);
    expect(h.store.getTask(taskId)!.summary).toBe(summary);
    client.close();
  });

  it('"no thanks" lists without the note, and sends the full list for the card', async () => {
    const purposes = scriptedModel();
    const h = await start();
    const client = await app(h);
    const submitted = await client.call("submitGoal", {
      transcript: "list the files in my Downloads folder",
      originDeviceId: "mac-brent",
    });
    const taskId = (submitted.result as { taskId: string }).taskId;
    await until(() => client.named("goalRestated").length === 1);
    await client.call("replyToConfirmation", { taskId, reply: { kind: "spoken", text: "no thanks" } });
    await until(() => client.named("speak").length === 1);
    expect(h.store.wantsListInNote(taskId)).toBe(false);
    expect(h.store.listSubtasks(taskId)).toHaveLength(1);
    expect(noted).toEqual([]);
    expect(purposes).not.toContain("note");
    expect(client.named("speak")[0]).toMatchObject({
      taskId,
      text: ANSWER,
      list: { title: "Files in your Downloads folder", inNote: false },
    });
    client.close();
  });

  it("asks the model with the note answers when the reply is not a fixed one", async () => {
    const purposes = scriptedModel(["confirmWithNote"]);
    const h = await start();
    const client = await app(h);
    const submitted = await client.call("submitGoal", {
      transcript: "list the files in my Downloads folder",
      originDeviceId: "mac-brent",
    });
    const taskId = (submitted.result as { taskId: string }).taskId;
    await until(() => client.named("goalRestated").length === 1);
    await client.call("replyToConfirmation", { taskId, reply: { kind: "spoken", text: "oo, ilagay mo doon" } });
    await until(() => h.store.getTask(taskId)?.status === "done");
    expect(purposes[1]).toBe("classifyNote");
    expect(h.store.wantsListInNote(taskId)).toBe(true);
    expect(noted).toHaveLength(1);
    client.close();
  });

  it("In Auto mode there is no offer and no button: the list goes into a new note on its own", async () => {
    // Brent's decision, 2026-10-10: "The goal why we're building this is to literally automate things."
    const purposes = scriptedModel();
    const h = await start();
    const client = await app(h);
    const submitted = await client.call("submitGoal", {
      transcript: "list the files in my Downloads folder",
      originDeviceId: "mac-brent",
      autoMode: true,
    });
    const taskId = (submitted.result as { taskId: string }).taskId;
    await until(() => client.named("speak").length === 1);
    expect(client.named("goalRestated")).toEqual([]);
    expect(purposes).not.toContain("classify");
    expect(h.store.listSubtasks(taskId).map((s) => s.title)).toEqual(["List Downloads", NOTE_SUBTASK_TITLE]);
    // In Auto mode the confirmed goal is what the user said, so the title is too.
    expect(noteTextOf(noted[0]!.instruction)!.split("\n")[0]).toBe("Files in my Downloads folder");
    expect(client.named("speak")[0]).toMatchObject({
      taskId,
      text: "You have 3 files and 1 folder in Downloads. I put the full list in a new note called Files in my Downloads folder.",
      list: { inNote: true },
    });
    client.close();
  });

  it("In Auto mode a goal that finds no list writes no note", async () => {
    const purposes = scriptedModel();
    const h = await start();
    const task = h.store.createTask({
      originDeviceId: "mac-brent",
      goal: "tidy",
      confirmedGoal: "Tidy up",
      status: "planning",
      autoMode: true,
    });
    h.store.setListToNote(task.id);
    server.respond((body) => {
      const system = (body as unknown as ChatRequest).messages[0]!.content as string;
      if (system === PLANNER_SYSTEM_PROMPT)
        return content({
          subtasks: [{ id: "a", title: "Look", instruction: "Do nothing.", dependsOn: [], proposedLane: "helper" }],
        });
      if (system === SUMMARY_SYSTEM_PROMPT) return content({ summary: "Done. Nothing to tidy." });
      return content({ action: { kind: "finish", status: "done", note: "Nothing to do." } });
    });
    expect(purposes).toEqual([]);
    expect((await runTask(task.id, work(h))).outcome).toBe("done");
    expect(h.store.listSubtasks(task.id).some(isNoteSubtask)).toBe(false);
    expect(noted).toEqual([]);
  });

  it('"Save to Notes" on a list that is not in a note starts a short task that writes the note', async () => {
    const purposes = scriptedModel();
    const h = await start();
    const client = await app(h);
    const submitted = await client.call("submitGoal", {
      transcript: "list the files in my Downloads folder",
      originDeviceId: "mac-brent",
    });
    const taskId = (submitted.result as { taskId: string }).taskId;
    await until(() => client.named("goalRestated").length === 1);
    await client.call("replyToConfirmation", { taskId, reply: { kind: "spoken", text: "no thanks" } });
    await until(() => client.named("speak").length === 1);
    expect(client.named("speak")[0]).toMatchObject({ taskId, list: { inNote: false } });

    // The card's button, or "save it" while the card is up.
    const saved = await client.call("saveListToNote", { taskId });
    const noteTaskId = (saved.result as { taskId: string }).taskId;
    expect(noteTaskId).not.toBe(taskId);
    await until(() => h.store.getTask(noteTaskId)?.status === "done");
    expect(h.store.getTask(noteTaskId)).toMatchObject({
      confirmedGoal: "Put the files in your Downloads folder in a new note",
      status: "done",
    });
    expect(h.store.listSubtasks(noteTaskId).map((s) => s.title)).toEqual([NOTE_SUBTASK_TITLE]);
    expect(noteTextOf(noted[0]!.instruction)!.split("\n")[0]).toBe("Files in your Downloads folder");
    // No planner and no summary model call for the follow-up.
    expect(purposes.filter((p) => p === "planner")).toHaveLength(1);
    expect(purposes.filter((p) => p === "summary")).toHaveLength(1);
    await until(() => client.named("speak").length === 2);
    expect(client.named("speak")[1]).toEqual({
      taskId: noteTaskId,
      text: "Done. I put the full list in a new note called Files in your Downloads folder.",
    });
    client.close();
  });

  it("refuses to save a task that found no list, with the Unexpected kind", async () => {
    scriptedModel();
    const h = await start();
    const task = h.store.createTask({
      originDeviceId: "mac-brent",
      goal: "rename the invoices",
      confirmedGoal: "Rename",
      status: "planning",
    });
    const client = await app(h);
    const refused = await client.call("saveListToNote", { taskId: task.id });
    expect(refused.error?.data).toMatchObject({ kind: "unexpected", taskId: task.id });
    const unknown = await client.call("saveListToNote", { taskId: "00000000-0000-4000-8000-000000000009" });
    expect(unknown.error?.data).toEqual({ kind: "unexpected" });
    client.close();
  });

  it("runTask adds the note subtask only once, even when it already ran", async () => {
    scriptedModel();
    const h = await start();
    const task = h.store.createTask({
      originDeviceId: "mac-brent",
      goal: GOAL,
      confirmedGoal: "List the files in your Downloads folder",
      status: "planning",
    });
    h.store.setListToNote(task.id);
    const outcome = await runTask(task.id, work(h));
    expect(outcome.outcome).toBe("done");
    expect(h.store.listSubtasks(task.id).filter(isNoteSubtask)).toHaveLength(1);
    expect(new TaskControl(h.store, logger).isRunning(task.id)).toBe(false);
  });
});
