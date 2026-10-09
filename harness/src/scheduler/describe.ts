import { basename, dirname } from "node:path";
import type { RecordedAction, ToolCall } from "@yumi/protocol/types";
import { PASSWORD_QUESTION } from "../gui/copy.ts";
import { closesWindow } from "../safety/gate.ts";

/**
 * Plain-language action log lines (SPEC-07 r18), built from the action, the real element, the app the Mac app
 * reported, and the real result, never from model text. The user reads these in the action log file, "Show what I
 * did", and past tasks, so they name files, not paths, and they never include text Yumi typed: a password field's
 * text can never reach the log (SPEC-07 r20).
 */

const name = (path: string) => basename(path);
const folder = (path: string) => basename(dirname(path)) || dirname(path);

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
    // The direct tools gui_act offers (SPEC-05 r1). They open things; nothing is created or changed.
    case "open_app": {
      const app = call.name ?? call.bundleId ?? "an app";
      return ok ? `Opened ${app}` : `Tried to open ${app}`;
    }
    case "open_file":
      return ok ? `Opened ${name(call.path)}` : `Tried to open ${name(call.path)}`;
    case "open_url":
      return ok ? `Opened ${host(call.url)}` : `Tried to open ${host(call.url)}`;
    case "reveal_in_finder":
      return ok ? `Showed ${name(call.path)} in Finder` : `Tried to show ${name(call.path)} in Finder`;
    default:
      return ok ? `Used ${call.tool}` : `Tried to use ${call.tool}`;
  }
}

/** A link's site, never its path or query, which can hold personal data: "Opened example.com". */
function host(url: string): string {
  try {
    return new URL(url).host || "a link";
  } catch {
    return "a link";
  }
}

/**
 * Files moved to the Trash, from the exact paths the Mac app moved: "Moved old-invoice.pdf from Downloads to the
 * Trash", "Moved 12 files from Downloads to the Trash", or "Moved 12 files from 3 folders to the Trash". The log
 * entry carries every path (SPEC-07 r18).
 */
export function describeTrashed(paths: readonly string[]): string {
  const folders = new Set(paths.map((path) => dirname(path)));
  if (paths.length === 1) return `Moved ${name(paths[0]!)} from ${folder(paths[0]!)} to the Trash`;
  if (folders.size === 1) return `Moved ${paths.length} files from ${folder(paths[0]!)} to the Trash`;
  return `Moved ${paths.length} files from ${folders.size} folders to the Trash`;
}

/**
 * A UI action, for the `gui_act` step loop (OBJ-36): "Clicked Export in Keynote". `app` is the app the Mac app
 * reported (`Observation.app`). Text that was typed or set is never part of the line.
 */
export function describeGuiAction(recorded: RecordedAction, app: string | undefined, ok: boolean): string {
  if (recorded.action.kind === "tool") return describeToolRun(recorded.action.call, ok);
  const phrase = guiPhrase(recorded, app);
  return phrase
    ? ok
      ? phrase.done
      : `Tried to ${phrase.todo}`
    : ok
      ? "Did something on the screen"
      : "Tried something on the screen";
}

/** Why an action was not done, for its action log line. */
export type NotDone =
  /** The gate asks, and there is no approval card for it, so it was not asked. */
  | "needsApproval"
  /** The gate blocked it (SPEC-07 r5). */
  | "blocked"
  /** The user said no. */
  | "declined"
  /** A pause or cancel came before the user answered, or right after. */
  | "paused"
  /** The files changed or are gone, so the approval no longer fits them. */
  | "filesChanged"
  /** The recipients could not be read. */
  | "noRecipients"
  /** The approval card could not be shown. */
  | "couldNotAsk";

const BECAUSE: Record<NotDone, string> = {
  needsApproval: "because it needs your approval first",
  blocked: "because Yumi's safety rules do not allow it",
  declined: "because you said no",
  paused: "because the task was paused before it could",
  filesChanged: "because the files changed",
  noRecipients: "because Yumi couldn't read who it was going to",
  couldNotAsk: "because Yumi couldn't show you the approval",
};

