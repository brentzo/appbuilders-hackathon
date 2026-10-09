import type { PermissionLevel, PhoneToolCall } from "@yumi/protocol/types";

/**
 * The SPEC-07 permission table as data, in one place. The gate (`gate.ts`) only applies these rules; it never
 * invents a level, and nothing the model writes or the screen shows can change one. A change here is a change to
 * SPEC-07: add a rule only with a spec change.
 *
 * Names and labels are compared after `normalizeLabel`: case, repeated spaces, Unicode form, and a trailing
 * ellipsis do not matter, because Mac volumes and menus are not consistent about them.
 */

/**
 * Why the gate chose a level. Every decision names exactly one rule, for the log and for OBJ-38, which turns a
 * blocked or asking decision into the right card. The first group are the rows of the SPEC-07 r1 table.
 */
export const RULE = {
  // Allowed (SPEC-07 r1).
  readFile: "allowed",
  listFolder: "allowed",
  openApp: "allowed",
  openFile: "allowed",
  openUrl: "allowed",
  revealInFinder: "allowed",
  clickOrType: "allowed",
  createFile: "allowed",
  copyOrMove: "allowed",
  /** Asking the user a question or finishing an attempt changes nothing on the Mac. */
  noEffect: "allowed",
  /** A click on a label from a risky app's safe-label list (SPEC-07 Decisions, 2026-10-09). */
  safeLabel: "allowed",
  /** Phone tools: a stand-in until SPEC-09 and SPEC-10 give their levels (see PHONE_TOOL_LEVELS). */
  phoneTool: "allowed",
  /** Closing a window Yumi opened for this task, or any window in Auto mode (SPEC-07, decided 2026-10-10). */
  closeYumiWindow: "allowed",

  // Ask every time (SPEC-07 r1 and r6).
  send: "ask",
  delete: "ask",
  /** A click or key press in a risky app that no rule classifies (SPEC-07 r6). */
  unclassified: "ask",

  // Blocked (SPEC-07 r1, r2, r3, r8, r9).
  /** Anything that is not one of the typed actions and tools, such as a shell command or AppleScript (r3). */
  notATypedAction: "blocked",
  shellCommand: "blocked",
  installSoftware: "blocked",
  payment: "blocked",
  emptyTrash: "blocked",
  quitApp: "blocked",
  /** Any action in System Settings: the table blocks changing system settings (SPEC-07 r6). */
  changeSystemSettings: "blocked",
  /**
   * Closing a window Yumi did not open for this task (SPEC-07, decided 2026-10-10 by Brent). The spec says it asks,
   * like a send or a delete; it is blocked until the general approval card (OBJ-56) exists, then becomes "ask".
   */
  closeUserWindow: "blocked",
  /** Deleting without the Trash. SPEC-07 r7: nothing is ever deleted permanently. */
  deletePermanently: "blocked",
  runScript: "blocked",
  secretLocation: "blocked",
  outsideHome: "blocked",
  library: "blocked",
  dotfile: "blocked",
  /** A path that is not exact: relative, empty, or with a wildcard character (r8). */
  inexactPath: "blocked",
  /** The home folder, Desktop, Documents, Downloads, or a Library folder itself (r9). */
  protectedFolder: "blocked",
  appBundle: "blocked",
  /** A delete that names a path with nothing at it, so there is no real file list to show (r10). */
  missingPath: "blocked",
} as const satisfies Record<string, PermissionLevel>;

export type RuleId = keyof typeof RULE;

/** SPEC-07 r2: never read, listed, written, or deleted. Relative to the home folder. */
export const SECRET_LOCATIONS = [
  ".ssh",
  ".gnupg",
  ".aws",
  "Library/Keychains",
  // Browser profile folders.
  "Library/Safari",
  "Library/Containers/com.apple.Safari",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Chromium",
  "Library/Application Support/Firefox",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Arc",
  "Library/Application Support/com.operasoftware.Opera",
  "Library/Application Support/Vivaldi",
] as const;

