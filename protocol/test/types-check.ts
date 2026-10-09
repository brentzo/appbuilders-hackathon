// Compile-time checks, run by `npm run typecheck`. Each @ts-expect-error must stay an error,
// or the generated TypeScript has become looser than the schema.
import type { ModelAction, RpcMethods, ToolCall } from "../generated/ts/index.ts";

export const press: ModelAction = { kind: "axPress", element: 3 };

// @ts-expect-error a finish action has no element
export const finishWithElement: ModelAction = { kind: "finish", status: "done", note: "ok", element: 3 };

// @ts-expect-error there is no shell tool
export const shell: ToolCall = { tool: "shell", command: "ls" };

export function narrow(action: ModelAction): number | undefined {
  // The discriminator narrows the union, so element is only reachable on element actions.
  if (action.kind === "axPress" || action.kind === "setValue" || action.kind === "scroll") return action.element;
  // @ts-expect-error element does not exist on the other variants
  return action.element;
}

export type SubmitGoalResult = RpcMethods["submitGoal"]["result"];
export const submitted: SubmitGoalResult = { taskId: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8" };
