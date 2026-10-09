import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const EXAMPLE_DIR = fileURLToPath(new URL("../examples/", import.meta.url));

/**
 * The example value for a type, from examples/<Type>.<label>.json. With no label, the first example
 * in name order. Mocks answer with these, so mock data is always a valid, reviewed example.
 */
export function exampleOf(type: string, label?: string): unknown {
  const files = readdirSync(EXAMPLE_DIR)
    .filter((f) => f.startsWith(`${type}.`) && f.endsWith(".json") && (label === undefined || f === `${type}.${label}.json`))
    .sort();
  const file = files[0];
  if (!file) throw new Error(`No example for ${type}${label ? `.${label}` : ""} in protocol/examples`);
  return JSON.parse(readFileSync(EXAMPLE_DIR + file, "utf8"));
}

/** Resolves "Type.label" or "Type" to its example. */
export function exampleByName(name: string): unknown {
  const dot = name.indexOf(".");
  return dot < 0 ? exampleOf(name) : exampleOf(name.slice(0, dot), name.slice(dot + 1));
}
