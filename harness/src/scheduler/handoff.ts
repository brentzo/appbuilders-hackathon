import type { Step, Uuid } from "@yumi/protocol/types";
import { INVALID_OUTPUT_LIMIT, NO_EFFECT_LIMIT, type Streaks } from "../gui/gui-act.ts";

/**
 * Ghost handoff (SPEC-03 r8, r9, OBJ-09): a ghost that gets stuck is not retried. Its subtask moves to the main
 * cursor, which carries on from the task record and a fresh look, with the step log kept, never the ghost's
 * conversation (docs/lane-router.md, "Handoff (promotion)").
 */

/** Whether a ghost's attempt ended stuck enough to hand off: 2 invalid replies or 3 no-effect steps in a row. */
export function handoffDue(streaks: Streaks): boolean {
  return streaks.invalidOutput >= INVALID_OUTPUT_LIMIT || streaks.noEffect >= NO_EFFECT_LIMIT;
}

/** The last step that worked, which the main cursor carries on after. Undefined when no step worked. */
export function lastGoodStep(steps: readonly Step[]): Uuid | undefined {
  return steps.findLast((step) => step.outcome === "ok")?.id;
}
