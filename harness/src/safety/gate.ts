import { statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { validate } from "@yumi/protocol";
import type {
  FileSummary,
  LayerKind,
  ModelAction,
  PermissionLevel,
  RecordedAction,
  ResolvedElement,
  ToolCall,
} from "@yumi/protocol/types";
import { ACTION } from "../worker/actions.ts";
import { entryKind, isFolder, isProtectedFolder, nameKey, pathProblem, realHome, resolvePath } from "./paths.ts";
import {
  BLOCKED_APPS,
  CLOSE_COMBOS,
  CLOSE_LABELS,
  INSTALLER_EXTENSIONS,
  KEY_RULES,
  LABEL_RULES,
  PHONE_TOOL_LEVELS,
  RISKY_APPS,
  RULE,
  SCRIPT_EXTENSIONS,
  SYSTEM_SETTINGS_APPS,
  canonicalCombo,
  normalizeLabel,
  type RuleId,
} from "./rules.ts";
import { checkTrash } from "./trash.ts";

/**
 * The permission gate (SPEC-07 r1, OBJ-37.1). Every action from every lane, including typed tools and phone tools,
 * goes through `checkAction` before it runs, and only an `allowed` decision may run without the user.
 *
 * The gate reads only the resolved action (its kind, tool arguments, and the real element the Mac app resolved) and
 * the real file system. It never reads model text: not the reply around the action, not the text an action types or
 * writes, not a question or a note. Screen text reaches it only as the label of the element being clicked, and a
 * label can only make a click stricter, except for the exact safe labels of a risky app (SPEC-07 Decisions). The
 * level always comes from the table in `rules.ts` (SPEC-07 r16).
 */

export interface GateContext {
  /** The user's home folder. Tests pass a temporary one. */
  home: string;
  /** The app the action acts in, as the Mac app reported it (`Observation.app`). Never from the model. */
  app?: string | undefined;
  /**
   * May this action close the window it acts in without asking: the task started in Auto mode, or Yumi opened the
   * window for this task (SPEC-07, decided 2026-10-10). From the harness's own records, never from the model.
   * Missing means no: closing a window the user had open is never allowed by default.
   */
  mayCloseWindow?: boolean;
  /** What was in front when the model chose the action (`Observation.layer`), from the Mac app. Missing means the window. */
  layer?: LayerKind | undefined;
}

/** An action after the harness resolved its element, before the gate decided its level. */
export interface UncheckedAction {
  action: ModelAction;
  element?: ResolvedElement | undefined;
}

/** What a file tool works on, resolved on the real file system when the gate checked it. */
export type FilePlan =
  | { tool: "read_file" | "list_dir" | "open_file" | "reveal_in_finder" | "write_new_file"; path: string }
  | { tool: "copy" | "move"; from: string; to: string };

declare const decidedByGate: unique symbol;

/**
 * The gate's decision. Only `checkAction` makes one, so code that runs actions can require it and know the level
 * came from the rule table.
 */
export interface GateDecision {
  level: PermissionLevel;
  /** The rule that decided, for the log and for OBJ-38's cards. */
  rule: RuleId;
  /** The action with the level stored on it. */
  recorded: RecordedAction;
  /** For `move_to_trash` when it asks: the real file list for the card (SPEC-07 r10). */
  files?: FileSummary;
  /** For the file tools when allowed: the real paths to act on. */
  plan?: FilePlan;
  readonly [decidedByGate]: true;
}

interface Verdict {
  rule: RuleId;
  files?: FileSummary;
  plan?: FilePlan;
}

export function checkAction(unchecked: UncheckedAction, context: GateContext): GateDecision {
  // Only the fields the gate reads, so nothing else a caller passes along can reach the shape check or the record.
  const resolved: UncheckedAction = {
    action: unchecked.action,
    ...(unchecked.element ? { element: unchecked.element } : {}),
  };
  const verdict = decide(resolved, context);
  const level = RULE[verdict.rule];
  const recorded = { ...resolved, permission: level } as RecordedAction;
  return {
    level,
    rule: verdict.rule,
    recorded,
    ...(verdict.files ? { files: verdict.files } : {}),
    ...(verdict.plan && level === "allowed" ? { plan: verdict.plan } : {}),
  } as GateDecision;
}

function decide(unchecked: UncheckedAction, context: GateContext): Verdict {
  // Anything that is not one of the protocol's actions, with its resolved element where one is needed, is not
  // something Yumi can do: there is no shell, no AppleScript, and no free-form tool (SPEC-07 r3).
  const shape = validate("RecordedAction", { ...unchecked, permission: "blocked" });
  if (!shape.valid) return { rule: "notATypedAction" };

  const { action, element } = unchecked;
  const app = context.app;

  if (isGuiAction(action) && app !== undefined) {
    const blockedApp = BLOCKED_APPS.find((entry) => entry.names.some((name) => sameName(name, app)));
    if (blockedApp) return { rule: blockedApp.rule };
    if (SYSTEM_SETTINGS_APPS.some((name) => sameName(name, app))) return { rule: "changeSystemSettings" };
  }
  if (closesWindow(action, element, context.layer))
    return { rule: context.mayCloseWindow === true ? "closeYumiWindow" : "closeUserWindow" };

  switch (action.kind) {
    case ACTION.click:
      return checkClick(element!.label, app);
    case ACTION.clickAt:
      // A vision click has no label to read, so it is a click no rule classifies.
      return checkClick(undefined, app);
    case ACTION.key:
      return checkKey(action.combo, app);
    case ACTION.setValue:
    case ACTION.type:
    case ACTION.scroll:
      return { rule: "clickOrType" };
    case ACTION.ask:
    case ACTION.finish:
      return { rule: "noEffect" };
    case ACTION.tool:
      return checkTool(action.call, realHome(context.home));
  }
}

/**
 * A click on a close button or a Close menu item, or a close shortcut (`CLOSE_LABELS`, `CLOSE_COMBOS`). A Close button
 * in a sheet or dialog in front dismisses that layer, not the window under it, so it is an ordinary click: the Mac app
 * reads only the sheet's elements while one is open, and a dialog is its own window with subrole AXDialog.
 */
export function closesWindow(action: ModelAction, element: ResolvedElement | undefined, layer?: LayerKind | undefined): boolean {
  if (action.kind === ACTION.click && element !== undefined) {
    if (layer === "sheet" || layer === "dialog") return false;
    return CLOSE_LABELS.some((label) => normalizeLabel(label) === normalizeLabel(element.label));
  }
  if (action.kind === ACTION.key) {
    const combo = canonicalCombo(action.combo);
    return combo !== undefined && CLOSE_COMBOS.some((close) => canonicalCombo(close) === combo);
  }
  return false;
}

function isGuiAction(action: ModelAction): boolean {
  const gui: string[] = [ACTION.click, ACTION.clickAt, ACTION.key, ACTION.setValue, ACTION.type, ACTION.scroll];
  return gui.includes(action.kind);
}

function sameName(a: string, b: string): boolean {
  return normalizeLabel(a) === normalizeLabel(b);
}

/** The strictest of several rules: blocked over ask over allowed. */
function strictest(rules: readonly RuleId[]): RuleId | undefined {
  const order: PermissionLevel[] = ["blocked", "ask", "allowed"];
  for (const level of order) {
    const rule = rules.find((r) => RULE[r] === level);
    if (rule) return rule;
  }
  return undefined;
}

/** SPEC-07 r6: risk from the element's label, then the risky-app rule with its safe labels. */
function checkClick(label: string | undefined, app: string | undefined): Verdict {
  if (label !== undefined) {
    const normalized = normalizeLabel(label);
    const matched = LABEL_RULES.filter((rule) => {
      const word = normalizeLabel(rule.label);
      return normalized === word || normalized.startsWith(`${word} `);
    }).map((rule) => rule.rule);
    const rule = strictest(matched);
    if (rule) return { rule };
  }
  const risky = riskyApp(app);
  if (risky === "notRisky") return { rule: "clickOrType" };
  if (risky !== "unknown" && label !== undefined && risky.safeLabels.some((safe) => sameName(safe, label))) {
    return { rule: "safeLabel" };
  }
  return { rule: "unclassified" };
}

/**
 * The risky-app entry for an app, "notRisky", or "unknown" when the Mac app did not report the app: then the gate
 * cannot tell whether it is a risky app, so it cannot classify the action.
 */
function riskyApp(app: string | undefined): (typeof RISKY_APPS)[number] | "notRisky" | "unknown" {
  if (app === undefined) return "unknown";
  return RISKY_APPS.find((entry) => sameName(entry.name, app)) ?? "notRisky";
}

/** SPEC-07 r6: key presses from the per-app list. Any other key press asks in a risky app and is allowed elsewhere. */
function checkKey(combo: string, app: string | undefined): Verdict {
  const canonical = canonicalCombo(combo);
  if (canonical === undefined) return { rule: "unclassified" };
  const matched = KEY_RULES.filter(
    (rule) =>
      canonicalCombo(rule.combo) === canonical && (rule.app === undefined || (app !== undefined && sameName(rule.app, app))),
  ).map((rule) => rule.rule);
  const rule = strictest(matched);
  if (rule) return { rule };
  return { rule: riskyApp(app) === "notRisky" ? "clickOrType" : "unclassified" };
}

/** SPEC-07 r1, r3, and OBJ-37.4: the typed tools. */
function checkTool(call: ToolCall, home: string): Verdict {
  switch (call.tool) {
    case "open_app": {
      const blocked = BLOCKED_APPS.find(
        (entry) =>
          (call.name !== undefined && entry.names.some((name) => sameName(name, call.name!))) ||
          (call.bundleId !== undefined && entry.bundleIds.some((id) => nameKey(id) === nameKey(call.bundleId!))),
      );
      return { rule: blocked?.rule ?? "openApp" };
    }
    case "open_url":
      return { rule: "openUrl" };
    case "open_file":
      return checkOpenFile(call.path, call.bundleId, home);
    case "reveal_in_finder":
      return checkPath(call.tool, call.path, home, "entry", "revealInFinder");
    case "read_file":
      return checkPath(call.tool, call.path, home, "target", "readFile");
    case "list_dir":
      return checkPath(call.tool, call.path, home, "target", "listFolder");
    case "write_new_file":
      return checkPath(call.tool, call.path, home, "entry", "createFile");
    case "copy":
    case "move":
      return checkCopyOrMove(call.tool, call.from, call.to, home);
    case "move_to_trash": {
      const check = checkTrash(call.paths, home);
      return check.level === "ask" ? { rule: check.rule, files: check.files } : { rule: check.rule };
    }
    case "phone":
      return { rule: PHONE_TOOL_LEVELS[call.call.tool] };
  }
}

function checkPath(
  tool: Extract<FilePlan, { path: string }>["tool"],
  raw: string,
  home: string,
  mode: "target" | "entry",
  allowed: RuleId,
): Verdict {
  const resolved = resolvePath(raw, home, mode);
  if (!resolved.ok) return { rule: resolved.rule };
  const problem = pathProblem(resolved.path, home);
  if (problem) return { rule: problem };
  return { rule: allowed, plan: { tool, path: resolved.path } };
}

/** Opening runs scripts, installers, and apps, so those are blocked, as is opening anything with a shell app. */
function checkOpenFile(raw: string, bundleId: string | undefined, home: string): Verdict {
  const verdict = checkPath("open_file", raw, home, "target", "openFile");
  if (!verdict.plan || verdict.plan.tool !== "open_file") return verdict;
  if (bundleId !== undefined) {
    const blocked = BLOCKED_APPS.find((entry) => entry.bundleIds.some((id) => nameKey(id) === nameKey(bundleId)));
    if (blocked) return { rule: blocked.rule };
  }
  const path = verdict.plan.path;
  const extension = nameKey(extname(path));
  if ((INSTALLER_EXTENSIONS as readonly string[]).includes(extension)) return { rule: "installSoftware" };
  if ((SCRIPT_EXTENSIONS as readonly string[]).includes(extension)) return { rule: "runScript" };
  if (entryKind(path) === "file" && (statSync(path).mode & 0o111) !== 0) return { rule: "runScript" };
  return verdict;
}

/**
 * Copy reads the source, so it follows a link; move moves the entry itself, and never a protected folder. The
 * destination is the new path, or an existing folder to put the item in (SPEC-07 r4 numbering happens when it runs).
 */
function checkCopyOrMove(tool: "copy" | "move", rawFrom: string, rawTo: string, home: string): Verdict {
  const from = resolvePath(rawFrom, home, tool === "copy" ? "target" : "entry");
  if (!from.ok) return { rule: from.rule };
  const fromProblem = pathProblem(from.path, home);
  if (fromProblem) return { rule: fromProblem };
  if (tool === "move" && isProtectedFolder(from.path, home)) return { rule: "protectedFolder" };

  const to = destination(from.path, rawTo, home);
  if (!to.ok) return { rule: to.rule };
  const toProblem = pathProblem(to.path, home);
  if (toProblem) return { rule: toProblem };
  return { rule: "copyOrMove", plan: { tool, from: from.path, to: to.path } };
}

/**
 * Where a copy or move lands. `to` is the new path, unless it is an existing folder with another name than the
 * item, in which case the item goes inside it with its own name.
 */
function destination(from: string, rawTo: string, home: string): ReturnType<typeof resolvePath> {
  const entry = resolvePath(rawTo, home, "entry");
  if (!entry.ok) return entry;
  const target = resolvePath(rawTo, home, "target");
  if (!target.ok) return target;
  if (isFolder(target.path) && nameKey(basename(entry.path)) !== nameKey(basename(from))) {
    return { ok: true, path: join(target.path, basename(from)) };
  }
  return entry;
}
