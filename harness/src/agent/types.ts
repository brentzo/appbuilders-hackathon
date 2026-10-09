// Forked from Pi (@earendil-works/pi-agent-core 1.1.0, packages/agent/src/types.ts), MIT License,
// Copyright (c) 2025 Mario Zechner. See ./LICENSE and ./FORK.md.
// Provider options (API keys, transports, thinking levels) are removed, and tool arguments are JSON Schema.
import type { AssistantMessageEventStream } from "./event-stream.ts";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  Message,
  Model,
  StreamOptions,
  TextContent,
  Tool,
  ToolResultMessage,
  TranscriptContext,
} from "./llm.ts";

/**
 * Stream function used by the agent loop. The harness passes the local model client's (src/model/stream-fn.ts).
 *
 * The loop passes a normalized transcript: the system prompt and tool declarations are carried by the
 * transcript's system messages, never by `context.systemPrompt` or `context.tools`.
 *
 * Contract:
 * - Must not throw or return a rejected promise for request/model/runtime failures.
 * - Must return an AssistantMessageEventStream.
 * - Failures must be encoded in the returned stream via protocol events and a
 *   final AssistantMessage with stopReason "error" or "aborted" and errorMessage.
 */
export type StreamFn = (
  model: Model,
  context: TranscriptContext,
  options?: StreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

/**
 * Configuration for how tool calls from a single assistant message are executed.
 *
 * - "sequential": each tool call is prepared, executed, and finalized before the next one starts.
 * - "parallel": tool calls are prepared sequentially, then allowed tools execute concurrently.
 *   `tool_execution_end` is emitted in tool completion order after each tool is finalized,
 *   while tool-result message artifacts are emitted later in assistant source order.
 */
export type ToolExecutionMode = "sequential" | "parallel";

/**
 * Controls how many queued user messages are injected when the agent loop reaches a queue drain point.
 *
 * - "all": drain and inject every queued message at that point.
 * - "one-at-a-time": drain and inject only the oldest queued message, leaving the rest queued for later drain points.
 */
export type QueueMode = "all" | "one-at-a-time";

/** A single tool call content block emitted by an assistant message. */
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

/**
 * Result returned from `beforeToolCall`.
 *
 * Returning `{ block: true }` prevents the tool from executing. The loop emits an error tool result instead.
 * `reason` becomes the text shown in that error result. If omitted, a default blocked message is used.
 */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
  /**
   * Hint that the agent should stop after the current tool batch when this call is blocked.
   * Early termination only happens when every finalized tool result in the batch sets this to true.
   */
  terminate?: boolean;
}

/**
 * Partial override returned from `afterToolCall`. Omitted fields keep the executed tool result's values.
 * There is no deep merge for `content` or `details`.
 */
export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  /**
   * Hint that the agent should stop after the current tool batch.
   * Early termination only happens when every finalized tool result in the batch sets this to true.
   */
  terminate?: boolean;
}

/** Context passed to `beforeToolCall`. */
export interface BeforeToolCallContext {
  /** The assistant message that requested the tool call. */
  assistantMessage: AssistantMessage;
  /** The raw tool call block from `assistantMessage.content`. */
  toolCall: AgentToolCall;
  /** Validated tool arguments for the target tool schema. */
  args: unknown;
  /** Current agent context at the time the tool call is prepared. */
  context: AgentContext;
}

/** Context passed to `afterToolCall`. */
export interface AfterToolCallContext {
  /** The assistant message that requested the tool call. */
  assistantMessage: AssistantMessage;
  /** The raw tool call block from `assistantMessage.content`. */
  toolCall: AgentToolCall;
  /** Validated tool arguments for the target tool schema. */
  args: unknown;
  /** The executed tool result before any `afterToolCall` overrides are applied. */
  result: AgentToolResult<unknown>;
  /** Whether the executed tool result is currently treated as an error. */
  isError: boolean;
  /** Current agent context at the time the tool call is finalized. */
  context: AgentContext;
}

