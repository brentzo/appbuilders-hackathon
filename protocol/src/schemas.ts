import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SCHEMA_DIR = fileURLToPath(new URL("../schemas/", import.meta.url));

/** Annotation keywords used in the schemas. They carry metadata for generators and tests, not validation rules. */
export const ANNOTATION_KEYWORDS = ["x-rpc", "x-specRows"] as const;

export type JsonSchema = { [key: string]: unknown };

export interface SchemaFile {
  /** File name, for example "action.json". */
  file: string;
  /** The `$id`, used to resolve references between files. */
  id: string;
  schema: JsonSchema;
  /** Named types defined in this file, from `$defs`. */
  defs: Record<string, JsonSchema>;
}

/** Loads every schema file, sorted by name so output that depends on order is stable. */
export function loadSchemaFiles(dir: string = SCHEMA_DIR): SchemaFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => {
      const schema = JSON.parse(readFileSync(dir + file, "utf8")) as JsonSchema;
      const id = schema["$id"];
      if (typeof id !== "string") throw new Error(`${file} has no $id`);
      const defs = (schema["$defs"] ?? {}) as Record<string, JsonSchema>;
      return { file, id, schema, defs };
    });
}

/** Maps every type name to the file that defines it. Type names are unique across files. */
export function indexTypes(files: SchemaFile[]): Map<string, SchemaFile> {
  const index = new Map<string, SchemaFile>();
  for (const file of files) {
    for (const name of Object.keys(file.defs)) {
      const existing = index.get(name);
      if (existing) throw new Error(`Type ${name} is defined in both ${existing.file} and ${file.file}`);
      index.set(name, file);
    }
  }
  return index;
}
