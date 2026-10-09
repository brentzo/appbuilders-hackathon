import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { runWorkerStep } from "../src/worker/step.ts";
import { exampleWorkerInput, modelConfig, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer } from "./mock-model-server.ts";

const PRESS_EXPORT = JSON.stringify({ action: { kind: "click", element: 4 } });

let server: MockModelServer;
let logger: MemoryLogger;
let client: ModelClient;

beforeEach(async () => {
  server = await startMockModelServer();
  logger = new MemoryLogger();
  client = new ModelClient(modelConfig(server.baseUrl), logger);
});

afterEach(async () => {
  await server.close();
});

const userText = (request: Record<string, unknown>) => {
  const content = (request as unknown as ChatRequest).messages.find((m) => m.role === "user")!.content;
  return typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "")).join("");
};

describe("a worker step", () => {
  it("returns a valid output on the first try", async () => {
    server.reply({ kind: "content", content: PRESS_EXPORT });
    const result = await runWorkerStep(exampleWorkerInput(), { client, logger });

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.output).toEqual({ action: { kind: "click", element: 4 } });
    expect(result.attempts).toEqual([{ outcome: "ok", durationMs: expect.any(Number), usage: expect.any(Object) }]);
    expect(server.requests).toHaveLength(1);

    const request = server.requests[0] as unknown as ChatRequest;
    expect(request.model).toBe("mlx-community/Qwen3.5-9B-4bit");
    expect(request.enable_thinking).toBe(false);
    expect(request.response_format?.type).toBe("json_schema");
    expect(request.response_format?.json_schema.name).toBe("WorkerOutput");
    const text = userText(server.requests[0]!);
    expect(text).toContain("export my Keynote deck as a PDF");
    expect(text).toContain("In Keynote, export the open deck to PDF in Downloads.");
    expect(text).toContain('[4] menuItem "Export To"');
    expect(text).toContain("Available tools: open_app, open_file, reveal_in_finder.");
  });

  it("sends only what SPEC-02 r5 allows: goal, instruction, last steps, observation, and tools", async () => {
    server.reply({ kind: "content", content: PRESS_EXPORT });
    await runWorkerStep(exampleWorkerInput(), { client, logger });
    const request = server.requests[0] as unknown as ChatRequest;
    expect(request.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(userText(server.requests[0]!)).toContain("1. ");
    expect(userText(server.requests[0]!)).toContain("The File menu opened.");
  });

  it("narrows the schema sent to the model to the elements on screen and the lane's tools", async () => {
    server.reply({ kind: "content", content: PRESS_EXPORT });
    await runWorkerStep(exampleWorkerInput(), { client, logger });
    const schema = (server.requests[0] as unknown as ChatRequest).response_format!.json_schema.schema as {
      $defs: Record<string, { enum?: number[] }>;
    };
    expect(schema.$defs["ElementNumber"]).toEqual({ type: "integer", enum: [1, 2, 3, 4, 5] });
    expect(Object.keys(schema.$defs)).toContain("OpenAppCall");
    expect(Object.keys(schema.$defs)).not.toContain("MoveToTrashCall");
    expect(Object.keys(schema.$defs)).not.toContain("ClickAtAction");
    expect(Object.keys(schema.$defs)).toContain("ClickAction");
    expect(JSON.stringify(schema)).not.toContain("uniqueItems");
  });

  it.skipIf(process.platform === "win32")("sends the screenshot as an image when the observation has one", async () => {
    const dir = tempDir();
    try {
      const screenshot = join(dir.path, "screen.png");
      writeFileSync(screenshot, Buffer.from("89504e470d0a1a0a", "hex"));
      const input = exampleWorkerInput();
      input.observation.screenshotPath = screenshot;
      server.reply({ kind: "content", content: PRESS_EXPORT });
      await runWorkerStep(input, { client, logger });
      const content = (server.requests[0] as unknown as ChatRequest).messages[1]!.content;
      expect(Array.isArray(content) && content[0]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
      });
    } finally {
      dir.cleanup();
    }
  });

  describe("Scenario: Worker returns an invalid action", () => {
    // Given a worker is running a step
    // When the model output does not match the action schema
    // Then the step outcome is "invalidOutput"
    // And the step is retried once with the validation error in the prompt
    it("marks the output invalidOutput and retries once with the validation error in the prompt", async () => {
      server.reply(
        { kind: "content", content: JSON.stringify({ action: { kind: "finish", status: "done", note: "ok", element: 4 } }) },
        { kind: "content", content: PRESS_EXPORT },
      );
      const result = await runWorkerStep(exampleWorkerInput(), { client, logger });

      expect(result.attempts[0]!.outcome).toBe("invalidOutput");
      const validationError = result.attempts[0]!.validationError!;
      expect(validationError).toContain("does not match the action schema");
      expect(server.requests).toHaveLength(2);
      expect(userText(server.requests[0]!)).not.toContain("rejected");
      expect(userText(server.requests[1]!)).toContain(`Your last reply was rejected: ${validationError}`);
      expect(result.outcome).toBe("ok");
    });

    it("ends the step as invalidOutput when the retry is invalid too, without a third try", async () => {
      server.reply(
        { kind: "content", content: "Sure! I'll click Export." },
        { kind: "content", content: '{"action": {"kind": "press"}}' },
      );
      const result = await runWorkerStep(exampleWorkerInput(), { client, logger });

      expect(result.outcome).toBe("invalidOutput");
      expect(result.attempts.map((a) => a.outcome)).toEqual(["invalidOutput", "invalidOutput"]);
      expect(server.requests).toHaveLength(2);
      expect(userText(server.requests[1]!)).toContain("not valid JSON");
      expect(logger.entries.filter((e) => e.event === "step.invalidOutput")).toHaveLength(2);
    });
  });

  describe("rejects actions that do not fit the step", () => {
    const cases: [string, unknown, string][] = [
      ["an element that is not on screen", { action: { kind: "click", element: 9 } }, "Element 9 is not on the screen"],
      [
        "a tool outside the lane's subset",
        { action: { kind: "tool", call: { tool: "move_to_trash", paths: ["/Users/a/b.txt"] } } },
        "The tool move_to_trash is not available",
      ],
      ["a vision click without a screenshot", { action: { kind: "clickAt", x: 10, y: 10 } }, "no screenshot"],
      ["the v2 element press", { action: { kind: "axPress", element: 4 } }, "schema"],
      ["a click at coordinates instead of clickAt", { action: { kind: "click", x: 10, y: 10 } }, "schema"],
      ["two actions", [{ action: { kind: "click", element: 1 } }, { action: { kind: "click", element: 2 } }], "schema"],
      ["no action", { note: "nothing to do" }, "schema"],
      ["an empty reply", null, "empty"],
    ];
    it.each(cases)("%s", async (_name, reply, error) => {
      const content = reply === null ? null : JSON.stringify(reply);
      server.reply({ kind: "content", content }, { kind: "content", content });
      const result = await runWorkerStep(exampleWorkerInput(), { client, logger });
      expect(result.outcome).toBe("invalidOutput");
      if (result.outcome === "invalidOutput") expect(result.validationError).toContain(error);
    });

    it("a password field filled with setValue", async () => {
      const input = exampleWorkerInput();
      input.observation.elements.push({ n: 6, role: "secureTextField", label: "Password", enabled: true });
      const content = JSON.stringify({ action: { kind: "setValue", element: 6, text: "hunter2" } });
      server.reply({ kind: "content", content }, { kind: "content", content });
      const result = await runWorkerStep(input, { client, logger });
      expect(result.outcome).toBe("invalidOutput");
      if (result.outcome === "invalidOutput") expect(result.validationError).toContain("password field");
    });

    it("typing while a password field has focus (SPEC-05 r7)", async () => {
      const input = exampleWorkerInput();
      input.observation.elements.push({ n: 6, role: "secureTextField", label: "Password", enabled: true });
      input.observation.focused = 6;
      const content = JSON.stringify({ action: { kind: "type", text: "hunter2" } });
      server.reply({ kind: "content", content }, { kind: "content", content });
      const result = await runWorkerStep(input, { client, logger });
      expect(result.outcome).toBe("invalidOutput");
      if (result.outcome === "invalidOutput") expect(result.validationError).toContain("password field");
    });
  });

  it("lets the model type when an ordinary text field has focus", async () => {
    const input = exampleWorkerInput();
    input.observation.focused = 5;
    server.reply({ kind: "content", content: JSON.stringify({ action: { kind: "type", text: "Q3" } }) });
    const result = await runWorkerStep(input, { client, logger });
    expect(result.outcome).toBe("ok");
  });

  it("shows the model the app, the focused element, and the sheet in front (SPEC-05 r15)", async () => {
    const input = exampleWorkerInput();
    input.observation.focused = 5;
    input.observation.layer = { kind: "sheet", defaultButton: 3, cancelButton: 4 };
    server.reply({ kind: "content", content: PRESS_EXPORT });
    await runWorkerStep(input, { client, logger });
    const text = userText(server.requests[0]!);
    expect(text).toContain('App: "Keynote"');
    expect(text).toContain("In front: a sheet, default button [3], cancel button [4]");
    expect(text).toContain("Keyboard focus: [5]");
  });

  it("says nothing about a layer when the window itself is in front", async () => {
    const input = exampleWorkerInput();
    input.observation.layer = { kind: "window" };
    server.reply({ kind: "content", content: PRESS_EXPORT });
    await runWorkerStep(input, { client, logger });
    expect(userText(server.requests[0]!)).not.toContain("In front:");
  });

  it("refuses an input that breaks the WorkerInput contract", async () => {
    const input = { ...exampleWorkerInput(), allowedTools: ["bash"] } as never;
    await expect(runWorkerStep(input, { client, logger })).rejects.toThrow("Invalid WorkerInput");
    expect(server.requests).toHaveLength(0);
  });
});
