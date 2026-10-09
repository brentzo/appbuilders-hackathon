import type { JsonSchema, SchemaFile } from "../src/schemas.ts";

/**
 * A language-neutral model of the schemas. The reader accepts only the subset of JSON Schema that maps
 * faithfully to TypeScript, Swift, and Kotlin, and throws on anything else, so a schema can never silently
 * generate a looser type than it validates.
 */

export type Primitive = "string" | "integer" | "number" | "boolean";

export type TypeRef = { kind: "primitive"; type: Primitive } | { kind: "named"; name: string } | { kind: "array"; items: TypeRef };

export interface Field {
  name: string;
  type: TypeRef;
  optional: boolean;
  doc?: string;
}

export interface Variant {
  /** The discriminator value, for example "axPress". */
  value: string;
  /** The struct that holds the variant's other fields. */
  struct: string;
}

export type Decl =
  | { kind: "alias"; name: string; doc?: string; type: Primitive; constValue?: string | number }
  | { kind: "enum"; name: string; doc?: string; values: string[] }
  | { kind: "struct"; name: string; doc?: string; fields: Field[]; variantOf?: { property: string; value: string } }
  | { kind: "union"; name: string; doc?: string; discriminator: string; variants: Variant[] };

export type RpcDirection = "appToHarness" | "harnessToApp";

export interface RpcModel {
  methods: { name: string; direction: RpcDirection; params: string; result: string }[];
  events: { name: string; payload: string }[];
}

export interface Model {
  decls: Decl[];
  rpc?: RpcModel;
}

/** Keywords the reader understands. Constraint-only keywords among them are enforced by Ajv and do not change the types. */
const KNOWN_KEYWORDS = new Set([
  "$schema", "$id", "title", "description", "$comment", "format", "pattern", "minLength", "maxLength",
  "minimum", "maximum", "minItems", "maxItems", "uniqueItems", "required", "if", "then", "else", "allOf",
  "additionalProperties", "properties", "type", "items", "$ref", "enum", "const", "oneOf", "discriminator", "$defs",
]);
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;
const ENUM_VALUE = /^[a-z][A-Za-z0-9_]*$/;
const RPC_DIRECTIONS: readonly RpcDirection[] = ["appToHarness", "harnessToApp"];

/** A union as read from its schema, before its variant structs are known. */
interface PendingUnion {
  kind: "pendingUnion";
  name: string;
  doc?: string;
  discriminator: string;
  structs: string[];
}

export function readModel(files: SchemaFile[]): Model {
  const read: (Decl | PendingUnion)[] = [];
  const definedIn = new Map<string, string>();
  for (const file of files) {
    for (const [name, schema] of Object.entries(file.defs)) {
      const other = definedIn.get(name);
      if (other) throw new Error(`Type ${name} is defined in both ${other} and ${file.file}`);
      definedIn.set(name, file.file);
      read.push(readDecl(name, schema));
    }
  }
  const decls = resolveUnions(read).sort((a, b) => a.name.localeCompare(b.name));
  checkReferences(decls);
  const rpcFile = files.find((f) => f.schema["x-rpc"]);
  return rpcFile ? { decls, rpc: readRpc(rpcFile.schema["x-rpc"] as JsonSchema, decls) } : { decls };
}

