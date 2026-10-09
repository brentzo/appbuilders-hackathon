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

/**
 * The two property names of an "exactly one of A or B" conditional, `if: {required: [A]}, then: {not: {required:
 * [B]}}, else: {required: [B]}`, as `TargetApp` and `OpenAppCall` use it for bundleId or name. Undefined for any
 * other shape.
 */
function exactlyOneOf(entry: unknown): [string, string] | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const { if: ifSchema, then: thenSchema, else: elseSchema, ...rest } = entry as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return undefined;
  const required = (schema: unknown): string | undefined => {
    if (schema === null || typeof schema !== "object") return undefined;
    const keys = Object.keys(schema);
    const list = (schema as { required?: unknown }).required;
    return keys.length === 1 && Array.isArray(list) && list.length === 1 && typeof list[0] === "string" ? list[0] : undefined;
  };
  const a = required(ifSchema);
  const b = required(elseSchema);
  const notB =
    thenSchema !== null && typeof thenSchema === "object" && Object.keys(thenSchema).length === 1
      ? required((thenSchema as { not?: unknown }).not)
      : undefined;
  return a && b && notB === b && a !== b ? [a, b] : undefined;
}

/**
 * For the model, an object that must have exactly one of two properties becomes an `anyOf` of the two shapes, each
 * with its own property and every shared one. Dropping the conditional alone would let the grammar produce an object
 * with neither, which the full schema then rejects, so the planner failed every time it named an app. Other
 * conditionals are dropped as before.
 */
function exactlyOneAsAnyOf(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  const allOf = schema.allOf;
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!Array.isArray(allOf) || allOf.length !== 1 || schema.additionalProperties !== false || !properties) return undefined;
  const pair = exactlyOneOf(allOf[0]);
  if (!pair || !pair.every((name) => name in properties)) return undefined;
  const { allOf: _allOf, properties: _properties, required, additionalProperties: _additional, ...rest } = schema;
  const shared = Object.fromEntries(Object.entries(properties).filter(([name]) => !pair.includes(name)));
  const sharedRequired = Array.isArray(required) ? required.filter((name) => !pair.includes(name)) : [];
  return {
    ...rest,
    anyOf: pair.map((name) => ({
      type: "object",
      additionalProperties: false,
      required: [...sharedRequired, name],
      properties: { ...shared, [name]: properties[name] },
    })),
  };
}

function rewrite(value: unknown, options: BundleOptions, onRef: (name: string) => void): unknown {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, options, onRef));
  if (value === null || typeof value !== "object") return value;
  const object = (options.forModel && exactlyOneAsAnyOf(value as Record<string, unknown>)) || value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
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
