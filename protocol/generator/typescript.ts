import { HEADER, docComment, screamingSnake, type Decl, type Model, type TypeRef } from "./model.ts";

export function emitTypeScript(model: Model): string {
  const out: string[] = [`// ${HEADER}`, ""];
  for (const decl of model.decls) out.push(...emitDecl(decl), "");
  if (model.rpc) {
    out.push("/** Every local RPC method, with its direction, params, and result. */", "export interface RpcMethods {");
    for (const m of model.rpc.methods) {
      out.push(`  ${m.name}: { direction: "${m.direction}"; params: ${m.params}; result: ${m.result} };`);
    }
    out.push("}", "", "/** Every local RPC event (a JSON-RPC notification from the harness), with its payload. */", "export interface RpcEvents {");
    for (const e of model.rpc.events) out.push(`  ${e.name}: ${e.payload};`);
    out.push("}", "");
  }
  return out.join("\n");
}

function emitDecl(decl: Decl): string[] {
  const doc = docComment(decl.doc, "", "block");
  switch (decl.kind) {
    case "alias": {
      if (decl.constValue === undefined) return [...doc, `export type ${decl.name} = ${primitive(decl.type)};`];
      const constant = screamingSnake(decl.name);
      return [...doc, `export const ${constant} = ${JSON.stringify(decl.constValue)};`, `export type ${decl.name} = typeof ${constant};`];
    }
    case "enum": {
      const literals = decl.values.map((v) => JSON.stringify(v));
      const valuesName = `${decl.name.charAt(0).toLowerCase()}${decl.name.slice(1)}Values`;
      return [...doc, `export type ${decl.name} = ${literals.join(" | ")};`, `export const ${valuesName}: readonly ${decl.name}[] = [${literals.join(", ")}];`];
    }
    case "union":
      return [...doc, `export type ${decl.name} =`, ...decl.variants.map((v, i) => `  | ${v.struct}${i === decl.variants.length - 1 ? ";" : ""}`)];
    case "struct": {
      const lines = [...doc, `export interface ${decl.name} {`];
      if (decl.variantOf) lines.push(`  ${decl.variantOf.property}: ${JSON.stringify(decl.variantOf.value)};`);
      for (const f of decl.fields) lines.push(...docComment(f.doc, "  ", "block"), `  ${f.name}${f.optional ? "?" : ""}: ${typeRef(f.type)};`);
      lines.push("}");
      return lines;
    }
  }
}

function typeRef(ref: TypeRef): string {
  if (ref.kind === "primitive") return primitive(ref.type);
  if (ref.kind === "named") return ref.name;
  return `${typeRef(ref.items)}[]`;
}

function primitive(type: string): string {
  return type === "integer" || type === "number" ? "number" : type;
}
