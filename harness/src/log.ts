import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The harness's local log: technical detail for the team (model errors, timing, token counts), one JSON object
 * per line. Nothing here is ever shown to the user (SPEC-11 r1 and r2). Never log prompts, screen text, file
 * contents, or secrets: only sizes, timings, codes, and error detail.
 */
export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  event: string;
  [field: string]: unknown;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

abstract class BaseLogger implements Logger {
  protected abstract write(entry: LogEntry): void;

  info(event: string, fields?: Record<string, unknown>): void {
    this.write(entry("info", event, fields));
  }

  warn(event: string, fields?: Record<string, unknown>): void {
    this.write(entry("warn", event, fields));
  }

  error(event: string, fields?: Record<string, unknown>): void {
    this.write(entry("error", event, fields));
  }
}

/** Appends to a log file, creating its folder. Writes are synchronous so the last lines survive a crash. */
export class FileLogger extends BaseLogger {
  constructor(readonly path: string) {
    super();
    mkdirSync(dirname(path), { recursive: true });
  }

  protected write(entry: LogEntry): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }
}

/** Keeps entries in memory, for tests. */
export class MemoryLogger extends BaseLogger {
  readonly entries: LogEntry[] = [];

  protected write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

function entry(level: LogLevel, event: string, fields: Record<string, unknown> = {}): LogEntry {
  return { time: new Date().toISOString(), level, event, ...fields };
}

/** Log fields for an unknown thrown value: its type, code, and message, never its payload. */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  const cause = (error as { cause?: unknown }).cause;
  return {
    errorName: error.name,
    errorMessage: error.message,
    ...((error as { code?: unknown }).code !== undefined ? { errorCode: (error as { code?: unknown }).code } : {}),
    ...(cause !== undefined ? { cause: describeError(cause) } : {}),
  };
}
