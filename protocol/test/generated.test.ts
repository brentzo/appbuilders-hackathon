import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_DIR, generateAll } from "../generator/index.ts";
import { loadSchemaFiles, type SchemaFile } from "../src/schemas.ts";

function fileWith(defs: Record<string, unknown>): SchemaFile {
  return { file: "test.json", id: "https://yumi.local/protocol/test.json", schema: { $defs: defs }, defs: defs as SchemaFile["defs"] };
}

describe("generated types", () => {
  it("are up to date with the schemas (run `npm run generate` if this fails)", () => {
    for (const [path, content] of generateAll(loadSchemaFiles())) {
      expect(readFileSync(GENERATED_DIR + path, "utf8"), path).toBe(content);
    }
  });

  it("turn a discriminated union into a real sum type in every language", () => {
    const out = generateAll(loadSchemaFiles());
    expect(out.get("ts/index.ts")).toContain("export type ModelAction =\n  | ClickAction\n  | SetValueAction");
    expect(out.get("ts/index.ts")).toContain('  kind: "click";');
    expect(out.get("swift/YumiProtocol.swift")).toContain("public enum ModelAction: Codable, Equatable, Sendable {");
    expect(out.get("swift/YumiProtocol.swift")).toContain("    case click(ClickAction)");
    expect(out.get("kotlin/yumi/protocol/YumiProtocol.kt")).toContain('@JsonClassDiscriminator("kind")\nsealed interface ModelAction');
    expect(out.get("kotlin/yumi/protocol/YumiProtocol.kt")).toContain('@SerialName("click")\ndata class ClickAction(');
  });

  it("rename types that clash with names every Swift or Kotlin file already sees", () => {
    const out = generateAll(loadSchemaFiles());
    const swift = out.get("swift/YumiProtocol.swift")!;
    const kotlin = out.get("kotlin/yumi/protocol/YumiProtocol.kt")!;
    expect(swift).toContain("public struct TaskRecord: Codable");
    expect(swift).not.toMatch(/public struct Task:/);
    expect(kotlin).toContain("data class AppTarget(");
    expect(kotlin).not.toMatch(/class Target\(/);
    expect(kotlin).toContain("val target: AppTarget,");
  });

  it("refuse schema constructs they cannot represent faithfully", () => {
    expect(() => generateAll([fileWith({ Loose: { anyOf: [{ type: "string" }, { type: "integer" }] } })])).toThrow(/anyOf/);
    expect(() => generateAll([fileWith({ Open: { type: "object", properties: { a: { type: "string" } } } })])).toThrow(
      /additionalProperties/,
    );
    expect(() =>
      generateAll([fileWith({ Nested: { type: "object", additionalProperties: false, properties: { a: { type: "object" } } } })]),
    ).toThrow(/inline object/);
  });

  it("refuse a const property outside a union variant, where it would silently vanish from Swift and Kotlin", () => {
    const loneConst = { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "x" } } };
    expect(() => generateAll([fileWith({ LoneConst: loneConst })])).toThrow(/const/);
    const twoConsts = {
      type: "object",
      additionalProperties: false,
      properties: { kind: { const: "a" }, other: { const: "b" } },
    };
    expect(() => generateAll([fileWith({ TwoConsts: twoConsts })])).toThrow(/const/);
  });

  it("refuse the same type name in two files", () => {
    const a = fileWith({ Same: { type: "string" } });
    const b = { ...fileWith({ Same: { type: "string" } }), file: "other.json" };
    expect(() => generateAll([a, b])).toThrow(/Same/);
  });

  it("refuse RPC names that are not identifiers, and an unknown direction", () => {
    const rpcFile = (rpc: unknown) => ({
      ...fileWith({ Empty: { type: "object", additionalProperties: false, properties: {} } }),
      schema: { "x-rpc": rpc },
    });
    const method = (name: string, direction = "appToHarness") => ({
      methods: { [name]: { direction, params: "Empty", result: "Empty" } },
      events: {},
      errorData: "Empty",
    });
    expect(() => generateAll([rpcFile(method("bad-name"))])).toThrow(/bad-name/);
    expect(() => generateAll([rpcFile(method("fine", "sideways"))])).toThrow(/sideways/);
    expect(() => generateAll([rpcFile({ methods: {} })])).toThrow(/events/);
    expect(() => generateAll([rpcFile({ methods: {}, events: {}, errorData: "Missing" })])).toThrow(/errorData/);
  });

  it("keep multi-line descriptions inside comments, and type number constants correctly", () => {
    const out = generateAll([
      fileWith({
        Ratio: { description: "first line\nsecond line", type: "number", const: 1 },
      }),
    ]);
    const swift = out.get("swift/YumiProtocol.swift")!;
    expect(swift).toContain("/// first line\n/// second line");
    expect(swift).toContain("public let RATIO: Double = 1");
    expect(out.get("kotlin/yumi/protocol/YumiProtocol.kt")).toContain("const val RATIO: Double = 1.0");
  });
});
