import { describe, expect, it } from "vitest";
import { validate } from "../src/index.ts";

describe("ModelAction", () => {
  it("accepts a click on a numbered element", () => {
    expect(validate("ModelAction", { kind: "click", element: 3 }).valid).toBe(true);
  });

  it("rejects the v2 name axPress (OBJ-29: the model says click)", () => {
    expect(validate("ModelAction", { kind: "axPress", element: 3 }).valid).toBe(false);
  });

  it("clicks at coordinates only with clickAt (p1 vision, SPEC-05 r12)", () => {
    expect(validate("ModelAction", { kind: "clickAt", x: 412, y: 96 }).valid).toBe(true);
    expect(validate("ModelAction", { kind: "click", x: 412, y: 96 }).valid).toBe(false);
    expect(validate("ModelAction", { kind: "clickAt", element: 3 }).valid).toBe(false);
  });

  it("rejects fields that belong to another variant", () => {
    expect(validate("ModelAction", { kind: "finish", status: "done", note: "ok", element: 3 }).valid).toBe(false);
  });

  it("rejects an element given as a path instead of a number", () => {
    expect(validate("ModelAction", { kind: "click", element: "AXWindow/AXMenuBar/AXMenuItem[Export]" }).valid).toBe(
      false,
    );
  });

  it("has no shell or AppleScript action (SPEC-05 'Raw shell is not available')", () => {
    expect(validate("ModelAction", { kind: "shell", command: "rm -rf ~/Downloads/old" }).valid).toBe(false);
    expect(validate("ModelAction", { kind: "tool", call: { tool: "shell", command: "ls" } }).valid).toBe(false);
    expect(validate("ModelAction", { kind: "tool", call: { tool: "applescript", script: "beep" } }).valid).toBe(false);
  });
});

describe("AXRole", () => {
  it("accepts all documented actionable roles", () => {
    const roles = [
      ...["button", "menuItem", "menuBarItem", "textField", "secureTextField", "textArea", "link", "checkbox", "radioButton", "popUpButton"],
      ...["comboBox", "menuButton", "disclosureTriangle", "row", "cell", "scrollArea", "table", "list", "outline"],
    ];
    for (const role of roles) {
      expect(validate("TreeElement", { n: 1, role, label: "Control", enabled: true }).valid, role).toBe(true);
    }
  });

  it("rejects raw macOS role and subrole names, which the Mac app maps first", () => {
    for (const role of ["AXButton", "AXRow", "searchField", "tab", "tabGroup", "sheet", "staticText"]) {
      expect(validate("TreeElement", { n: 1, role, label: "Control", enabled: true }).valid, role).toBe(false);
    }
  });
});

describe("KeyAction", () => {
  it("accepts punctuation and named keys", () => {
    for (const combo of ["cmd+,", "cmd+/", "cmd+shift+d", "return", "enter", "cmd+enter", "cmd+delete", "cmd+shift+delete", "escape", "f5"]) {
      expect(validate("ModelAction", { kind: "key", combo }).valid, combo).toBe(true);
    }
  });

  it("rejects unknown modifiers and text", () => {
    expect(validate("ModelAction", { kind: "key", combo: "hyper+a" }).valid).toBe(false);
    expect(validate("ModelAction", { kind: "key", combo: "hello world" }).valid).toBe(false);
  });

  it("accepts only the canonical form; the harness normalizes aliases first", () => {
    for (const combo of ["Cmd+S", "command+s", "esc", "backspace", "Enter", "cmd+Return"]) {
      expect(validate("ModelAction", { kind: "key", combo }).valid, combo).toBe(false);
    }
  });
});

