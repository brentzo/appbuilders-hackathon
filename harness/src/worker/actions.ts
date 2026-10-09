import type { ModelAction } from "@yumi/protocol/types";

/**
 * The model's action kinds, in one place. The prompt, the schema narrowing, and the validation all read these
 * names, so a protocol rename (version 3 renamed `axPress` to `click`) is a change here plus the generated types.
 */
export const ACTION = {
  /** Click an element through the accessibility API: the Mac app selects a row or cell, and presses anything else. */
  click: "click",
  setValue: "setValue",
  scroll: "scroll",
  type: "type",
  key: "key",
  tool: "tool",
  ask: "ask",
  finish: "finish",
  /** p1 vision fallback: click at screenshot coordinates. */
  clickAt: "clickAt",
} as const satisfies Record<string, ModelAction["kind"]>;

/** The protocol `$defs` name of each action variant, for narrowing the schema sent to the model. */
export const ACTION_TYPE_NAME = {
  click: "ClickAction",
  setValue: "SetValueAction",
  scroll: "ScrollAction",
  type: "TypeTextAction",
  key: "KeyAction",
  tool: "ToolAction",
  ask: "AskAction",
  finish: "FinishAction",
  clickAt: "ClickAtAction",
} as const satisfies Record<keyof typeof ACTION, string>;

/** Actions that refer to an element of the trimmed tree by its number. */
export const ELEMENT_ACTIONS = ["click", "setValue", "scroll"] as const satisfies readonly (keyof typeof ACTION)[];

export function isElementAction(kind: ModelAction["kind"]): boolean {
  return ELEMENT_ACTIONS.some((name) => ACTION[name] === kind);
}
