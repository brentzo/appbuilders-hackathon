import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validate } from "@yumi/protocol";
import type {
  CursorCommand,
  ModelAction,
  QuestionAsked,
  Subtask,
  Task,
  TaskStatusChanged,
  WorkerThought,
} from "@yumi/protocol/types";
import { DebugLog } from "../src/debug/debug-log.ts";
import { PASSWORD_REMOVED } from "../src/debug/scrub.ts";
import { GUI_TOOLS, guiAct, STEPS_PER_ATTEMPT, type GuiActDeps, type GuiActRun } from "../src/gui/gui-act.ts";
import { PASSWORD_QUESTION } from "../src/gui/copy.ts";
import { MacGuiFailure, macAppGui } from "../src/gui/mac.ts";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../src/planner/summary.ts";
import type { ApprovalAnswer, ApprovalGate } from "../src/approvals/approval-flow.ts";
import { RunControl } from "../src/control/run-control.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";
import { runGuiSubtask } from "../src/scheduler/gui-lane.ts";
import { modelConfig, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";
import { connectFakeMac, type FakeAppModel, type FakeMac, type FakeScreen } from "./support/fake-mac.ts";
import { FakeKeynote, KEYNOTE, staticApp } from "./support/fake-keynote.ts";

/**
 * `gui_act` (OBJ-36) end to end inside the harness: the real task store, permission gate, worker step, and local RPC
 * server, a mocked model server, and a scripted Mac app that answers `observeWindow` and `executeAction` over the
 * socket with contract-checked shapes (test/support/fake-mac.ts).
 */

vi.setConfig({ testTimeout: 20_000 });

const GOAL = "Export my deck as a PDF.";
const INSTRUCTION = 'In Keynote, export the open deck as a PDF named "Q3 Report", in Downloads. Keep the default options.';
/** Much shorter than the real 500 ms between looks, which only the real Mac app needs. */
const FAST_SETTLE = { intervalMs: 20, timeoutMs: 500 };

let dir: { path: string; cleanup: () => void };
let home: string;
let model: MockModelServer;
let logger: MemoryLogger;
let harness: Harness;
let mac: FakeMac | undefined;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  for (const folder of ["Downloads", "Documents", "Library/Caches"]) mkdirSync(join(home, folder), { recursive: true });
  model = await startMockModelServer();
  logger = new MemoryLogger();
  harness = await startHarness({ supportDir: join(dir.path, "s"), socketPath: join(dir.path, "h.sock") }, logger, {
    work: {
      client: new ModelClient(modelConfig(model.baseUrl), logger),
      lanes: { helper: fileHelperLane({ home, logger }) },
      deviceId: "mac-brent",
      home,
      slots: 3,
      logger,
      gui: { settle: FAST_SETTLE },
    },
  });
});

afterEach(async () => {
  mac?.close();
  mac = undefined;
  await harness.close();
  await model.close();
  dir.cleanup();
});

// --- Helpers ---------------------------------------------------------------------------------------------------

async function connect(...apps: FakeAppModel[]): Promise<FakeMac> {
  mac = await connectFakeMac(harness.server.socketPath, apps);
  return mac;
}

/** The element number of a line such as `[15] button "Save…"` in the step's prompt, if it is there. */
function numberOf(text: string, role: string, label: string): number | undefined {
  const line = text.split("\n").find((l) => new RegExp(`^\\[\\d+\\] ${role} ${JSON.stringify(label)}(?: |$)`).test(l));
  return line ? Number(/^\[(\d+)\]/.exec(line)![1]) : undefined;
}

const reply = (action: ModelAction | Record<string, unknown>): MockReply => ({
  kind: "content",
  content: JSON.stringify({ action }),
});

interface WorkerCall {
  system: string;
  text: string;
  body: Record<string, unknown>;
}

/** Answers worker steps with `decide`, and the planner and summary when a whole task runs. */
function scriptModel(decide: (text: string, call: number) => MockReply, plan?: unknown) {
  const calls: WorkerCall[] = [];
  model.respond((body) => {
    const request = body as unknown as ChatRequest;
    const system = request.messages[0]!.content as string;
    const text = request.messages[1]!.content as string;
    if (system === PLANNER_SYSTEM_PROMPT) return { kind: "content", content: JSON.stringify(plan) };
    if (system === SUMMARY_SYSTEM_PROMPT)
      return { kind: "content", content: JSON.stringify({ summary: "Done. I exported your deck." }) };
    calls.push({ system, text, body });
    return decide(text, calls.length);
  });
  return calls;
}

/** What a careful model does in Keynote, from what the step's prompt shows. Finishes when a new file appears. */
function keynoteWorker(name = "Q3 Report") {
  return (text: string): MockReply => {
    const last =
      text
        .split("\n")
        .filter((l) => /^\d+\. /.test(l))
        .at(-1) ?? "";
    if (last.includes("New file:")) return reply({ kind: "finish", status: "done", note: "Exported the deck." });
    const pick = (role: string, label: string) => numberOf(text, role, label);
    const saveAs = text.split("\n").find((l) => /^\[\d+\] textField "Save As:"/.test(l));
    if (pick("menuItem", "PDF…")) return reply({ kind: "click", element: pick("menuItem", "PDF…")! });
    if (pick("menuItem", "Export To")) return reply({ kind: "click", element: pick("menuItem", "Export To")! });
    if (pick("button", "Save…")) return reply({ kind: "click", element: pick("button", "Save…")! });
    if (saveAs && !saveAs.includes(`value=${JSON.stringify(name)}`)) {
      return reply({ kind: "setValue", element: pick("textField", "Save As:")!, text: name });
    }
    if (pick("button", "Export")) return reply({ kind: "click", element: pick("button", "Export")! });
    // Round 3's mistake: a closing sheet with only Cancel looks like an export dialog to cancel.
    if (/In front: a sheet, cancel button \[1\]/.test(text)) return reply({ kind: "click", element: 1 });
    return reply({ kind: "click", element: pick("menuBarItem", "File")! });
  };
}

/** A confirmed task with one ghost or main subtask in an app, running, as the scheduler leaves it before gui_act. */
function guiSubtask(
  options: { lane?: "ghost" | "main"; bundleId?: string; windowId?: number; instruction?: string; goal?: string } = {},
): {
  task: Task;
  subtask: Subtask;
} {
  const store = harness.store;
  const goal = options.goal ?? GOAL;
  const task = store.createTask({ originDeviceId: "mac-brent", goal });
  store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });
  const { subtasks } = store.savePlan(task.id, [
    {
      title: "Export the deck as a PDF",
      instruction: options.instruction ?? INSTRUCTION,
      proposedLane: "ghost",
      status: "ready",
    },
  ]);
  const lane = options.lane ?? "ghost";
  const subtask = store.setSubtaskStatus(subtasks[0]!.id, "running", {
    lane,
    routeReason: lane === "ghost" ? "backgroundCapable" : "needsKeyboard",
    target: { bundleId: options.bundleId ?? KEYNOTE, ...(options.windowId !== undefined ? { windowId: options.windowId } : {}) },
    workerId: `${lane}-1`,
  });
  return { task: store.getTask(task.id)!, subtask };
}

function deps(overrides: Partial<GuiActDeps> = {}): GuiActDeps {
  return {
    store: harness.store,
    client: new ModelClient(modelConfig(model.baseUrl), logger),
    logger,
    deviceId: "mac-brent",
    home,
    mac: macGui(),
    questions: harness.questions,
    settle: FAST_SETTLE,
    ...overrides,
  };
}

