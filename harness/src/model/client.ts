import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ModelConfig } from "../config.ts";
import type { DebugLog, Scrub } from "../debug/debug-log.ts";
import { describeError, type Logger } from "../log.ts";
import type { ChatContentPart, ChatErrorBody, ChatMessage, ChatRequest, ChatResponse, ChatTool, ChatToolCall } from "./openai.ts";

/**
 * Client for the local OpenAI-compatible model server (mlx-vlm running Qwen3.5-9B at 4-bit). It never throws for
 * a model or transport failure: it returns a structured `ModelFailure`, logs the technical detail, and leaves the
 * user-facing wording to the error mapping (SPEC-11).
 */

export type ModelFailure =
  /** Nothing answered at the base URL: the server is not running, crashed, or is still starting. */
  | { kind: "unreachable" }
  /** The server took longer than the configured timeout. */
  | { kind: "timeout" }
  /** The caller cancelled the request. */
  | { kind: "aborted" }
  /** The server answered with an HTTP error. The detail is in the log only. */
  | { kind: "httpError"; status: number }
  /** The server answered 200 with a body that is not a chat completion. */
  | { kind: "badResponse" };

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type ChatResult =
  | {
      ok: true;
      /** The reply text. Null when the model only called tools. */
      content: string | null;
      toolCalls: ChatToolCall[];
      /** "stop", "length", or "tool_calls". */
      finishReason: string;
      usage: Usage;
      durationMs: number;
    }
  | { ok: false; failure: ModelFailure; durationMs: number };

export interface ChatOptions {
  messages: ChatMessage[];
  /** Constrains decoding to this JSON Schema when the config allows it. */
  responseFormat?: { name: string; schema: Record<string, unknown> };
  tools?: ChatTool[];
  signal?: AbortSignal | undefined;
  /** What the call is for, for the log, for example "workerStep". */
  purpose: string;
  /** The task and subtask the call is for, for both logs. */
  taskId?: string | undefined;
  subtaskId?: string | undefined;
  /** How the debug log keeps password text out of this request and its reply (`src/debug/scrub.ts`). */
  redact?: { reply(content: string | null): string | null; scrub: Scrub } | undefined;
}

export type FetchFn = typeof fetch;

export class ModelClient {
  constructor(
    readonly config: ModelConfig,
    private readonly logger: Logger,
    private readonly fetchFn: FetchFn = fetch,
    /** The detailed debug log: every request and reply in full while Debug mode is on (SPEC-07 r22). */
    private readonly debug?: DebugLog,
    /** Told about every failed request, so model readiness notices a server that went away (OBJ-47.3). */
    private readonly onFailure?: (failure: ModelFailure) => void,
  ) {}

  async chat(options: ChatOptions): Promise<ChatResult> {
    const body: ChatRequest = {
      model: this.config.model,
      messages: options.messages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      top_p: this.config.topP,
      top_k: this.config.topK,
      stream: false,
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
      ...(options.responseFormat && this.config.structuredOutput
        ? { response_format: { type: "json_schema", json_schema: options.responseFormat } }
        : {}),
      ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
    };
    const images = options.messages.reduce(
      (count, m) => count + (Array.isArray(m.content) ? m.content.filter((p) => p.type === "image_url").length : 0),
      0,
    );
    const request = {
      purpose: options.purpose,
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.subtaskId ? { subtaskId: options.subtaskId } : {}),
      model: this.config.model,
      messages: options.messages.length,
      images,
      structuredOutput: body.response_format !== undefined,
      tools: options.tools?.length ?? 0,
    };

    const trace = this.trace(options, body);

    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      return this.fail(
        classifyFetchError(error, options.signal, timeout),
        elapsed(),
        { ...request, ...describeError(error) },
        trace,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (!response.ok) return this.fail({ kind: "httpError", status: response.status }, elapsed(), request, trace);
      const failure = classifyFetchError(error, options.signal, timeout);
      return this.fail(
        failure.kind === "unreachable" ? { kind: "badResponse" } : failure,
        elapsed(),
        { ...request, ...describeError(error) },
        trace,
      );
    }

    if (!response.ok) {
      return this.fail(
        { kind: "httpError", status: response.status },
        elapsed(),
        { ...request, status: response.status, detail: (payload as Partial<ChatErrorBody> | null)?.detail },
        trace,
      );
    }

    const choice = readChoice(payload);
    if (!choice) return this.fail({ kind: "badResponse" }, elapsed(), request, trace);

