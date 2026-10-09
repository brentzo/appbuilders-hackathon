import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { describeError, type Logger } from "../log.ts";

/**
 * The detailed debug log (SPEC-07 r22, OBJ-52): what `harness.log` leaves out on purpose, so a failed goal can be
 * explained from this file alone. Transcripts and the user's answers, every model request (messages, schema name)
 * and reply (content, timing, tokens), plans, and each step's observation, decision, and outcome.
 *
 * - It is written only while Debug mode is on. With it off, nothing is written and no file is made.
 * - One file a day in local time, `Debug log/<yyyy-mm-dd>.jsonl` in the support folder, one JSON object per line,
 *   readable only by this user. It never leaves the device: nothing in the harness reads it back or sends it.
 * - Files older than 7 days are deleted when the harness starts, and again each time a new day's file begins.
 * - Text typed or set into a password field never reaches it: callers pass a `Scrub` for anything that could hold
 *   one (`src/debug/scrub.ts`), and the Mac app never reads a secure field's value (SPEC-07 r20).
 *
 * Writing never throws: a full disk or a missing folder is logged once in `harness.log` and the entry is dropped,
 * because a debug log must never stop a task.
 */

export const DEBUG_LOG_FOLDER = "Debug log";
/** How long a day's file is kept, by its last change (SPEC-07 r22). */
export const DEBUG_LOG_DAYS = 7;
const FILE_NAME = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Rewrites one serialized entry before it is written, to remove text that must never be logged. */
export type Scrub = (line: string) => string;

export interface DebugLogOptions {
  /** The folder for the files: `<support folder>/Debug log`. */
  dir: string;
  enabled: boolean;
  /** `harness.log`, for the log's own problems and for Debug mode changes. */
  logger: Logger;
  now?: () => Date;
}

export class DebugLog {
  private on: boolean;
  private day: string | undefined;
  private requests = 0;
  private failed = false;
  private readonly now: () => Date;

  constructor(private readonly options: DebugLogOptions) {
    this.on = options.enabled;
    this.now = options.now ?? (() => new Date());
  }

  get dir(): string {
    return this.options.dir;
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Debug mode from the Mac app's setting (`setDebugMode`). */
  setEnabled(enabled: boolean): void {
    if (enabled === this.on) return;
    this.on = enabled;
    this.options.logger.info("debug.mode", { enabled, dir: this.options.dir });
  }

  /** A number for one model request, so its reply can be found: unique for this harness run. */
  nextRequestId(): number {
    return ++this.requests;
  }

  /** The path of today's file, whether or not it exists yet. */
  pathFor(date: Date = this.now()): string {
    return join(this.options.dir, `${localDay(date)}.jsonl`);
  }

  /** Appends one entry while Debug mode is on. `scrub` sees the whole serialized line. */
  write(event: string, fields: Record<string, unknown> = {}, scrub?: Scrub): void {
    if (!this.on) return;
    const now = this.now();
    try {
      const day = localDay(now);
      if (day !== this.day) {
        mkdirSync(this.options.dir, { recursive: true, mode: 0o700 });
        // A harness that runs for days still keeps only a week.
        if (this.day !== undefined) this.deleteOld();
        this.day = day;
      }
      let line = JSON.stringify({ time: now.toISOString(), event, ...fields });
      if (scrub) line = scrub(line);
      appendFileSync(join(this.options.dir, `${day}.jsonl`), `${line}\n`, { mode: 0o600 });
      this.failed = false;
    } catch (error) {
      if (this.failed) return;
      this.failed = true;
      this.options.logger.warn("debug.writeFailed", { entry: event, ...describeError(error) });
    }
  }

  /** Deletes the day files whose last change is more than 7 days ago. Returns their names. Runs in either mode. */
  deleteOld(): string[] {
    const cutoff = this.now().getTime() - DEBUG_LOG_DAYS * DAY_MS;
    let names: string[];
    try {
      names = readdirSync(this.options.dir);
    } catch {
      return [];
    }
    const deleted: string[] = [];
    for (const name of names) {
      if (!FILE_NAME.test(name)) continue;
      const path = join(this.options.dir, name);
      try {
        if (statSync(path).mtimeMs >= cutoff) continue;
        rmSync(path, { force: true });
        deleted.push(name);
      } catch (error) {
        this.options.logger.warn("debug.deleteFailed", { name, ...describeError(error) });
      }
    }
    if (deleted.length > 0) this.options.logger.info("debug.deletedOld", { files: deleted });
    return deleted;
  }
}

/** yyyy-mm-dd in local time, as the action log names its files. */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
