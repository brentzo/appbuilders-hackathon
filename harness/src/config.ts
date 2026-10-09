import { homedir } from "node:os";
import { join, resolve } from "node:path";

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
  /**
   * How many requests the server decodes at once, and so how many subtasks the scheduler runs at the same time.
   * mlx-vlm decodes concurrent requests in one continuous batch; start it with `--max-num-seqs` set to this value.
   */
  parallelSlots: number;
}

/** The limits that stop runaway work (SPEC-02 r8, docs/task-record-schema.md "Limits"). */
export interface Limits {
  /** Steps per subtask, across all its attempts. Reaching it fails the subtask with `taskTookTooLong`. */
  stepsPerSubtask: number;
  /** Attempts per subtask: one `gui_act` call is one attempt. The protocol's `Subtask.attempts` allows at most 3. */
  attemptsPerSubtask: number;
  /** How deep subtasks may nest: 1 means only the planner makes subtasks, and a subtask can never make one. */
  subtaskDepth: number;
}

export interface HarnessConfig {
  /** Where the socket, the log, and the task store live: the user's Application Support folder on the Mac. */
  supportDir: string;
  socketPath: string;
  logPath: string;
  model: ModelConfig;
  limits: Limits;
  /** How many cursors may be visible at once, including `main` (SPEC-03 r6). More UI subtasks queue. */
  cursorCap: number;
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
  parallelSlots: 3,
};

export const DEFAULT_LIMITS: Limits = {
  stepsPerSubtask: 25,
  attemptsPerSubtask: 3,
  subtaskDepth: 1,
};

/** Visible cursors, including `main` (SPEC-03 r6). */
export const DEFAULT_CURSOR_CAP = 3;

/** The most attempts a subtask can record (`Subtask.attempts` in protocol/schemas/task.json). */
export const MAX_ATTEMPTS_PER_SUBTASK = 3;

/**
 * Reads the configuration from environment variables, falling back to the defaults:
 * YUMI_SUPPORT_DIR, YUMI_MODEL_BASE_URL, YUMI_MODEL, YUMI_MODEL_TIMEOUT_MS, YUMI_MODEL_MAX_TOKENS,
 * YUMI_MODEL_STRUCTURED_OUTPUT ("0" turns schema-constrained decoding off), YUMI_MODEL_PARALLEL_SLOTS, and the
 * limits YUMI_STEPS_PER_SUBTASK, YUMI_ATTEMPTS_PER_SUBTASK (at most 3), and YUMI_SUBTASK_DEPTH, and the cursor cap
 * YUMI_CURSOR_CAP.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  const supportDir = resolve(env["YUMI_SUPPORT_DIR"] || DEFAULT_SUPPORT_DIR);
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
      parallelSlots: positiveInteger(env, "YUMI_MODEL_PARALLEL_SLOTS", DEFAULT_MODEL_CONFIG.parallelSlots),
    },
    limits: {
      stepsPerSubtask: positiveInteger(env, "YUMI_STEPS_PER_SUBTASK", DEFAULT_LIMITS.stepsPerSubtask),
      attemptsPerSubtask: positiveInteger(
        env,
        "YUMI_ATTEMPTS_PER_SUBTASK",
        DEFAULT_LIMITS.attemptsPerSubtask,
        MAX_ATTEMPTS_PER_SUBTASK,
      ),
      subtaskDepth: positiveInteger(env, "YUMI_SUBTASK_DEPTH", DEFAULT_LIMITS.subtaskDepth),
    },
    cursorCap: positiveInteger(env, "YUMI_CURSOR_CAP", DEFAULT_CURSOR_CAP),
  };
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? "a positive integer" : `a whole number from 1 to ${max}`;
    throw new Error(`${name} must be ${range}, got "${raw}"`);
  }
  return value;
}
