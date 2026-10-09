import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

/**
 * A stand-in for the local model server (mlx-vlm 0.7.6 serving Qwen3.5-9B), for tests. It answers
 * POST /v1/chat/completions with the same shapes the real server sends, read from mlx-vlm's
 * `mlx_vlm/server/schemas.py` and `openai.py`:
 * - success: a `ChatResponse` with every field serialized, so absent values are null;
 * - `HTTPException` failures: the status with `{"detail": "<text>"}`;
 * - request validation failures: 422 with FastAPI's list of problems;
 * - an unhandled exception: 500 with Starlette's plain-text "Internal Server Error";
 * - a crashed server: the connection drops without an answer.
 * The success body's fields and the 422 body were checked against the real server on 2026-10-09.
 * Each request takes the next scripted reply and is recorded for assertions.
 */

export type MockReply =
  | { kind: "content"; content: string | null; finishReason?: string; promptTokens?: number; completionTokens?: number }
  | { kind: "toolCalls"; calls: { name: string; arguments: string }[] }
  | { kind: "httpError"; status: number; detail: string }
  | { kind: "validationError" }
  /** An unhandled exception: Starlette answers 500 with a plain-text body. */
  | { kind: "unhandledException" }
  | { kind: "dropConnection" }
  | { kind: "hang" };

export interface MockModelServer {
  /** Base URL including /v1, as the harness config expects. */
  baseUrl: string;
  /** Every request body received, in order. */
  requests: Record<string, unknown>[];
  reply(...replies: MockReply[]): void;
  close(): Promise<void>;
}

export async function startMockModelServer(model = "mlx-community/Qwen3.5-9B-4bit"): Promise<MockModelServer> {
  const queue: MockReply[] = [];
  const requests: Record<string, unknown>[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || (req.url !== "/v1/chat/completions" && req.url !== "/chat/completions")) {
      return send(res, 404, { detail: "Not Found" });
    }
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    requests.push(body);
    const next = queue.shift() ?? { kind: "httpError", status: 500, detail: "Mock model server has no scripted reply" };
    switch (next.kind) {
      case "content":
        return send(res, 200, chatResponse(model, next.content, next.finishReason ?? "stop", null, next));
      case "toolCalls":
        return send(
          res,
          200,
          chatResponse(
            model,
            null,
            "tool_calls",
            next.calls.map((call, index) => ({
              type: "function",
              index,
              id: randomUUID(),
              function: { name: call.name, arguments: call.arguments },
            })),
            {},
          ),
        );
      case "httpError":
        return send(res, next.status, { detail: next.detail });
      case "validationError":
        return send(res, 422, {
          detail: [{ type: "missing", loc: ["body", "messages"], msg: "Field required", input: {} }],
        });
      case "unhandledException":
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        return res.end("Internal Server Error");
      case "dropConnection":
        return req.socket.destroy();
      case "hang":
        return; // never answers
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    reply: (...replies) => queue.push(...replies),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function chatResponse(
  model: string,
  content: string | null,
  finishReason: string,
  toolCalls: unknown[] | null,
  tokens: { promptTokens?: number; completionTokens?: number },
) {
  const promptTokens = tokens.promptTokens ?? 2032;
  const completionTokens = tokens.completionTokens ?? 14;
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: {
          role: "assistant",
          content,
          reasoning_content: null,
          reasoning: null,
          tool_calls: toolCalls,
          tool_call_id: null,
          name: null,
        },
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: { cached_tokens: 0 },
    },
    timings: {
      prompt_n: promptTokens,
      cache_n: 0,
      predicted_n: completionTokens,
      prompt_ms: 6900.0,
      prompt_per_token_ms: 3.4,
      prompt_per_second: 294.5,
      predicted_ms: 480.0,
      predicted_per_token_ms: 34.3,
      predicted_per_second: 29.2,
      peak_memory: 6.1,
      draft_kind: null,
      draft_rounds: null,
      draft_n: null,
      draft_n_accepted: null,
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