    const durationMs = elapsed();
    const raw = (payload as ChatResponse).usage;
    const usage: Usage = {
      promptTokens: raw?.prompt_tokens ?? 0,
      completionTokens: raw?.completion_tokens ?? 0,
      totalTokens: raw?.total_tokens ?? 0,
    };
    this.logger.info("model.reply", {
      ...request,
      durationMs,
      finishReason: choice.finishReason,
      ...usage,
      contentChars: choice.content?.length ?? 0,
      toolCalls: choice.toolCalls.length,
    });
    trace?.("model.reply", {
      durationMs,
      finishReason: choice.finishReason,
      ...usage,
      content: options.redact ? options.redact.reply(choice.content) : choice.content,
      ...(choice.toolCalls.length > 0 ? { toolCalls: choice.toolCalls } : {}),
    });
    return { ok: true, ...choice, usage, durationMs };
  }

  private fail(failure: ModelFailure, durationMs: number, fields: Record<string, unknown>, trace?: Trace): ChatResult {
    const level = failure.kind === "aborted" ? "info" : "error";
    this.logger[level]("model.failure", { failure: failure.kind, durationMs, ...fields });
    trace?.("model.failure", { durationMs, ...fields, failure: failure.kind });
    this.onFailure?.(failure);
    return { ok: false, failure, durationMs };
  }

  /**
   * Writes the request to the debug log while Debug mode is on, and returns how to write its reply under the same
   * request number. Images are written as their type and size, not their data.
   */
  private trace(options: ChatOptions, body: ChatRequest): Trace | undefined {
    const debug = this.debug;
    if (!debug?.enabled) return undefined;
    const ids = {
      requestId: debug.nextRequestId(),
      purpose: options.purpose,
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.subtaskId ? { subtaskId: options.subtaskId } : {}),
    };
    const scrub = options.redact?.scrub;
    debug.write(
      "model.request",
      {
        ...ids,
        model: body.model,
        schema: options.responseFormat?.name ?? null,
        structuredOutput: body.response_format !== undefined,
        maxTokens: body.max_tokens,
        messages: body.messages.map(withoutImageData),
        ...(options.tools && options.tools.length > 0 ? { tools: options.tools.map((t) => t.function.name) } : {}),
      },
      scrub,
    );
    return (event, fields) => debug.write(event, { ...ids, ...fields }, scrub);
  }
}

type Trace = (event: string, fields: Record<string, unknown>) => void;

/** A message for the debug log: an image's data URL becomes "[image image/png, 412 KB]". */
function withoutImageData(message: ChatMessage): ChatMessage {
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== "image_url") return part;
      const url = part.image_url.url;
      const type = /^data:([^;,]+)/.exec(url)?.[1] ?? "unknown type";
      const kb = Math.round(((url.length - url.indexOf(",") - 1) * 0.75) / 1024);
      return { type: "text", text: `[image ${type}, ${kb} KB]` };
    }),
  } as ChatMessage;
}

/** Tells a timeout, a cancel, and an unreachable server apart from the error's structure, never its message. */
function classifyFetchError(error: unknown, callerSignal: AbortSignal | undefined, timeout: AbortSignal): ModelFailure {
  if (callerSignal?.aborted) return { kind: "aborted" };
  if (timeout.aborted) return { kind: "timeout" };
  return { kind: "unreachable" };
}

function readChoice(payload: unknown): { content: string | null; toolCalls: ChatToolCall[]; finishReason: string } | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const choice = choices[0] as { finish_reason?: unknown; message?: { content?: unknown; tool_calls?: unknown } };
  const message = choice.message;
  if (!message || typeof message !== "object") return undefined;
  const content = message.content ?? null;
  if (content !== null && typeof content !== "string") return undefined;
  const toolCalls = message.tool_calls ?? [];
  if (!Array.isArray(toolCalls) || !toolCalls.every(isToolCall)) return undefined;
  return { content, toolCalls, finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "stop" };
}

function isToolCall(value: unknown): value is ChatToolCall {
  const call = value as Partial<ChatToolCall> | null;
  return (
    !!call &&
    typeof call.id === "string" &&
    typeof call.function?.name === "string" &&
    typeof call.function.arguments === "string"
  );
}

/** An image for the model, from a file (PNG, JPEG, or WebP) or from base64 data. */
export type ImageInput = { path: string } | { data: string; mimeType: string };

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Builds an image content part as a data URL, which mlx-vlm decodes itself. */
export async function imagePart(image: ImageInput): Promise<ChatContentPart> {
  if ("data" in image) return { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } };
  const mimeType = IMAGE_TYPES[extname(image.path).toLowerCase()];
  if (!mimeType) throw new Error(`Unsupported image type: ${image.path}`);
  const data = await readFile(image.path);
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${data.toString("base64")}` } };
}
