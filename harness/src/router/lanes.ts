import type { Lane, ModelAction } from "@yumi/protocol/types";
import { ACTION } from "../worker/actions.ts";

/**
 * What each lane may do (SPEC-03 r7, docs/lane-router.md "Lanes" and "Lane-specific rules"). The worker reads these
 * when it narrows the schema sent to the model, writes the prompt, and checks the reply, so an action outside its
 * lane is never offered and never accepted.
 */

type ActionKind = ModelAction["kind"];

/** Lane cost order (SPEC-03 r1): the router picks the cheapest lane that passes every check. */
export const LANE_COST: Readonly<Record<Lane, number>> = { helper: 0, ghost: 1, main: 2 };

/** Keystrokes need keyboard focus, which is single, so only `main` sends them (SPEC-03 r7). */
export const KEYSTROKE_ACTIONS: readonly ActionKind[] = [ACTION.type, ACTION.key];

/** Actions that touch an app's UI. Helpers never touch the UI; one that needs it returns a new subtask instead. */
const UI_ACTIONS: readonly ActionKind[] = [ACTION.click, ACTION.setValue, ACTION.scroll, ACTION.type, ACTION.key, ACTION.clickAt];

const ALL_ACTIONS = Object.values(ACTION) as ActionKind[];

export const LANE_ACTIONS: Readonly<Record<Lane, readonly ActionKind[]>> = {
  helper: ALL_ACTIONS.filter((kind) => !UI_ACTIONS.includes(kind)),
  // A ghost works through the accessibility API or DevTools: no keystrokes, and no click at screen coordinates,
  // which moves the real mouse.
  ghost: ALL_ACTIONS.filter((kind) => !KEYSTROKE_ACTIONS.includes(kind) && kind !== ACTION.clickAt),
  main: ALL_ACTIONS,
};

export function laneAllows(lane: Lane, kind: ActionKind): boolean {
  return LANE_ACTIONS[lane].includes(kind);
}
