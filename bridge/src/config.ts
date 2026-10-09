import { resolve } from "node:path";

export interface RelayConfig {
  host: string;
  port: number;
  databasePath: string;
  revision: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    host: env["BRIDGE_HOST"] || "0.0.0.0",
    port: positiveInteger(env["BRIDGE_PORT"], 8787, "BRIDGE_PORT"),
    databasePath: resolve(env["BRIDGE_DATABASE_PATH"] || "/data/bridge.sqlite"),
    revision: env["BRIDGE_REVISION"] || "unknown",
  };
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`${name} must be an integer from 0 to 65535`);
  return value;
}
