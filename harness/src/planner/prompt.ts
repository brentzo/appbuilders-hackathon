import { join } from "node:path";
import type { ChatMessage } from "../model/openai.ts";
import { MAX_PLAN_SUBTASKS } from "./check.ts";

/**
 * The planner's context (OBJ-05.1): the confirmed goal, the user's real folders, and the tools workers can use, and
 * nothing from the screen, so text on screen can never add a subtask (SPEC-07 r16). Without the folders, the model
 * made up a home folder (`/Users/Yumi`, Brent's run, 2026-10-10). On the one retry, the rejected reply and the reason are
 * added so the planner can fix its own plan (OBJ-05.2).
 */

export const PLANNER_SYSTEM_PROMPT = [
  "You are Yumi's planner. You split the user's confirmed goal into subtasks that workers on a Mac carry out.",
  'Reply with exactly one JSON object and nothing else: {"subtasks": [...]}.',
  "",
  "Each subtask is:",
  '{"id": "read-1", "title": "...", "instruction": "...", "dependsOn": ["..."], "proposedLane": "helper" | "ghost" | "main", "targetApp": {"name": "Keynote"}, "needsKeyboard": true}',
  "- id: short, lower case letters, digits, and dashes, unique in the plan.",
  "- title: at most 60 characters, shown to the user while it runs.",
  "- instruction: one narrow job for one worker, with exact file paths and app names.",
  "- dependsOn: ids of the subtasks that must finish before this one starts. Empty when it can start right away.",
  '- proposedLane: "helper" for work with files and no app window, "ghost" for an app that can be controlled in the background, "main" for anything that needs the real mouse and keyboard.',
  '- targetApp: the app whose window the subtask works in, by the name the user sees, for example {"name": "Keynote"}. Leave it out for work with files and no app window.',
  '- Writing, reading, listing, copying, or moving files is "helper" work with no targetApp, even when the goal names a folder or Finder. Use Finder only when the user wants to see something in a Finder window.',
  "- needsKeyboard: true when the subtask types text or uses keyboard shortcuts, for example to paste or press Command-S. Leave it out otherwise.",
  "",
  "Rules:",
  `- Use as few subtasks as the goal needs, at most ${MAX_PLAN_SUBTASKS}.`,
  "- Subtasks that do not need each other's work have no dependency between them, so they run at the same time.",
  "- Workers never see each other's work. When a subtask needs what an earlier one produced, the earlier one writes it to a file and the later one reads that file. Name the same exact path in both instructions.",
  "- Every file path is an absolute path inside the user's home folder, built from the folders listed. Never make up a user name or a home folder.",
  "- Workers can only use the tools listed. Do not plan work the tools cannot do.",
  "- Never plan anything the user did not ask for.",
].join("\n");

export interface PlannerTool {
  name: string;
  description: string;
}

/** The user's folders the planner is told about, by name, all inside the home folder. */
export const PLANNER_FOLDERS = ["Documents", "Desktop", "Downloads"] as const;

export function buildPlannerMessages(confirmedGoal: string, tools: readonly PlannerTool[], home: string): ChatMessage[] {
  const text = [
    `Goal: ${confirmedGoal}`,
    "",
    "The user's folders:",
    `- Home folder: ${home}`,
    ...PLANNER_FOLDERS.map((folder) => `- ${folder}: ${join(home, folder)}`),
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
