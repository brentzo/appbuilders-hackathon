import { HEADER, docComment, pascal, primitiveAliases, screamingSnake, type Decl, type Model, type TypeRef } from "./model.ts";

export const KOTLIN_PACKAGE = "yumi.protocol";

/**
 * Kotlin names that would clash with names every Kotlin file imports by default. `Target` is
 * kotlin.annotation.Target, so the target window is AppTarget in Kotlin. The JSON is unchanged.
 */
const KOTLIN_RENAMES: Record<string, string> = { Target: "AppTarget" };

export function kotlinTypeName(name: string): string {
  return KOTLIN_RENAMES[name] ?? name;
}

const RESERVED = new Set([
  "as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if", "in", "interface", "is", "null",
  "object", "package", "return", "super", "this", "throw", "true", "try", "typealias", "typeof", "val", "var", "when", "while",
]);

function ident(name: string): string {
  return RESERVED.has(name) ? `\`${name}\`` : name;
}

/**
 * Emits kotlinx.serialization types. Decode with a Json configured as
 * `Json { explicitNulls = false }` so optional fields are omitted, not written as null.
 */
export function emitKotlin(model: Model): string {
  const aliases = primitiveAliases(model);
  const typeRef = (ref: TypeRef): string => {
    if (ref.kind === "primitive") return primitive(ref.type);
    if (ref.kind === "array") return `List<${typeRef(ref.items)}>`;
    const alias = aliases.get(ref.name);
    return alias ? primitive(alias) : kotlinTypeName(ref.name);
  };
  const unionsOf = new Map<string, string[]>();
  for (const d of model.decls) {
    if (d.kind === "union") for (const v of d.variants) unionsOf.set(v.struct, [...(unionsOf.get(v.struct) ?? []), kotlinTypeName(d.name)]);
  }

  const out: string[] = [
    `// ${HEADER}`,
    "@file:OptIn(ExperimentalSerializationApi::class)",
    "",
    `package ${KOTLIN_PACKAGE}`,
    "",
    "import kotlinx.serialization.ExperimentalSerializationApi",
    "import kotlinx.serialization.SerialName",
    "import kotlinx.serialization.Serializable",
    "import kotlinx.serialization.json.JsonClassDiscriminator",
    "",
  ];
  for (const decl of model.decls) {
    const lines = emitDecl(decl, typeRef, unionsOf.get(decl.name) ?? []);
    if (lines.length) out.push(...lines, "");
  }
  if (model.rpc) {
    out.push(...nameEnum("RpcMethod", "Every local RPC method name.", model.rpc.methods), "");
    out.push(...nameEnum("RpcEvent", "Every local RPC event name.", model.rpc.events), "");
  }
  return out.join("\n");
}

function nameEnum(name: string, doc: string, entries: { name: string }[]): string[] {
  return [
    `/** ${doc} */`,
    `enum class ${name}(val wireName: String) {`,
    ...entries.map((e, i) => `    ${pascal(e.name)}("${e.name}")${i === entries.length - 1 ? ";" : ","}`),
    "}",
  ];
}

function emitDecl(decl: Decl, typeRef: (ref: TypeRef) => string, unions: string[]): string[] {
  const doc = docComment(decl.doc, "", "block");
  const name = kotlinTypeName(decl.name);
  switch (decl.kind) {
    case "alias":
      return decl.constValue === undefined
        ? []
        : [...doc, `const val ${screamingSnake(decl.name)}: ${primitive(decl.type)} = ${constLiteral(decl.type, decl.constValue)}`];
    case "enum":
      return [
        ...doc,
        "@Serializable",
        `enum class ${name} {`,
        ...decl.values.map((v, i) => `    @SerialName("${v}") ${pascal(v)}${i === decl.values.length - 1 ? ";" : ","}`),
        "}",
      ];
    case "union":
      return [...doc, "@Serializable", `@JsonClassDiscriminator("${decl.discriminator}")`, `sealed interface ${name}`];
    case "struct": {
      const head = [...doc, "@Serializable", ...(decl.variantOf ? [`@SerialName("${decl.variantOf.value}")`] : [])];
      const supertypes = unions.length ? ` : ${unions.join(", ")}` : "";
      if (decl.fields.length === 0) return [...head, `data object ${name}${supertypes}`];
      const params = decl.fields.flatMap((f) => [
        ...docComment(f.doc, "    ", "block"),
        `    val ${ident(f.name)}: ${typeRef(f.type)}${f.optional ? "? = null" : ""},`,
      ]);
      return [...head, `data class ${name}(`, ...params, `)${supertypes}`];
    }
  }
}

function constLiteral(type: string, value: string | number): string {
  if (type === "integer") return `${value}L`;
  if (type === "number") return Number.isInteger(value) ? `${value}.0` : `${value}`;
  return JSON.stringify(value);
}

function primitive(type: string): string {
  return { string: "String", integer: "Long", number: "Double", boolean: "Boolean" }[type]!;
}
