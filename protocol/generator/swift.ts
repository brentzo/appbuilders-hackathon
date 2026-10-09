import { HEADER, camel, docComment, primitiveAliases, screamingSnake, type Decl, type Model, type TypeRef } from "./model.ts";

/**
 * Swift names that would clash with names every Mac app sees. `Task` is Swift's concurrency type, so
 * the task record is TaskRecord in Swift. The JSON is unchanged.
 */
const SWIFT_RENAMES: Record<string, string> = { Task: "TaskRecord" };

export function swiftTypeName(name: string): string {
  return SWIFT_RENAMES[name] ?? name;
}

const RESERVED = new Set([
  "associatedtype", "class", "deinit", "enum", "extension", "func", "import", "init", "inout", "internal", "let",
  "operator", "private", "protocol", "public", "static", "struct", "subscript", "typealias", "var", "break", "case",
  "continue", "default", "defer", "do", "else", "fallthrough", "for", "guard", "if", "in", "repeat", "return",
  "switch", "where", "while", "as", "catch", "false", "is", "nil", "rethrows", "super", "self", "throw", "throws",
  "true", "try", "type", "Type", "Self",
]);

function ident(name: string): string {
  return RESERVED.has(name) ? `\`${name}\`` : name;
}

export function emitSwift(model: Model): string {
  const aliases = primitiveAliases(model);
  // Primitive aliases (Uuid, Path, ...) are written as their primitive, so they never clash with app names like SwiftUI's Path.
  const typeRef = (ref: TypeRef): string => {
    if (ref.kind === "primitive") return primitive(ref.type);
    if (ref.kind === "array") return `[${typeRef(ref.items)}]`;
    const alias = aliases.get(ref.name);
    return alias ? primitive(alias) : swiftTypeName(ref.name);
  };

  const out: string[] = [`// ${HEADER}`, "", "import Foundation", ""];
  for (const decl of model.decls) {
    const lines = emitDecl(decl, typeRef);
    if (lines.length) out.push(...lines, "");
  }
  if (model.rpc) {
    out.push(...nameEnum("RpcMethod", "Every local RPC method name.", model.rpc.methods), "");
    out.push(...nameEnum("RpcEvent", "Every local RPC event name.", model.rpc.events), "");
  }
  return out.join("\n");
}

function nameEnum(name: string, doc: string, entries: { name: string }[]): string[] {
  return [`/// ${doc}`, `public enum ${name}: String, CaseIterable, Sendable {`, ...entries.map((e) => `    case ${ident(e.name)}`), "}"];
}

function emitDecl(decl: Decl, typeRef: (ref: TypeRef) => string): string[] {
  const doc = docComment(decl.doc, "", "slashes");
  const name = swiftTypeName(decl.name);
  switch (decl.kind) {
    case "alias":
      return decl.constValue === undefined
        ? []
        : [...doc, `public let ${screamingSnake(decl.name)}: ${primitive(decl.type)} = ${JSON.stringify(decl.constValue)}`];
    case "enum":
      return [
        ...doc,
        `public enum ${name}: String, Codable, Equatable, Sendable, CaseIterable {`,
        ...decl.values.map((v) => (camel(v) === v ? `    case ${ident(v)}` : `    case ${ident(camel(v))} = ${JSON.stringify(v)}`)),
        "}",
      ];
    case "struct": {
      const lines = [...doc, `public struct ${name}: Codable, Equatable, Sendable {`];
      for (const f of decl.fields) {
        lines.push(...docComment(f.doc, "    ", "slashes"), `    public var ${ident(f.name)}: ${typeRef(f.type)}${f.optional ? "?" : ""}`);
      }
      const params = decl.fields.map((f) => `${ident(f.name)}: ${typeRef(f.type)}${f.optional ? "? = nil" : ""}`);
      lines.push("", `    public init(${params.join(", ")}) {`);
      for (const f of decl.fields) lines.push(`        self.${f.name} = ${ident(f.name)}`);
      lines.push("    }", "}");
      return lines;
    }
    case "union":
      return emitUnion(decl, name, doc);
  }
}

function emitUnion(decl: Extract<Decl, { kind: "union" }>, name: string, doc: string[]): string[] {
  const caseName = (value: string) => ident(camel(value));
  const lines = [...doc, `public enum ${name}: Codable, Equatable, Sendable {`];
  for (const v of decl.variants) lines.push(`    case ${caseName(v.value)}(${swiftTypeName(v.struct)})`);
  lines.push(
    "",
    "    private enum DiscriminatorKey: String, CodingKey {",
    `        case discriminator = ${JSON.stringify(decl.discriminator)}`,
    "    }",
    "",
    "    public init(from decoder: Decoder) throws {",
    "        let container = try decoder.container(keyedBy: DiscriminatorKey.self)",
    "        let value = try container.decode(String.self, forKey: .discriminator)",
    "        switch value {",
    ...decl.variants.map((v) => `        case ${JSON.stringify(v.value)}: self = .${caseName(v.value)}(try ${swiftTypeName(v.struct)}(from: decoder))`),
    "        default:",
    `            throw DecodingError.dataCorruptedError(forKey: .discriminator, in: container, debugDescription: "Unknown ${decl.name} ${decl.discriminator}: \\(value)")`,
    "        }",
    "    }",
    "",
    "    public func encode(to encoder: Encoder) throws {",
    "        var container = encoder.container(keyedBy: DiscriminatorKey.self)",
    "        switch self {",
  );
  for (const v of decl.variants) {
    lines.push(
      `        case .${caseName(v.value)}(let value):`,
      `            try container.encode(${JSON.stringify(v.value)}, forKey: .discriminator)`,
      "            try value.encode(to: encoder)",
    );
  }
  lines.push("        }", "    }", "}");
  return lines;
}

function primitive(type: string): string {
  return { string: "String", integer: "Int", number: "Double", boolean: "Bool" }[type]!;
}
