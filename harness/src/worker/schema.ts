import type { Lane, ModelAction, WorkerInput } from "@yumi/protocol/types";
import type { JsonSchema } from "../agent/llm.ts";
import { bundleType } from "../schema/bundle.ts";
import { laneAllows } from "../router/lanes.ts";
import { ACTION, ACTION_TYPE_NAME, ELEMENT_ACTIONS } from "./actions.ts";

/**
 * The `WorkerOutput` schema sent to the model server for one step in `lane`, narrowed to what this step offers: only
 * the lane's actions (SPEC-03 r7), only the element numbers on screen, only the lane's tools, and the vision click
 * only when there is a screenshot. The server then cannot decode an action the step would reject. The reply is still
 * checked against the full protocol schema and the same rules afterwards (validate.ts), because not every server
 * constrains decoding. With `explain` (Debug mode), the model must also give a one-sentence `reason`.
 */
export function workerOutputSchemaFor(input: WorkerInput, lane: Lane, options: { explain?: boolean } = {}): JsonSchema {
  const schema = bundleType("WorkerOutput", { forModel: true });
  const defs = schema["$defs"] as Record<string, JsonSchema>;
  // In Debug mode the model writes its reason first, so the reason comes before the action it explains (SPEC-07
  // r23). Otherwise the reason is left out of the grammar, so it costs no tokens.
  const output = defs["WorkerOutput"]!;
  if (options.explain) output["required"] = ["reason", "action"];
  else delete (output["properties"] as Record<string, JsonSchema>)["reason"];
  const actions = defs["ModelAction"]!;
  const toolCall = defs["ToolCall"]!;
  const removeAction = (name: string) => {
    actions["oneOf"] = (actions["oneOf"] as JsonSchema[]).filter((variant) => variant["$ref"] !== `#/$defs/${name}`);
  };

  for (const [name, kind] of Object.entries(ACTION) as [keyof typeof ACTION, ModelAction["kind"]][]) {
    if (!laneAllows(lane, kind)) removeAction(ACTION_TYPE_NAME[name]);
  }

  const numbers = input.observation.elements.map((element) => element.n);
  if (numbers.length > 0) {
    defs["ElementNumber"] = { type: "integer", enum: numbers };
  } else {
    for (const name of ELEMENT_ACTIONS) removeAction(ACTION_TYPE_NAME[name]);
  }

  const allowed = new Set<string>(input.allowedTools);
  toolCall["oneOf"] = (toolCall["oneOf"] as JsonSchema[]).filter((variant) => {
    const name = String(variant["$ref"]).replace("#/$defs/", "");
    return allowed.has(toolName(defs[name]));
  });
  if ((toolCall["oneOf"] as JsonSchema[]).length === 0) removeAction(ACTION_TYPE_NAME.tool);

  if (!input.observation.screenshotPath) removeAction(ACTION_TYPE_NAME.clickAt);

  return pruneUnreachable(schema);
}

/** The `tool` const of a tool call, which sits in each `anyOf` shape when the bundle split an exactly-one rule. */
function toolName(call: JsonSchema | undefined): string {
  const shape = (call?.["anyOf"] as JsonSchema[] | undefined)?.[0] ?? call;
  return ((shape?.["properties"] as Record<string, JsonSchema> | undefined)?.["tool"]?.["const"] ?? "") as string;
}

/** Drops `$defs` no longer referenced after narrowing, so the grammar stays small. */
function pruneUnreachable(schema: JsonSchema): JsonSchema {
  const defs = schema["$defs"] as Record<string, JsonSchema>;
  const reachable = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") {
        const name = child.replace("#/$defs/", "");
        if (!reachable.has(name)) {
          reachable.add(name);
          visit(defs[name]);
        }
      } else {
        visit(child);
      }
    }
  };
  visit({ $ref: schema["$ref"] });
  return { ...schema, $defs: Object.fromEntries(Object.entries(defs).filter(([name]) => reachable.has(name))) };
}