/** SPEC-07 r9: never deleted or moved themselves. Relative to the home folder; "" is the home folder. */
export const PROTECTED_FOLDERS = ["", "Desktop", "Documents", "Downloads", "Library"] as const;

/** The Library folder in the home folder. Nothing in it is read, written, or deleted (SPEC-07 r1). */
export const LIBRARY_FOLDER = "Library";

/**
 * Folders that are one document to the user: counted as one file in a delete (SPEC-07 r10), never opened up.
 * App bundles (`.app`) are packages too, but a delete that includes one is blocked (r9).
 */
export const PACKAGE_EXTENSIONS = [
  ".key",
  ".pages",
  ".numbers",
  ".rtfd",
  ".band",
  ".logicx",
  ".photoslibrary",
  ".musiclibrary",
  ".imovielibrary",
  ".fcpbundle",
  ".bundle",
  ".plugin",
  ".framework",
] as const;

export const APP_BUNDLE_EXTENSION = ".app";

/** Opening one of these runs it: blocked as "running downloaded scripts" (r1). Yumi cannot tell where a file came from, so every script is treated as downloaded. */
export const SCRIPT_EXTENSIONS = [
  ".sh",
  ".command",
  ".tool",
  ".zsh",
  ".bash",
  ".csh",
  ".ksh",
  ".fish",
  ".py",
  ".rb",
  ".pl",
  ".php",
  ".js",
  ".jar",
  ".scpt",
  ".scptd",
  ".applescript",
  ".workflow",
  ".action",
  ".terminal",
  ".shortcut",
] as const;

/** Opening one of these installs or runs software: blocked as "installing software" (r1). */
export const INSTALLER_EXTENSIONS = [".pkg", ".mpkg", ".dmg", APP_BUNDLE_EXTENSION] as const;

/**
 * SPEC-07 r3: apps that run shell commands or scripts, or install software. Yumi never opens them, opens files with
 * them, or acts in them, because that is a shell by another route. Matched by name or bundle id.
 */
export const BLOCKED_APPS: readonly { names: readonly string[]; bundleIds: readonly string[]; rule: RuleId }[] = [
  { names: ["Terminal"], bundleIds: ["com.apple.Terminal"], rule: "shellCommand" },
  { names: ["iTerm", "iTerm2"], bundleIds: ["com.googlecode.iterm2"], rule: "shellCommand" },
  { names: ["Script Editor"], bundleIds: ["com.apple.ScriptEditor2"], rule: "shellCommand" },
  { names: ["Automator"], bundleIds: ["com.apple.Automator"], rule: "shellCommand" },
  { names: ["Installer"], bundleIds: ["com.apple.installer"], rule: "installSoftware" },
];

/**
 * SPEC-07 r6, element labels. A label matches when it is the word or starts with the word and a space, so
 * "Quit Keynote" and "Empty Trash…" match. When several match, blocked wins over ask.
 */
export const LABEL_RULES: readonly { label: string; rule: RuleId }[] = [
  { label: "Send", rule: "send" },
  { label: "Delete", rule: "delete" },
  { label: "Move to Trash", rule: "delete" },
  { label: "Empty Trash", rule: "emptyTrash" },
  { label: "Buy", rule: "payment" },
  { label: "Pay", rule: "payment" },
  { label: "Install", rule: "installSoftware" },
  { label: "Quit", rule: "quitApp" },
  { label: "Force Quit", rule: "quitApp" },
  // Finder's "Delete Immediately…" skips the Trash (r7). Without this rule it would only ask, as a "Delete".
  { label: "Delete Immediately", rule: "deletePermanently" },
];

/**
 * SPEC-07 r6: every action in System Settings is blocked, because the table blocks changing system settings. Yumi
 * never needs it; the user grants permissions themselves. "System Preferences" is the same app before macOS 13.
 * Opening it is not an action in it, so `open_app` is not affected.
 */
export const SYSTEM_SETTINGS_APPS = ["System Settings", "System Preferences"] as const;