/** The harness's own Mac app seam over its RPC server, as `startHarness` builds it. */
function macGui() {
  return macAppGui(harness.server, logger);
}

function act(subtask: Subtask, overrides: Partial<GuiActDeps> = {}, control = new RunControl()) {
  const signal = control.enter(subtask.id, subtask.lane!);
  return guiAct(subtask.id, deps(overrides), { confirmedGoal: GOAL, signal, control });
}

/** An approval flow that answers every request the same way, and records what it was asked. */
function approvalsAnswering(answer: ApprovalAnswer, blocked: "keepGoing" | "cancelled" = "cancelled") {
  const requests: Parameters<ApprovalGate["request"]>[] = [];
  const blockedCalls: Parameters<ApprovalGate["blocked"]>[] = [];
  const gate: ApprovalGate = {
    request: (...args) => {
      requests.push(args);
      return Promise.resolve(answer);
    },
    blocked: (...args) => {
      blockedCalls.push(args);
      return Promise.resolve(blocked);
    },
    moveToTrash: () => Promise.resolve({ failed: true }),
  };
  return { gate, requests, blockedCalls };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 500 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

const cursorCommands = (fake: FakeMac) =>
  fake.events.filter((e) => e.event === "cursorCommand").map((e) => e.payload as CursorCommand);

const ended = (run: GuiActRun) => {
  if (run.outcome !== "ended") throw new Error(`expected the attempt to end, got ${run.outcome}`);
  return run;
};

// --- SPEC-05 scenarios -----------------------------------------------------------------------------------------

describe("SPEC-05 Mac GUI control", () => {
  it('Scenario: Direct tool is used when available ("open the Downloads folder")', async () => {
    const finder = staticApp("com.apple.finder", {
      app: "Finder",
      title: "Recents",
      elements: [
        { role: "button", label: "Back" },
        { role: "row", label: "Q3 Report.key" },
        { role: "menuBarItem", label: "Go" },
      ],
    });
    const fake = await connect(finder);
    const calls = scriptModel((_text, call) =>
      call === 1
        ? reply({ kind: "tool", call: { tool: "reveal_in_finder", path: "~/Downloads" } })
        : reply({ kind: "finish", status: "done", note: "Opened Downloads." }),
    );
    const { subtask } = guiSubtask({ bundleId: "com.apple.finder", instruction: "Open the Downloads folder." });

    const run = ended(await act(subtask));

    // Then it opens the folder with the reveal_in_finder tool
    expect(fake.executed.map((c) => c.params.action.action)).toEqual([
      { kind: "tool", call: { tool: "reveal_in_finder", path: "~/Downloads" } },
    ]);
    // And no element in the UI is pressed
    expect(fake.executed.some((c) => c.params.action.action.kind === "click")).toBe(false);
    expect(run.result.status).toBe("done");
    // The direct tools are offered first, with how to call them (OBJ-36.4).
    expect(calls[0]!.text).toContain(`Available tools: ${GUI_TOOLS.join(", ")}.`);
    expect(calls[0]!.text).toContain('{"tool": "reveal_in_finder", "path": "~/Downloads"}');
    expect(calls[0]!.system.indexOf('"kind": "tool"')).toBeLessThan(calls[0]!.system.indexOf('"kind": "click"'));
    expect(calls[0]!.system).toContain("When one of the available tools does the job, use it instead of clicking");
  });

  it("Scenario: Raw shell is not available", async () => {
    const finder = staticApp("com.apple.finder", {
      app: "Finder",
      title: "Recents",
      elements: [{ role: "button", label: "Back" }],
    });
    const fake = await connect(finder);
    // When the model tries to run a shell command or AppleScript
    const calls = scriptModel((_text, call) =>
      call === 1
        ? reply({ kind: "shell", command: "open ~/Downloads" })
        : reply({ kind: "tool", call: { tool: "run_applescript", script: 'tell application "Finder" to open home' } }),
    );
    const { subtask } = guiSubtask({ bundleId: "com.apple.finder", instruction: "Open the Downloads folder." });

    const run = ended(await act(subtask));

    // Then the action is rejected as invalid output
    expect(run.reason).toBe("invalidOutput");
    expect(run.result.status).toBe("stuck");
    expect(run.streaks.invalidOutput).toBe(2);
    expect(logger.entries.filter((e) => e.event === "step.invalidOutput")).toHaveLength(2);
    // And nothing runs
    expect(fake.executed).toEqual([]);
    expect(harness.store.listSteps(subtask.id)).toEqual([]);
    // Neither is ever offered: the schema has no shell, AppleScript, or vision click (p1) for the model to decode.
    const schema = JSON.stringify((calls[0]!.body["response_format"] as { json_schema: unknown }).json_schema);
    expect(schema).not.toMatch(/shell|applescript|osascript|clickAt/i);
  });

  it('Scenario: Accessibility is used before vision ("export the deck as a PDF in Keynote")', async () => {
    const keynote = new FakeKeynote({ home });
    const fake = await connect(keynote);
    const calls = scriptModel(keynoteWorker());
    const { subtask } = guiSubtask();

    const run = ended(await act(subtask));
    expect(run.result.status).toBe("done");

    // Then the menu items are pressed through the accessibility API
    const clicks = fake.executed.filter((c) => c.params.action.action.kind === "click");
    expect(clicks.map((c) => c.element!.label).slice(0, 2)).toEqual(["File", "Export To"]);
    expect(clicks.map((c) => c.params.action.element!.role)).toContain("menuItem");
    // And the cursor animation moves to each item: every action names the lane's cursor, which the Mac app moves to
    // the element before acting (OBJ-39), and the cursor was spawned for this ghost with the subtask's title.
    for (const call of fake.executed) expect(call.params.cursorId).toBe("ghost-1");
    expect(cursorCommands(fake)[0]).toEqual({
      command: "spawn",
      cursorId: "ghost-1",
      cursorKind: "ghost",
      label: "Export the deck as a PDF",
    });
    // And the real mouse does not move: no action clicks at screen coordinates.
    expect(fake.executed.some((c) => c.params.action.action.kind === "clickAt")).toBe(false);
    // And no screenshot is sent to the model
    for (const call of calls) {
      expect(JSON.stringify(call.body["messages"])).not.toContain("image_url");
      expect(JSON.stringify(call.body["response_format"])).not.toContain("ClickAtAction");
    }
  });

  it("Scenario: The model sees a trimmed tree", async () => {
    // Given the Keynote window has many elements: the Mac app trims it to at most 200 (OBJ-39), and gui_act passes on
    // exactly what it got.
    const extra = Array.from({ length: 300 }, (_, i) => ({ role: "button" as const, label: `Shape ${i + 1}` }));
    const fake = await connect(new FakeKeynote({ home, extra }));
    const calls = scriptModel(() => reply({ kind: "finish", status: "done", note: "Nothing to do." }));
    const { subtask } = guiSubtask();

    await act(subtask);

    // Then the model receives at most 200 numbered, visible, actionable elements
    const lines = calls[0]!.text.split("\n").filter((l) => /^\[\d+\] /.test(l));
    expect(lines).toHaveLength(200);
    expect(lines[0]).toMatch(/^\[1\] button "Play"$/);
    expect(lines[199]).toMatch(/^\[200\] /);
    // And the model answers with an element number: the schema only allows the numbers on screen.
    const schema = (calls[0]!.body["response_format"] as { json_schema: { schema: { $defs: Record<string, unknown> } } })
      .json_schema.schema;
    expect(schema.$defs["ElementNumber"]).toEqual({ type: "integer", enum: Array.from({ length: 200 }, (_, i) => i + 1) });
    expect(fake.observes.length).toBeGreaterThan(0);
  });

  it('Scenario: Sub-agent returns a structured result ("files ["~/Downloads/Q3 Report.pdf"]")', async () => {
    const keynote = new FakeKeynote({ home });
    await connect(keynote);
    scriptModel(keynoteWorker());
    const { subtask } = guiSubtask();

    const run = ended(await act(subtask));

    // Given gui_act finished exporting a PDF in 6 steps
    expect(run.steps).toBe(6);
    expect(keynote.exported).toEqual([join(home, "Downloads", "Q3 Report.pdf")]);
    // Then the orchestrator receives status "done", files ["~/Downloads/Q3 Report.pdf"], and a short note
    expect(run.result).toEqual({ status: "done", files: ["~/Downloads/Q3 Report.pdf"], note: "Done in 6 steps." });
    expect(validate("SubtaskResult", run.result).errors).toEqual([]);
    // And it does not receive the screenshots, step history, or screen text
    expect(Object.keys(run.result).sort()).toEqual(["files", "note", "status"]);
    for (const text of ["Export To", "Save As:", "Keynote", "Exported the deck."])
      expect(JSON.stringify(run.result)).not.toContain(text);
  });

  it("Scenario: Sub-agent hits its step limit", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    // A model that never finishes: it keeps ticking a checkbox, which changes the tree every time.
    scriptModel((text) => reply({ kind: "click", element: numberOf(text, "checkbox", "Include presenter notes")! }));
    const { subtask } = guiSubtask();

    // Given gui_act has run 10 steps without finishing
    const run = ended(await act(subtask));

    // Then it stops
    expect(run.reason).toBe("stepLimit");
    expect(run.steps).toBe(STEPS_PER_ATTEMPT);
    expect(fake.executed).toHaveLength(10);
    expect(harness.store.listSteps(subtask.id).map((s) => s.outcome)).toEqual(Array(10).fill("ok"));
    // And returns status "partial" with a note on where it got stuck
    expect(run.result).toEqual({ status: "partial", files: [], note: "Stopped after 10 steps without finishing." });
  });

  it("Scenario: Action has no effect (gui_act pressed a button; the tree and title did not change)", async () => {
    await connect(new FakeKeynote({ home }));
    scriptModel((text) => reply({ kind: "click", element: numberOf(text, "button", "Play")! }));
    const { subtask } = guiSubtask();

    const run = ended(await act(subtask));

    // Then the step outcome is "noEffect"
    const steps = harness.store.listSteps(subtask.id);
    expect(steps[0]!.outcome).toBe("noEffect");
    expect(steps[0]!.observation).toBe(
      'Clicked the button "Play". But nothing changed: this action did not work here. Choose a different action.',
    );
    // 3 in a row end the attempt as stuck, with the "Stuck on screen" error (OBJ-36.7), counted for OBJ-09.
    expect(steps.map((s) => s.outcome)).toEqual(["noEffect", "noEffect", "noEffect"]);
    expect(run).toMatchObject({
      reason: "noEffect",
      result: { status: "stuck", files: [], note: "Stuck: 3 steps in a row had no effect." },
      userError: { kind: "stuckOnScreen", taskId: subtask.taskId },
      streaks: { noEffect: 3, invalidOutput: 0 },
    });
  });

  it("Scenario: Password field is left to the user", async () => {
    let signedIn = false;
    const dialog = (): FakeScreen =>
      signedIn
        ? { app: "Pages", title: "Q3 Plan", elements: [{ role: "textArea", label: "Body", value: "Plan" }] }
        : {
            app: "Pages",
            title: "Q3 Plan",
            layer: { kind: "sheet", title: "Enter the password to open Q3 Plan", defaultButton: "OK", cancelButton: "Cancel" },
            focused: "Password",
            elements: [
              { role: "textField", label: "Hint", value: "the usual one", enabled: false },
              { role: "secureTextField", label: "Password", value: "hunter2" },
              { role: "button", label: "Cancel" },
              { role: "button", label: "OK" },
            ],
          };
    const pages: FakeAppModel = {
      bundleId: "com.apple.Pages",
      name: "Pages",
      screen: dialog,
      onElement: (action, element) => {
        if (action.kind === "click" && element.label === "OK") signedIn = true;
        return undefined;
      },
    };
    const fake = await connect(pages);
    // Given the next step needs a password typed into a secure field: the model tries to fill it, then presses OK
    // once the user has typed it, then finishes.
    const calls = scriptModel((text, call) => {
      if (call === 1)
        return reply({ kind: "setValue", element: numberOf(text, "secureTextField", "Password")!, text: "guess123" });
      if (text.includes('textArea "Body"')) return reply({ kind: "finish", status: "done", note: "Opened it." });
      return reply({ kind: "click", element: numberOf(text, "button", "OK")! });
    });
    const { task, subtask } = guiSubtask({
      bundleId: "com.apple.Pages",
      instruction: "Open the Q3 Plan document.",
      lane: "main",
    });
    const statuses: TaskStatusChanged[] = [];
    harness.store.onStatusChanged((event) => statuses.push(event));

    const running = act(subtask);
    // When gui_act reaches that field, Yumi asks the user to type the password, with the SPEC-07 draft copy
    await until(() => fake.events.some((e) => e.event === "questionAsked"));
    const asked = fake.events.find((e) => e.event === "questionAsked")!.payload as QuestionAsked;
    expect(asked).toEqual({ taskId: task.id, subtaskId: subtask.id, question: PASSWORD_QUESTION });
    // And the task waits for the user without pausing while they type
    expect(harness.store.getTask(task.id)!.status).toBe("waitingForUser");
    expect(cursorCommands(fake).at(-1)).toEqual({ command: "setState", cursorId: "main", state: "waitingForUser" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.store.getTask(task.id)!.status).toBe("waitingForUser");
    // The user types it and says Done; the answer comes back through answerQuestion.
    await fake.peer.request("answerQuestion", { taskId: task.id, subtaskId: subtask.id, answer: "Done" });

    const run = ended(await running);
    expect(run.result.status).toBe("done");
    // Then it does not read or fill the field: nothing was ever sent to it, and the model's guess is stored nowhere.
    expect(fake.executed.map((c) => c.element?.label)).toEqual(["OK"]);
    expect(JSON.stringify(harness.store.getTaskHistory(task.id))).not.toContain("guess123");
    // The secure field's value never reaches the model (the Mac app never reads it; OBJ-39).
    for (const call of calls) expect(call.text).not.toContain("hunter2");
    // And the answer fed the next step.
    expect(calls[1]!.text).toContain(`The user was asked to type the password themselves and answered: "Done"`);
    expect(statuses.filter((e) => e.subtaskId === undefined).map((e) => e.status)).toEqual(["waitingForUser", "running"]);
    expect(statuses.some((e) => e.status === "paused")).toBe(false);
  });

  it("Scenario: Accessibility permission is missing", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    fake.failObserve("accessibilityPermissionMissing");
    scriptModel(() => reply({ kind: "finish", status: "done", note: "" }));
    const { subtask } = guiSubtask();

    const run = ended(await act(subtask));

    // Then the user sees the "Permission missing (Mac)" error worded for Accessibility (the Mac app shows its copy
    // and the "Open settings" button, OBJ-39); gui_act stops and passes the kind on, and nothing ran.
    expect(run).toMatchObject({
      reason: "macFailure",
      result: { status: "blocked" },
      userError: { kind: "accessibilityPermissionMissing" },
    });
    expect(fake.executed).toEqual([]);
    expect(model.requests).toEqual([]);
  });
});

