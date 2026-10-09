import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "node:net";
import { RpcPeer, RpcRemoteError, loadRpcContract } from "@yumi/protocol";
import { PROTOCOL_VERSION, type ToolCall } from "@yumi/protocol/types";
import { PASSWORD_QUESTION } from "../src/gui/copy.ts";
import { watchHome } from "../src/gui/file-watch.ts";
import { guiAct, isAskedFile } from "../src/gui/gui-act.ts";
import { macAppGui } from "../src/gui/mac.ts";
import {
  GUI_ACT_TOOL,
  MAX_ORCHESTRATOR_TOOLS,
  ORCHESTRATOR_TOOL_NAMES,
  checkToolCount,
  orchestratorTools,
} from "../src/gui/orchestrator-tools.ts";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import { RunControl } from "../src/control/run-control.ts";
import { describeGuiAction, describeNotDone, describeSkipped } from "../src/scheduler/describe.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";
import { FILE_TOOL_NAMES } from "../src/tools/file-tools.ts";
import { modelConfig, PROTOCOL_DIR, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer } from "./mock-model-server.ts";

vi.setConfig({ testTimeout: 30_000 });

const SPECS_DIR = fileURLToPath(new URL("../../specs/", import.meta.url));

describe("the orchestrator's tools (SPEC-05 r9, OBJ-36.2)", () => {
  it("has 8 tools or fewer, with the direct tools inside gui_act", () => {
    expect(ORCHESTRATOR_TOOL_NAMES.length).toBeLessThanOrEqual(MAX_ORCHESTRATOR_TOOLS);
    expect(ORCHESTRATOR_TOOL_NAMES).toEqual([
      "gui_act",
      "read_file",
      "list_dir",
      "write_new_file",
      "copy",
      "move",
      "move_to_trash",
      "phone",
    ]);
    for (const direct of ["open_app", "open_file", "open_url", "reveal_in_finder"]) {
      expect(ORCHESTRATOR_TOOL_NAMES).not.toContain(direct);
    }
  });

  it("fails past 8 tools", () => {
    const nine = Array.from({ length: MAX_ORCHESTRATOR_TOOLS + 1 }, (_, i) => ({ name: `tool${i}`, description: "" }));
    expect(() => checkToolCount(nine)).toThrow(/at most 8/);
    expect(checkToolCount(nine.slice(0, 8))).toHaveLength(8);
  });

  it("offers the planner gui_act and the helper lane's file tools, and refuses a tool not on the list", () => {
    const helper = fileHelperLane({ home: "/tmp/nowhere" }).tools.tools;
    const tools = orchestratorTools(helper, true);
    // OBJ-38 offers move_to_trash on the helper lane, behind its approval: 7 tools.
    expect(tools.map((tool) => tool.name)).toEqual(["gui_act", ...FILE_TOOL_NAMES, "move_to_trash"]);
    expect(tools[0]).toBe(GUI_ACT_TOOL);
    expect(orchestratorTools(helper, false).map((tool) => tool.name)).toEqual([...FILE_TOOL_NAMES, "move_to_trash"]);
    expect(() => orchestratorTools([...helper, { name: "open_app", description: "" }], true)).toThrow(/open_app/);
  });
});

describe("gui_act's words for the user", () => {
  it("asks for a password with the SPEC-07 draft copy, exactly", () => {
    const spec = readFileSync(join(SPECS_DIR, "07-safety.md"), "utf8");
    const row = spec.split("\n").find((line) => line.startsWith("| Asking the user to type a password"))!;
    expect(row.split("|")[2]!.trim()).toBe(`"${PASSWORD_QUESTION}"`);
  });

  it("writes action log lines for direct tools and questions, never the question's text", () => {
    const tool = (call: ToolCall) => ({ action: { kind: "tool" as const, call }, permission: "allowed" as const });
    expect(describeGuiAction(tool({ tool: "open_app", name: "Keynote" }), "Finder", true)).toBe("Opened Keynote");
    expect(describeGuiAction(tool({ tool: "reveal_in_finder", path: "~/Downloads" }), "Finder", true)).toBe(
      "Showed Downloads in Finder",
    );
    expect(describeGuiAction(tool({ tool: "open_url", url: "https://example.com/private?q=secret" }), undefined, false)).toBe(
      "Tried to open example.com",
    );
    expect(describeGuiAction(tool({ tool: "open_file", path: "~/Documents/Q3 Report.key" }), undefined, true)).toBe(
      "Opened Q3 Report.key",
    );
    const ask = (question: string) => ({ action: { kind: "ask" as const, question }, permission: "allowed" as const });
    expect(describeGuiAction(ask(PASSWORD_QUESTION), "Pages", true)).toBe("Asked you to type a password");
    expect(describeGuiAction(ask("Which deck, Q3 or Q4?"), "Keynote", true)).toBe("Asked you a question");
    const send = {
      action: { kind: "click" as const, element: 3 },
      element: { path: "#3", role: "button" as const, label: "Send" },
      permission: "ask" as const,
    };
    expect(describeNotDone(send, "Mail", "declined")).toBe("Did not click Send in Mail, because you said no");
  });
});

