import type { ModelState } from "@yumi/protocol/types";
import type { ModelConfig } from "../config.ts";
import { describeError, type Logger } from "../log.ts";
import type { FetchFn, ModelFailure } from "./client.ts";

/**
 * Tracks whether the local model server is ready (OBJ-47), so the Mac app can say "Yumi is getting ready" instead of
 * looking frozen while Qwen3.5-9B loads.
 *
 * mlx-vlm 0.7.6 started with `--model` loads the model before it accepts connections (`lifespan` in
 * `mlx_vlm/server/app.py`), so while it loads nothing answers. Once it answers, `GET /health` reports
 * `{"status":"healthy","loaded_model":"<repo id>"}`. The state is:
 * - `loading` from the start, and again whenever the server stops answering, until `/health` names the configured model;
 * - `ready` while it does;
 * - `failed` when nothing answered within the load timeout, or the server serves another model.
 * It keeps checking in every state, so a server started or restarted late still ends in `ready`.
 */

export interface ModelReadinessOptions {
  config: Pick<ModelConfig, "baseUrl" | "model">;
  logger: Logger;
  fetchFn?: FetchFn;
  /** How long the server may take to answer before the state is `failed`. */
  loadTimeoutMs?: number;
  /** How often to check while `loading` or `failed`. */
  pollMs?: number;
  /** How often to check while `ready`, to notice a server that went away between requests. */
  readyPollMs?: number;
  /** How long one `/health` request may take. */
  requestTimeoutMs?: number;
}

/** About 2.5 minutes: a 9B model at 4-bit loads in well under a minute from disk; the rest is margin for a slow Mac. */
export const DEFAULT_MODEL_LOAD_TIMEOUT_MS = 150_000;

type Check =
  /** `/health` named this model, or none (a server started without `--model` loads the requested one on demand). */
  | { kind: "serving"; model: string | null }
  /** Nothing answered: not started, still loading, or crashed. */
  | { kind: "unreachable" }
  /** Something answered, but not in time or not with a health report. The state stays as it is. */
  | { kind: "inconclusive" };

export class ModelReadiness {
  private current: ModelState = "loading";
  /** When the server was last seen gone, or when tracking started: the load timeout counts from here. */
  private loadingSince = Date.now();
  private readonly listeners = new Set<(state: ModelState) => void>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private checking: Promise<void> | undefined;
  private readonly fetchFn: FetchFn;
  private readonly loadTimeoutMs: number;
  private readonly pollMs: number;
  private readonly readyPollMs: number;
  private readonly requestTimeoutMs: number;
  private readonly healthUrl: string;

  constructor(private readonly options: ModelReadinessOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_MODEL_LOAD_TIMEOUT_MS;
    this.pollMs = options.pollMs ?? 1_000;
    this.readyPollMs = options.readyPollMs ?? 3_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 2_000;
    // The config's base URL includes `/v1`; mlx-vlm serves `/health` at the root.
    this.healthUrl = `${options.config.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/health`;
  }

  get state(): ModelState {
    return this.current;
  }

  /** Calls `listener` on every change of state. Returns how to stop. */
  onChange(listener: (state: ModelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts checking at once. */
  start(): this {
    if (this.running) return this;
    this.running = true;
    this.loadingSince = Date.now();
    this.options.logger.info("model.readiness.started", { healthUrl: this.healthUrl, loadTimeoutMs: this.loadTimeoutMs });
    void this.checkNow();
    return this;
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Called with every failed model request. An unreachable server is checked at once, so a server that went away
   * mid-run turns the state back to `loading` without waiting for the next poll.
   */
  noteFailure(failure: ModelFailure): void {
    if (failure.kind === "unreachable" && this.running) void this.checkNow();
  }

  /** Checks once now, unless a check is already running. Resolves when that check is done. */
  checkNow(): Promise<void> {
    this.checking ??= this.check().finally(() => {
      this.checking = undefined;
      this.schedule();
    });
    return this.checking;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => void this.checkNow(), this.current === "ready" ? this.readyPollMs : this.pollMs);
    this.timer.unref();
  }

  private async check(): Promise<void> {
    const result = await this.probe();
    if (!this.running) return;
    switch (result.kind) {
      case "serving":
        if (result.model === null || sameModel(result.model, this.options.config.model)) {
          if (result.model === null && this.current !== "ready") {
            this.options.logger.warn("model.readiness.noModelLoaded", { configured: this.options.config.model });
          }
          return this.set("ready");
        }
        this.options.logger.error("model.readiness.otherModel", {
          configured: this.options.config.model,
          loaded: result.model,
        });
        return this.set("failed");
      case "unreachable":
        // A server that answered before and is gone now restarted or crashed: count its load time from now.
        if (this.current === "ready") {
          this.loadingSince = Date.now();
          return this.set("loading");
        }
        if (this.current === "loading" && Date.now() - this.loadingSince >= this.loadTimeoutMs) {
          this.options.logger.error("model.readiness.timedOut", { loadTimeoutMs: this.loadTimeoutMs });
          return this.set("failed");
        }
        return;
      case "inconclusive":
        return;
    }
  }

  private async probe(): Promise<Check> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(this.healthUrl, { signal: timeout });
    } catch {
      // A busy server can be slow to answer; only a refused or dropped connection means it is gone.
      return timeout.aborted ? { kind: "inconclusive" } : { kind: "unreachable" };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      this.options.logger.warn("model.readiness.badHealth", { status: response.status, ...describeError(error) });
      return { kind: "inconclusive" };
    }
    if (!response.ok || !body || typeof body !== "object") {
      this.options.logger.warn("model.readiness.badHealth", { status: response.status });
      return { kind: "inconclusive" };
    }
    const loaded = (body as { loaded_model?: unknown }).loaded_model;
    return { kind: "serving", model: typeof loaded === "string" ? loaded : null };
  }

  private set(state: ModelState): void {
    if (state === this.current) return;
    this.options.logger.info("model.readiness.changed", { from: this.current, to: state });
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }
}

/** mlx-vlm reports the model as it was given: a Hugging Face repo id, or a local path that ends in it. */
function sameModel(loaded: string, configured: string): boolean {
  const trim = (s: string) => s.replace(/\/+$/, "");
  return trim(loaded) === trim(configured) || trim(loaded).endsWith(`/${trim(configured)}`);
}