/** Context passed to completed-turn callbacks. */
export interface AgentTurnContext {
  /** The assistant message that completed the turn. */
  message: AssistantMessage;
  /** Tool result messages emitted for the completed turn. */
  toolResults: ToolResultMessage[];
  /** Current agent context after the turn's assistant message and tool results have been appended. */
  context: AgentContext;
  /** Messages that this loop invocation will return if it exits at this point. */
  newMessages: AgentMessage[];
}

/** Decision returned by {@link FinishTurn}. Returning undefined preserves normal scheduling. */
export type AgentTurnDecision = { action: "continue" } | { action: "end" };

/**
 * Called after a completed assistant turn and all of its tool-result messages, but before `turn_end`.
 * On a normal turn, `{ action: "continue" }` ensures one next provider request. Error and aborted responses
 * remain hard exits.
 */
export type FinishTurn = (
  turn: AgentTurnContext,
  signal?: AbortSignal,
) => AgentTurnDecision | void | Promise<AgentTurnDecision | undefined> | Promise<void>;

/** Replacement runtime state used by the agent loop before starting another provider request. */
export interface AgentLoopTurnUpdate {
  /** Context for the next provider request. */
  context?: AgentContext;
  /** Messages to append before the next provider request, with normal lifecycle events. */
  messages?: AgentMessage[];
  /** Model for the next provider request. */
  model?: Model;
}

/** Runtime state available immediately before a provider request. */
export interface PrepareRequestContext {
  context: AgentContext;
  model: Model;
}

/** Replacement runtime state for the provider request being prepared. */
export type AgentRequestUpdate = Omit<AgentLoopTurnUpdate, "messages">;

/**
 * Called immediately before every provider request, including the first.
 * Pending messages have already been appended and emitted when this callback runs.
 */
export type PrepareRequest = (
  request: PrepareRequestContext,
  signal?: AbortSignal,
) => AgentRequestUpdate | void | Promise<AgentRequestUpdate | undefined> | Promise<void>;

export type PrepareNextTurnContext = AgentTurnContext;

export interface AgentLoopConfig {
  model: Model;

