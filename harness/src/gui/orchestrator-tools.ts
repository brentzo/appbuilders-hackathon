import type { ToolName } from "@yumi/protocol/types";
import type { PlannerTool } from "../planner/prompt.ts";

/**
 * The orchestrator's tools (SPEC-05 r9, OBJ-36.2): what the planner may hand work to. The orchestrator never looks at
 * the screen; work in an app's window goes to `gui_act`, which keeps the direct tools (`open_app`, `open_file`,
 * `open_url`, `reveal_in_finder`) inside its own step loop, so the list stays at 8 or fewer.
 */

/** SPEC-05 r9: the orchestrator's tool list stays at 8 tools or fewer. */
export const MAX_ORCHESTRATOR_TOOLS = 8;

export type OrchestratorToolName = "gui_act" | Exclude<ToolName, "open_app" | "open_file" | "open_url" | "reveal_in_finder">;

/** The full list, in the order the planner sees it. `move_to_trash` and `phone` join when their lanes exist. */
export const ORCHESTRATOR_TOOL_NAMES: readonly OrchestratorToolName[] = [
  "gui_act",
  "read_file",
  "list_dir",
  "write_new_file",
  "copy",
  "move",
  "move_to_trash",
  "phone",
];

/** `gui_act` as the planner sees it. It takes the subtask; the instruction and target app come from its record. */
export const GUI_ACT_TOOL: PlannerTool = {
  name: "gui_act",
  description:
    "Works in an app's window the way a person would: menus, buttons, lists, and text fields, and opening apps, files, folders in Finder, and web links. Give the subtask a targetApp.",
};

/**
 * The tools the planner is offered: `gui_act` when the ghost and main lanes can run, then the helper lane's tools.
 * Throws for a tool that is not on the orchestrator's list, or a list past the limit: both are bugs in the lane wiring.
 */
export function orchestratorTools(helperTools: readonly PlannerTool[], gui: boolean): PlannerTool[] {
  const helpers = helperTools.filter((tool, i) => helperTools.findIndex((other) => other.name === tool.name) === i);
  const unlisted = helpers.filter((tool) => !ORCHESTRATOR_TOOL_NAMES.includes(tool.name as OrchestratorToolName));
  if (unlisted.length > 0) {
    throw new Error(`Not on the orchestrator's tool list: ${unlisted.map((tool) => tool.name).join(", ")}`);
  }
  return checkToolCount([...(gui ? [GUI_ACT_TOOL] : []), ...helpers]);
}

/** Refuses a tool list longer than SPEC-05 r9 allows. */
export function checkToolCount<T>(tools: readonly T[]): T[] {
  if (tools.length > MAX_ORCHESTRATOR_TOOLS) {
    throw new Error(`The orchestrator has ${tools.length} tools; SPEC-05 r9 allows at most ${MAX_ORCHESTRATOR_TOOLS}`);
  }
  return [...tools];
}
