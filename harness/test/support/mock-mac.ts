import type { Handler } from "@yumi/protocol";
import { connectMockMacApp, type MockMacApp } from "../../../protocol/mocks/mock-mac-app.ts";

/**
 * The protocol's mock Mac app (`npm run mock:mac`), connected in this process so a test can script what the user
 * does on a card and what the screen shows: each scripted answer is still checked against the contract by the
 * protocol's RPC peer, on both sides. Records every call the harness makes and every event it sends.
 */
export interface ScriptedMac {
  app: MockMacApp;
  calls: { method: string; params: unknown }[];
  events: { event: string; payload: unknown }[];
  /** Calls the harness, as the Mac app does: `pause`, `resumeTask`, `cancelTask`, `replyToBlockedAction`. */
  call(method: string, params: unknown): Promise<unknown>;
  close(): void;
}

export async function connectScriptedMac(socketPath: string, answers: Record<string, Handler> = {}): Promise<ScriptedMac> {
  const calls: ScriptedMac["calls"] = [];
  const events: ScriptedMac["events"] = [];
  const recorded: Record<string, Handler> = {};
  for (const method of ["showApprovalCard", "readFieldValues", "moveToTrash"]) {
    recorded[method] = (params) => {
      calls.push({ method, params });
      const answer = answers[method];
      return answer ? answer(params) : defaultAnswer(method, params);
    };
  }
  for (const [method, answer] of Object.entries(answers)) {
    if (!(method in recorded)) recorded[method] = answer;
  }
  const app = await connectMockMacApp({
    socketPath,
    quiet: true,
    answers: recorded,
    onEvent: (event, payload) => events.push({ event, payload }),
  });
  return {
    app,
    calls,
    events,
    call: (method, params) => app.peer.request(method, params),
    close: () => app.close(),
  };
}

/** The mock's own answers for the recorded methods: a tapped "yes", and the Trash moves nothing. */
function defaultAnswer(method: string, params: unknown): unknown {
  switch (method) {
    case "showApprovalCard":
      return { approved: true, method: "tap", decidedAt: new Date().toISOString() };
    case "moveToTrash":
      return { trashed: [...(params as { paths: string[] }).paths] };
    default:
      return { fields: [] };
  }
}

/** Waits until `check` passes, or fails the test after `timeoutMs`. */
export async function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A promise the test resolves by hand, for a card the user answers later. */
export function later<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