/**
 * SPEC-07 r6 and Decisions: apps where a click or key press no rule classifies asks. In every other app, unlisted
 * clicks and key presses are allowed.
 *
 * Each risky app has a short list of safe click labels, which are allowed. A label matches only as the whole label.
 * Brent chose this on 2026-10-09 (SPEC-07 Decisions) so demo task 2 asks only before Send. Add a label only with a
 * change to SPEC-07.
 */
export const RISKY_APPS: readonly { name: string; safeLabels: readonly string[] }[] = [
  { name: "Mail", safeLabels: ["New Message", "Attach"] },
  { name: "Messages", safeLabels: [] },
  { name: "WhatsApp", safeLabels: [] },
  { name: "Finder", safeLabels: [] },
];

/**
 * SPEC-07 r6, key presses, in the canonical form of `canonicalCombo`. `app` is absent for rules in every app. A key
 * press no rule lists asks in a risky app and is allowed elsewhere, like a click.
 */
export const KEY_RULES: readonly { combo: string; app?: string; rule: RuleId }[] = [
  { combo: "cmd+q", rule: "quitApp" },
  { combo: "cmd+opt+escape", rule: "quitApp" },
  // Holding this force-quits the front app without the dialog: another way to force-quit (r1).
  { combo: "cmd+opt+shift+escape", rule: "quitApp" },
  { combo: "return", app: "Messages", rule: "send" },
  { combo: "cmd+return", app: "Mail", rule: "send" },
  { combo: "cmd+shift+d", app: "Mail", rule: "send" },
  { combo: "cmd+delete", app: "Finder", rule: "delete" },
  { combo: "cmd+shift+delete", app: "Finder", rule: "emptyTrash" },
  // Finder empties the Trash without asking, and deletes immediately (r7).
  { combo: "cmd+opt+shift+delete", app: "Finder", rule: "emptyTrash" },
  { combo: "cmd+opt+delete", app: "Finder", rule: "deletePermanently" },
];

/**
 * Phone tool levels. SPEC-09 and SPEC-10 have not given them yet (OBJ-37 Out of scope), so this is a stand-in: the
 * p0 phone tools set an alarm, set a timer, or open an app, which SPEC-09 r4 runs on the phone without asking.
 */
export const PHONE_TOOL_LEVELS: Record<PhoneToolCall["tool"], RuleId> = {
  set_alarm: "phoneTool",
  set_timer: "phoneTool",
  open_app: "phoneTool",
};

/** Lower case, NFC, single spaces, no trailing ellipsis. */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:…|\.\.\.)$/, "")
    .trim()
    .toLowerCase();
}

const MODIFIER_ORDER = ["cmd", "ctrl", "opt", "shift", "fn"] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  cmd: "cmd",
  command: "cmd",
  "⌘": "cmd",
  ctrl: "ctrl",
  control: "ctrl",
  "⌃": "ctrl",
  opt: "opt",
  option: "opt",
  alt: "opt",
  "⌥": "opt",
  shift: "shift",
  "⇧": "shift",
  fn: "fn",
};
const KEY_ALIASES: Record<string, string> = { esc: "escape", backspace: "delete", "⌫": "delete", "↩": "return" };

/**
 * A key combo with its modifiers in one fixed order and its aliases resolved, so "Shift+Cmd+Delete" and
 * "cmd+shift+backspace" are the same combo. Undefined when it is not a combo at all.
 */
export function canonicalCombo(combo: string): string | undefined {
  const parts = combo.toLowerCase().replace(/\s+/g, "").split("+");
  const key = parts.pop();
  if (!key) return undefined;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part];
    if (!modifier) return undefined;
    modifiers.add(modifier);
  }
  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  return [...ordered, KEY_ALIASES[key] ?? key].join("+");
}

/**
 * What closes a window (SPEC-07, decided 2026-10-10): the window's close button, whose accessibility label is
 * "close", the File menu's Close items, and their shortcuts. Compared after `normalizeLabel`, exactly.
 */
export const CLOSE_LABELS = ["close", "close window", "close all"] as const;
export const CLOSE_COMBOS = ["cmd+w", "cmd+opt+w", "cmd+shift+w"] as const;
