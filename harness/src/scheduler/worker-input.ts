import type { Observation, Step, StepSummary, ToolName, WorkerInput } from "@yumi/protocol/types";

/**
 * Builds a worker's input for one step exactly as SPEC-02 r5 says, and nothing else: the confirmed goal, the
 * subtask instruction, the last steps of this subtask, a fresh observation, and the lane's tools. No other
 * subtask's steps, no transcript, and no results from other workers ever go in (OBJ-05.5, OBJ-05.6).
 */

/** How many earlier steps a worker sees: the most SPEC-02 r5 allows ("the last 3-5 steps"). */
export const RECENT_STEPS = 5;

export interface WorkerInputSource {
  confirmedGoal: string;
  instruction: string;
  /** This subtask's steps, in order. Only finished steps are passed on. */
  steps: readonly Step[];
  /** Taken just now, for this step. */
  observation: Observation;
  tools: readonly ToolName[];
}

export function buildWorkerInput(source: WorkerInputSource): WorkerInput {
  return {
    confirmedGoal: source.confirmedGoal,
    instruction: source.instruction,
    recentSteps: source.steps.filter(isFinished).slice(-RECENT_STEPS).map(summarizeStep),
    observation: source.observation,
    allowedTools: [...source.tools],
  };
}

function isFinished(step: Step): step is Step & { outcome: NonNullable<Step["outcome"]> } {
  return step.outcome !== undefined;
}

/** A step as the next worker sees it: the action, one line on what changed, the outcome, and what its tool returned. */
function summarizeStep(step: Step & { outcome: NonNullable<Step["outcome"]> }): StepSummary {
  return {
    action: step.action.action,
    observation: step.observation ?? "",
    outcome: step.outcome,
    ...(step.toolOutput !== undefined ? { toolOutput: step.toolOutput } : {}),
  };
}