// --- Limits and endings ----------------------------------------------------------------------------------------

describe("gui_act limits and endings (OBJ-36.5 to OBJ-36.8)", () => {
  it("counts one attempt per call, and the orchestrator tries again after a partial attempt (SPEC-05 r5)", async () => {
    await connect(new FakeKeynote({ home }));
    scriptModel((text) => reply({ kind: "click", element: numberOf(text, "checkbox", "Include presenter notes")! }));
    const { subtask } = guiSubtask();
    harness.store.updateSubtask(subtask.id, { attempts: 0 });

    const control = new RunControl();
    const run = await runGuiSubtask(subtask, GOAL, deps(), control.enter(subtask.id, "ghost"), control, false);

    // 10 + 10 + 5: the 25 steps per subtask across attempts end it before the third attempt's 10 (SPEC-02 r8).
    expect(harness.store.listSteps(subtask.id)).toHaveLength(25);
    expect(harness.store.getSubtask(subtask.id)!.attempts).toBe(3);
    expect(run).toMatchObject({
      outcome: "failed",
      result: { status: "partial", note: "Stopped at the limit of 25 steps for this subtask." },
      userError: { kind: "taskTookTooLong", taskId: subtask.taskId },
    });
  });

  it("refuses a fourth attempt", async () => {
    await connect(new FakeKeynote({ home }));
    const { subtask } = guiSubtask();
    harness.store.updateSubtask(subtask.id, { attempts: 3 });
    const run = ended(await act(subtask));
    expect(run).toMatchObject({ reason: "attemptLimit", userError: { kind: "stepFailed", step: subtask.title } });
    expect(model.requests).toEqual([]);
  });

  it("checks finish against the step log: done after only failed actions is stuck", async () => {
    await connect(new FakeKeynote({ home }));
    scriptModel((text, call) =>
      call === 1
        ? reply({ kind: "click", element: numberOf(text, "button", "Play")! })
        : reply({ kind: "finish", status: "done", note: "All done!" }),
    );
    const { subtask } = guiSubtask();
    const run = ended(await act(subtask));
    expect(run.result).toEqual({ status: "stuck", files: [], note: "Could not finish after 1 step." });
  });

  it("keeps done when the model finishes before acting: the work may be done already", async () => {
    await connect(new FakeKeynote({ home }));
    scriptModel(() => reply({ kind: "finish", status: "done", note: "Already exported." }));
    const { subtask } = guiSubtask();
    expect(ended(await act(subtask)).result).toEqual({ status: "done", files: [], note: "Done in 0 steps." });
  });

  const quitMenu = () =>
    staticApp(KEYNOTE, {
      app: "Keynote",
      title: "Q3 Report",
      layer: { kind: "menu", title: "Keynote" },
      elements: [
        { role: "menuItem", label: "About Keynote" },
        { role: "menuItem", label: "Quit Keynote" },
      ],
    });

  it("never runs a blocked action, and ends the attempt when the blocked-action card is not answered Keep going (SPEC-07 r5)", async () => {
    // Clicking "Quit Keynote" is blocked by the permission table.
    await connect(quitMenu());
    scriptModel(() => reply({ kind: "click", element: 2 }));
    // "Stop" is the app's cancelTask (OBJ-45): the card answers "cancelled".
    const { gate, blockedCalls } = approvalsAnswering({ outcome: "cancelled" }, "cancelled");
    const { subtask } = guiSubtask();
    const run = ended(await act(subtask, { approvals: gate }));

    expect(run).toMatchObject({ reason: "blocked", result: { status: "blocked" } });
    expect(mac!.executed).toEqual([]);
    const [step] = harness.store.listSteps(subtask.id);
    expect(step).toMatchObject({ outcome: "blocked", action: { permission: "blocked" } });
    // The card is asked about the step that was recorded as blocked, before anything else happens.
    expect(blockedCalls.map(([context]) => context.step.id)).toEqual([step!.id]);
    expect(harness.store.listActionLog(subtask.taskId).at(-1)!.description).toBe(
      "Did not click Quit Keynote in Keynote, because Yumi's safety rules do not allow it",
    );
  });

  it('goes on after "Keep going", still never running the blocked action', async () => {
    await connect(quitMenu());
    scriptModel((text, call) =>
      call === 1 ? reply({ kind: "click", element: 2 }) : reply({ kind: "finish", status: "stuck", note: "Cannot quit." }),
    );
    const { gate } = approvalsAnswering({ outcome: "cancelled" }, "keepGoing");
    const { subtask } = guiSubtask();
    const run = ended(await act(subtask, { approvals: gate }));
    expect(run).toMatchObject({ reason: "finished", result: { status: "stuck" } });
    expect(mac!.executed).toEqual([]);
    expect(model.requests).toHaveLength(2);
    expect((model.requests[1] as unknown as ChatRequest).messages[1]!.content).toContain(
      "-> blocked: Not done: Yumi's safety rules do not allow this action. Do not try it again.",
    );
  });

  it("never asks again about an action that was blocked, and a model that keeps repeating it is stuck (live Keynote runs, 2026-10-10)", async () => {
    await connect(quitMenu());
    scriptModel(() => reply({ kind: "click", element: 2 }));
    const { gate, blockedCalls } = approvalsAnswering({ outcome: "cancelled" }, "keepGoing");
    const { subtask } = guiSubtask();
    const run = ended(await act(subtask, { approvals: gate }));

    expect(blockedCalls).toHaveLength(1);
    expect(mac!.executed).toEqual([]);
    const steps = harness.store.listSteps(subtask.id);
    expect(steps.map((s) => s.outcome)).toEqual(["blocked", "blocked", "blocked"]);
    expect(steps[1]!.observation).toBe("Not run: this exact action was blocked before. Choose a different action.");
    expect(run).toMatchObject({ reason: "invalidOutput", result: { status: "stuck" } });
  });

  it("pauses instead of showing the blocked-action card when the Mac app refuses a click because it is stopped on its side", async () => {
    // The Mac app answers this way while its own stop is on, for example after it saw the user take over.
    await connect(
      staticApp(
        KEYNOTE,
        {
          app: "Keynote",
          title: "Q3 Report",
          elements: [
            { role: "menuBarItem", label: "File" },
            { role: "button", label: "Don’t Update" },
          ],
        },
        () => ({ outcome: "blocked", observation: "Nothing ran: Yumi is paused, or the goal is not confirmed yet." }),
      ),
    );
    scriptModel(() => reply({ kind: "click", element: 1 }));
    const { gate, blockedCalls } = approvalsAnswering({ outcome: "cancelled" }, "keepGoing");
    const control = new RunControl();
    const { subtask } = guiSubtask();
    const run = await act(subtask, { approvals: gate }, control);

    expect(run.outcome).toBe("aborted");
    expect(blockedCalls).toEqual([]);
    expect(control.uiLanesPaused).toBe(true);
    expect(harness.store.getTask(subtask.taskId)!.status).toBe("paused");
    const [step] = harness.store.listSteps(subtask.id);
    expect(step).toMatchObject({
      outcome: "blocked",
      action: { permission: "allowed", element: { role: "menuBarItem", label: "File" } },
    });
    expect(logger.entries.some((e) => e.event === "gui.macStopped")).toBe(true);
  });

  it("ends with blockedAction when there is no approval flow", async () => {
    await connect(quitMenu());
    scriptModel(() => reply({ kind: "click", element: 2 }));
    const { subtask } = guiSubtask();
    const run = ended(await act(subtask));
    expect(run).toMatchObject({
      reason: "blocked",
      userError: { kind: "blockedAction", taskId: subtask.taskId, skippedAction: "click Quit Keynote in Keynote" },
    });
    expect(harness.store.listSteps(subtask.id)[0]).toMatchObject({ outcome: "blocked" });
  });

  const mailDraft = () =>
    staticApp("com.apple.mail", {
      app: "Mail",
      title: "Q3 numbers",
      elements: [
        { role: "textField", label: "To:", value: "ana@example.com" },
        { role: "textField", label: "Cc:", value: "" },
        { role: "button", label: "Send" },
      ],
    });

  it("asks through the approval flow when the gate says ask, with the draft's To and Cc fields; a no runs nothing", async () => {
    const fake = await connect(mailDraft());
    scriptModel((text, call) =>
      call === 1
        ? reply({ kind: "click", element: numberOf(text, "button", "Send")! })
        : reply({ kind: "finish", status: "stuck", note: "The user did not want to send it." }),
    );
    const { gate, requests } = approvalsAnswering({ outcome: "declined", approval: {} as never });
    const { subtask } = guiSubtask({ bundleId: "com.apple.mail", instruction: "Send the draft to Ana." });
    const run = ended(await act(subtask, { approvals: gate }));

    expect(requests).toHaveLength(1);
    const [decision, context] = requests[0]!;
    expect(decision).toMatchObject({ level: "ask", rule: "send" });
    // The step is written, with the gate's level, before the user is asked.
    expect(context.step).toMatchObject({ subtaskId: subtask.id, action: { permission: "ask" } });
    expect(context.step).not.toHaveProperty("outcome");
    expect(context.send).toEqual({ target: { bundleId: "com.apple.mail" }, app: "Mail", to: ["#1"], cc: ["#2"] });
    expect(fake.executed).toEqual([]);
    expect(harness.store.listSteps(subtask.id)[0]!.outcome).toBe("declined");
    expect(harness.store.listActionLog(subtask.taskId).at(-1)!.description).toBe(
      "Did not click Send in Mail, because you said no",
    );
    expect(run.result.status).toBe("stuck");
  });

  it("runs an approved action once", async () => {
    let sent = false;
    const fake = await connect({
      bundleId: "com.apple.mail",
      name: "Mail",
      screen: () => ({ app: "Mail", title: sent ? "Sent" : "Q3 numbers", elements: [{ role: "button", label: "Send" }] }),
      onElement: () => ((sent = true), undefined),
    });
    scriptModel((text, call) =>
      call === 1
        ? reply({ kind: "click", element: numberOf(text, "button", "Send")! })
        : reply({ kind: "finish", status: "done", note: "" }),
    );
    const { gate } = approvalsAnswering({ outcome: "approved", approval: {} as never });
    const { subtask } = guiSubtask({ bundleId: "com.apple.mail", instruction: "Send the draft to Ana." });
    const run = ended(await act(subtask, { approvals: gate }));
    expect(fake.executed).toHaveLength(1);
    expect(run.result.status).toBe("done");
  });

  it("with the real approval flow, a send is not run while the Mac app cannot read the To field by path (known gap)", async () => {
    // The harness has no element paths (OBJ-39 "Protocol asks"), so the flow cannot read the real recipients, and
    // nothing is sent rather than sending without the user's informed yes.
    const fake = await connect(mailDraft());
    scriptModel((text, call) =>
      call === 1
        ? reply({ kind: "click", element: numberOf(text, "button", "Send")! })
        : reply({ kind: "finish", status: "stuck", note: "" }),
    );
    const { subtask } = guiSubtask({ bundleId: "com.apple.mail", instruction: "Send the draft to Ana." });
    await act(subtask, { approvals: harness.approvals! });
    expect(fake.executed).toEqual([]);
    expect(harness.store.listActionLog(subtask.taskId).at(-1)!.description).toBe(
      "Did not click Send in Mail, because Yumi couldn't read who it was going to",
    );
  });

  it("sends nothing once the user takes over, and stops before the next action (SPEC-06 r4)", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    const control = new RunControl();
    const { subtask } = guiSubtask();
    // The take-over lands while the model is deciding.
    scriptModel((text) => {
      control.pauseUiLanes();
      return reply({ kind: "click", element: numberOf(text, "menuBarItem", "File")! });
    });
    const run = await act(subtask, {}, control);
    expect(run).toEqual({ outcome: "aborted", result: { status: "partial", files: [], note: "Stopped before it finished." } });
    expect(fake.executed).toEqual([]);
    expect(harness.store.listSteps(subtask.id)).toEqual([]);
  });

  it("starts no attempt when the run was stopped while the subtask was routed (Brent's run, 2026-10-10)", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    const control = new RunControl();
    const { subtask } = guiSubtask({ windowId: 7 });
    const signal = control.enter(subtask.id, "ghost");
    control.stop("paused");
    const run = await guiAct(subtask.id, deps(), { confirmedGoal: GOAL, signal, control });
    expect(run).toMatchObject({ outcome: "aborted", result: { status: "partial" } });
    expect(fake.observes).toEqual([]);
    expect(harness.store.getSubtask(subtask.id)!.attempts).toBe(0);
  });

  it("ends as stopped, not stuck, when the first look fails after a pause", async () => {
    await connect(new FakeKeynote({ home }));
    const control = new RunControl();
    const { subtask } = guiSubtask({ windowId: 7 });
    const mac = macGui();
    const run = await act(
      subtask,
      {
        mac: {
          ...mac,
          observe: () => {
            control.stop("paused");
            return Promise.reject(new MacGuiFailure("observeWindow", { kind: "stuckOnScreen", taskId: subtask.taskId }));
          },
        },
      },
      control,
    );
    expect(run.outcome).toBe("aborted");
    expect(model.requests).toEqual([]);
  });

  it("asks the model nothing when its lane is already paused", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    const control = new RunControl();
    control.pauseUiLanes();
    const { subtask } = guiSubtask();
    expect((await act(subtask, {}, control)).outcome).toBe("aborted");
    expect(fake.observes).toEqual([]);
    expect(model.requests).toEqual([]);
  });

  it("opens the target app with open_app when it has no window yet (SPEC-05 r1)", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    fake.failObserve("stuckOnScreen", 1);
    scriptModel(() => reply({ kind: "finish", status: "done", note: "" }));
    const { subtask } = guiSubtask();
    await act(subtask);
    expect(fake.executed.map((c) => c.params.action.action)).toEqual([
      { kind: "tool", call: { tool: "open_app", bundleId: KEYNOTE } },
    ]);
    expect(harness.store.listActionLog(subtask.taskId).map((l) => l.description)).toEqual(["Opened com.apple.Keynote"]);
  });

  it("waits for a window the router just opened to become readable (Brent's run, 2026-10-10)", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    // The router listed the new window before the Mac app could read it.
    fake.failObserve("stuckOnScreen", 2);
    scriptModel(() => reply({ kind: "finish", status: "done", note: "" }));
    const { subtask } = guiSubtask({ windowId: 7 });
    const run = ended(await act(subtask));
    expect(fake.observes.slice(0, 3).map((o) => o.target)).toEqual(Array(3).fill({ bundleId: KEYNOTE, windowId: 7 }));
    expect(fake.executed).toEqual([]);
    expect(run).toMatchObject({ reason: "finished", result: { status: "done" } });
    expect(logger.entries.some((e) => e.event === "gui.windowAppeared" && e.looks === 3)).toBe(true);
  });

  it("fails the attempt, opening nothing, when the window the router locked never becomes readable (OBJ-08)", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    fake.failObserve("stuckOnScreen");
    scriptModel(() => reply({ kind: "finish", status: "done", note: "" }));
    const { subtask } = guiSubtask({ windowId: 7 });
    const run = ended(await act(subtask));
    expect(fake.observes.length).toBeGreaterThan(1);
    expect(fake.observes.every((o) => o.target.windowId === 7)).toBe(true);
    expect(fake.executed).toEqual([]);
    expect(model.requests).toEqual([]);
    expect(run).toMatchObject({
      reason: "macFailure",
      result: { status: "stuck" },
      userError: { kind: "stuckOnScreen", taskId: subtask.taskId },
    });
  });

  it("writes every step row before its action runs (SPEC-02 r3)", async () => {
    const fake = await connect(new FakeKeynote({ home }));
    const seen: unknown[] = [];
    fake.onExecute = (params) => seen.push(harness.store.getStep(params.stepId));
    scriptModel(keynoteWorker());
    const { subtask } = guiSubtask();
    await act(subtask);
    expect(seen).toHaveLength(6);
    for (const step of seen) {
      expect(step).toMatchObject({ subtaskId: subtask.id });
      expect(step).not.toHaveProperty("outcome");
    }
  });

  it("writes plain action log lines from the resolved action, never from typed text", async () => {
    await connect(new FakeKeynote({ home }));
    scriptModel(keynoteWorker("Q3 Report final"));
    const { subtask } = guiSubtask();
    await act(subtask);
    expect(harness.store.listActionLog(subtask.taskId).map((l) => l.description)).toEqual([
      "Clicked File in Keynote",
      "Clicked Export To in Keynote",
      "Clicked PDF… in Keynote",
      "Clicked Save… in Keynote",
      "Filled in Save As: in Keynote",
      "Clicked Export in Keynote",
    ]);
  });
});

