import { validate } from "@yumi/protocol";
import type { Plan, PlannedSubtask } from "@yumi/protocol/types";

/**
 * Checks the planner's reply (OBJ-05.1, OBJ-05.2): one JSON object that matches the protocol's `Plan` schema, with
 * no duplicate ids, no dependency on an id that is not in the plan, no dependency cycle, and no more than
 * `MAX_PLAN_SUBTASKS` subtasks. A plan that fails never reaches the scheduler. The error text goes back to the
 * planner on its one retry and into the log; it never reaches the user and never quotes the reply.
 */

/**
 * The most subtasks one plan may have. SPEC-02 sets no number. The goals Yumi demos need about 6 (five reads and a
 * note), and with 3 parallel slots, 12 is four rounds of work; a longer plan is more likely a planner mistake.
 */
export const MAX_PLAN_SUBTASKS = 12;

export type PlanCheck = { ok: true; plan: Plan } | { ok: false; error: string };

export function checkPlan(raw: string | null): PlanCheck {
  if (raw === null || raw.trim() === "") return { ok: false, error: "The reply was empty." };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The reply is not valid JSON. Reply with exactly one JSON object and nothing else." };
  }

  const result = validate("Plan", value);
  if (!result.valid) return { ok: false, error: `The plan does not match the plan schema: ${result.errors.join("; ")}.` };
  const plan = value as Plan;
  const problem = graphProblem(plan.subtasks);
  return problem ? { ok: false, error: problem } : { ok: true, plan };
}

function graphProblem(subtasks: readonly PlannedSubtask[]): string | undefined {
  if (subtasks.length > MAX_PLAN_SUBTASKS) {
    return `The plan has ${subtasks.length} subtasks; the most is ${MAX_PLAN_SUBTASKS}. Combine small steps into fewer subtasks.`;
  }

  const ids = new Set<string>();
  for (const subtask of subtasks) {
    if (ids.has(subtask.id)) return `The id "${subtask.id}" is used by more than one subtask. Give every subtask its own id.`;
    ids.add(subtask.id);
  }

  for (const subtask of subtasks) {
    for (const dependency of subtask.dependsOn) {
      if (dependency === subtask.id) return `Subtask "${subtask.id}" depends on itself. Remove it from its own dependsOn.`;
      if (!ids.has(dependency)) {
        return `Subtask "${subtask.id}" depends on "${dependency}", which is not in the plan. Use only ids from this plan.`;
      }
    }
  }

  const cycle = findCycle(subtasks);
  if (cycle)
    return `The dependencies form a cycle: ${cycle.join(" -> ")}. A subtask can only wait for work that does not wait for it.`;
  return undefined;
}

/** A dependency cycle as a list of ids that starts and ends with the same id, or undefined when there is none. */
export function findCycle(subtasks: readonly Pick<PlannedSubtask, "id" | "dependsOn">[]): string[] | undefined {
  const dependsOn = new Map(subtasks.map((s) => [s.id, s.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === "done") return undefined;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const next of dependsOn.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, "done");
    return undefined;
  };

  for (const { id } of subtasks) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return undefined;
}
