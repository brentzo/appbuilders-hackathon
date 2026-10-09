import { homedir } from "node:os";
import { join } from "node:path";

/** Settings for the local OpenAI-compatible model server. */
export interface ModelConfig {
  /** Base URL of the OpenAI-compatible API, including `/v1`. */
  baseUrl: string;
  /** Model name sent with every request. */
  model: string;
  /** Give up on one request after this long. */
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  /** Send the output schema as `response_format` so the server constrains decoding (SPEC-05 r10). */
  structuredOutput: boolean;
}

export interface HarnessConfig {
  /** Where the socket and the log live: the user's Application Support folder on the Mac. */
  supportDir: string;
  socketPath: string;
  logPath: string;
  model: ModelConfig;
}

export const DEFAULT_SUPPORT_DIR = join(homedir(), "Library", "Application Support", "Yumi");

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "mlx-community/Qwen3.5-9B-4bit",
  timeoutMs: 120_000,
  maxTokens: 1024,
  // The Qwen3.5 model card's instruct (non-thinking) settings for general tasks.
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  structuredOutput: true,
};

/**
 * Reads the configuration from environment variables, falling back to the defaults:
 * YUMI_SUPPORT_DIR, YUMI_MODEL_BASE_URL, YUMI_MODEL, YUMI_MODEL_TIMEOUT_MS, YUMI_MODEL_MAX_TOKENS,
 * and YUMI_MODEL_STRUCTURED_OUTPUT ("0" turns schema-constrained decoding off).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  const supportDir = env["YUMI_SUPPORT_DIR"] || DEFAULT_SUPPORT_DIR;
  return {
    supportDir,
    socketPath: join(supportDir, "harness.sock"),
    logPath: join(supportDir, "harness.log"),
    model: {
      ...DEFAULT_MODEL_CONFIG,
      baseUrl: (env["YUMI_MODEL_BASE_URL"] || DEFAULT_MODEL_CONFIG.baseUrl).replace(/\/+$/, ""),
      model: env["YUMI_MODEL"] || DEFAULT_MODEL_CONFIG.model,
      timeoutMs: positiveInteger(env, "YUMI_MODEL_TIMEOUT_MS", DEFAULT_MODEL_CONFIG.timeoutMs),
      maxTokens: positiveInteger(env, "YUMI_MODEL_MAX_TOKENS", DEFAULT_MODEL_CONFIG.maxTokens),
      structuredOutput: env["YUMI_MODEL_STRUCTURED_OUTPUT"] !== "0",
    },
  };
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}