function readDecl(name: string, schema: JsonSchema): Decl | PendingUnion {
  if (!IDENTIFIER.test(name)) throw new Error(`${name}: type names must be identifiers`);
  checkKeywords(name, schema);
  const doc = schema["description"] as string | undefined;
  const base = doc ? { name, doc } : { name };

  if (schema["oneOf"]) {
    const discriminator = (schema["discriminator"] as { propertyName?: string } | undefined)?.propertyName;
    if (!discriminator) throw new Error(`${name}: oneOf needs a discriminator`);
    const structs = (schema["oneOf"] as JsonSchema[]).map((item) => refName(name, item));
    return { kind: "pendingUnion", ...base, discriminator, structs };
  }
  if (schema["enum"]) {
    const values = schema["enum"] as unknown[];
    for (const v of values) {
      if (typeof v !== "string" || !ENUM_VALUE.test(v)) throw new Error(`${name}: enum value ${String(v)} is not supported`);
    }
    return { kind: "enum", ...base, values: values as string[] };
  }
  const type = schema["type"];
  if (type === "object") return readStruct(base, schema);
  if (type === "string" || type === "integer" || type === "number" || type === "boolean") {
    const constValue = schema["const"] as string | number | undefined;
    return constValue === undefined ? { kind: "alias", ...base, type } : { kind: "alias", ...base, type, constValue };
  }
  throw new Error(`${name}: unsupported schema; use an object, an enum, a primitive, or a oneOf with a discriminator`);
}

function readStruct(base: { name: string; doc?: string }, schema: JsonSchema): Decl {
  const name = base.name;
  if (schema["additionalProperties"] !== false) throw new Error(`${name}: objects must set additionalProperties to false`);
  const required = new Set((schema["required"] as string[] | undefined) ?? []);
  const properties = (schema["properties"] ?? {}) as Record<string, JsonSchema>;
  const fields: Field[] = [];
  let variantOf: { property: string; value: string } | undefined;
  for (const [fieldName, prop] of Object.entries(properties)) {
    const at = `${name}.${fieldName}`;
    if (!IDENTIFIER.test(fieldName)) throw new Error(`${at}: property names must be identifiers`);
    if ("const" in prop) {
      if (typeof prop["const"] !== "string" || Object.keys(prop).length !== 1 || !required.has(fieldName)) {
        throw new Error(`${at}: a const property must be a required, bare string const, used as a union discriminator`);
      }
      if (variantOf) throw new Error(`${at}: only one const property is allowed, the union discriminator`);
      variantOf = { property: fieldName, value: prop["const"] };
      continue;
    }
    const doc = prop["description"] as string | undefined;
    const field: Field = { name: fieldName, type: readTypeRef(at, prop), optional: !required.has(fieldName) };
    fields.push(doc ? { ...field, doc } : field);
  }
  return variantOf ? { kind: "struct", ...base, fields, variantOf } : { kind: "struct", ...base, fields };
}

function readTypeRef(at: string, schema: JsonSchema): TypeRef {
  checkKeywords(at, schema);
  if (schema["$ref"]) return { kind: "named", name: refName(at, schema) };
  const type = schema["type"];
  if (type === "array") {
    if (!schema["items"]) throw new Error(`${at}: arrays need items`);
    return { kind: "array", items: readTypeRef(`${at}[]`, schema["items"] as JsonSchema) };
  }
  if (type === "object") throw new Error(`${at}: inline object; give it a name in $defs`);
  if (schema["enum"] || schema["oneOf"]) throw new Error(`${at}: inline enum or union; give it a name in $defs`);
  if (type === "string" || type === "integer" || type === "number" || type === "boolean") return { kind: "primitive", type };
  throw new Error(`${at}: unsupported property schema`);
}

function refName(at: string, schema: JsonSchema): string {
  const ref = schema["$ref"];
  const match = typeof ref === "string" ? /#\/\$defs\/([A-Za-z0-9]+)$/.exec(ref) : null;
  if (!match) throw new Error(`${at}: references must point at a $defs entry`);
  return match[1]!;
}

function checkKeywords(where: string, schema: JsonSchema): void {
  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(key) && !key.startsWith("x-")) throw new Error(`${where}: unsupported keyword ${key}`);
  }
}

/**
 * Builds each union from its variant structs, taking the discriminator values from their const properties.
 * A struct with a const property must be a variant of some union, or its const would vanish in Swift and Kotlin.
 */