// --- OBJ-26 round 3 lessons ------------------------------------------------------------------------------------

describe("OBJ-26 round 3 lessons (OBJ-36.10)", () => {
  it("waits for two matching looks, so a closing sheet is not mistaken for the current one", async () => {
    // The save sheet is still in the tree at the first look after Export, as in round 3.
    const keynote = new FakeKeynote({ home, closingLooks: 1 });
    await connect(keynote);
    const calls = scriptModel(keynoteWorker());
    const { subtask } = guiSubtask();

    const run = ended(await act(subtask));

    expect(run.result).toMatchObject({ status: "done", files: ["~/Downloads/Q3 Report.pdf"] });
    // The model never saw the half-closed sheet, so it never clicked its Cancel and never started a second export.
    for (const call of calls) expect(call.text).not.toContain("In front: a sheet, cancel button [1]");
    expect(keynote.exported).toHaveLength(1);
  });

  it("without settling, the round 3 failure happens: the test can tell (control)", async () => {
    const keynote = new FakeKeynote({ home, closingLooks: 100 });
    await connect(keynote);
    const calls = scriptModel(keynoteWorker());
    const { subtask } = guiSubtask();
    await act(subtask, { settle: { intervalMs: 1, timeoutMs: 0 } });
    expect(calls.some((call) => call.text.includes("In front: a sheet, cancel button [1]"))).toBe(true);
  });

  it("treats an accessibility error from executeAction as noEffect with the reason, never ok", async () => {
    const keynote = new FakeKeynote({ home, closingLooks: 100 });
    await connect(keynote);
    // A model that clicks the stale Cancel after Export, as 8 of 10 round 3 runs did.
    const calls = scriptModel((text) => {
      if (/In front: a sheet, cancel button \[1\]/.test(text)) return reply({ kind: "click", element: 1 });
      return keynoteWorker()(text.replace(/New file:/g, "new-file:"));
    });
    const { subtask } = guiSubtask();
    await act(subtask, { settle: { intervalMs: 1, timeoutMs: 0 } });

    const steps = harness.store.listSteps(subtask.id);
    const cancel = steps.find((s) => s.observation?.includes("no longer on screen"))!;
    expect(cancel.outcome).toBe("noEffect");
    expect(cancel.observation).toBe('Nothing happened: The button "Cancel" is no longer on screen. Choose a different action.');
    expect(calls.some((c) => c.text.includes("-> noEffect: Nothing happened: The button"))).toBe(true);
  });

  it('tells the model when a file appears, and in which folder ("New file: Q3 Report.pdf, in Downloads"), so it can finish', async () => {
    await connect(new FakeKeynote({ home }));
    const calls = scriptModel(keynoteWorker());
    const { subtask } = guiSubtask();
    await act(subtask);
    const exportStep = harness.store.listSteps(subtask.id).at(-1)!;
    expect(exportStep.observation).toBe(
      'Clicked the button "Export". Changes: the sheet closed; new: button "Play", button "Add Slide", checkbox "Include presenter notes"; 4 elements gone. New file: Q3 Report.pdf, in Downloads.',
    );
    expect(calls.at(-1)!.text).toContain("New file: Q3 Report.pdf, in Downloads.");
    // Live Keynote runs, 2026-10-10: told only the name, the model went looking for the file in other folders.
    expect(calls.at(-1)!.system).toContain(
      'When a step says "new file", that file was just saved, in the folder it names. If saving it was the job, finish now with status "done" and say in the note which folder it is in, even if it is not the folder you meant. Never go looking for it.',
    );
    // The attempt's log line counts the files it found, which are only known once the attempt is over.
    expect(logger.entries.find((e) => e.event === "gui.attemptEnded")).toMatchObject({ reason: "finished", files: 1 });
  });

  it("says to use setValue when a click on a text field changed nothing", async () => {
    const keynote = new FakeKeynote({ home });
    keynote.state = "savePanel";
    await connect(keynote);
    scriptModel((text) => reply({ kind: "click", element: numberOf(text, "textField", "Save As:")! }));
    const { subtask } = guiSubtask();
    await act(subtask);
    expect(harness.store.listSteps(subtask.id)[0]!.observation).toBe(
      'Put the cursor in the textField "Save As:". But nothing changed: clicking a text field only puts the cursor in it. Use setValue to fill it. Choose a different action.',
    );
  });
});

