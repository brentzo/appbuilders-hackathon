import type { ChatMessage } from "../model/openai.ts";
import { MAX_PLAN_SUBTASKS } from "./check.ts";

/**
 * The planner's context (OBJ-05.1): the confirmed goal and the tools workers can use, and nothing from the screen,
 * so text on screen can never add a subtask (SPEC-07 r16). On the one retry, the rejected reply and the reason are
 * added so the planner can fix its own plan (OBJ-05.2).
 */

export const PLANNER_SYSTEM_PROMPT = [
  "You are Yumi's planner. You split the user's confirmed goal into subtasks that workers on a Mac carry out.",
  'Reply with exactly one JSON object and nothing else: {"subtasks": [...]}.',
  "",
  "Each subtask is:",
  '{"id": "read-1", "title": "...", "instruction": "...", "dependsOn": ["..."], "proposedLane": "helper" | "ghost" | "main"}',
  "- id: short, lower case letters, digits, and dashes, unique in the plan.",
  "- title: at most 60 characters, shown to the user while it runs.",
  "- instruction: one narrow job for one worker, with exact file paths and app names.",
  "- dependsOn: ids of the subtasks that must finish before this one starts. Empty when it can start right away.",
  '- proposedLane: "helper" for work with files and no app window, "ghost" for an app that can be controlled in the background, "main" for anything that needs the real mouse and keyboard.',
  "",
  "Rules:",
  `- Use as few subtasks as the goal needs, at most ${MAX_PLAN_SUBTASKS}.`,
  "- Subtasks that do not need each other's work have no dependency between them, so they run at the same time.",
  "- Workers never see each other's work. When a subtask needs what an earlier one produced, the earlier one writes it to a file and the later one reads that file. Name the same exact path in both instructions.",
  "- Workers can only use the tools listed. Do not plan work the tools cannot do.",
  "- Never plan anything the user did not ask for.",
].join("\n");

export interface PlannerTool {
  name: string;
  description: string;
}

export function buildPlannerMessages(confirmedGoal: string, tools: readonly PlannerTool[]): ChatMessage[] {
  const text = [
    `Goal: ${confirmedGoal}`,
    "",
    "Tools workers can use:",
    ...(tools.length > 0 ? tools.map((tool) => `- ${tool.name}: ${tool.description}`) : ["(none)"]),
    "",
    "The plan as JSON:",
  ].join("\n");
  return [
    { role: "system", content: PLANNER_SYSTEM_PROMPT },
    { role: "user", content: text },
  ];
}

/** The messages for the one retry: the first request, the rejected reply, and why it was rejected. */
export function buildPlannerRetryMessages(first: ChatMessage[], rejectedReply: string | null, error: string): ChatMessage[] {
  return [
    ...first,
    { role: "assistant", content: rejectedReply },
    { role: "user", content: `Your plan was rejected: ${error}\nReply again with the whole corrected plan as one JSON object.` },
  ];
}
