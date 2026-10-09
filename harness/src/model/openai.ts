/**
 * The wire shapes of the OpenAI-compatible chat completions API, as the local model server (mlx-vlm 0.7.6,
 * `mlx_vlm/server/schemas.py`) sends and accepts them. Only the fields the harness uses are listed.
 */

export type ChatContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatToolCall {
  id: string;
  type: "function";
  index?: number;
  /** `arguments` is a JSON string, as in the OpenAI API. */
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ChatContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  top_p: number;
  top_k: number;
  stream: false;
  /** mlx-vlm reads this; Qwen3.5 thinks by default, and a step needs a direct answer. */
  enable_thinking: false;
  /** The Qwen3.5 model card's way to turn thinking off, for servers that pass template arguments through. */
  chat_template_kwargs: { enable_thinking: false };
  response_format?: { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown> } };
  tools?: ChatTool[];
}

/** A successful reply. mlx-vlm serializes every field, so absent values arrive as null. */
export interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    finish_reason: string;
    message: {
      role: "assistant";
      content: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ChatToolCall[] | null;
    };
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

/**
 * A failed reply. The server is FastAPI: `HTTPException` answers `{"detail": "<text>"}` with its status, and a
 * request that fails Pydantic validation answers 422 with a list of problems.
 */
export interface ChatErrorBody {
  detail: string | { type: string; loc: (string | number)[]; msg: string }[];
}