/** An action the gate or the user did not let run: "Did not move 12 items to the Trash, because you said no". */
export function describeNotDone(recorded: RecordedAction, app: string | undefined, why: NotDone): string {
  const { action } = recorded;
  const what =
    action.kind === "tool"
      ? describeToolRun(action.call, false).replace(/^Tried to /, "")
      : (guiPhrase(recorded, app)?.todo ?? "do that on the screen");
  return `Did not ${what}, ${BECAUSE[why]}`;
}

/**
 * The action a blocked-action message names (SPEC-07 r5), as the words after "I can't": "click File in Keynote",
 * "press Command-Q in Keynote", "open Terminal". Undefined when there is no plain name for it, so the message says
 * "I can't do that" instead. Built like the action log line: never model text, never typed text.
 */
export function describeSkipped(recorded: RecordedAction, app: string | undefined): string | undefined {
  const { action } = recorded;
  const what =
    action.kind === "tool" ? describeToolRun(action.call, false).replace(/^Tried to /, "") : guiPhrase(recorded, app)?.todo;
  if (!what) return undefined;
  return what.length <= 200 ? what : `${what.slice(0, 199).trimEnd()}…`;
}

/**
 * A step a restart cut off (SPEC-02 r4): its action may or may not have happened. Tool calls name what they were
 * doing; UI actions name the element when they have one.
 */
export function describeInterrupted(recorded: RecordedAction): string {
  const { action } = recorded;
  const what =
    action.kind === "tool" ? describeToolRun(action.call, false).replace(/^Tried to /, "") : guiPhrase(recorded, undefined)?.todo;
  return what ? `Started to ${what}, but was interrupted before it finished` : "Was interrupted in the middle of a step";
}

/** The past and the "to ..." form of a UI action, or undefined for actions that are not UI actions. */
function guiPhrase(recorded: RecordedAction, app: string | undefined): { done: string; todo: string } | undefined {
  const { action, element } = recorded;
  const where = app ? ` in ${app}` : "";
  // Said as what it does, so the blocked-action message reads "I can't close a window in Keynote" (SPEC-07).
  if (closesWindow(action, element)) return { done: `Closed a window${where}`, todo: `close a window${where}` };
  const label = element?.label.trim() ? element.label.trim() : undefined;
  const on = label ? ` ${label}` : "";
  switch (action.kind) {
    case "click":
      return { done: `Clicked${on}${where}`, todo: `click${on}${where}` };
    case "clickAt":
      return { done: `Clicked${where}`, todo: `click${where}` };
    case "setValue":
      return label
        ? { done: `Filled in ${label}${where}`, todo: `fill in ${label}${where}` }
        : { done: `Filled in a field${where}`, todo: `fill in a field${where}` };
    case "type":
      return { done: `Typed${where}`, todo: `type${where}` };
    case "key":
      return { done: `Pressed ${keyName(action.combo)}${where}`, todo: `press ${keyName(action.combo)}${where}` };
    case "scroll":
      return { done: `Scrolled${on}${where}`, todo: `scroll${on}${where}` };
    case "ask":
      // The question's text is model text, or the password copy: only which of the two it was is logged.
      return action.question === PASSWORD_QUESTION
        ? { done: "Asked you to type a password", todo: "ask you to type a password" }
        : { done: "Asked you a question", todo: "ask you a question" };
    default:
      return undefined;
  }
}

const KEY_WORDS: Record<string, string> = {
  cmd: "Command",
  ctrl: "Control",
  opt: "Option",
  shift: "Shift",
  fn: "Fn",
  return: "Return",
  enter: "Enter",
  escape: "Escape",
  delete: "Delete",
  tab: "Tab",
  space: "Space",
};

/** "cmd+shift+d" as the user says it: "Command-Shift-D". */
function keyName(combo: string): string {
  return combo
    .split("+")
    .map((part) => KEY_WORDS[part] ?? (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join("-");
}