// --- What the orchestrator receives ----------------------------------------------------------------------------

describe("the orchestrator never sees the screen (SPEC-05 r4, r8)", () => {
  it("keeps unique screen text out of everything the orchestrator receives", async () => {
    const UNIQUE = "Zebra-7731-Quokka";
    // The unique text is in the window title, a label, a value, the model's note, and the model's question.
    const keynote = new FakeKeynote({
      home,
      deck: `Q3 ${UNIQUE}`,
      extra: [{ role: "textField", label: `Speaker ${UNIQUE}`, value: `${UNIQUE} notes` }],
    });
    const fake = await connect(keynote);
    const plan = {
      subtasks: [
        {
          id: "export",
          title: "Export the deck as a PDF",
          instruction: INSTRUCTION,
          dependsOn: [],
          proposedLane: "ghost",
          targetApp: { name: "Keynote" },
        },
      ],
    };
    const worker = keynoteWorker();
    const calls = scriptModel(
      (text) =>
        text
          .split("\n")
          .filter((l) => /^\d+\. /.test(l))
          .at(-1)
          ?.includes("New file:")
          ? reply({ kind: "finish", status: "done", note: `Exported ${UNIQUE}.` })
          : worker(text),
      plan,
    );
    const task = harness.store.createTask({ originDeviceId: "mac-brent", goal: GOAL });
    harness.store.setTaskStatus(task.id, "planning", { confirmedGoal: GOAL });

    const outcome = await harness.tasks.start(task.id);
    expect(outcome).toMatchObject({ outcome: "done" });

    // The workers saw it: it was on the screen.
    expect(calls.some((c) => c.system !== PLANNER_SYSTEM_PROMPT && c.text.includes(UNIQUE))).toBe(true);
    // The orchestrator did not: not in the subtask result, the planner's or summary's requests, or the task record.
    const [subtask] = harness.store.listSubtasks(task.id);
    expect(subtask!.result).toEqual({ status: "done", files: ["~/Downloads/Q3 Report.pdf"], note: "Done in 6 steps." });
    expect(fake.executed).toHaveLength(6);
    const orchestrator = model.requests.filter((body) => {
      const system = (body as unknown as ChatRequest).messages[0]!.content as string;
      return system === PLANNER_SYSTEM_PROMPT || system === SUMMARY_SYSTEM_PROMPT;
    });
    expect(orchestrator).toHaveLength(2);
    // The planner was offered gui_act, not the direct tools inside it (SPEC-05 r9).
    const planner = JSON.stringify(orchestrator[0]);
    expect(planner).toContain("- gui_act: Works in an app's window");
    expect(planner).not.toContain("reveal_in_finder");
    const summaryRequest = JSON.stringify(orchestrator[1]);
    expect(summaryRequest).toContain("Done in 6 steps.");
    expect(summaryRequest).not.toContain(UNIQUE);
    expect(JSON.stringify(subtask!.result)).not.toContain(`Exported ${UNIQUE}`);
  });
});

