import type { Path, ResultStatus, Step, SubtaskResult } from "@yumi/protocol/types";

/**
 * Builds a subtask's short, structured result for the planner (OBJ-05.6, SPEC-05 r4): how it ended, the files it
 * created or changed, and a note of at most 200 characters. The files come from the step log, never from the
 * model's word. Screenshots, step history, and screen or file text never go in.
 */

/** `SubtaskResult.note` holds at most this many characters. */
export const MAX_NOTE = 200;

export function buildSubtaskResult(status: ResultStatus, note: string, steps: readonly Step[]): SubtaskResult {
  return { status, files: changedFiles(steps), note: note.length <= MAX_NOTE ? note : `${note.slice(0, MAX_NOTE - 3)}...` };
}

/** Paths created or changed by the steps that succeeded, in the order they happened, each once. */
export function changedFiles(steps: readonly Step[]): Path[] {
  const files: Path[] = [];
  for (const step of steps) {
    if (step.outcome !== "ok" || step.action.action.kind !== "tool") continue;
    const call = step.action.action.call;
    const path = call.tool === "write_new_file" ? call.path : call.tool === "copy" || call.tool === "move" ? call.to : undefined;
    if (path !== undefined && !files.includes(path)) files.push(path);
  }
  return files;
}
