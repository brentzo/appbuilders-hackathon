import { basename, dirname } from "node:path";
import type { PermissionLevel, ToolCall } from "@yumi/protocol/types";

/**
 * Plain-language action log lines for tool calls (SPEC-07 r17), built from the call and the real result, never from
 * model text. The user reads these in "Show what I did" and in past tasks, so they name files, not paths.
 */

const name = (path: string) => basename(path);
const folder = (path: string) => basename(dirname(path));

/** A tool call that ran. `path` is the real path the tool used, when it reported one. */
export function describeToolRun(call: ToolCall, ok: boolean, path?: string): string {
  switch (call.tool) {
    case "read_file":
      return ok ? `Read ${name(call.path)}` : `Tried to read ${name(call.path)}`;
    case "list_dir":
      return ok ? `Looked in the folder ${name(call.path)}` : `Tried to look in the folder ${name(call.path)}`;
    case "write_new_file":
      return ok ? `Created ${name(path ?? call.path)} in ${folder(path ?? call.path)}` : `Tried to create ${name(call.path)}`;
    case "copy":
      return ok ? `Copied ${name(call.from)} to ${folder(path ?? call.to)}` : `Tried to copy ${name(call.from)}`;
    case "move":
      return ok ? `Moved ${name(call.from)} to ${folder(path ?? call.to)}` : `Tried to move ${name(call.from)}`;
    case "move_to_trash": {
      const what = call.paths.length === 1 ? name(call.paths[0]!) : `${call.paths.length} items`;
      return ok ? `Moved ${what} to the Trash` : `Tried to move ${what} to the Trash`;
    }
    default:
      return ok ? `Used ${call.tool}` : `Tried to use ${call.tool}`;
  }
}

/** A tool call the gate did not let run. */
export function describeNotRun(call: ToolCall, level: Exclude<PermissionLevel, "allowed">): string {
  const what = describeToolRun(call, false).replace(/^Tried to /, "");
  return level === "ask"
    ? `Did not ${what}, because it needs your approval first`
    : `Did not ${what}, because Yumi's safety rules do not allow it`;
}