describe("file work the planner places in Finder (Brent's run, 2026-10-10)", () => {
  it("writes the note with the helper's file tools, never a ghost in Finder", async () => {
    // Brent's plan, with the real home folder the planner is now given.
    const fake = await connect(staticApp("com.apple.finder", { app: "Finder", title: "Documents", elements: [] }));
    const plan = {
      subtasks: [
        {
          id: "note",
          title: "Create Yumi test note",
          instruction: `write_new_file(path="${home}/Documents/Yumi test.txt", content="hello")`,
          dependsOn: [],
          proposedLane: "helper",
          targetApp: { name: "Finder" },
        },
      ],
    };
    scriptModel(
      (text) =>
        text.includes("Created")
          ? reply({ kind: "finish", status: "done", note: "Wrote the note." })
          : reply({ kind: "tool", call: { tool: "write_new_file", path: "~/Documents/Yumi test.txt", content: "hello" } }),
      plan,
    );
    const goal = "write a note in Documents called Yumi test that says hello";
    const task = harness.store.createTask({ originDeviceId: "mac-brent", goal });
    harness.store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });

    expect(await harness.tasks.start(task.id)).toMatchObject({ outcome: "done" });
    expect(harness.store.listSubtasks(task.id)).toMatchObject([{ lane: "helper", routeReason: "noUI", status: "done" }]);
    expect(readFileSync(join(home, "Documents", "Yumi test.txt"), "utf8")).toBe("hello");
    expect(fake.observes).toEqual([]);
    expect(fake.events.filter((e) => e.event === "cursorCommand")).toEqual([]);
  });
});