describe("naming a blocked action for its message (SPEC-07 r5)", () => {
  const recorded = (action: object, element?: object) => ({
    action,
    permission: "blocked" as const,
    ...(element ? { element } : {}),
  });

  it("says what was skipped, after I can't", () => {
    expect(
      describeSkipped(recorded({ kind: "click" }, { path: "#2", role: "menuBarItem", label: "File" }) as never, "Keynote"),
    ).toBe("click File in Keynote");
    expect(describeSkipped(recorded({ kind: "key", combo: "cmd+q" }) as never, "Keynote")).toBe("press Command-Q in Keynote");
    expect(describeSkipped(recorded({ kind: "tool", call: { tool: "open_app", name: "Terminal" } }) as never, undefined)).toBe(
      "open Terminal",
    );
  });

  it("never holds typed text, and has no name for an action it cannot describe", () => {
    const typed = describeSkipped(recorded({ kind: "type", text: "hunter2" }) as never, "Mail");
    expect(typed).toBe("type in Mail");
    expect(describeSkipped(recorded({ kind: "done" }) as never, "Mail")).toBeUndefined();
  });
});

describe("finding files an app wrote (OBJ-36.8)", () => {
  let dir: { path: string; cleanup: () => void };
  beforeEach(() => (dir = tempDir()));
  afterEach(() => dir.cleanup());

  it("reports new and changed files in the home folder once, and never Library, hidden files, or files that are gone", async () => {
    const home = dir.path;
    for (const folder of ["Downloads", "Documents", "Library/Caches", ".config"])
      mkdirSync(join(home, folder), { recursive: true });
    writeFileSync(join(home, "Documents", "Old notes.txt"), "old");
    // Let its creation time fall outside the watcher slack; POSIX filesystems do not let utimes backdate birthtime.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const watch = await watchHome(home, new MemoryLogger());
    try {
      mkdirSync(join(home, "Documents", "Deck.key", "Data"), { recursive: true });
      writeFileSync(join(home, "Downloads", "Q3 Report.pdf"), "%PDF-");
      writeFileSync(join(home, "Documents", "Deck.key", "Data", "image.jpg"), "jpg");
      writeFileSync(join(home, "Documents", "Old notes.txt"), "changed");
      writeFileSync(join(home, "Library", "Caches", "cache.db"), "x");
      writeFileSync(join(home, ".config", "settings.json"), "{}");
      writeFileSync(join(home, "Downloads", ".DS_Store"), "x");
      writeFileSync(join(home, "Downloads", "temp.sb-1234"), "x");
      rmSync(join(home, "Downloads", "temp.sb-1234"));
      // No waiting here: takeNew waits for the events itself.
      const found = await watch.takeNew();
      expect(found).toEqual(
        expect.arrayContaining([
          { path: "~/Downloads/Q3 Report.pdf", created: true },
          { path: "~/Documents/Deck.key", created: true },
          { path: "~/Documents/Old notes.txt", created: false },
        ]),
      );
      expect(found).toHaveLength(3);
      // Each file is reported once; `all` keeps every one that still exists.
      writeFileSync(join(home, "Downloads", "Q3 Report.pdf"), "%PDF-2");
      expect(await watch.takeNew()).toEqual([]);
      rmSync(join(home, "Documents", "Old notes.txt"));
      const all = await watch.all();
      expect(all.map((change) => change.path).sort()).toEqual(["~/Documents/Deck.key", "~/Downloads/Q3 Report.pdf"]);
    } finally {
      watch.close();
    }
  });

  it("never reports files inside a Git working tree, such as build output (live Keynote runs, 2026-10-10)", async () => {
    const home = dir.path;
    for (const folder of ["Developer/app/.git", "Developer/app/mac/build/Objects", "Yumi smoke test"])
      mkdirSync(join(home, folder), { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const watch = await watchHome(home, new MemoryLogger());
    try {
      for (let n = 0; n < 20; n++) writeFileSync(join(home, "Developer", "app", "mac", "build", "Objects", `f${n}.o`), "o");
      writeFileSync(join(home, "Developer", "app", "README.md"), "changed");
      writeFileSync(join(home, "Yumi smoke test", "Q3 Report run 41.pdf"), "%PDF-");
      expect(await watch.takeNew()).toEqual([{ path: "~/Yumi smoke test/Q3 Report run 41.pdf", created: true }]);
    } finally {
      watch.close();
    }
  });
});

describe("gui_act against the harness's RPC server", () => {
  let dir: { path: string; cleanup: () => void };
  let model: MockModelServer;
  let logger: MemoryLogger;
  let harness: Harness;
  let mock: ChildProcess | undefined;
  let output = "";

  beforeEach(async () => {
    dir = tempDir();
    mkdirSync(join(dir.path, "home"));
    model = await startMockModelServer();
    logger = new MemoryLogger();
    harness = await startHarness({ supportDir: join(dir.path, "s"), socketPath: join(dir.path, "h.sock") }, logger);
  });

  afterEach(async () => {
    mock?.kill();
    mock = undefined;
    output = "";
    await harness.close();
    await model.close();
    dir.cleanup();
  });

  async function waitFor(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Timed out. Mock output:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function runningGuiSubtask() {
    const store = harness.store;
    const task = store.createTask({ originDeviceId: "mac-brent", goal: "Export my deck as a PDF." });
    store.setTaskStatus(task.id, "planning", { confirmedGoal: "Export my deck as a PDF." });
    const { subtasks } = store.savePlan(task.id, [
      { title: "Export the deck", instruction: "In Keynote, export the deck as a PDF.", proposedLane: "ghost", status: "ready" },
    ]);
    return store.setSubtaskStatus(subtasks[0]!.id, "running", {
      lane: "ghost",
      routeReason: "backgroundCapable",
      target: { bundleId: "com.apple.Keynote" },
      workerId: "ghost-1",
    });
  }

  it.skipIf(process.platform === "win32")(
    "Scenario: Action has no effect, with the protocol's mock Mac app, whose window never changes",
    async () => {
      mock = spawn("npm", ["run", "mock:mac", "--", "--socket", harness.server.socketPath], {
        cwd: PROTOCOL_DIR,
        stdio: ["ignore", "pipe", "pipe"],
      });
      mock.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      mock.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      await waitFor(() => output.includes("[mock Mac app] connected"));
      // The mock shows Keynote's export sheet; the model presses "Next…", its default button, every time.
      model.respond(() => ({ kind: "content", content: JSON.stringify({ action: { kind: "click", element: 6 } }) }));
      const subtask = runningGuiSubtask();
      const control = new RunControl();

      const run = await guiAct(
        subtask.id,
        {
          store: harness.store,
          client: new ModelClient(modelConfig(model.baseUrl), logger),
          logger,
          deviceId: "mac-brent",
          home: join(dir.path, "home"),
          mac: macAppGui(harness.server, logger),
          questions: harness.questions,
          settle: { intervalMs: 20, timeoutMs: 500 },
        },
        { confirmedGoal: "Export my deck as a PDF.", signal: control.enter(subtask.id, "ghost"), control },
      );

      // Then the step outcome is "noEffect": the mock answers ok, but the tree and the title did not change.
      expect(harness.store.listSteps(subtask.id).map((step) => step.outcome)).toEqual(["noEffect", "noEffect", "noEffect"]);
      expect(run).toMatchObject({
        outcome: "ended",
        reason: "noEffect",
        result: { status: "stuck" },
        userError: { kind: "stuckOnScreen" },
      });
      await waitFor(() => (output.match(/\[mock Mac app\] executeAction /g) ?? []).length === 3);
      expect(output).toContain('"element":{"path":"#6","role":"button","label":"Next…"}');
    },
  );

  it("refuses an answer to a question nobody asked, with the Unexpected kind", async () => {
    const subtask = runningGuiSubtask();
    const socket = connect(harness.server.socketPath);
    await new Promise((resolve) => socket.once("connect", resolve));
    const peer = new RpcPeer({ role: "app", socket, handlers: {}, contract: loadRpcContract() });
    await peer.request("hello", { protocolVersion: PROTOCOL_VERSION });
    const answer = peer.request("answerQuestion", { taskId: subtask.taskId, subtaskId: subtask.id, answer: "Done" });
    await expect(answer).rejects.toBeInstanceOf(RpcRemoteError);
    await expect(answer).rejects.toMatchObject({ error: { data: { kind: "unexpected", taskId: subtask.taskId } } });
    peer.close();
  });
});

describe("the file the instruction asked for (live Keynote runs, 2026-10-10)", () => {
  it("matches a quoted name, with or without its extension, and nothing else when names are quoted", () => {
    const instruction =
      'In Keynote, export the open deck as a PDF named "Q3 Report run 61", saved in the "Yumi smoke test" folder.';
    expect(isAskedFile("~/Yumi smoke test/Q3 Report run 61.pdf", instruction)).toBe(true);
    expect(isAskedFile("~/Documents/q3 report run 61.pdf", instruction)).toBe(true);
    expect(isAskedFile("~/Yumi smoke test/Q3 Report run 62.pdf", instruction)).toBe(false);
    expect(isAskedFile("~/Yumi smoke test/Other.pdf", instruction)).toBe(false);
    expect(isAskedFile("~/Desktop/Notes.txt", "Save the note as \u201cNotes.txt\u201d on the Desktop.")).toBe(true);
  });

  it("without a quoted name, matches a file of the asked type in the asked folder", () => {
    expect(isAskedFile("~/Downloads/Deck.pdf", "Export the deck as a PDF to Downloads.")).toBe(true);
    expect(isAskedFile("~/Documents/Deck.pdf", "Export the deck as a PDF to Downloads.")).toBe(false);
    expect(isAskedFile("~/Documents/Deck.pdf", "Export the deck as a PDF.")).toBe(true);
    expect(isAskedFile("~/Documents/Deck.key", "Export the deck as a PDF.")).toBe(false);
    expect(isAskedFile("~/Documents/Deck.pdf", "Export the deck with the default options.")).toBe(false);
  });
});
