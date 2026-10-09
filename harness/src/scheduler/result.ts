import type { Path, ResultStatus, SubtaskResult } from "@yumi/protocol/types";

/**
 * Builds a subtask's short, structured result for the planner (OBJ-05.6, SPEC-05 r4): how it ended, the files it
 * created or changed, and a note of at most 200 characters. The files are the real paths the tools reported, never
 * the model's word, since a taken name gets a number (SPEC-07 r4). Screenshots, step history, and screen or file
 * text never go in.
 */

/** `SubtaskResult.note` holds at most this many characters. */
export const MAX_NOTE = 200;

export function buildSubtaskResult(status: ResultStatus, note: string, files: readonly Path[]): SubtaskResult {
  return { status, files: [...files], note: note.length <= MAX_NOTE ? note : `${note.slice(0, MAX_NOTE - 3)}...` };
}
