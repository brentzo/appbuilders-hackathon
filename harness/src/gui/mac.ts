import { RpcErrorCode, RpcRemoteError, validate } from "@yumi/protocol";
import type {
  CursorCommand,
  ExecuteActionParams,
  ExecuteActionResult,
  Observation,
  ObserveWindowParams,
  Target,
  UserError,
} from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";
import type { MacAppCaller } from "../router/capability.ts";

/**
 * What `gui_act` needs from the Mac app (OBJ-39): read the target window, run one checked action, and drive the
 * cursor overlay. Element numbers resolve against the Mac app's last observation of the same
 * window, so the loop always acts on the observation it showed the model.
 */
export interface MacGui {
  /** Reads the target window's trimmed tree (SPEC-05 r2). Rejects with `MacGuiFailure`. */
  observe(target: Target, signal?: AbortSignal): Promise<Observation>;
  /** Runs one checked action. Rejects with `MacGuiFailure` when the Mac app refuses or cannot run it. */
  execute(params: ExecuteActionParams): Promise<ExecuteActionResult>;
  cursor(command: CursorCommand): void;
}

/**
 * The Mac app could not answer. `userError` is the structured kind it reported (for example
 * `accessibilityPermissionMissing`, `stuckOnScreen` for a window that is gone, or `blockedAction` for a password
 * field); undefined when it reported none, for example when no Mac app is connected. The detail is in the log.
 */
export class MacGuiFailure extends Error {
  constructor(
    readonly method: string,
    readonly userError: UserError | undefined,
  ) {
    super(`The Mac app could not answer ${method}${userError ? `: ${userError.kind}` : ""}`);
    this.name = "MacGuiFailure";
  }
}

/** The Mac app on the local socket: `observeWindow` and `executeAction` as requests, the cursor as events. */
export function macAppGui(app: MacAppCaller & { emit(event: string, payload: unknown): number }, logger: Logger): MacGui {
  const call = async <T>(method: string, params: unknown): Promise<T> => {
    try {
      return (await app.request(method, params)) as T;
    } catch (error) {
      const reported = reportedUserError(error);
      logger.warn("gui.macFailed", { method, ...(reported ? { kind: reported.kind } : {}), ...describeError(error) });
      throw new MacGuiFailure(method, reported);
    }
  };
  /** Cursors spawned and not faded since, so a second spawn does not make the Mac app redraw one in place. */
  const spawned = new Set<string>();
  return {
    observe: (target) => call<Observation>("observeWindow", { target } satisfies ObserveWindowParams),
    execute: (params) => call<ExecuteActionResult>("executeAction", params),
    cursor: (command) => {
      if (command.command === "spawn") {
        if (spawned.has(command.cursorId)) return;
        spawned.add(command.cursorId);
      } else if (command.command === "fade") {
        spawned.delete(command.cursorId);
      }
      app.emit("cursorCommand", command);
    },
  };
}

/** The UserError in a `-32000` reply, the only error reply whose data is meant for the user. */
function reportedUserError(error: unknown): UserError | undefined {
  if (!(error instanceof RpcRemoteError) || error.error.code !== RpcErrorCode.failed) return undefined;
  return validate("UserError", error.error.data).valid ? (error.error.data as UserError) : undefined;
}
