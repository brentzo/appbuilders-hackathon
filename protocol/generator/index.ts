import { fileURLToPath } from "node:url";
import type { SchemaFile } from "../src/schemas.ts";
import { emitKotlin } from "./kotlin.ts";
import { readModel } from "./model.ts";
import { emitSwift } from "./swift.ts";
import { emitTypeScript } from "./typescript.ts";

export { swiftTypeName } from "./swift.ts";
export { KOTLIN_PACKAGE, kotlinTypeName } from "./kotlin.ts";

export const GENERATED_DIR = fileURLToPath(new URL("../generated/", import.meta.url));

/** Generates every output file, keyed by its path under generated/. */
export function generateAll(files: SchemaFile[]): Map<string, string> {
  const model = readModel(files);
  return new Map([
    ["ts/index.ts", emitTypeScript(model)],
    ["swift/YumiProtocol.swift", emitSwift(model)],
    ["kotlin/yumi/protocol/YumiProtocol.kt", emitKotlin(model)],
  ]);
}