describe("RecordedAction", () => {
  const element = (role: string) => ({ path: "AXWindow/AXTextField[To]", role, label: "To" });

  it("always carries the resolved element for element actions (SPEC-07 r6 reads its label)", () => {
    expect(validate("RecordedAction", { action: { kind: "click", element: 2 }, permission: "allowed" }).valid).toBe(false);
    expect(
      validate("RecordedAction", { action: { kind: "click", element: 2 }, element: element("button"), permission: "ask" }).valid,
    ).toBe(true);
  });

  it("never carries an element for actions that have none", () => {
    const finish = { kind: "finish", status: "done", note: "ok" };
    expect(validate("RecordedAction", { action: finish, element: element("button"), permission: "allowed" }).valid).toBe(false);
    expect(validate("RecordedAction", { action: { kind: "key", combo: "enter" }, element: element("button"), permission: "allowed" }).valid).toBe(false);
  });

  it("records the focused element for a type action when there is one", () => {
    const type = { kind: "type", text: "Q3 report" };
    expect(validate("RecordedAction", { action: type, permission: "allowed" }).valid).toBe(true);
    expect(validate("RecordedAction", { action: type, element: element("textField"), permission: "allowed" }).valid).toBe(true);
  });

  it("never types into a focused secure text field (SPEC-05 r7)", () => {
    const type = { kind: "type", text: "hunter2" };
    expect(validate("RecordedAction", { action: type, element: element("secureTextField"), permission: "allowed" }).valid).toBe(false);
  });

  it("never sets a value in a secure text field (SPEC-05 r7)", () => {
    const fill = { kind: "setValue", element: 2, text: "hunter2" };
    expect(validate("RecordedAction", { action: fill, element: element("secureTextField"), permission: "allowed" }).valid).toBe(false);
    expect(validate("RecordedAction", { action: fill, element: element("textField"), permission: "allowed" }).valid).toBe(true);
  });
});

describe("open_app", () => {
  const open = (args: object) => validate("ToolCall", { tool: "open_app", ...args }).valid;

  it("takes a bundle id or a name", () => {
    expect(open({ bundleId: "com.apple.Notes" })).toBe(true);
    expect(open({ name: "Notes" })).toBe(true);
  });

  it("takes exactly one of them", () => {
    expect(open({})).toBe(false);
    expect(open({ bundleId: "com.apple.Notes", name: "Notes" })).toBe(false);
    expect(open({ name: "" })).toBe(false);
  });
});

describe("open_file", () => {
  it("opens in the default app, or in the app given by bundleId", () => {
    expect(validate("ToolCall", { tool: "open_file", path: "~/Downloads/Q3 Report.pdf" }).valid).toBe(true);
    expect(validate("ToolCall", { tool: "open_file", path: "~/Downloads/Q3 Report.pdf", bundleId: "com.apple.mail" }).valid).toBe(true);
    expect(validate("ToolCall", { tool: "open_file", path: "~/Downloads/Q3 Report.pdf", bundleId: "" }).valid).toBe(false);
    expect(validate("ToolCall", { tool: "open_file", path: "~/Downloads/Q3 Report.pdf", app: "Mail" }).valid).toBe(false);
  });
});

describe("move_to_trash", () => {
  const trash = (paths: unknown[]) => ({ kind: "tool", call: { tool: "move_to_trash", paths } });

  it("accepts exact paths", () => {
    expect(validate("ModelAction", trash(["~/Downloads/old-invoice.pdf", "/Users/ana/Downloads/a.pdf"])).valid).toBe(
      true,
    );
  });

  it("rejects wildcards (SPEC-07 'Wildcards are rejected')", () => {
    expect(validate("ModelAction", trash(["~/Downloads/*.pdf"])).valid).toBe(false);
  });

  it("accepts real file names with brackets and braces", () => {
    expect(validate("ModelAction", trash(["~/Downloads/Invoice [2024].pdf", "~/Notes/{draft}.txt"])).valid).toBe(true);
  });

  it("rejects relative paths and an empty list", () => {
    expect(validate("ModelAction", trash(["Downloads/a.pdf"])).valid).toBe(false);
    expect(validate("ModelAction", trash([])).valid).toBe(false);
  });
});

describe("WorkerOutput", () => {
  const press = { kind: "click", element: 1 };

  it("holds exactly one action", () => {
    expect(validate("WorkerOutput", { action: press }).valid).toBe(true);
  });

  it("rejects zero actions or two (SPEC-02 'Worker returns an invalid action')", () => {
    expect(validate("WorkerOutput", {}).valid).toBe(false);
    expect(validate("WorkerOutput", { action: [press, press] }).valid).toBe(false);
    expect(validate("WorkerOutput", { action: press, action2: press }).valid).toBe(false);
  });
});

