# Forked from Pi

This folder is a fork of Pi's agent core, under Pi's MIT license ([LICENSE](LICENSE)).

| What | Where |
|---|---|
| Package | `@earendil-works/pi-agent-core` 1.1.0 (formerly `@mariozechner/pi-agent-core`, now deprecated on npm) |
| Source | https://github.com/earendil-works/pi, tag `v1.1.0`, commit `abe508e1b89912adde45528136c3221eb69acdd7` |
| Copied from `packages/agent/src/` | `agent-loop.ts`, `agent.ts`, `types.ts` |
| Copied from `packages/ai/src/` | the message, tool, and event types in `types.ts` (into `llm.ts`), `utils/event-stream.ts`, and the transcript helpers in `utils/transcript.ts` and `utils/text.ts` |

## What changed from Pi

- Pi's provider layer (`@earendil-works/pi-ai`) is not a dependency.
  Only the message types and transcript helpers the loop needs were copied, trimmed to the fields a local OpenAI-compatible server uses.
- Provider options are gone: API keys, transports, session ids, thinking levels and budgets, payload hooks, retry delays, and Pi's cloud proxy (`proxy.ts`).
- Tool arguments are plain JSON Schema checked with Ajv, instead of TypeBox schemas.
  Each tool validates its own arguments (`AgentTool.validateArguments`), which the Yumi tool registry provides.
- There is no default stream function: the caller always passes one. The harness passes the local model client (`src/model/stream-fn.ts`).
- Pi's agent core never shipped coding tools (read, write, edit, bash live in Pi's coding agent). The default tool set here is empty; Yumi tools are registered explicitly through `src/tools/registry.ts`.

The loop itself (turns, tool execution in sequence or parallel, steering and follow-up queues, the hooks, and transcript tool declarations) is kept as Pi wrote it, so upstream fixes can be diffed in.
