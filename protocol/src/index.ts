import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { ANNOTATION_KEYWORDS, indexTypes, loadSchemaFiles } from "./schemas.ts";

export { RpcFailure, RpcPeer } from "./rpc.ts";
export type { Handler } from "./rpc.ts";
export { loadSchemaFiles, indexTypes } from "./schemas.ts";
export {
  RpcPeer,
  RpcFailure,
  RpcRemoteError,
  RpcErrorCode,
  loadRpcContract,
  type Handler,
  type RpcContract,
  type RpcErrorObject,
  type RpcPeerOptions,
  type RpcRole,
} from "./rpc.ts";

export interface ValidationResult {
  valid: boolean;
  /** One line per problem, with the JSON path where it was found. Empty when valid. */
  errors: string[];
}

const files = loadSchemaFiles();
const types = indexTypes(files);

// strictRequired is off because conditional rules ("a delete requires files") name properties defined one level up.
const ajv = new Ajv2020.default({ strict: true, strictRequired: false, allErrors: true, discriminator: true });
addFormats.default(ajv);
ajv.addVocabulary([...ANNOTATION_KEYWORDS]);
for (const file of files) ajv.addSchema(file.schema);

const compiled = new Map<string, ValidateFunction>();

/** Every type name that can be validated. */
export const typeNames: readonly string[] = [...types.keys()].sort();

/** Validates a value against a named protocol type, for example "ModelAction" or "Task". */
export function validate(typeName: string, value: unknown): ValidationResult {
  let check = compiled.get(typeName);
  if (!check) {
    const file = types.get(typeName);
    if (!file) throw new Error(`Unknown protocol type: ${typeName}`);
    check = ajv.compile({ $ref: `${file.id}#/$defs/${typeName}` });
    compiled.set(typeName, check);
  }
  const valid = check(value);
  return { valid, errors: valid ? [] : formatErrors(check.errors ?? []) };
}

function formatErrors(errors: ErrorObject[]): string[] {
  return errors.map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}
