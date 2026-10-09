import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkerInput } from "@yumi/protocol/types";
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from "../src/config.ts";

export const PROTOCOL_DIR = new URL("../../protocol/", import.meta.url).pathname;

export function modelConfig(baseUrl: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
  return { ...DEFAULT_MODEL_CONFIG, baseUrl, ...overrides };
}

/** The protocol's example step: Keynote, five elements, three allowed tools. */
export function exampleWorkerInput(): WorkerInput {
  return JSON.parse(readFileSync(join(PROTOCOL_DIR, "examples", "WorkerInput.keynote-export.json"), "utf8")) as WorkerInput;
}

/** A temporary folder, removed by the returned cleanup. Short, because Unix socket paths are limited to 104 bytes. */
export function tempDir(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "yumi-"));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}
