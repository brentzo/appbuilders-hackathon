// Forked from Pi (@earendil-works/pi-ai 1.1.0, packages/ai/src/types.ts), MIT License, Copyright (c) 2025 Mario Zechner.
// See ./LICENSE and ./FORK.md. Trimmed to the message, tool, and event types the agent loop uses with a local model.

/** A JSON Schema object, as sent to the model and checked by Ajv. */
export type JsonSchema = { [key: string]: unknown };

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ImageContent {
  type: "image";
  /** Base64-encoded image data. */
  data: string;
  /** For example "image/png" or "image/jpeg". */
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: JsonObject;
}

export interface Usage {
  input: number;
  output: number;
  totalTokens: number;
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

/**
 * The leading system message is the system prompt. Later system messages change it:
 * `content` adds instructions from that point on, `sections` replace or remove named
 * prompt sections, and `toolsAdded`/`toolsRemoved` change the tool set. Replaying
 * every system message in order yields the current prompt and tools.
 */
export interface SystemMessage {
  role: "system";
  /** Instruction text. On the leading message this is the base prompt; later, additional instructions. */
  content: string | TextContent[];
  /** Named, ordered prompt sections rendered verbatim after `content`. Later messages replace sections by name, and `null` removes one. */
  sections?: Record<string, string | null>;
  /** Complete definitions of tools that become available at this point. */
  toolsAdded?: Tool[];
  /** Tools that stop being available at this point. */
  toolsRemoved?: ToolReference[];
  timestamp: number;
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  /** The model id that answered. */
  model: string;
  usage: Usage;
  stopReason: StopReason;
  /** Technical detail for the log. Never shown to the user (SPEC-11). */
  errorMessage?: string;
  /** Unix timestamp in milliseconds when the request started. */
  timestamp: number;
  /** Milliseconds until the response ended, measured with a monotonic clock. */
  durationMs?: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: unknown;
  isError: boolean;
  timestamp: number;
  /** Milliseconds the tool's execution took. */
  durationMs?: number;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolReference {
  name: string;
}

/** The chat model the loop calls. */
export interface Model {
  /** Model name sent to the server, for example "mlx-community/Qwen3.5-9B-4bit". */
  id: string;
  /** Input kinds the model accepts. */
  input: ("text" | "image")[];
}

/** Request input for a stream function. `systemPrompt` and `tools` are shorthand for a leading system message. */
export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

declare const transcriptContextBrand: unique symbol;

/**
 * Normalized request context passed to stream functions. The prompt and tool declarations are
 * carried by the transcript's system messages. Only `normalizeContext()` produces this type.
 */
export type TranscriptContext = {
  messages: Message[];
  readonly [transcriptContextBrand]: true;
};

export interface StreamOptions {
  signal?: AbortSignal | undefined;
}

/**
 * Event protocol for AssistantMessageEventStream.
 *
 * Successful streams emit `start` before partial updates and terminate with `done`.
 * A stream may terminate directly with `error` when request setup fails before
 * generation starts; after `start`, failures also terminate with `error`.
 */
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };
