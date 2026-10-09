import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ModelConfig } from "../config.ts";
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
}

export type FetchFn = typeof fetch;

export class ModelClient {
  constructor(
    readonly config: ModelConfig,
    private readonly logger: Logger,
    private readonly fetchFn: FetchFn = fetch,
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
      model: this.config.model,
      messages: options.messages.length,
      images,
      structuredOutput: body.response_format !== undefined,
      tools: options.tools?.length ?? 0,
    };

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
      return this.fail(classifyFetchError(error, options.signal, timeout), elapsed(), { ...request, ...describeError(error) });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (!response.ok) return this.fail({ kind: "httpError", status: response.status }, elapsed(), request);
      const failure = classifyFetchError(error, options.signal, timeout);
      return this.fail(failure.kind === "unreachable" ? { kind: "badResponse" } : failure, elapsed(), {
        ...request,
        ...describeError(error),
      });
    }

    if (!response.ok) {
      return this.fail({ kind: "httpError", status: response.status }, elapsed(), {
        ...request,
        status: response.status,
        detail: (payload as Partial<ChatErrorBody> | null)?.detail,
      });
    }

    const choice = readChoice(payload);
    if (!choice) return this.fail({ kind: "badResponse" }, elapsed(), request);

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
    return { ok: true, ...choice, usage, durationMs };
  }

  private fail(failure: ModelFailure, durationMs: number, fields: Record<string, unknown>): ChatResult {
    const level = failure.kind === "aborted" ? "info" : "error";
    this.logger[level]("model.failure", { failure: failure.kind, durationMs, ...fields });
    return { ok: false, failure, durationMs };
  }
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
