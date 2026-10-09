import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerInput } from "@yumi/protocol/types";
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from "../src/config.ts";

export const PROTOCOL_DIR = fileURLToPath(new URL("../../protocol/", import.meta.url));

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

/** A bare JSON-RPC client: one JSON message per line, as the contract says. */
export async function rawClient(path: string) {
  const socket: Socket = await new Promise((resolve, reject) => {
    const s = connect(path, () => resolve(s)).once("error", reject);
  });
  socket.setEncoding("utf8");
  const lines: unknown[] = [];
  let buffer = "";
  const waiters: (() => void)[] = [];
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      lines.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
      waiters.splice(0).forEach((w) => w());
    }
  });
  return {
    send: (message: unknown) => socket.write(`${JSON.stringify(message)}\n`),
    next: async (): Promise<unknown> => {
      while (lines.length === 0) await new Promise<void>((resolve) => waiters.push(resolve));
      return lines.shift();
    },
    close: () => socket.destroy(),
  };
}
