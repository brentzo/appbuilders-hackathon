import { isDeepStrictEqual } from "node:util";
import type { Observation, TreeElement } from "@yumi/protocol/types";

/**
 * Comparing two looks at the target window: whether an action had any effect (SPEC-05 r6), whether the screen has
 * settled after an action (OBJ-26 round 3, fix 1), and one line on what changed for the model's step history.
 */

/**
 * SPEC-05 r6: a step has no effect when the trimmed tree and the window title are the same before and after it. The
 * front layer and the focus are not part of the tree: a click that only moves focus has no effect.
 */
export function sameTreeAndTitle(before: Observation, after: Observation): boolean {
  return before.windowTitle === after.windowTitle && isDeepStrictEqual(before.elements, after.elements);
}

/** Two observations that show exactly the same screen, including the front layer and the focus. */
export function sameScreen(a: Observation, b: Observation): boolean {
  return isDeepStrictEqual(a, b);
}

export interface SettleTiming {
  /**
   * Time between two looks. Round 3 saw a closing sheet still in the tree 1 second after Export, and gone 0.3
   * seconds after it in another run, so two matching looks span at least this long.
   */
  intervalMs: number;
  /** Give up waiting and use the last look after this long, for a window that never stops changing. */
  timeoutMs: number;
}

export const DEFAULT_SETTLE: SettleTiming = { intervalMs: 500, timeoutMs: 5000 };

/**
 * Looks at the window until two looks in a row are the same, so the model never sees a sheet that is still closing
 * (OBJ-36.10). Returns the last look, which is also the one the Mac app resolves element numbers against.
 */
export async function settledObservation(
  observe: () => Promise<Observation>,
  timing: SettleTiming,
  signal?: AbortSignal,
): Promise<{ observation: Observation; settled: boolean; looks: number }> {
  const deadline = Date.now() + timing.timeoutMs;
  let last = await observe();
  let looks = 1;
  for (;;) {
    if (signal?.aborted || Date.now() >= deadline) return { observation: last, settled: false, looks };
    await sleep(timing.intervalMs, signal);
    const next = await observe();
    looks++;
    if (sameScreen(last, next)) return { observation: next, settled: true, looks };
    last = next;
  }
}

/** One short clause on what changed, from the model's point of view. Screen text in it is data for the model only. */
export function describeChange(before: Observation, after: Observation): string {
  const parts: string[] = [];
  if (before.windowTitle !== after.windowTitle) parts.push(`the window title is now ${JSON.stringify(after.windowTitle)}`);
  const kindBefore = before.layer?.kind ?? "window";
  const kindAfter = after.layer?.kind ?? "window";
  if (kindBefore !== kindAfter) {
    parts.push(kindAfter === "window" ? `the ${kindBefore} closed` : `a ${kindAfter} is now in front`);
  }
  const old = new Set(before.elements.map(signature));
  const added = after.elements.filter((element) => !old.has(signature(element)));
  if (added.length > 0) {
    const shown = added.slice(0, 4).map((element) => `${element.role} ${JSON.stringify(cut(element.label, 40))}`);
    parts.push(`new: ${shown.join(", ")}${added.length > 4 ? `, and ${added.length - 4} more` : ""}`);
  }
  const now = new Set(after.elements.map(signature));
  const gone = before.elements.filter((element) => !now.has(signature(element))).length;
  if (gone > 0) parts.push(`${gone} ${gone === 1 ? "element" : "elements"} gone`);
  return parts.length > 0 ? parts.join("; ") : "the elements changed";
}

/** An element without its number, which changes whenever anything above it does. */
function signature(element: TreeElement): string {
  return JSON.stringify([element.role, element.label, element.value ?? null, element.enabled]);
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}
