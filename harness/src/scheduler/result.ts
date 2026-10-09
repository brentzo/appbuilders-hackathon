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

/** `UserError.finishedSoFar` holds at most this many characters. */
export const MAX_FINISHED_SO_FAR = 500;
/** Longest single line in `finishedSoFar`, so one long file name cannot push out everything else. */
const MAX_FINISHED_LINE = 200;

/**
 * What was finished before a limit stopped the work, for the "Task took too long" copy ("Here's what I finished so
 * far.", SPEC-11): one line per item, oldest first, each said once. Items that do not fit are counted in a last
 * line, "And 4 more.". Undefined when nothing was finished, so the app does not promise a list it cannot show.
 */
export function finishedSoFar(items: readonly string[]): string | undefined {
  const lines = [...new Set(items)].map((item) =>
    item.length <= MAX_FINISHED_LINE ? item : `${item.slice(0, MAX_FINISHED_LINE - 3)}...`,
  );
  if (lines.length === 0) return undefined;
  const room = `\nAnd ${lines.length} more.`.length;
  let text = "";
  let kept = 0;
  for (const line of lines) {
    const next = kept === 0 ? line : `${text}\n${line}`;
    const isLast = kept === lines.length - 1;
    if (next.length > MAX_FINISHED_SO_FAR - (isLast ? 0 : room)) break;
    text = next;
    kept++;
  }
  return kept === lines.length ? text : `${text}\nAnd ${lines.length - kept} more.`;
}
