import type { Handler } from "@yumi/protocol";
import type { Empty, SetDebugModeParams } from "@yumi/protocol/types";
import type { DebugLog } from "../debug/debug-log.ts";

/**
 * `setDebugMode` (OBJ-52), which the Mac app sends after every hello and whenever the user changes the Debug mode
 * setting (OBJ-53). It turns the detailed debug log and the `workerThought` events on or off at once.
 */
export function debugHandlers(debug: DebugLog): Record<string, Handler> {
  return {
    setDebugMode: (params): Empty => {
      debug.setEnabled((params as SetDebugModeParams).enabled);
      return {};
    },
  };
}
