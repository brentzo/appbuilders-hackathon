import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { DEFAULT_SUPPORT_DIR, loadConfig } from "../src/config.ts";
import { FileLogger } from "../src/log.ts";
import { bundleType } from "../src/schema/bundle.ts";
import { workerOutputSchemaFor } from "../src/worker/schema.ts";
import { checkWorkerOutput } from "../src/worker/validate.ts";
import { exampleWorkerInput, PROTOCOL_DIR, tempDir } from "./helpers.ts";

function compile(schema: object) {
  const ajv = new Ajv2020.default({ strict: false, allErrors: true });
  addFormats.default(ajv);
  return ajv.compile(schema);
}

const example = (name: string) => JSON.parse(readFileSync(join(PROTOCOL_DIR, "examples", `${name}.json`), "utf8"));

describe("the schema bundle", () => {
  it("makes a protocol type self-contained", () => {
    const schema = bundleType("WorkerOutput");
    const refs = JSON.stringify(schema).match(/"\$ref":"[^"]+"/g) ?? [];
    expect(refs.every((ref) => ref.startsWith('"$ref":"#/$defs/'))).toBe(true);
    const check = compile(schema);
    expect(check(example("WorkerOutput.press-export"))).toBe(true);
    expect(check({ action: { kind: "click", element: 4, text: "x" } })).toBe(false);
  });

  it("drops uniqueItems for the model, which llguidance 1.9.1 rejects", () => {
    expect(JSON.stringify(bundleType("WorkerOutput"))).toContain("uniqueItems");
    expect(JSON.stringify(bundleType("WorkerOutput", { forModel: true }))).not.toContain("uniqueItems");
  });

  it("drops the conditionals for the model, which llguidance 1.9.1 also rejects, and validation still applies them", () => {
    const full = JSON.stringify(bundleType("WorkerOutput"));
    expect(full).toContain('"if"');
    const forModel = JSON.stringify(bundleType("WorkerOutput", { forModel: true }));
    for (const keyword of ["if", "then", "else"]) expect(forModel).not.toContain(`"${keyword}":`);
    // OpenAppCall takes a bundle id or a name, not both: the grammar no longer says so, the validation does.
    const both = { action: { kind: "tool", call: { tool: "open_app", bundleId: "com.apple.Notes", name: "Notes" } } };
    expect(compile(workerOutputSchemaFor(exampleWorkerInput(), "main"))(both)).toBe(true);
    expect(checkWorkerOutput(JSON.stringify(both), exampleWorkerInput(), "main").ok).toBe(false);
  });

  it("narrows the model schema to the step but still accepts the step's valid actions", () => {
    const input = exampleWorkerInput();
    const check = compile(workerOutputSchemaFor(input, "main"));
    expect(check({ action: { kind: "click", element: 4 } })).toBe(true);
    expect(check({ action: { kind: "tool", call: { tool: "open_app", bundleId: "com.apple.Notes" } } })).toBe(true);
    expect(check({ action: { kind: "click", element: 6 } })).toBe(false);
    expect(check({ action: { kind: "tool", call: { tool: "move_to_trash", paths: ["/a"] } } })).toBe(false);
    expect(check({ action: { kind: "clickAt", x: 1, y: 1 } })).toBe(false);
    expect(check({ action: { kind: "click", x: 1, y: 1 } })).toBe(false);
  });

  it("leaves out element and tool actions when the step has none", () => {
    const input = { ...exampleWorkerInput(), allowedTools: [], observation: { windowTitle: "Empty", elements: [] } };
    const check = compile(workerOutputSchemaFor(input, "main"));
    expect(check({ action: { kind: "ask", question: "Which deck?" } })).toBe(true);
    expect(check({ action: { kind: "click", element: 1 } })).toBe(false);
    expect(check({ action: { kind: "tool", call: { tool: "open_app", bundleId: "x" } } })).toBe(false);
  });
});

describe("the config", () => {
  it("defaults to the Application Support folder and the local Qwen3.5-9B server", () => {
    const config = loadConfig({});
    expect(config.supportDir).toBe(DEFAULT_SUPPORT_DIR);
    expect(config.socketPath).toBe(join(DEFAULT_SUPPORT_DIR, "harness.sock"));
    expect(config.logPath).toBe(join(DEFAULT_SUPPORT_DIR, "harness.log"));
    expect(config.model).toMatchObject({ baseUrl: "http://127.0.0.1:8080/v1", model: "mlx-community/Qwen3.5-9B-4bit" });
  });

  it("reads the base URL, model name, and folder from the environment", () => {
    const config = loadConfig({
      YUMI_SUPPORT_DIR: "/tmp/yumi-test",
      YUMI_MODEL_BASE_URL: "http://localhost:9000/v1/",
      YUMI_MODEL: "mlx-community/Qwen3.5-4B-4bit",
      YUMI_MODEL_TIMEOUT_MS: "5000",
      YUMI_MODEL_STRUCTURED_OUTPUT: "0",
    });
    expect(config.socketPath).toBe(join(resolve("/tmp/yumi-test"), "harness.sock"));
    expect(config.model).toMatchObject({
      baseUrl: "http://localhost:9000/v1",
      model: "mlx-community/Qwen3.5-4B-4bit",
      timeoutMs: 5000,
      structuredOutput: false,
    });
    expect(() => loadConfig({ YUMI_MODEL_TIMEOUT_MS: "soon" })).toThrow("YUMI_MODEL_TIMEOUT_MS");
  });
});

describe("the log file", () => {
  it("appends one JSON object per line, creating the folder", () => {
    const dir = tempDir();
    try {
      const path = join(dir.path, "nested", "harness.log");
      const logger = new FileLogger(path);
      logger.info("model.reply", { durationMs: 12, promptTokens: 3 });
      logger.error("model.failure", { failure: "httpError", status: 500 });
      const lines = readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(lines).toMatchObject([
        { level: "info", event: "model.reply", durationMs: 12, promptTokens: 3 },
        { level: "error", event: "model.failure", status: 500 },
      ]);
    } finally {
      dir.cleanup();
    }
  });
});