function resolveUnions(read: (Decl | PendingUnion)[]): Decl[] {
  const structs = new Map(read.flatMap((d) => (d.kind === "struct" ? [[d.name, d] as const] : [])));
  const usedAsVariant = new Set<string>();
  const decls = read.map((d): Decl => {
    if (d.kind !== "pendingUnion") return d;
    const variants = d.structs.map((structName) => {
      const struct = structs.get(structName);
      if (!struct?.variantOf) throw new Error(`${d.name}: variant ${structName} must be an object with a const ${d.discriminator}`);
      if (struct.variantOf.property !== d.discriminator) {
        throw new Error(`${d.name}: variant ${structName} uses ${struct.variantOf.property}, not ${d.discriminator}`);
      }
      usedAsVariant.add(structName);
      return { value: struct.variantOf.value, struct: structName };
    });
    const union: Decl = { kind: "union", name: d.name, discriminator: d.discriminator, variants };
    return d.doc ? { ...union, doc: d.doc } : union;
  });
  for (const struct of structs.values()) {
    if (struct.variantOf && !usedAsVariant.has(struct.name)) {
      throw new Error(`${struct.name}: has a const property but is not a variant of any union`);
    }
  }
  return decls;
}

function checkReferences(decls: Decl[]): void {
  const names = new Set(decls.map((d) => d.name));
  const check = (from: string, ref: TypeRef): void => {
    if (ref.kind === "named" && !names.has(ref.name)) throw new Error(`${from}: unknown type ${ref.name}`);
    if (ref.kind === "array") check(from, ref.items);
  };
  for (const decl of decls) if (decl.kind === "struct") for (const f of decl.fields) check(`${decl.name}.${f.name}`, f.type);
}

function readRpc(raw: JsonSchema, decls: Decl[]): RpcModel {
  const names = new Set(decls.map((d) => d.name));
  const section = (key: string) => {
    const value = raw[key];
    if (!value || typeof value !== "object") throw new Error(`x-rpc needs a ${key} object`);
    return Object.entries(value as Record<string, unknown>);
  };
  const name = (value: string, what: string) => {
    if (!IDENTIFIER.test(value)) throw new Error(`x-rpc ${what} ${value}: names must be identifiers`);
    return value;
  };
  const type = (value: unknown, at: string) => {
    if (typeof value !== "string" || !names.has(value)) throw new Error(`x-rpc ${at}: unknown type ${String(value)}`);
    return value;
  };
  const methods = section("methods").map(([methodName, raw]) => {
    const m = raw as { direction?: unknown; params?: unknown; result?: unknown };
    if (!RPC_DIRECTIONS.includes(m.direction as RpcDirection)) {
      throw new Error(`x-rpc method ${methodName}: direction ${String(m.direction)} must be ${RPC_DIRECTIONS.join(" or ")}`);
    }
    return {
      name: name(methodName, "method"),
      direction: m.direction as RpcDirection,
      params: type(m.params, methodName),
      result: type(m.result, methodName),
    };
  });
  const events = section("events").map(([eventName, payload]) => ({ name: name(eventName, "event"), payload: type(payload, eventName) }));
  type(raw["errorData"], "errorData");
  return { methods, events };
}

// Helpers shared by the emitters.

export function camel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function pascal(value: string): string {
  const c = camel(value);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function screamingSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/** Primitive aliases (Uuid, Path, ...) by name, for languages that write them as their primitive. */
export function primitiveAliases(model: Model): Map<string, Primitive> {
  return new Map(model.decls.flatMap((d) => (d.kind === "alias" ? [[d.name, d.type] as const] : [])));
}

/** A doc comment, one comment line per description line, so a newline can never end the comment early. */
export function docComment(doc: string | undefined, indent: string, style: "block" | "slashes"): string[] {
  if (!doc) return [];
  const lines = doc.split("\n").map((l) => l.replaceAll("*/", "* /"));
  if (style === "slashes") return lines.map((l) => `${indent}/// ${l}`.trimEnd());
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`.trimEnd()), `${indent} */`];
}

export const HEADER = "Generated by protocol/scripts/generate.ts from protocol/schemas. Do not edit by hand.";