describe("StepSummary", () => {
  const read = { action: { kind: "tool", call: { tool: "read_file", path: "~/a.txt" } }, observation: "Read a.txt", outcome: "ok" };

  it("may carry what the tool returned, up to 4000 characters", () => {
    expect(validate("StepSummary", { ...read, toolOutput: "x".repeat(4000) }).valid).toBe(true);
    expect(validate("StepSummary", { ...read, toolOutput: "x".repeat(4001) }).valid).toBe(false);
    expect(validate("StepSummary", read).valid).toBe(true);
  });

  it("still keeps the observation to one short line", () => {
    expect(validate("StepSummary", { ...read, observation: "x".repeat(301) }).valid).toBe(false);
  });
});

describe("TargetApp", () => {
  it("names the app by exactly one of bundleId or name", () => {
    expect(validate("TargetApp", { name: "Keynote" }).valid).toBe(true);
    expect(validate("TargetApp", { bundleId: "com.apple.Keynote" }).valid).toBe(true);
    expect(validate("TargetApp", { name: "Keynote", bundleId: "com.apple.Keynote" }).valid).toBe(false);
    expect(validate("TargetApp", {}).valid).toBe(false);
    expect(validate("TargetApp", { name: "" }).valid).toBe(false);
  });

  it("is optional on a planned subtask and on a subtask", () => {
    const planned = { id: "a", title: "A", instruction: "Do a.", dependsOn: [], proposedLane: "ghost" };
    expect(validate("Plan", { subtasks: [{ ...planned, targetApp: { name: "Google Chrome" } }] }).valid).toBe(true);
    expect(validate("Plan", { subtasks: [{ ...planned, targetApp: "Google Chrome" }] }).valid).toBe(false);
  });
});

describe("Plan", () => {
  const subtask = (id: string, dependsOn: string[] = []) => ({
    id,
    title: `Subtask ${id}`,
    instruction: "Read ~/Downloads/a.pdf and write a summary.",
    dependsOn,
    proposedLane: "helper",
  });

  it("holds subtasks with short ids, dependencies, and a proposed lane", () => {
    expect(validate("Plan", { subtasks: [subtask("read-1"), subtask("note", ["read-1"])] }).valid).toBe(true);
  });

  it("marks a subtask that needs the keyboard, and only with a boolean (SPEC-03 r17)", () => {
    expect(validate("Plan", { subtasks: [{ ...subtask("paste"), proposedLane: "main", needsKeyboard: true }] }).valid).toBe(true);
    expect(validate("Plan", { subtasks: [{ ...subtask("paste"), needsKeyboard: "yes" }] }).valid).toBe(false);
  });

  it("rejects an empty plan", () => {
    expect(validate("Plan", { subtasks: [] }).valid).toBe(false);
  });

  it("rejects ids that are not short lower-case words, and a repeated dependency", () => {
    expect(validate("Plan", { subtasks: [subtask("Read 1")] }).valid).toBe(false);
    expect(validate("Plan", { subtasks: [subtask("a".repeat(33))] }).valid).toBe(false);
    expect(validate("Plan", { subtasks: [subtask("note", ["read-1", "read-1"])] }).valid).toBe(false);
  });

  it("rejects a missing field, an unknown lane, a long title, and fields the planner does not set", () => {
    const { proposedLane: _lane, ...noLane } = subtask("read-1");
    expect(validate("Plan", { subtasks: [noLane] }).valid).toBe(false);
    expect(validate("Plan", { subtasks: [{ ...subtask("read-1"), proposedLane: "cloud" }] }).valid).toBe(false);
    expect(validate("Plan", { subtasks: [{ ...subtask("read-1"), title: "x".repeat(61) }] }).valid).toBe(false);
    expect(validate("Plan", { subtasks: [{ ...subtask("read-1"), status: "ready" }] }).valid).toBe(false);
  });
});

