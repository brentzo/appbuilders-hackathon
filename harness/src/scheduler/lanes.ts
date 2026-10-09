import type { Lane, Observation, PermissionLevel, RouteReason, Subtask, ToolCall, ToolName } from "@yumi/protocol/types";

/**
 * The seams between the scheduler and what decides and runs lanes. The scheduler only knows these interfaces, so
 * the lane router (OBJ-07) and the permission-gated typed tools (OBJ-42) plug in without changing it.
 */

/** Where a subtask runs, and why (SPEC-03 r10). */
export interface RouteDecision {
  lane: Lane;
  reason: RouteReason;
}

/** Decides a subtask's lane. OBJ-07's router replaces `routeEverythingAsHelper`. */
export type RouteSubtask = (subtask: Subtask) => RouteDecision | Promise<RouteDecision>;

/**
 * STAND-IN until the lane router exists (OBJ-05.8, replaced by OBJ-07.8): every subtask runs as a helper. The
 * reason is `noUI` because the only lane that exists so far is the one with no UI.
 */
export const routeEverythingAsHelper: RouteSubtask = () => ({ lane: "helper", reason: "noUI" });

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

/** The lanes the scheduler can run. Until OBJ-07 and OBJ-41, only the helper lane exists. */
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