describe("gui_act in the scheduler", () => {
  const plan = {
    subtasks: [
      {
        id: "export",
        title: "Export the deck as a PDF",
        instruction: INSTRUCTION,
        dependsOn: [],
        proposedLane: "ghost",
        targetApp: { name: "Keynote" },
      },
    ],
  };

  it("Scenario: Password field is left to the user (the user's typing does not pause the task)", async () => {
    let unlocked = false;
    const pages: FakeAppModel = {
      bundleId: "com.apple.Pages",
      name: "Pages",
      screen: () =>
        unlocked
          ? { app: "Pages", title: "Q3 Plan", elements: [{ role: "textArea", label: "Body", value: "Plan" }] }
          : {
              app: "Pages",
              title: "Q3 Plan",
              layer: { kind: "sheet", defaultButton: "Open", cancelButton: "Cancel" },
              focused: "Password",
              elements: [
                { role: "secureTextField", label: "Password" },
                { role: "button", label: "Cancel" },
                { role: "button", label: "Open" },
              ],
            },
      onElement: (action, element) => {
        if (action.kind === "click" && element.label === "Open") unlocked = true;
        return undefined;
      },
    };
    const fake = await connect(pages);
    const task = harness.store.createTask({ originDeviceId: "mac-brent", goal: "Open my Q3 Plan." });
    harness.store.setTaskStatus(task.id, "planning", { confirmedGoal: "Open my Q3 Plan." });
    scriptModel(
      (text, call) => {
        if (call === 1) return reply({ kind: "type", text: "guess123" });
        if (text.includes('textArea "Body"')) return reply({ kind: "finish", status: "done", note: "" });
        return reply({ kind: "click", element: numberOf(text, "button", "Open")! });
      },
      {
        subtasks: [
          {
            id: "open",
            title: "Open the Q3 Plan",
            instruction: "Open the Q3 Plan document in Pages.",
            dependsOn: [],
            proposedLane: "main",
            targetApp: { name: "Pages" },
            needsKeyboard: true,
          },
        ],
      },
    );

    const running = harness.tasks.start(task.id);
    await until(() => fake.events.some((e) => e.event === "questionAsked"));
    expect(harness.store.getTask(task.id)!.status).toBe("waitingForUser");
    // While the user clicks into the field and types, the Mac app reports a take-over; the harness ignores it,
    // because the task waits for the user and no UI lane acts (SPEC-06 r2).
    expect(await fake.peer.request("pause", { taskId: task.id, scope: "uiLanes" })).toEqual({});
    expect(harness.store.getTask(task.id)!.status).toBe("waitingForUser");
    const [subtask] = harness.store.listSubtasks(task.id);
    await fake.peer.request("answerQuestion", { taskId: task.id, subtaskId: subtask!.id, answer: "Done" });

    expect(await running).toMatchObject({ outcome: "done" });
    expect(fake.executed.map((c) => c.element?.label)).toEqual(["Open"]);
    expect(JSON.stringify(harness.store.getTaskHistory(task.id))).not.toContain("guess123");
    expect(harness.store.listActionLog(task.id).map((l) => l.description)).toEqual([
      "Asked you to type a password",
      "Clicked Open in Pages",
    ]);
  });

  it("routes a Keynote subtask to a ghost; a take-over holds it, and Resume carries on with the same attempt", async () => {
    const keynote = new FakeKeynote({ home });
    const fake = await connect(keynote);
    const task = harness.store.createTask({ originDeviceId: "mac-brent", goal: GOAL });
    harness.store.setTaskStatus(task.id, "planning", { confirmedGoal: GOAL });
    const worker = keynoteWorker();
    let tookOver = false;
    scriptModel((text, call) => {
      // The user grabs the mouse while the model decides its third step: the Mac app calls pause for the UI lanes.
      if (call === 3 && !tookOver) {
        tookOver = true;
        void fake.peer.request("pause", { taskId: task.id, scope: "uiLanes" });
      }
      return worker(text);
    }, plan);

    const running = harness.tasks.start(task.id);
    await until(() => harness.store.getTask(task.id)!.status === "paused");
    const [subtask] = harness.store.listSubtasks(task.id);
    await until(() => harness.store.getSubtask(subtask!.id)!.status === "ready");
    expect(harness.store.getSubtask(subtask!.id)).toMatchObject({ lane: "ghost", routeReason: "backgroundCapable", attempts: 1 });
    // Nothing was sent after the take-over: the third step's action never ran.
    expect(harness.store.listSteps(subtask!.id)).toHaveLength(2);
    expect(fake.executed).toHaveLength(2);

    await fake.peer.request("resumeTask", { taskId: task.id });
    expect(await running).toMatchObject({ outcome: "done" });
    expect(harness.store.getSubtask(subtask!.id)).toMatchObject({
      status: "done",
      attempts: 1,
      result: { status: "done", files: ["~/Downloads/Q3 Report.pdf"] },
    });
    expect(keynote.exported).toHaveLength(1);
  });
});

