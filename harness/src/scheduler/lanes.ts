import type { Observation, Path, Subtask, ToolCall, ToolName } from "@yumi/protocol/types";
import type { Logger } from "../log.ts";
import type { LaneRouter, RouteDecision } from "../router/index.ts";
import { FILE_TOOL_NAMES, registerFileTools, type FileToolDetails } from "../tools/file-tools.ts";
import { ToolRegistry } from "../tools/registry.ts";

/**
 * The seams between the scheduler and what decides and runs lanes. The lane router (OBJ-07) plugs in through
 * `route`, and each lane brings its own observation and tools.
 */

/**
 * Decides a subtask's lane, stores it on the subtask, and tells the apps. `promoted` is set for a subtask a stuck
 * ghost handed off, which goes to `main` (OBJ-09). Rejects with `ProbeFailure` when the target app's capability
 * cannot be learned.
 */
export type RouteSubtask = (subtask: Subtask, promoted?: boolean) => Promise<RouteDecision>;

/** Routes through the lane router (OBJ-07), which only reads the planner's proposed lane for its log. */
export function routeWith(router: LaneRouter): RouteSubtask {
  return (subtask, promoted) => router.route(subtask, subtask.proposedLane, promoted);
}

/** How one tool call ended. The permission gate has already allowed it. */
export interface ToolRunResult {
  outcome: "ok" | "error";
  /** What the tool returned, for the model only. Never shown to the user. */
  output: string;
  /** The real path the tool read, listed, or created; for copy and move, the new path. */
  path?: Path;
}

/** A lane's typed tools: the names and descriptions offered to the model, and running a call. */
export interface LaneTools {
  readonly tools: readonly { name: ToolName; description: string }[];
  run(call: ToolCall, signal?: AbortSignal): Promise<ToolRunResult>;
}

/** What a lane gives a worker for each step: a fresh observation and its tools. */
export interface LaneRunner {
  observe(subtask: Subtask, signal?: AbortSignal): Promise<Observation>;
  tools: LaneTools;
  /**
   * The id of the cursor working on the subtask, for its `workerThought` (OBJ-52). A ghost lane gives each ghost's
   * own id; without it, the main lane's cursor is `main` and a helper has none.
   */
  cursorId?(subtask: Subtask): string | undefined;
}

/** The lanes the scheduler can run. Until OBJ-36 (gui_act), only the helper lane exists. */
export type LaneRunners = Partial<Record<RouteDecision["lane"], LaneRunner>>;

/**
 * What a helper sees: it has no window (SPEC-03 r2), so its observation is empty and its context is the goal, the
 * instruction, its last steps, and its tools.
 */
export const HELPER_OBSERVATION: Observation = { windowTitle: "", elements: [] };

/** A helper lane: no window, and the given tools. */
export function helperLane(tools: LaneTools): LaneRunner {
  return { observe: () => Promise.resolve(structuredClone(HELPER_OBSERVATION)), tools };
}

/** Typed tools from the registry, offered by name. Each tool still checks its own call with the gate when it runs. */
export function registryTools(registry: ToolRegistry, names: readonly ToolName[]): LaneTools {
  const set = registry.select(names);
  const byName = new Map(set.toAgentTools().map((tool) => [tool.name, tool]));
  return {
    tools: names.map((name) => ({ name, description: byName.get(name)!.description })),
    async run(call, signal) {
      const tool = byName.get(call.tool);
      if (!tool) return { outcome: "error", output: `The tool ${call.tool} is not available here.` };
      const { tool: _name, ...args } = call;
      const result = await tool.execute(call.tool, tool.validateArguments(args), signal);
      const output = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      const path = (result.details as FileToolDetails | undefined)?.path;
      return { outcome: result.isError ? "error" : "ok", output, ...(path && !result.isError ? { path } : {}) };
    },
  };
}

/** How `move_to_trash` is offered to the model. */
export const TRASH_TOOL_DESCRIPTION =
  "Move files or folders to the Trash. Give every exact path; no wildcards. The user is always asked first.";

/**
 * Adds `move_to_trash` to a lane's tools (SPEC-07 r3, r7). The gate always asks or blocks it, so it only ever runs
 * through the approval flow, which moves exactly the approved paths with the Mac app's `moveToTrash` (OBJ-38.3).
 * Running it as an allowed call is a bug and does nothing.
 */
export function withTrash(tools: LaneTools): LaneTools {
  return {
    tools: [...tools.tools, { name: "move_to_trash", description: TRASH_TOOL_DESCRIPTION }],
    run: (call, signal) =>
      call.tool === "move_to_trash"
        ? Promise.resolve({ outcome: "error", output: "Moving to the Trash needs the user's approval first." })
        : tools.run(call, signal),
  };
}

/** The helper lane of the running harness: OBJ-37's typed file tools on the user's home folder, and the Trash. */
export function fileHelperLane(context: { home: string; logger?: Logger }): LaneRunner {
  const registry = new ToolRegistry();
  registerFileTools(registry, context);
  return helperLane(withTrash(registryTools(registry, FILE_TOOL_NAMES)));
}
