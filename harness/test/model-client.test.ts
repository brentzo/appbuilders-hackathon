import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@yumi/protocol";
import { userErrorForModelFailure } from "../src/errors.ts";
import { MemoryLogger } from "../src/log.ts";
import { imagePart, ModelClient } from "../src/model/client.ts";
import { runWorkerStep, type WorkerStepResult } from "../src/worker/step.ts";
import { exampleWorkerInput, modelConfig } from "./helpers.ts";
import { startMockModelServer, type MockModelServer } from "./mock-model-server.ts";

let server: MockModelServer;
let logger: MemoryLogger;

beforeEach(async () => {
  server = await startMockModelServer();
  logger = new MemoryLogger();
});

afterEach(async () => {
  await server.close();
});

/** A port nothing listens on, so connecting fails the way it does when the model server is not running. */
async function closedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1`;
}

describe("the model client", () => {
  it("reads content, finish reason, and token counts, and logs them", async () => {
    server.reply({ kind: "content", content: "hello", promptTokens: 100, completionTokens: 7 });
    const client = new ModelClient(modelConfig(server.baseUrl), logger);
    const result = await client.chat({ messages: [{ role: "user", content: "hi" }], purpose: "test" });
    expect(result).toMatchObject({ ok: true, content: "hello", finishReason: "stop", toolCalls: [] });
    if (result.ok) expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 7, totalTokens: 107 });
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ event: "model.reply", promptTokens: 100, completionTokens: 7, durationMs: expect.any(Number) }),
    );
  });

  it("omits response_format when structured output is turned off", async () => {
    server.reply({ kind: "content", content: "{}" });
    const client = new ModelClient(modelConfig(server.baseUrl, { structuredOutput: false }), logger);
    await client.chat({
      messages: [{ role: "user", content: "hi" }],
      responseFormat: { name: "X", schema: {} },
      purpose: "test",
    });
    expect(server.requests[0]).not.toHaveProperty("response_format");
  });

  const failures: [string, () => Promise<ModelClient>, string][] = [
    ["a server that is not running", async () => new ModelClient(modelConfig(await closedPortUrl()), logger), "unreachable"],
    [
      "a dropped connection",
      async () => (server.reply({ kind: "dropConnection" }), new ModelClient(modelConfig(server.baseUrl), logger)),
      "unreachable",
    ],
    [
      "an HTTPException",
      async () => (
        server.reply({ kind: "httpError", status: 500, detail: "Generation failed: [metal::malloc] Resource limit exceeded" }),
        new ModelClient(modelConfig(server.baseUrl), logger)
      ),
      "httpError",
    ],
    [
      "a request validation error",
      async () => (server.reply({ kind: "validationError" }), new ModelClient(modelConfig(server.baseUrl), logger)),
      "httpError",
    ],
    [
      "an unhandled exception with a plain-text body",
      async () => (server.reply({ kind: "unhandledException" }), new ModelClient(modelConfig(server.baseUrl), logger)),
      "httpError",
    ],
    [
      "a request that takes too long",
      async () => (server.reply({ kind: "hang" }), new ModelClient(modelConfig(server.baseUrl, { timeoutMs: 150 }), logger)),
      "timeout",
    ],
  ];

  it.each(failures)("returns a structured failure for %s and logs the detail", async (_name, make, kind) => {
    const client = await make();
    const result = await client.chat({ messages: [{ role: "user", content: "hi" }], purpose: "test" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe(kind);
    expect(logger.entries).toContainEqual(expect.objectContaining({ level: "error", event: "model.failure", failure: kind }));
  });

  it("logs the server's error detail and status", async () => {
    server.reply({ kind: "httpError", status: 400, detail: "Failed to load model: out of memory" });
    const client = new ModelClient(modelConfig(server.baseUrl), logger);
    await client.chat({ messages: [{ role: "user", content: "hi" }], purpose: "test" });
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ event: "model.failure", status: 400, detail: "Failed to load model: out of memory" }),
    );
  });

  it("reports a cancel as aborted, not as an error", async () => {
    server.reply({ kind: "hang" });
    const client = new ModelClient(modelConfig(server.baseUrl), logger);
    const controller = new AbortController();
    const pending = client.chat({ messages: [{ role: "user", content: "hi" }], signal: controller.signal, purpose: "test" });
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(!result.ok && result.failure.kind).toBe("aborted");
    expect(userErrorForModelFailure({ kind: "aborted" })).toBeUndefined();
  });

  it("builds image parts as data URLs", async () => {
    expect(await imagePart({ data: "AAAA", mimeType: "image/jpeg" })).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,AAAA" },
    });
    await expect(imagePart({ path: "/tmp/screen.gif" })).rejects.toThrow("Unsupported image type");
  });
});

describe("no user-facing string contains raw model or server errors", () => {
  const RAW = [
    "Generation failed",
    "metal::malloc",
    "Resource limit exceeded",
    "Internal Server Error",
    "Field required",
    "ECONNREFUSED",
    "fetch failed",
    "500",
    "422",
    "TimeoutError",
  ];

  const scenarios: [string, () => Promise<ModelClient>, string][] = [
    ["model server not running", async () => new ModelClient(modelConfig(await closedPortUrl()), logger), "modelFailedToLoad"],
    [
      "generation failure (HTTP 500)",
      async () => (
        server.reply({ kind: "httpError", status: 500, detail: "Generation failed: [metal::malloc] Resource limit exceeded" }),
        new ModelClient(modelConfig(server.baseUrl), logger)
      ),
      "unexpected",
    ],
    [
      "unhandled server exception",
      async () => (server.reply({ kind: "unhandledException" }), new ModelClient(modelConfig(server.baseUrl), logger)),
      "unexpected",
    ],
    [
      "request validation error (HTTP 422)",
      async () => (server.reply({ kind: "validationError" }), new ModelClient(modelConfig(server.baseUrl), logger)),
      "unexpected",
    ],
    [
      "timeout",
      async () => (server.reply({ kind: "hang" }), new ModelClient(modelConfig(server.baseUrl, { timeoutMs: 150 }), logger)),
      "unexpected",
    ],
  ];

  it.each(scenarios)("%s gives a contract UserError with no raw detail", async (_name, make, kind) => {
    const client = await make();
    const result: WorkerStepResult = await runWorkerStep(
      exampleWorkerInput(),
      { client, logger },
      { lane: "main", taskId: "0d7f4c1e-2a7b-4d3c-9a51-6b1f0e8c2d34", lastAction: "Pressed File in Keynote" },
    );
    expect(result.outcome).toBe("error");
    if (result.outcome !== "error") return;
    expect(result.userError.kind).toBe(kind);
    expect(validate("UserError", result.userError)).toEqual({ valid: true, errors: [] });
    const userFacing = JSON.stringify(result.userError);
    for (const raw of RAW) expect(userFacing).not.toContain(raw);
    // The detail is in the log instead.
    expect(logger.entries.some((e) => e.event === "model.failure")).toBe(true);
  });

  it("fills only the contract's fields: the task and the last action for Unexpected", () => {
    expect(userErrorForModelFailure({ kind: "httpError", status: 500 }, { taskId: "t", lastAction: "Pressed File" })).toEqual({
      kind: "unexpected",
      taskId: "t",
      lastAction: "Pressed File",
    });
    expect(userErrorForModelFailure({ kind: "unreachable" }, { lastAction: "Pressed File" })).toEqual({
      kind: "modelFailedToLoad",
    });
  });
});
