import type { WorkerInput } from "@yumi/protocol/types";
import type { JsonSchema } from "../agent/llm.ts";
import { bundleType } from "../schema/bundle.ts";
import { ACTION_TYPE_NAME, ELEMENT_ACTIONS } from "./actions.ts";

/**
 * The `WorkerOutput` schema sent to the model server for one step, narrowed to what this step offers: only the
 * element numbers on screen, only the lane's tools, and the vision click only when there is a screenshot. The
 * server then cannot decode an action the step would reject. The reply is still checked against the full protocol
 * schema and the same rules afterwards (validate.ts), because not every server constrains decoding.
 */
export function workerOutputSchemaFor(input: WorkerInput): JsonSchema {
  const schema = bundleType("WorkerOutput", { forModel: true });
  const defs = schema["$defs"] as Record<string, JsonSchema>;
  const actions = defs["ModelAction"]!;
  const toolCall = defs["ToolCall"]!;
  const removeAction = (name: string) => {
    actions["oneOf"] = (actions["oneOf"] as JsonSchema[]).filter((variant) => variant["$ref"] !== `#/$defs/${name}`);
  };

  const numbers = input.observation.elements.map((element) => element.n);
  if (numbers.length > 0) {
    defs["ElementNumber"] = { type: "integer", enum: numbers };
  } else {
    for (const name of ELEMENT_ACTIONS) removeAction(ACTION_TYPE_NAME[name]);
  }

  const allowed = new Set<string>(input.allowedTools);
  toolCall["oneOf"] = (toolCall["oneOf"] as JsonSchema[]).filter((variant) => {
    const name = String(variant["$ref"]).replace("#/$defs/", "");
    const tool = ((defs[name]?.["properties"] as Record<string, JsonSchema> | undefined)?.["tool"]?.["const"] ?? "") as string;
    return allowed.has(tool);
  });
  if ((toolCall["oneOf"] as JsonSchema[]).length === 0) removeAction(ACTION_TYPE_NAME.tool);

  if (!input.observation.screenshotPath) removeAction(ACTION_TYPE_NAME.visionClick);

  return pruneUnreachable(schema);
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
