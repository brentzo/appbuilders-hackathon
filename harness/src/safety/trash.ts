import { readdirSync } from "node:fs";
import { basename, dirname, extname, join, sep } from "node:path";
import type { FileSummary } from "@yumi/protocol/types";
import { entryKind, hasWildcard, homeRelative, isProtectedFolder, nameKey, pathProblem, resolvePath } from "./paths.ts";
import { APP_BUNDLE_EXTENSION, PACKAGE_EXTENSIONS, type RuleId } from "./rules.ts";

/**
 * The checks for `move_to_trash` (SPEC-07 r7-r10, OBJ-42.6). A delete is never allowed outright: it either asks,
 * with a `FileSummary` built from the real file list, or it is blocked. Approving, checking the list again, and
 * moving to the Trash are OBJ-43.
 */

export type TrashCheck = { level: "ask"; rule: "delete"; files: FileSummary } | { level: "blocked"; rule: RuleId };

/** SPEC-07 r10: the card shows the first 5 names. */
export const FIRST_NAMES = 5;

export function checkTrash(paths: readonly string[], home: string): TrashCheck {
  // r8: wildcards are rejected before anything else runs, including any look at the file system.
  if (paths.length === 0 || paths.some((path) => typeof path !== "string" || hasWildcard(path))) {
    return { level: "blocked", rule: "inexactPath" };
  }

  // The entry each path names: a link is moved to the Trash itself, so only the folders above it are resolved.
  const roots: string[] = [];
  for (const raw of paths) {
    const resolved = resolvePath(raw, home, "entry");
    if (!resolved.ok) return { level: "blocked", rule: resolved.rule };
    const problem = rootProblem(resolved.path, home);
    if (problem) return { level: "blocked", rule: problem };
    if (!roots.some((root) => nameKey(root) === nameKey(resolved.path))) roots.push(resolved.path);
  }

  const entries: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    const key = nameKey(path);
    if (!seen.has(key)) {
      seen.add(key);
      entries.push(path);
    }
  };
  for (const root of roots) {
    const problem = expand(root, add);
    if (problem) return { level: "blocked", rule: problem };
  }

  const firstNames = entries.slice(0, FIRST_NAMES).map((path) => basename(path));
  return {
    level: "ask",
    rule: "delete",
    files: { folder: commonFolder(roots), count: entries.length, firstNames, allPaths: entries },
  };
}

/** r9 for one requested path, which must also exist so the summary comes from real files (r10). */
function rootProblem(path: string, home: string): RuleId | undefined {
  if (isProtectedFolder(path, home)) return "protectedFolder";
  const problem = pathProblem(path, home);
  if (problem) return problem;
  if (homeRelative(path, home)!.some(isAppBundleName)) return "appBundle";
  if (entryKind(path) === "missing") return "missingPath";
  return undefined;
}

/**
 * Every file a delete moves (r8): a file, link, or document package is one entry; a folder is opened up, in name
 * order, and an empty folder is one entry so it is still listed. An app bundle anywhere inside blocks the delete.
 */
function expand(path: string, add: (path: string) => void): RuleId | undefined {
  const kind = entryKind(path);
  if (kind !== "folder") {
    add(path);
    return undefined;
  }
  if (isAppBundleName(basename(path))) return "appBundle";
  if (isPackageName(basename(path))) {
    add(path);
    return undefined;
  }
  const children = readdirSync(path).sort(byFinderName);
  if (children.length === 0) add(path);
  for (const child of children) {
    const problem = expand(join(path, child), add);
    if (problem) return problem;
  }
  return undefined;
}

function isAppBundleName(name: string): boolean {
  return nameKey(extname(name)) === APP_BUNDLE_EXTENSION;
}

function isPackageName(name: string): boolean {
  return (PACKAGE_EXTENSIONS as readonly string[]).includes(nameKey(extname(name)));
}

/** Names in the order Finder lists them: ignoring case, with numbers compared as numbers. */
function byFinderName(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
}

/** The folder the requested paths are in: their shared parent folder. */
function commonFolder(roots: readonly string[]): string {
  let folder = dirname(roots[0]!);
  for (const root of roots.slice(1)) {
    while (!isInside(dirname(root), folder)) folder = dirname(folder);
  }
  return folder;
}

function isInside(path: string, folder: string): boolean {
  const pathKey = nameKey(path);
  const folderKey = nameKey(folder);
  return pathKey === folderKey || pathKey.startsWith(folderKey.endsWith(sep) ? folderKey : folderKey + sep);
}
