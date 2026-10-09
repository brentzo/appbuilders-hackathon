import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSchemaFiles, typeNames, validate } from "../src/index.ts";

interface RpcAnnotation {
  methods: Record<string, { direction: "harnessToApp" | "appToHarness"; params: string; result: string }>;
  events: Record<string, string>;
}

function rpc(): RpcAnnotation {
  const file = loadSchemaFiles().find((f) => f.file === "rpc.json");
  return file?.schema["x-rpc"] as RpcAnnotation;
}

/** Method and event names other objectives already rely on, read from the objective files themselves. */
function namesFromObjectives(): string[] {
  const read = (file: string) => readFileSync(new URL(`../../objectives/${file}`, import.meta.url), "utf8");
  const objective = read("OBJ-01-task-record-schemas.md");
  const task = (id: string) => objective.split(`**OBJ-01.${id}**`)[1]!.split(/\n- \[[ x]\] \*\*OBJ-01\./)[0]!;
  const fromObj01 = [...(task("11") + task("16")).matchAll(/`([a-z][A-Za-z]+)`/g)].map((m) => m[1]!);
  return [...new Set([...fromObj01, "ping", "submitGoal", "resumeTask", "cancelTask", "listTasks", "searchTasks", "getTask"])];
}

describe("local RPC", () => {
  it("defines every method and event the objectives name", () => {
    const { methods, events } = rpc();
    const defined = new Set([...Object.keys(methods), ...Object.keys(events)]);
    const missing = namesFromObjectives().filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it("validates a goal revision and records only confirmed revisions on a task", () => {
    const taskId = "00000000-0000-4000-8000-000000000001";
    expect(validate("ReviseGoalParams", { taskId, transcript: "put it in Keynote" }).errors).toEqual([]);
    expect(validate("ReviseGoalParams", { taskId, transcript: "put it in Keynote", autoMode: true }).errors).toEqual([]);
    expect(validate("ReviseGoalParams", { taskId, autoMode: true }).valid).toBe(false);
    expect(validate("GoalRevision", { userSaid: "not Notes, Keynote", goal: "put the summary in Keynote", confirmedAt: "2026-10-10T00:00:00.000Z" }).errors).toEqual([]);
    expect(validate("GoalRevision", { goal: "put it in Keynote", confirmedAt: "2026-10-10T00:00:00.000Z" }).valid).toBe(false);
    expect(validate("SubtaskStatus", "cancelled").valid).toBe(true);
    expect(rpc().methods["reviseGoal"]).toEqual({ direction: "appToHarness", params: "ReviseGoalParams", result: "Empty" });
    expect(validate("GoalRestated", { taskId, text: "Put it in Keynote", autoMode: true }).valid).toBe(true);
  });

  it("refers only to types that exist", () => {
    const { methods, events } = rpc();
    const referenced = [...Object.values(methods).flatMap((m) => [m.params, m.result]), ...Object.values(events)];
    expect(referenced.filter((name) => !typeNames.includes(name))).toEqual([]);
  });

  it("pauses every lane, or only the UI lanes when the user takes over (SPEC-06 r1, r2)", () => {
    const taskId = "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8";
    expect(validate("PauseParams", {}).errors).toEqual([]);
    expect(validate("PauseParams", { taskId, scope: "everyLane" }).errors).toEqual([]);
    expect(validate("PauseParams", { scope: "uiLanes" }).errors).toEqual([]);
    expect(validate("PauseParams", { scope: "helpers" }).valid).toBe(false);
  });

  it("tells the app whether the model is loading, ready, or failed, on connect and on every change (OBJ-45)", () => {
    expect(rpc().events["modelStateChanged"]).toBe("ModelStateChanged");
    for (const state of ["loading", "ready", "failed"]) {
      expect(validate("ModelStateChanged", { state }).errors).toEqual([]);
      expect(validate("HelloResult", { protocolVersion: 4, modelState: state }).errors).toEqual([]);
    }
    expect(validate("HelloResult", { protocolVersion: 4 }).errors).toEqual([]);
    expect(validate("ModelStateChanged", { state: "warming" }).valid).toBe(false);
    expect(validate("ModelStateChanged", {}).valid).toBe(false);
  });

  it("moves a cursor to an element or a point, and nothing else", () => {
    const move = (to: unknown) => ({ command: "move", cursorId: "main", to });
    expect(validate("CursorCommand", move({ kind: "point", x: 512, y: 300 })).valid).toBe(true);
    expect(
      validate("CursorCommand", move({ kind: "element", target: { bundleId: "com.apple.mail" }, elementPath: "AXButton[Send]" }))
        .valid,
    ).toBe(true);
    expect(validate("CursorCommand", move({ kind: "point", x: 1, y: 2, elementPath: "x" })).valid).toBe(false);
  });

  it("always names the cursor that animates to the element before acting (SPEC-05 r3)", () => {
    const params = JSON.parse(
      readFileSync(new URL("../examples/ExecuteActionParams.press-export.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    const { cursorId: _cursor, ...withoutCursor } = params;
    expect(validate("ExecuteActionParams", params).valid).toBe(true);
    expect(validate("ExecuteActionParams", withoutCursor).valid).toBe(false);
  });

  it("round-trips a model's question to the user and the answer", () => {
    const { methods, events } = rpc();
    expect(events["questionAsked"]).toBe("QuestionAsked");
    expect(methods["answerQuestion"]).toEqual({ direction: "appToHarness", params: "AnswerQuestionParams", result: "Empty" });
  });

  it("turns Debug mode on and off, and sends a worker's thoughts (SPEC-07 r22, r23)", () => {
    const { methods, events } = rpc();
    expect(methods["setDebugMode"]).toEqual({ direction: "appToHarness", params: "SetDebugModeParams", result: "Empty" });
    expect(events["workerThought"]).toBe("WorkerThought");
    expect(validate("SetDebugModeParams", { enabled: false }).valid).toBe(true);
    expect(validate("SetDebugModeParams", {}).valid).toBe(false);
    const thought = {
      taskId: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8",
      subtaskId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      title: "Find the invoices",
      lane: "helper",
      sees: "Files",
      at: "2026-10-10T15:42:07+08:00",
    };
    expect(validate("WorkerThought", thought).errors).toEqual([]);
    expect(validate("WorkerThought", { ...thought, reason: "x".repeat(201) }).valid).toBe(false);
    expect(validate("WorkerThought", { ...thought, typed: "hunter2" }).valid).toBe(false);
  });

  it("takes a model's reason with its action, or no reason at all", () => {
    const action = { kind: "click", element: 4 };
    expect(validate("WorkerOutput", { action }).valid).toBe(true);
    expect(validate("WorkerOutput", { reason: "Export is in the File menu.", action }).valid).toBe(true);
    expect(validate("WorkerOutput", { reason: "", action }).valid).toBe(false);
  });

  it("takes a confirmation reply as a button or as speech", () => {
    const taskId = "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8";
    expect(validate("ReplyToConfirmationParams", { taskId, reply: { kind: "button", choice: "goAhead" } }).valid).toBe(true);
    expect(validate("ReplyToConfirmationParams", { taskId, reply: { kind: "spoken", text: "only October" } }).valid).toBe(true);
    expect(validate("ReplyToConfirmationParams", { taskId, reply: { kind: "button", choice: "maybe" } }).valid).toBe(false);
  });
});
