import { basename, dirname } from "node:path";
import type { Lane, ModelAction, Observation, Step, Subtask, ToolCall, WorkerThought } from "@yumi/protocol/types";
import { MAIN_CURSOR_ID } from "../confirm/confirmation.ts";
import { ACTION } from "../worker/actions.ts";

/**
 * The text of a `workerThought` (SPEC-07 r23): what a worker sees and what the model decided, in plain words for the
 * thoughts panel. Like the action log, it never holds text Yumi would type or set (SPEC-07 r20), and every field
 * fits the protocol's limits.
 */

const MAX = 200;

/** A cursor's id for its thoughts: its lane runner's, or `main` for the one main cursor. A helper has none. */
export function cursorIdFor(lane: Lane, subtask: Subtask, runner: { cursorId?: (subtask: Subtask) => string | undefined }) {
  if (lane === "helper") return undefined;
  return runner.cursorId?.(subtask) ?? (lane === "main" ? MAIN_CURSOR_ID : undefined);
}

/**
 * What the worker sees: the app, the window, what is in front, and how many elements, for example
 * `Keynote, "Q3 Review", with the sheet "Export" in front (14 elements)`. A helper has no window, so it sees what its
 * last step returned.
 */
export function describeSees(observation: Observation, lastStep?: Step): string {
  if (observation.windowTitle === "" && observation.elements.length === 0 && observation.app === undefined) {
    if (!lastStep?.observation) return "Files only, no window. Nothing done yet.";
    const output = lastStep.toolOutput?.split("\n").find((line) => line.trim() !== "");
    return fit(output ? `${lastStep.observation}: ${output.trim()}` : lastStep.observation);
  }
  const parts = [observation.app, observation.windowTitle !== "" ? JSON.stringify(observation.windowTitle) : undefined];
  let text = parts.filter((part) => part !== undefined).join(", ") || "A window";
  const layer = observation.layer;
  if (layer !== undefined && layer.kind !== "window") {
    text += `, with the ${layer.kind}${layer.title ? ` ${JSON.stringify(layer.title)}` : ""} in front`;
  }
  const count = observation.elements.length;
  return fit(`${text} (${count} element${count === 1 ? "" : "s"})`);
}

/** The model's chosen action in plain words, for example `Click "Export" (element 12)`. Never the text to type. */
export function describeDecision(action: ModelAction, observation: Observation): string {
  const element = (n: number) => {
    const found = observation.elements.find((e) => e.n === n);
    const label = found?.label ? JSON.stringify(found.label) : (found?.role ?? "an element");
    return `${label} (element ${n})`;
  };
  switch (action.kind) {
    case ACTION.click:
      return fit(`Click ${element(action.element)}`);
    case ACTION.setValue:
      return fit(`Set the text of ${element(action.element)}`);
    case ACTION.scroll:
      return fit(`Scroll ${action.direction} in ${element(action.element)}`);
    case ACTION.type:
      return "Type into the focused field";
    case ACTION.key:
      return fit(`Press ${action.combo}`);
    case ACTION.clickAt:
      return fit(`Click at ${action.x}, ${action.y} on the screenshot`);
    case ACTION.tool:
      return fit(describeToolCall(action.call));
    case ACTION.ask:
      return fit(`Ask you: ${action.question}`);
    case ACTION.finish:
      return fit(`Finish as ${action.status}: ${action.note}`);
  }
}

function describeToolCall(call: ToolCall): string {
  const name = (path: string) => basename(path);
  const folder = (path: string) => basename(dirname(path)) || dirname(path);
  switch (call.tool) {
    case "read_file":
      return `Read ${name(call.path)}`;
    case "list_dir":
      return `Look in the folder ${name(call.path)}`;
    case "write_new_file":
      return `Create ${name(call.path)} in ${folder(call.path)}`;
    case "copy":
      return `Copy ${name(call.from)} to ${folder(call.to)}`;
    case "move":
      return `Move ${name(call.from)} to ${folder(call.to)}`;
    case "move_to_trash":
      return `Move ${call.paths.length === 1 ? name(call.paths[0]!) : `${call.paths.length} items`} to the Trash`;
    default:
      return `Use ${call.tool}`;
  }
}

/** Builds a thought, dropping empty optional fields so it always matches the contract. */
export function thought(fields: Omit<WorkerThought, "at"> & { at?: string }): WorkerThought {
  const optional = (value: string | undefined) => (value !== undefined && value.trim() !== "" ? fit(value) : undefined);
  const lastAction = optional(fields.lastAction);
  const decision = optional(fields.decision);
  const reason = optional(fields.reason);
  return {
    taskId: fields.taskId,
    subtaskId: fields.subtaskId,
    ...(fields.cursorId ? { cursorId: fields.cursorId } : {}),
    title: fields.title,
    lane: fields.lane,
    sees: fit(fields.sees),
    ...(lastAction ? { lastAction } : {}),
    ...(decision ? { decision } : {}),
    ...(reason ? { reason } : {}),
    at: fields.at ?? new Date().toISOString(),
  };
}

function fit(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= MAX ? line : `${line.slice(0, MAX - 3)}...`;
}