describe("gui_act in Debug mode (OBJ-52)", () => {
  /** A debug log that is on, shared by the model client and gui_act, and the thoughts gui_act sends. */
  function debugDeps(enabled = true) {
    const dir_ = join(dir.path, "s", "Debug log");
    const debug = new DebugLog({ dir: dir_, enabled, logger });
    const thoughts: WorkerThought[] = [];
    const overrides: Partial<GuiActDeps> = {
      client: new ModelClient(modelConfig(model.baseUrl), logger, fetch, debug),
      debug,
      thoughts: (thought) => thoughts.push(thought),
    };
    const entries = () =>
      existsSync(dir_)
        ? readdirSync(dir_).flatMap((name) =>
            readFileSync(join(dir_, name), "utf8")
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line) as Record<string, unknown>),
          )
        : [];
    const text = () =>
      existsSync(dir_)
        ? readdirSync(dir_)
            .map((name) => readFileSync(join(dir_, name), "utf8"))
            .join("")
        : "";
    return { overrides, thoughts, entries, text };
  }

  /** The Keynote worker, giving a reason with each action, as the model does in Debug mode. */
  const withReason = (decide: (text: string) => MockReply) => (text: string) => {
    const answer = decide(text) as { kind: "content"; content: string };
    const { action } = JSON.parse(answer.content) as { action: ModelAction };
    return { kind: "content" as const, content: JSON.stringify({ reason: `Next: ${action.kind}.`, action }) };
  };

  it("writes each step and sends a ghost's thoughts under its own cursor id", async () => {
    await connect(new FakeKeynote({ home }));
    const calls = scriptModel(withReason(keynoteWorker()));
    const { subtask } = guiSubtask();
    const { overrides, thoughts, entries } = debugDeps();

    const run = ended(await act(subtask, overrides));
    expect(run.result.status).toBe("done");

    // The model was asked for its reason first.
    const schema = (
      calls[0]!.body["response_format"] as { json_schema: { schema: { $defs: Record<string, { required: string[] }> } } }
    ).json_schema.schema;
    expect(schema.$defs["WorkerOutput"]!.required).toEqual(["reason", "action"]);

    // Every thought fits the contract, and names the ghost's cursor, the one gui_act spawned and moved.
    expect(thoughts.length).toBeGreaterThan(2);
    for (const thought of thoughts) {
      expect(validate("WorkerThought", thought).errors).toEqual([]);
      expect(thought).toMatchObject({
        subtaskId: subtask.id,
        cursorId: "ghost-1",
        lane: "ghost",
        title: "Export the deck as a PDF",
      });
    }
    expect(thoughts[0]).toMatchObject({
      decision: expect.stringMatching(/^Click "File" \(element \d+\)$/),
      reason: "Next: click.",
    });
    expect(thoughts[0]!.sees).toMatch(/^Keynote, /);
    expect(thoughts[0]).not.toHaveProperty("lastAction");
    expect(thoughts[1]).toMatchObject({ decision: thoughts[0]!.decision, lastAction: "Clicked File in Keynote" });
    expect(thoughts.at(-1)).toMatchObject({ decision: "Finish as done: Exported the deck.", reason: "Next: finish." });

    // The debug log has each decision with the full observation, each outcome, and how the attempt ended.
    const log = entries();
    const decided = log.filter((e) => e.event === "step.decided");
    expect(decided).toHaveLength(calls.length);
    expect(decided[0]).toMatchObject({ subtaskId: subtask.id, step: 1, lane: "ghost", observation: { app: "Keynote" } });
    expect(log.filter((e) => e.event === "step.finished").length).toBe(calls.length - 1);
    expect(log.find((e) => e.event === "subtask.started")).toMatchObject({ cursorId: "ghost-1", target: { bundleId: KEYNOTE } });
    expect(log.find((e) => e.event === "subtask.ended")).toMatchObject({
      outcome: "ended",
      reason: "finished",
      result: { status: "done" },
    });
    expect(log.filter((e) => e.event === "model.request" && e.purpose === "workerStep")).toHaveLength(calls.length);
  });

  it("keeps the password the model tried to fill out of the debug log, and names the main cursor", async () => {
    let signedIn = false;
    const pages: FakeAppModel = {
      bundleId: "com.apple.Pages",
      name: "Pages",
      screen: () =>
        signedIn
          ? { app: "Pages", title: "Q3 Plan", elements: [{ role: "textArea", label: "Body", value: "Plan" }] }
          : {
              app: "Pages",
              title: "Q3 Plan",
              focused: "Password",
              elements: [
                { role: "secureTextField", label: "Password" },
                { role: "button", label: "OK" },
              ],
            },
      onElement: (action, element) => {
        if (action.kind === "click" && element.label === "OK") signedIn = true;
        return undefined;
      },
    };
    const fake = await connect(pages);
    scriptModel((text, call) => {
      if (call === 1)
        return reply({ kind: "setValue", element: numberOf(text, "secureTextField", "Password")!, text: "guess-Pa55word" });
      if (text.includes('textArea "Body"')) return reply({ kind: "finish", status: "done", note: "Opened it." });
      return reply({ kind: "click", element: numberOf(text, "button", "OK")! });
    });
    const { task, subtask } = guiSubtask({
      bundleId: "com.apple.Pages",
      instruction: "Open the Q3 Plan document.",
      lane: "main",
    });
    const { overrides, thoughts, entries, text } = debugDeps();

    const running = act(subtask, overrides);
    await until(() => fake.events.some((e) => e.event === "questionAsked"));
    await fake.peer.request("answerQuestion", { taskId: task.id, subtaskId: subtask.id, answer: "Done" });
    expect(ended(await running).result.status).toBe("done");

    expect(text()).not.toContain("guess-Pa55word");
    const reply1 = entries().find((e) => e.event === "model.reply" && e.purpose === "workerStep")!;
    expect(reply1.content).toContain(PASSWORD_REMOVED);
    expect(thoughts[0]).toMatchObject({ cursorId: "main", lane: "main", decision: 'Set the text of "Password" (element 1)' });
    for (const thought of thoughts) expect(JSON.stringify(thought)).not.toContain("guess-Pa55word");
  });

  it("writes nothing and sends no thoughts with Debug mode off", async () => {
    await connect(new FakeKeynote({ home }));
    const calls = scriptModel(keynoteWorker());
    const { subtask } = guiSubtask();
    const { overrides, thoughts, entries } = debugDeps(false);

    expect(ended(await act(subtask, overrides)).result.status).toBe("done");
    expect(thoughts).toEqual([]);
    expect(entries()).toEqual([]);
    expect(existsSync(join(dir.path, "s", "Debug log"))).toBe(false);
    expect(JSON.stringify(calls[0]!.body["response_format"])).not.toContain('"reason"');
  });
});
