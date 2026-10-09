import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent, type AgentEvent, type ToolResultMessage } from "../src/agent/index.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { createLocalStreamFn } from "../src/model/stream-fn.ts";
import { MAX_TOOLS_PER_CALL, ToolRegistry, ToolRegistryError, type ToolDefinition } from "../src/tools/registry.ts";
import { modelConfig } from "./helpers.ts";
import { startMockModelServer, type MockModelServer } from "./mock-model-server.ts";

function testTool(name: string, calls: unknown[] = []): ToolDefinition {
  return {
    name,
    description: `Test tool ${name}.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: { text: { type: "string", minLength: 1 } },
    },
    handler: async (args) => {
      calls.push(args);
      return { content: [{ type: "text", text: `${name} ran` }], details: {} };
    },
  };
}

describe("the tool registry", () => {
  it("starts empty: no coding tools (read, write, edit, bash) by default", () => {
    expect(new ToolRegistry().names).toEqual([]);
  });

  it("refuses duplicate names, bad names, and invalid schemas", () => {
    const registry = new ToolRegistry();
    registry.register(testTool("echo"));
    expect(() => registry.register(testTool("echo"))).toThrow(ToolRegistryError);
    expect(() => registry.register(testTool("not a name"))).toThrow(ToolRegistryError);
    expect(() => registry.register({ ...testTool("broken"), parameters: { type: "objekt" } })).toThrow();
  });

  it("offers a chosen subset, and refuses a registered tool outside it", () => {
    const registry = new ToolRegistry();
    for (const name of ["a", "b", "c"]) registry.register(testTool(name));
    const subset = registry.select(["a", "b"]);
    expect(subset.names).toEqual(["a", "b"]);
    expect(subset.check("a", { text: "hi" })).toEqual({ ok: true, args: { text: "hi" } });
    expect(subset.check("c", { text: "hi" })).toEqual({ ok: false, errors: ["Tool c is not available for this step"] });
    expect(subset.toAgentTools().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("checks arguments against the tool's JSON Schema", () => {
    const registry = new ToolRegistry();
    registry.register(testTool("a"));
    const subset = registry.select(["a"]);
    expect(subset.check("a", { text: "" })).toMatchObject({ ok: false });
    expect(subset.check("a", { text: "hi", extra: 1 })).toMatchObject({ ok: false });
    expect(subset.check("a", {})).toMatchObject({ ok: false });
  });

  it(`caps a subset at ${MAX_TOOLS_PER_CALL} tools and refuses unknown names`, () => {
    const registry = new ToolRegistry();
    const names = Array.from({ length: MAX_TOOLS_PER_CALL + 1 }, (_, i) => `t${i}`);
    for (const name of names) registry.register(testTool(name));
    expect(registry.select(names.slice(0, MAX_TOOLS_PER_CALL)).names).toHaveLength(MAX_TOOLS_PER_CALL);
    expect(() => registry.select(names)).toThrow(ToolRegistryError);
    expect(() => registry.select(["nope"])).toThrow("Unknown tool: nope");
  });
});

describe("the forked agent loop with a tool subset", () => {
  let server: MockModelServer;
  const calls: Record<string, unknown[]> = { a: [], b: [], c: [] };

  beforeEach(async () => {
    server = await startMockModelServer();
    for (const key of Object.keys(calls)) calls[key] = [];
  });

  afterEach(async () => {
    await server.close();
  });

  function agentWithSubset(names: string[]) {
    const registry = new ToolRegistry();
    for (const name of ["a", "b", "c"]) registry.register(testTool(name, calls[name]));
    const client = new ModelClient(modelConfig(server.baseUrl), new MemoryLogger());
    const agent = new Agent({
      streamFn: createLocalStreamFn(client),
      initialState: {
        systemPrompt: "You are a test agent.",
        model: { id: client.config.model, input: ["text", "image"] },
        tools: registry.select(names).toAgentTools(),
      },
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => void events.push(event));
    return { agent, events };
  }

  const toolResults = (events: AgentEvent[]) =>
    events.flatMap((e) => (e.type === "message_end" && e.message.role === "toolResult" ? [e.message as ToolResultMessage] : []));

  it("declares only the subset to the model and runs an offered tool", async () => {
    server.reply(
      { kind: "toolCalls", calls: [{ name: "a", arguments: '{"text": "hello"}' }] },
      { kind: "content", content: "Done." },
    );
    const { agent, events } = agentWithSubset(["a", "b"]);
    await agent.prompt("Say hello with tool a.");

    const first = server.requests[0] as unknown as ChatRequest;
    expect(first.tools?.map((t) => t.function.name)).toEqual(["a", "b"]);
    expect(first.messages[0]).toEqual({ role: "system", content: "You are a test agent." });
    expect(calls["a"]).toEqual([{ text: "hello" }]);
    expect(toolResults(events)).toMatchObject([{ toolName: "a", isError: false }]);

    // The tool result goes back to the model as an OpenAI tool message.
    const second = server.requests[1] as unknown as ChatRequest;
    expect(second.messages.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ function: { name: "a" } }] });
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", content: "a ran" });
    expect(agent.state.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "Done." }] });
  });

  it("never runs a registered tool that is outside the subset", async () => {
    server.reply(
      { kind: "toolCalls", calls: [{ name: "c", arguments: '{"text": "sneaky"}' }] },
      { kind: "content", content: "OK." },
    );
    const { agent, events } = agentWithSubset(["a", "b"]);
    await agent.prompt("Use tool c.");
    expect(calls["c"]).toEqual([]);
    expect(toolResults(events)).toMatchObject([{ toolName: "c", isError: true }]);
  });

  it("never runs a tool with invalid arguments", async () => {
    server.reply({ kind: "toolCalls", calls: [{ name: "a", arguments: '{"text": ""}' }] }, { kind: "content", content: "OK." });
    const { agent, events } = agentWithSubset(["a"]);
    await agent.prompt("Use tool a badly.");
    expect(calls["a"]).toEqual([]);
    expect(toolResults(events)).toMatchObject([{ toolName: "a", isError: true }]);
  });

  it("ends the run with an error turn when the model server fails, keeping the detail out of the transcript text", async () => {
    server.reply({ kind: "httpError", status: 500, detail: "Generation failed: boom" });
    const { agent } = agentWithSubset(["a"]);
    await agent.prompt("Hello.");
    expect(agent.state.errorMessage).toBe("model httpError");
    expect(JSON.stringify(agent.state.messages)).not.toContain("boom");
  });
});
