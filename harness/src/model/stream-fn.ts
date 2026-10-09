import {
  AssistantMessageEventStream,
  collapseSystemMessages,
  getCurrentTools,
  getSystemMessageText,
  type AssistantMessage,
  type JsonObject,
  type Message,
  type Model,
  type StreamFn,
  type ToolCall,
} from "../agent/index.ts";
import { contentText } from "../agent/transcript.ts";
import type { ModelClient } from "./client.ts";
import type { ChatContentPart, ChatMessage, ChatTool } from "./openai.ts";

/**
 * The forked agent loop's stream function, backed by the local model client. One non-streaming request per turn:
 * the loop gets `start` and then `done` or `error`. Tool declarations from the transcript become OpenAI `tools`,
 * and the reply's `tool_calls` become tool call blocks. Failures end the stream with stopReason "error" and the
 * failure kind in `errorMessage`, which is for the log only.
 */
export function createLocalStreamFn(client: ModelClient, purpose = "agentTurn"): StreamFn {
  return (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    const transcript = collapseSystemMessages(context);
    const tools: ChatTool[] = getCurrentTools(transcript.messages).map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    const message = emptyAssistantMessage(model);
    stream.push({ type: "start", partial: message });

    void client
      .chat({ messages: transcript.messages.map(toChatMessage), tools, signal: options?.signal, purpose })
      .then((result) => {
        if (!result.ok) {
          const reason = result.failure.kind === "aborted" ? "aborted" : "error";
          message.stopReason = reason;
          message.errorMessage = `model ${result.failure.kind}`;
          stream.push({ type: "error", reason, error: message });
          return;
        }
        message.usage = {
          input: result.usage.promptTokens,
          output: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        };
        if (result.content) message.content.push({ type: "text", text: result.content });
        for (const call of result.toolCalls)
          message.content.push(toToolCall(call.id, call.function.name, call.function.arguments));
        const reason = result.finishReason === "length" ? "length" : result.toolCalls.length > 0 ? "toolUse" : "stop";
        message.stopReason = reason;
        stream.push({ type: "done", reason, message });
      });
    return stream;
  };
}

function emptyAssistantMessage(model: Model): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    model: model.id,
    usage: { input: 0, output: 0, totalTokens: 0 },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** Malformed tool arguments become an empty object; the tool's own argument check then rejects the call. */
function toToolCall(id: string, name: string, rawArguments: string): ToolCall {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    parsed = {};
  }
  const args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
  return { type: "toolCall", id, name, arguments: args };
}

function toChatMessage(message: Message): ChatMessage {
  switch (message.role) {
    case "system":
      return { role: "system", content: getSystemMessageText(message) };
    case "user":
      return {
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content.map((part): ChatContentPart =>
                part.type === "text"
                  ? { type: "text", text: part.text }
                  : { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } },
              ),
      };
    case "assistant": {
      const toolCalls = message.content.filter((part): part is ToolCall => part.type === "toolCall");
      return {
        role: "assistant",
        content: contentText(message.content) || null,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      };
    }
    case "toolResult":
      return { role: "tool", tool_call_id: message.toolCallId, content: contentText(message.content) };
  }
}
