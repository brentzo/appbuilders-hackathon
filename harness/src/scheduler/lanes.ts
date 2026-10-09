import type { Lane, Observation, PermissionLevel, Subtask, ToolCall, ToolName } from "@yumi/protocol/types";
import type { LaneRouter, RouteDecision } from "../router/index.ts";

/**
 * The seams between the scheduler and what decides and runs lanes. The scheduler only knows these interfaces, so
 * the lane router (OBJ-07) plugs in through `route`, and each lane brings its own observation and tools.
 */

/**
 * Decides a subtask's lane, stores it on the subtask, and tells the apps. Rejects with `ProbeFailure` when the
 * target app's capability cannot be learned.
 */
export type RouteSubtask = (subtask: Subtask) => Promise<RouteDecision>;

/** Routes through the lane router (OBJ-07), which only reads the planner's proposed lane for its log. */
export function routeWith(router: LaneRouter): RouteSubtask {
  return (subtask) => router.route(subtask, subtask.proposedLane);
}

/** How one tool call ended, in the words the step log and the action log need. */
export interface ToolRunResult {
  outcome: "ok" | "error";
  /** One line for the next step's context: what happened. At most 300 characters. Never shown to the user. */
  observation: string;
  /** For the action log, in plain language: "Read Lease.pdf in Downloads". Never file contents. */
  description: string;
}

/** A lane's typed tools: the names offered to the model, the permission level of a call, and running it. */
export interface LaneTools {
  readonly tools: readonly { name: ToolName; description: string }[];
  /** Decided by the harness from the call alone, never by the model (SPEC-07 r1). */
  permission(call: ToolCall): PermissionLevel;
  run(call: ToolCall, signal?: AbortSignal): Promise<ToolRunResult>;
}

/** What a lane gives a worker for each step: a fresh observation and its tools. */
export interface LaneRunner {
  observe(subtask: Subtask, signal?: AbortSignal): Promise<Observation>;
  tools: LaneTools;
}

/** The lanes the scheduler can run. Until OBJ-07 and OBJ-36, only the helper lane exists. */
export type LaneRunners = Partial<Record<Lane, LaneRunner>>;

/**
 * What a helper sees: it has no window (SPEC-03 r2), so its observation is empty and its context is the goal, the
 * instruction, its last steps, and its tools.
 */
export const HELPER_OBSERVATION: Observation = { windowTitle: "", elements: [] };

/** A helper lane: no window, and the given tools. */
export function helperLane(tools: LaneTools): LaneRunner {
  return { observe: () => Promise.resolve(structuredClone(HELPER_OBSERVATION)), tools };
}
