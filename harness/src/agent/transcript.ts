// Forked from Pi (@earendil-works/pi-ai 1.1.0, packages/ai/src/utils/transcript.ts and utils/text.ts),
// MIT License, Copyright (c) 2025 Mario Zechner. See ./LICENSE and ./FORK.md.
// Trimmed to the helpers the agent loop and the local model client use.
import type { Context, SystemMessage, TextContent, Tool, ToolReference, TranscriptContext } from "./llm.ts";

/** Join the text blocks of a message's content. */
export function contentText(content: string | readonly { type: string }[], separator = "\n"): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join(separator);
}

/** Render a system message as a complete prompt: its content followed by its sections. */
export function getSystemMessageText(message: SystemMessage): string {
  const parts = [contentText(message.content)];
  for (const text of Object.values(message.sections ?? {})) {
    if (text !== null) parts.push(text);
  }
  return parts.filter((part) => part.length > 0).join("\n\n");
}

/**
 * Build the leading system message for a prompt and tool set. Returns undefined when
 * both are empty, so an empty transcript stays empty.
 */
export function createInitialSystemMessage(
  systemPrompt: string | undefined,
  tools: Tool[] | undefined,
): SystemMessage | undefined {
  const hasSystemPrompt = systemPrompt !== undefined && systemPrompt.length > 0;
  const hasTools = tools !== undefined && tools.length > 0;
  if (!hasSystemPrompt && !hasTools) return undefined;
  return {
    role: "system",
    content: systemPrompt ?? "",
    ...(hasTools ? { toolsAdded: tools } : {}),
    timestamp: 0,
  };
}

/**
 * Fold `Context.systemPrompt` and `Context.tools` into a leading system message.
 * This is the only entry point that produces a {@link TranscriptContext}.
 */
export function normalizeContext(context: Context): TranscriptContext {
  const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
  const messages = initialMessage ? [initialMessage, ...context.messages] : context.messages;
  return { messages } as TranscriptContext;
}

/**
 * Any message list. The replay helpers only read entries whose role is `"system"`, so
 * agent transcripts that carry custom message roles can be passed without filtering.
 */
export type TranscriptMessages = readonly { role: string }[];

function isSystemMessage(message: { role: string }): message is SystemMessage {
  return message.role === "system";
}

/** Resolve the tools available after applying every transcript delta in order. */
export function getCurrentTools(messages: TranscriptMessages): Tool[] {
  const tools = new Map<string, Tool>();
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
  }
  return [...tools.values()];
}

/**
 * Replay every system message into one leading system message holding the current
 * prompt and tools. Later `content` is appended to the base prompt, `sections` are
 * patched by name, and tools are resolved with {@link getCurrentTools}.
 */
export function getCurrentSystemMessage(messages: TranscriptMessages): SystemMessage | undefined {
  const content: string[] = [];
  const sections = new Map<string, string>();
  let timestamp: number | undefined;
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    timestamp ??= message.timestamp;
    const text = contentText(message.content);
    if (text.length > 0) content.push(text);
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  const tools = getCurrentTools(messages);
  if (timestamp === undefined && tools.length === 0) return undefined;
  return {
    role: "system",
    content: content.join("\n\n"),
    ...(sections.size > 0 ? { sections: Object.fromEntries(sections) } : {}),
    ...(tools.length > 0 ? { toolsAdded: tools } : {}),
    timestamp: timestamp ?? 0,
  };
}

/** Render the current system prompt text after replaying every system message. */
export function getCurrentSystemPrompt(messages: TranscriptMessages): string {
  const message = getCurrentSystemMessage(messages);
  return message ? getSystemMessageText(message) : "";
}

/**
 * Rebuild the transcript for APIs without mid-conversation system messages: the replayed
 * system message leads, and every later system message is dropped. Qwen3.5's chat template
 * only accepts a system message at the beginning.
 */
export function collapseSystemMessages(context: TranscriptContext): TranscriptContext {
  const head = getCurrentSystemMessage(context.messages);
  const messages = context.messages.filter((message) => message.role !== "system");
  return { messages: head ? [head, ...messages] : messages } as TranscriptContext;
}

/** Strip executable and display-only fields from a tool before transcript comparison or persistence. */
export function toToolDeclaration(tool: Tool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: JSON.parse(JSON.stringify(tool.parameters)) as Tool["parameters"],
  };
}

/** Whether two tools declare the same interface to the model. */
export function declarationsEqual(left: Tool, right: Tool): boolean {
  return JSON.stringify(toToolDeclaration(left)) === JSON.stringify(toToolDeclaration(right));
}

export interface ToolStateChanges {
  toolsAdded: Tool[];
  toolsRemoved: ToolReference[];
}

/** Compare two complete tool states. A changed definition is a removal followed by an addition. */
export function getToolStateChanges(previous: readonly Tool[], current: readonly Tool[]): ToolStateChanges {
  const previousTools = new Map(previous.map((tool) => [tool.name, tool]));
  const currentTools = new Map(current.map((tool) => [tool.name, tool]));
  return {
    toolsAdded: current
      .filter((tool) => {
        const previousTool = previousTools.get(tool.name);
        return previousTool === undefined || !declarationsEqual(previousTool, tool);
      })
      .map(toToolDeclaration),
    toolsRemoved: previous
      .filter((tool) => {
        const currentTool = currentTools.get(tool.name);
        return currentTool === undefined || !declarationsEqual(tool, currentTool);
      })
      .map((tool) => ({ name: tool.name })),
  };
}
