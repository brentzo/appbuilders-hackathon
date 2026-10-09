import { randomUUID } from "node:crypto";
import type { Plan, UserError, Uuid } from "@yumi/protocol/types";
import { userErrorForModelFailure } from "../errors.ts";
import type { Logger } from "../log.ts";
import type { ModelClient } from "../model/client.ts";
import type { JsonSchema } from "../agent/llm.ts";
import { bundleType } from "../schema/bundle.ts";
import type { NewSubtask } from "../store/task-store.ts";
import { checkPlan, MAX_PLAN_SUBTASKS } from "./check.ts";
import { buildPlannerMessages, buildPlannerRetryMessages, type PlannerTool } from "./prompt.ts";

/**
 * Turns a confirmed goal into a checked plan (OBJ-05.1, OBJ-05.2). A plan that fails the checks is sent back to the
 * planner once with the reason; if the second one fails too, there is no plan, and nothing reaches the scheduler.
 */

export type PlanResult =
  | { outcome: "ok"; plan: Plan }
  /** Both replies failed the checks. */
  | { outcome: "invalidPlan"; error: string }
  /** The model could not answer. `userError` is the SPEC-11 error to show. */
  | { outcome: "error"; userError: UserError }
  /** The caller cancelled. Nothing to show. */
  | { outcome: "aborted" };

export interface PlanOptions {
  taskId?: Uuid;
  signal?: AbortSignal;
}

/** One retry after the first rejected plan (OBJ-05.2). */
const MAX_REPLIES = 2;

export async function makePlan(
  confirmedGoal: string,
  tools: readonly PlannerTool[],
  deps: { client: ModelClient; logger: Logger },
  options: PlanOptions = {},
): Promise<PlanResult> {
  const first = buildPlannerMessages(confirmedGoal, tools);
  let messages = first;
  for (let reply = 1; ; reply++) {
    const answer = await deps.client.chat({
      messages,
      responseFormat: { name: "Plan", schema: planSchemaForModel() },
      signal: options.signal,
      purpose: "plan",
    });
    if (!answer.ok) {
      const userError = userErrorForModelFailure(answer.failure, options.taskId ? { taskId: options.taskId } : {});
      return userError ? { outcome: "error", userError } : { outcome: "aborted" };
    }

    const check = checkPlan(answer.content);
    if (check.ok) {
      deps.logger.info("plan.ok", { taskId: options.taskId, reply, subtasks: check.plan.subtasks.length });
      return { outcome: "ok", plan: check.plan };
    }
    deps.logger.warn("plan.rejected", { taskId: options.taskId, reply, finishReason: answer.finishReason, error: check.error });
    if (reply >= MAX_REPLIES) return { outcome: "invalidPlan", error: check.error };
    messages = buildPlannerRetryMessages(first, answer.content, check.error);
  }
}

/** The `Plan` schema sent to the model server, with the plan length limit, so decoding cannot exceed it. */
export function planSchemaForModel(): JsonSchema {
  const schema = bundleType("Plan", { forModel: true });
  const plan = (schema["$defs"] as Record<string, JsonSchema>)["Plan"]!;
  const subtasks = (plan["properties"] as Record<string, JsonSchema>)["subtasks"]!;
  subtasks["maxItems"] = MAX_PLAN_SUBTASKS;
  return schema;
}

/**
 * A checked plan as subtask records: each planned id becomes a Uuid, dependencies point at those Uuids, and a
 * subtask with no dependencies starts ready, the others pending (OBJ-05.3, OBJ-05.4).
 * `needsKeyboard` and `targetApp` are carried over for the router (SPEC-03 r2, r3, r17).
 */
export function subtasksFromPlan(plan: Plan): Omit<NewSubtask, "taskId">[] {
  const ids = new Map(plan.subtasks.map((s) => [s.id, randomUUID()]));
  return plan.subtasks.map((s) => ({
    id: ids.get(s.id)!,
    title: s.title,
    instruction: s.instruction,
    dependsOn: s.dependsOn.map((dependency) => ids.get(dependency)!),
    proposedLane: s.proposedLane,
    ...(s.needsKeyboard !== undefined ? { needsKeyboard: s.needsKeyboard } : {}),
    ...(s.targetApp !== undefined ? { targetApp: s.targetApp } : {}),
    status: s.dependsOn.length === 0 ? "ready" : "pending",
  }));
}
