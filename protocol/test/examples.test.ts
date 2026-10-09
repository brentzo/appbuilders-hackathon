import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readModel } from "../generator/model.ts";
import { loadSchemaFiles, typeNames, validate } from "../src/index.ts";

const EXAMPLE_DIR = fileURLToPath(new URL("../examples/", import.meta.url));

/** Example files are named <TypeName>.<label>.json. */
const examples = readdirSync(EXAMPLE_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((file) => ({ file, type: file.split(".")[0]! }));

describe("examples", () => {
  it.each(examples)("$file is a valid $type", ({ file, type }) => {
    expect(typeNames).toContain(type);
    const value: unknown = JSON.parse(readFileSync(EXAMPLE_DIR + file, "utf8"));
    expect(validate(type, value).errors).toEqual([]);
  });

  it("include every object and union type on its own (union variants are covered through their union)", () => {
    const exampleTypes = new Set(examples.map((e) => e.type));
    const { decls } = readModel(loadSchemaFiles());
    const missing = decls
      .filter((d) => (d.kind === "struct" && !d.variantOf) || d.kind === "union")
      .map((d) => d.name)
      .filter((name) => !exampleTypes.has(name));
    expect(missing).toEqual([]);
  });

  it("show every variant of every union at least once, anywhere in the examples", () => {
    const seen = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === "object") {
        for (const [key, v] of Object.entries(value)) {
          if (typeof v === "string") seen.add(`${key}=${v}`);
          walk(v);
        }
      }
    };
    for (const { file } of examples) walk(JSON.parse(readFileSync(EXAMPLE_DIR + file, "utf8")));
    const { decls } = readModel(loadSchemaFiles());
    const missing = decls.flatMap((d) =>
      d.kind === "union" ? d.variants.filter((v) => !seen.has(`${d.discriminator}=${v.value}`)).map((v) => `${d.name}.${v.value}`) : [],
    );
    expect(missing).toEqual([]);
  });
});
