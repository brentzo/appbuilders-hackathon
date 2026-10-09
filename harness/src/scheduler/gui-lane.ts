import type { Path, Subtask } from "@yumi/protocol/types";
import { DEFAULT_LIMITS } from "../config.ts";
import type { RunControl } from "../control/run-control.ts";
import { guiAct, type GuiActDeps } from "../gui/gui-act.ts";
import { handoffDue } from "./handoff.ts";
import type { SubtaskRun } from "./subtask-runner.ts";

/**
 * How the orchestrator uses `gui_act` for a ghost or main subtask: one call is one attempt (SPEC-05 r5). An attempt
 * that ran out of its 10 steps without finishing (`partial`) gets another, up to the attempt limit and while the
 * subtask has steps left (SPEC-02 r8). Anything else ends the subtask: `done` finishes it; `stuck` and `blocked` fail
 * it with their own SPEC-11 error, or "Couldn't finish a step" when they have none.
 *
 * A ghost stuck on 2 invalid replies or 3 no-effect steps in a row is handed off to the main cursor instead (SPEC-03
 * r8, OBJ-09); its `gui_act` attempt has already faded its cursor. A subtask the main cursor takes over (`handedOff`)
 * first moves the main cursor to the ghost's window, so the user sees who carries on.
 */
export async function runGuiSubtask(
  subtask: Subtask,
  confirmedGoal: string,
  deps: GuiActDeps,
  signal: AbortSignal,
  control: RunControl,
  continuing: boolean,
  handedOff = false,
): Promise<SubtaskRun> {
  const limits = deps.limits ?? DEFAULT_LIMITS;
  if (handedOff && subtask.lane === "main" && subtask.target) {
    // The window's center: "AXWindow" is the window's own element path (OBJ-39).
    const window = { kind: "element" as const, target: subtask.target, elementPath: "AXWindow" };
    deps.mac.cursor({ command: "spawn", cursorId: "main", cursorKind: "main", at: window });
    deps.mac.cursor({ command: "move", cursorId: "main", to: window });
  }
  /** Files from every attempt, since a later attempt may finish what an earlier one saved. */
  const files: Path[] = [];
  for (let call = 0; ; call++) {
    const attempt = await guiAct(subtask.id, deps, {
      confirmedGoal,
      signal,
      control,
      continuing: continuing && call === 0,
    });
    for (const file of attempt.result.files) if (!files.includes(file)) files.push(file);
    const run = { ...attempt, result: { ...attempt.result, files: [...files] } };
    switch (run.outcome) {
      case "aborted":
        return { outcome: "aborted", result: run.result };
      case "error":
        return { outcome: "error", result: run.result, userError: run.userError };
      case "ended":
        break;
    }
    if (run.result.status === "done") return { outcome: "finished", result: run.result };
    if (subtask.lane === "ghost" && handoffDue(run.streaks)) {
      deps.logger.info("gui.handoff", { taskId: subtask.taskId, subtaskId: subtask.id, ...run.streaks });
      return { outcome: "handoff", result: run.result };
    }
    const attempts = deps.store.getSubtask(subtask.id)?.attempts ?? limits.attemptsPerSubtask;
    if (run.reason === "stepLimit" && attempts < limits.attemptsPerSubtask) {
      deps.logger.info("gui.nextAttempt", { taskId: subtask.taskId, subtaskId: subtask.id, attempts });
      continue;
    }
    return { outcome: "failed", result: run.result, ...(run.userError ? { userError: run.userError } : {}) };
  }
}
