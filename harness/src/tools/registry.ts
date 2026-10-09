import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { AgentTool, AgentToolResult } from "../agent/index.ts";
import type { JsonSchema } from "../agent/llm.ts";

/**
 * The tool registry. Every tool has a name, a JSON Schema for its arguments, and a handler. A model call never
 * sees the whole registry: the caller picks a subset for the lane (5 to 10 tools), and a call to anything outside
 * that subset is refused even if the tool is registered.
 *
 * The registry starts empty. Pi's coding tools (read, write, edit, bash) are not part of Yumi; typed Yumi tools
 * are registered explicitly as they are built.
 */

/** The most tools one model call may be offered. */
export const MAX_TOOLS_PER_CALL = 10;

export interface ToolContext {
  signal?: AbortSignal | undefined;
}

export interface ToolDefinition<TArgs = unknown, TDetails = unknown> {
  /** Unique name the model calls the tool by. */
  name: string;
  /** What the tool does, for the model. */
  description: string;
  /** JSON Schema (draft 2020-12) for the arguments. Checked before every call. */
  parameters: JsonSchema;
  handler: (args: TArgs, context: ToolContext) => Promise<AgentToolResult<TDetails>>;
}

export type ArgumentCheck = { ok: true; args: unknown } | { ok: false; errors: string[] };

/** Thrown for programming errors: a duplicate name, an unknown tool, or too many tools in a subset. */
export class ToolRegistryError extends Error {}

interface RegisteredTool {
  definition: ToolDefinition;
  check: ValidateFunction;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly ajv = new Ajv2020.default({ strict: true, strictRequired: false, allErrors: true, discriminator: true });

  constructor() {
    addFormats.default(this.ajv);
  }

  register<TArgs, TDetails>(definition: ToolDefinition<TArgs, TDetails>): void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(definition.name)) throw new ToolRegistryError(`Invalid tool name: ${definition.name}`);
    if (this.tools.has(definition.name)) throw new ToolRegistryError(`Tool already registered: ${definition.name}`);
    const check = this.ajv.compile(definition.parameters);
    this.tools.set(definition.name, { definition: definition as ToolDefinition, check });
  }

  get names(): string[] {
    return [...this.tools.keys()];
  }

  /** The tools offered to one model call. Throws if a name is unknown or the subset is too large. */
  select(names: readonly string[]): ToolSet {
    const unique = [...new Set(names)];
    if (unique.length > MAX_TOOLS_PER_CALL) {
      throw new ToolRegistryError(`A call can offer at most ${MAX_TOOLS_PER_CALL} tools, got ${unique.length}`);
    }
    const selected = unique.map((name) => {
      const tool = this.tools.get(name);
      if (!tool) throw new ToolRegistryError(`Unknown tool: ${name}`);
      return tool;
    });
    return new ToolSet(selected);
  }
}

/** A subset of the registry, offered to one model call or one agent run. */
export class ToolSet {
  private readonly byName: Map<string, RegisteredTool>;

  constructor(tools: RegisteredTool[]) {
    this.byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  }

  get names(): string[] {
    return [...this.byName.keys()];
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Checks a call against the subset and the tool's argument schema. */
  check(name: string, args: unknown): ArgumentCheck {
    const tool = this.byName.get(name);
    if (!tool) return { ok: false, errors: [`Tool ${name} is not available for this step`] };
    if (tool.check(args)) return { ok: true, args };
    return { ok: false, errors: (tool.check.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`) };
  }

  /** The subset as tools for the forked agent loop, which validates arguments before running a handler. */
  toAgentTools(): AgentTool[] {
    return [...this.byName.values()].map(({ definition }) => ({
      name: definition.name,
      label: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      validateArguments: (args: unknown) => {
        const result = this.check(definition.name, args);
        if (!result.ok) throw new Error(`Invalid arguments for ${definition.name}: ${result.errors.join("; ")}`);
        return result.args;
      },
      execute: (_toolCallId: string, args: unknown, signal?: AbortSignal) => definition.handler(args, { signal }),
    }));
  }
}