describe("Task", () => {
  const task = (status: string, confirmedGoal?: string) => ({
    id: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8",
    originDeviceId: "mac-brent",
    goal: "rename the invoices in Downloads by date",
    status,
    plan: [],
    createdAt: "2026-10-09T15:40:00+08:00",
    updatedAt: "2026-10-09T15:40:00+08:00",
    ...(confirmedGoal ? { confirmedGoal } : {}),
  });

  it("has no confirmed goal while waiting for confirmation, or after a cancel before work", () => {
    expect(validate("Task", task("awaitingConfirmation")).valid).toBe(true);
    expect(validate("Task", task("cancelled")).valid).toBe(true);
  });

  it("keeps the confirmed goal separate from the transcript once work starts (SPEC-01 r7)", () => {
    expect(validate("Task", task("planning")).valid).toBe(false);
    expect(validate("Task", task("planning", "rename the October invoices in Downloads by date")).valid).toBe(true);
  });

  it("lets a step be written before its action runs, with no observation or outcome yet (SPEC-02 r3)", () => {
    const step = {
      id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
      subtaskId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      index: 0,
      lane: "main",
      action: { action: { kind: "ask", question: "Which deck?" }, permission: "allowed" },
      startedAt: "2026-10-09T15:41:05+08:00",
    };
    expect(validate("Step", step).errors).toEqual([]);
  });

  it("always records the origin device (SPEC-09)", () => {
    const { originDeviceId: _origin, ...withoutOrigin } = task("awaitingConfirmation");
    expect(validate("Task", withoutOrigin).valid).toBe(false);
  });
});

describe("TaskDetail", () => {
  const detail = {
    task: {
      id: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8",
      originDeviceId: "mac-brent",
      goal: "file the March invoices",
      confirmedGoal: "file the March invoices",
      status: "done",
      plan: [],
      createdAt: "2026-04-09T10:00:00+08:00",
      updatedAt: "2026-04-09T10:05:00+08:00",
    },
    subtasks: [],
    steps: [],
  };
  const line = {
    time: "2026-04-09T10:02:00+08:00",
    deviceId: "mac-brent",
    taskId: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8",
    lane: "main",
    description: "Moved 4 invoices to Accounting",
    outcome: "ok",
  };

  it("carries the task's action log (SPEC-02 'Finished tasks are kept')", () => {
    expect(validate("TaskDetail", { ...detail, actionLog: [line] }).errors).toEqual([]);
  });

  it("still accepts a detail without the action log, so the change is not breaking", () => {
    expect(validate("TaskDetail", detail).errors).toEqual([]);
  });

  it("rejects an action log line that breaks ActionLogEntry", () => {
    const { description: _description, ...noDescription } = line;
    expect(validate("TaskDetail", { ...detail, actionLog: [noDescription] }).valid).toBe(false);
  });
});

describe("Approval", () => {
  const deleteApproval = (decision?: unknown) => ({
    id: "3f1c2a9e-8b7d-4c6e-9a1f-2d3e4f5a6b7c",
    stepId: "8a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2d",
    kind: "delete",
    files: {
      folder: "~/Downloads",
      count: 2,
      firstNames: ["old-invoice.pdf", "old-receipt.pdf"],
      allPaths: ["~/Downloads/old-invoice.pdf", "~/Downloads/old-receipt.pdf"],
    },
    text: "I'm about to move 2 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?",
    requestedAt: "2026-10-09T15:42:00+08:00",
    expiresAt: "2026-10-09T15:47:00+08:00",
    ...(decision ? { decision } : {}),
  });

  it("accepts a delete approved by a tap", () => {
    const tapped = { approved: true, method: "tap", decidedAt: "2026-10-09T15:43:00+08:00" };
    expect(validate("Approval", deleteApproval(tapped)).valid).toBe(true);
  });

  it("rejects a delete approved by voice (SPEC-07 'Saying yes is not enough to delete')", () => {
    const spoken = { approved: true, method: "voice", decidedAt: "2026-10-09T15:43:00+08:00" };
    expect(validate("Approval", deleteApproval(spoken)).valid).toBe(false);
  });

  it("accepts a delete declined by voice", () => {
    const declined = { approved: false, method: "voice", decidedAt: "2026-10-09T15:43:00+08:00" };
    expect(validate("Approval", deleteApproval(declined)).valid).toBe(true);
  });

  it("requires the file list for a delete and the recipients for a send", () => {
    const { files: _files, ...withoutFiles } = deleteApproval();
    expect(validate("Approval", withoutFiles).valid).toBe(false);
    expect(validate("Approval", { ...withoutFiles, kind: "send" }).valid).toBe(false);
    expect(validate("Approval", { ...withoutFiles, kind: "send", recipients: ["ana@example.com"] }).valid).toBe(true);
  });
});