  /**
   * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
   * AgentMessages that cannot be converted (e.g., UI-only notifications) should be filtered out.
   *
   * Contract: must not throw or reject. Return a safe fallback value instead.
   */
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  /**
   * Optional transform applied to the context before `convertToLlm`, for context window management
   * or injecting context from external sources.
   *
   * Contract: must not throw or reject. Return the original messages or another safe fallback value instead.
   */
  transformContext?: ((messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>) | undefined;

  /**
   * Called after the assistant message and all tool-result messages have been emitted, immediately before `turn_end`.
   * `{ action: "end" }` ends the run without polling queues or preparing another request.
   */
  finishTurn?: FinishTurn | undefined;

  /**
   * Called immediately before every provider request, including the first.
   * The returned context and model replace the runtime values for this and later requests in the run.
   */
  prepareRequest?: PrepareRequest | undefined;

  /**
   * Called after `turn_end` when the loop will continue, immediately before the next turn starts.
   * Return replacement context/model state or messages to append to affect that turn.
   */
  prepareNextTurn?:
    ((context: PrepareNextTurnContext) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>) | undefined;

  /**
   * Returns steering messages to inject into the conversation mid-run.
   * Called after the current assistant turn finishes executing its tool calls, unless `finishTurn` ends the run.
   *
   * Contract: must not throw or reject. Return [] when no steering messages are available.
   */
  getSteeringMessages?: () => Promise<AgentMessage[]>;

  /**
   * Returns follow-up messages to process after the agent would otherwise stop.
   *
   * Contract: must not throw or reject. Return [] when no follow-up messages are available.
   */
  getFollowUpMessages?: () => Promise<AgentMessage[]>;

  /** Tool execution mode. Default: "parallel". */
  toolExecution?: ToolExecutionMode;

  /**
   * Called before a tool is executed, after arguments have been validated.
   * Return `{ block: true }` to prevent execution. The loop emits an error tool result instead.
   */
  beforeToolCall?:
    ((context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>) | undefined;

  /**
   * Called after a tool finishes executing, before `tool_execution_end` and tool-result message events are emitted.
   * Return an `AfterToolCallResult` to override parts of the executed tool result.
   */
  afterToolCall?: ((context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>) | undefined;
}

/**
 * Extensible interface for custom app messages. Apps can extend it via declaration merging.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CustomAgentMessages {
  // Empty by default - apps extend via declaration merging
}

/** Union of LLM messages and custom messages. */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/**
 * Public agent state.
 *
 * `tools` and `messages` use accessor properties so implementations can copy assigned arrays before storing them.
 */
export interface AgentState {
  /** Current system prompt, replayed from the transcript's system messages. */
  readonly systemPrompt: string;
  /** Active model used for future turns. */
  model: Model;
  /**
   * Executable tools. Assigning a new array copies the top-level array.
   * Differences from the tools declared in the transcript are announced to the model with a system message
   * before the next request.
   */
  set tools(tools: AgentTool[]);
  get tools(): AgentTool[];
  /** Conversation transcript. Assigning a new array copies the top-level array. */
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  /** True while the agent is processing a prompt or continuation. */
  readonly isStreaming: boolean;
  /** Partial assistant message for the current streamed response, if any. */
  readonly streamingMessage?: AgentMessage | undefined;
  /** Tool call ids currently executing. */
  readonly pendingToolCalls: ReadonlySet<string>;
  /** Technical error from the most recent failed or aborted assistant turn, if any. For the log only. */
  readonly errorMessage?: string | undefined;
}

/** Final or partial result produced by a tool. */
export interface AgentToolResult<T = unknown> {
  /** Text or image content returned to the model. */
  content: (TextContent | ImageContent)[];
  /** Arbitrary structured details for logs or UI rendering. */
  details: T;
  /** Report a failure without throwing. The model sees `content` as an error result. */
  isError?: boolean | undefined;
  /**
   * Hint that the agent should stop after the current tool batch.
   * Early termination only happens when every finalized tool result in the batch sets this to true.
   */
  terminate?: boolean | undefined;
}

/** Final outcome of a tool call after hooks ran. */
export interface AgentToolCallOutcome {
  toolCall: AgentToolCall;
  result: AgentToolResult;
  isError: boolean;
  /** Milliseconds `execute()` took, measured with a monotonic clock; absent when the tool did not run. */
  durationMs?: number;
}

/** Callback used by tools to stream partial execution updates. */
export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

/** Tool definition used by the agent runtime. */
export interface AgentTool<TArgs = unknown, TDetails = unknown> extends Tool {
  /** Human-readable label for logs. */
  label: string;
  /**
   * Checks raw tool-call arguments against `parameters`. Returns the arguments, or throws an Error whose
   * message lists the problems; the loop then answers the model with an error tool result.
   */
  validateArguments: (args: unknown) => TArgs;
  /** Execute the tool call. Throw on failure, or return a result with `isError: true`. */
  execute: (
    toolCallId: string,
    params: TArgs,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
  /**
   * Per-tool execution mode override. "sequential" means this tool must execute one at a time with other
   * tool calls. If omitted, the default execution mode applies.
   */
  executionMode?: ToolExecutionMode;
}

/** Context snapshot passed into the low-level agent loop. */
export interface AgentContext {
  /** Transcript visible to the model. */
  messages: AgentMessage[];
  /** Tools available for execution in this run. */
  tools?: AgentTool[];
}

/**
 * Events emitted by the Agent. `agent_end` is the last event emitted for a run.
 */
export type AgentEvent =
  // Agent lifecycle
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  // Turn lifecycle - a turn is one assistant response + any tool calls/results
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  // Message lifecycle - emitted for system, user, assistant, and toolResult messages
  | { type: "message_start"; message: AgentMessage }
  // Only emitted for assistant messages during streaming
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  // Tool execution lifecycle
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: AgentToolResult;
      isError: boolean;
      /** Milliseconds `execute()` took; absent when the tool did not run. */
      durationMs?: number;
    };
