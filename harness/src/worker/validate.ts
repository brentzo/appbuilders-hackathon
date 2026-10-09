import { validate } from "@yumi/protocol";
import type { ModelAction, TreeElement, WorkerInput, WorkerOutput } from "@yumi/protocol/types";
import { ACTION, isElementAction } from "./actions.ts";

/**
 * Checks one model reply for a step (SPEC-02 r6): it must be one JSON object that matches the protocol's
 * `WorkerOutput` schema, and its action must fit what the step offered. The error text goes back to the model on
 * the retry and into the log. It never reaches the user, and it never quotes the reply, which can hold screen text.
 */

export type OutputCheck = { ok: true; output: WorkerOutput } | { ok: false; error: string };

export function checkWorkerOutput(raw: string | null, input: WorkerInput): OutputCheck {
  if (raw === null || raw.trim() === "") return { ok: false, error: "The reply was empty." };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The reply is not valid JSON. Reply with exactly one JSON object and nothing else." };
  }

  const result = validate("WorkerOutput", value);
  if (!result.valid) {
    return { ok: false, error: `The reply does not match the action schema: ${result.errors.join("; ")}.` };
  }
  const output = value as WorkerOutput;
  const problem = actionProblem(output.action, input);
  return problem ? { ok: false, error: problem } : { ok: true, output };
}

function actionProblem(action: ModelAction, input: WorkerInput): string | undefined {
  if (isElementAction(action.kind) && "element" in action) {
    const element = input.observation.elements.find((e) => e.n === action.element);
    if (!element) return `Element ${action.element} is not on the screen. Use a number from the element list.`;
    // SPEC-05 r7: never fill a password field; ask the user to type it.
    if (action.kind === ACTION.setValue && element.role === "secureTextField") {
      return `Element ${action.element} is a password field. Never fill it; use ${ACTION.ask} so the user types it.`;
    }
  }
  if (action.kind === ACTION.tool && !input.allowedTools.includes(action.call.tool)) {
    return `The tool ${action.call.tool} is not available for this step. Available tools: ${input.allowedTools.join(", ") || "none"}.`;
  }
  // SPEC-05 r7: never type with the keyboard while a password field has focus.
  if (action.kind === ACTION.type && focusedElement(input)?.role === "secureTextField") {
    return `The focused element is a password field. Never type into it; use ${ACTION.ask} so the user types it.`;
  }
  if (action.kind === ACTION.clickAt && !input.observation.screenshotPath) {
    return `There is no screenshot for this step, so ${ACTION.clickAt} at coordinates is not available. Use ${ACTION.click} with an element number.`;
  }
  return undefined;
}

/** The element with keyboard focus, when the Mac app reported one and it is in the tree. */
export function focusedElement(input: WorkerInput): TreeElement | undefined {
  const focused = input.observation.focused;
  return focused === undefined ? undefined : input.observation.elements.find((e) => e.n === focused);
}
