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

  it("takes a confirmation reply as a button or as speech", () => {
    const taskId = "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8";
    expect(validate("ReplyToConfirmationParams", { taskId, reply: { kind: "button", choice: "goAhead" } }).valid).toBe(true);
    expect(validate("ReplyToConfirmationParams", { taskId, reply: { kind: "spoken", text: "only October" } }).valid).toBe(true);
    expect(validate("ReplyToConfirmationParams", { taskId, reply: { kind: "button", choice: "maybe" } }).valid).toBe(false);
  });
});