describe("Observation", () => {
  const element = (n: number) => ({ n, role: "button", label: `Button ${n}`, enabled: true });
  const observation = (count: number) => ({
    windowTitle: "Q3 Report.key",
    elements: Array.from({ length: count }, (_, i) => element(i + 1)),
  });

  it("allows up to 200 elements", () => {
    expect(validate("Observation", observation(200)).valid).toBe(true);
  });

  it("rejects 201 elements (SPEC-05 r2)", () => {
    expect(validate("Observation", observation(201)).valid).toBe(false);
  });

  it("never carries a secure text field's value (SPEC-05 r7)", () => {
    const withSecret = {
      windowTitle: "Sign in",
      elements: [{ n: 1, role: "secureTextField", label: "Password", value: "hunter2", enabled: true }],
    };
    expect(validate("Observation", withSecret).valid).toBe(false);
  });

  it("names the app, the focused element, and the front layer", () => {
    const sheet = {
      ...observation(6),
      app: "Keynote",
      focused: 6,
      layer: { kind: "sheet", defaultButton: 6, cancelButton: 5 },
    };
    expect(validate("Observation", sheet).errors).toEqual([]);
    expect(validate("Observation", { ...sheet, layer: { kind: "dialog", title: "Export Your Presentation" } }).valid).toBe(true);
  });

  it("rejects an unknown layer, a focus that is not an element number, and an empty app name", () => {
    expect(validate("Observation", { ...observation(1), layer: { kind: "popover" } }).valid).toBe(false);
    // macOS has no alert role, so the Mac app reports an alert as the sheet or dialog it is shown in.
    expect(validate("Observation", { ...observation(1), layer: { kind: "alert" } }).valid).toBe(false);
    expect(validate("Observation", { ...observation(1), layer: { kind: "sheet", title: "" } }).valid).toBe(false);
    expect(validate("Observation", { ...observation(1), layer: { kind: "sheet", defaultButton: 0 } }).valid).toBe(false);
    expect(validate("Observation", { ...observation(1), focused: 0 }).valid).toBe(false);
    expect(validate("Observation", { ...observation(1), focused: "AXTextField[Search]" }).valid).toBe(false);
    expect(validate("Observation", { ...observation(1), app: "" }).valid).toBe(false);
  });
});

describe("Path", () => {
  const open = (path: string) => validate("ToolCall", { tool: "open_file", path }).valid;

  it("accepts a document package, which is a folder (OBJ-29)", () => {
    expect(open("~/Documents/Q3 Report.key")).toBe(true);
    expect(open("~/Documents/Q3 Report.key/")).toBe(true);
  });
});

describe("Subtask and routing (SPEC-03 r17)", () => {
  const subtask = {
    id: "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e",
    taskId: "8e9f0a1b-2c3d-4e5f-9a6b-7c8d9e0f1a2b",
    title: "Put the chart in Keynote",
    instruction: "In Keynote, paste the expense chart on slide 3.",
    dependsOn: [],
    proposedLane: "main",
    target: { bundleId: "com.apple.Keynote" },
    status: "ready",
    attempts: 0,
  };

  it("lets the planner mark a subtask as needing the keyboard, and leaving it out stays valid", () => {
    expect(validate("Subtask", subtask).errors).toEqual([]);
    expect(validate("Subtask", { ...subtask, needsKeyboard: true }).errors).toEqual([]);
    expect(validate("Subtask", { ...subtask, needsKeyboard: "yes" }).valid).toBe(false);
  });

  it("records needsKeyboard as a route reason on the subtask and in routeDecided", () => {
    expect(validate("Subtask", { ...subtask, needsKeyboard: true, lane: "main", routeReason: "needsKeyboard" }).errors).toEqual([]);
    const decided = { taskId: subtask.taskId, subtaskId: subtask.id, lane: "main", reason: "needsKeyboard" };
    expect(validate("RouteDecided", decided).errors).toEqual([]);
  });
});
