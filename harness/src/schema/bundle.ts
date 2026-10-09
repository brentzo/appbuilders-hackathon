import { indexTypes, loadSchemaFiles } from "@yumi/protocol";
import type { JsonSchema } from "../agent/llm.ts";

/**
 * Turns one protocol type into a self-contained JSON Schema: the type and every type it references, from any
 * schema file, under one `$defs`, with every `$ref` pointing inside the bundle. The model server and the tool
 * registry need a single schema; the protocol keeps them split across files.
 */

const files = loadSchemaFiles();
const types = indexTypes(files);

/**
 * Keywords the model server's grammar compiler rejects. mlx-vlm 0.7.6 compiles `response_format` schemas with
 * llguidance 1.9.1, which fails the whole request with "Unimplemented keys: [\"uniqueItems\"]", and the same for the
 * conditionals (`if`, `then`, `else`) protocol version 3 uses, for example on `OpenAppCall`.
 */
const MODEL_UNSUPPORTED_KEYWORDS = new Set(["uniqueItems", "if", "then", "else"]);

export interface BundleOptions {
  /**
   * For schema-constrained decoding: drops the keywords the grammar compiler rejects. The output is still checked
   * against the full protocol schema afterwards, so a looser grammar never lets an invalid value through.
   */
  forModel?: boolean;
}

export function bundleType(typeName: string, options: BundleOptions = {}): JsonSchema {
  const defs: Record<string, JsonSchema> = {};
  const pending = [typeName];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (defs[name]) continue;
    const file = types.get(name);
    if (!file) throw new Error(`Unknown protocol type: ${name}`);
    const schema = file.defs[name]!;
    defs[name] = rewrite(schema, options, (ref) => pending.push(ref)) as JsonSchema;
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $ref: `#/$defs/${typeName}`, $defs: sortKeys(defs) };
}

/** The type name a protocol `$ref` points at: "common.json#/$defs/Uuid" and "#/$defs/Uuid" both give "Uuid". */
function refTarget(ref: string): string {
  const match = /^(?:[\w.-]+\.json)?#\/\$defs\/([\w]+)$/.exec(ref);
  if (!match) throw new Error(`Unsupported $ref: ${ref}`);
  return match[1]!;
}

function rewrite(value: unknown, options: BundleOptions, onRef: (name: string) => void): unknown {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, options, onRef));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("x-")) continue;
    if (options.forModel && MODEL_UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "$ref" && typeof child === "string") {
      const target = refTarget(child);
      onRef(target);
      out[key] = `#/$defs/${target}`;
    } else if (key === "properties" && child && typeof child === "object") {
      // Property names are data, not keywords, so they are never stripped.
      out[key] = Object.fromEntries(Object.entries(child).map(([name, sub]) => [name, rewrite(sub, options, onRef)]));
    } else {
      out[key] = rewrite(child, options, onRef);
    }
  }
  return out;
}

function sortKeys(record: Record<string, JsonSchema>): Record<string, JsonSchema> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
