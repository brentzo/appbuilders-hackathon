import { lstatSync, readlinkSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { LIBRARY_FOLDER, PROTECTED_FOLDERS, SECRET_LOCATIONS, type RuleId } from "./rules.ts";

/**
 * Path checks for the typed file tools and the delete checks (SPEC-07 r1, r2, r8, r9; OBJ-42.4). Every path is
 * resolved on the real file system, through `..` and every symlink, before it is checked, so a link into `~/.ssh`
 * is a path in `~/.ssh`. Names are compared without regard to case or Unicode form, as Mac volumes do by default.
 */

/** The most symlinks followed while resolving one path, as macOS's own limit (MAXSYMLINKS). */
const MAX_SYMLINKS = 32;

export type Resolution = { ok: true; path: string } | { ok: false; rule: RuleId };

/**
 * How a path is resolved:
 * - `target`: through every symlink, including the last one. For reading and opening: what gets read.
 * - `entry`: through every symlink except the last one. For writing, moving, and deleting: the entry that changes,
 *   which is the link itself when the path is a link.
 */
export type ResolveMode = "target" | "entry";

/** The real home folder. Resolved once, so a home under a symlinked folder (like /var on macOS) still matches. */
export function realHome(home: string): string {
  const resolved = resolveLinks(resolve(home), "target");
  if (!resolved.ok) throw new Error(`The home folder cannot be resolved: ${home}`);
  return resolved.path;
}

/**
 * Turns a path from a tool call into a real, absolute path. Only exact paths are accepted: absolute or starting
 * with `~/`, with no wildcard characters (r8) and no NUL.
 */
export function resolvePath(raw: string, home: string, mode: ResolveMode): Resolution {
  const expanded = expandPath(raw, home);
  if (expanded === undefined) return { ok: false, rule: "inexactPath" };
  return resolveLinks(expanded, mode);
}

/** `~/x` to an absolute path, normalized lexically. Undefined when the path is not exact. */
export function expandPath(raw: string, home: string): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.includes("\0") || hasWildcard(raw)) return undefined;
  if (raw.startsWith("~/")) return resolve(home, raw.slice(2));
  if (raw === "~") return resolve(home);
  if (isAbsolute(raw)) return resolve(raw);
  return undefined;
}

/** SPEC-07 r8: the wildcard characters the Path contract rejects. */
export function hasWildcard(raw: string): boolean {
  return /[*?]/.test(raw);
}

/**
 * Resolves symlinks one component at a time, so a dangling link is followed too: a write through a link to a folder
 * that does not exist yet must be checked where it would land, not where the link sits.
 */
function resolveLinks(absolute: string, mode: ResolveMode): Resolution {
  const pending = absolute.split(sep).filter(Boolean);
  let current: string = sep;
  let links = 0;
  while (pending.length > 0) {
    const part = pending.shift()!;
    if (part === ".") continue;
    if (part === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    const isLast = pending.length === 0;
    let isLink = false;
    try {
      isLink = lstatSync(next).isSymbolicLink();
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (isLink && (!isLast || mode === "target")) {
      if (++links > MAX_SYMLINKS) return { ok: false, rule: "inexactPath" };
      const target = readlinkSync(next);
      pending.unshift(...target.split(sep).filter(Boolean));
      if (isAbsolute(target)) current = sep;
      continue;
    }
    current = next;
  }
  return { ok: true, path: current };
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** For comparing names the way a default Mac volume does. */
export function nameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/**
 * The path's components below the home folder, compared and returned as name keys, or undefined when it is not
 * inside it. [] is the home folder.
 */
export function homeRelative(path: string, home: string): string[] | undefined {
  const pathKey = nameKey(path);
  const homeKey = nameKey(home);
  if (pathKey === homeKey) return [];
  const prefix = homeKey.endsWith(sep) ? homeKey : homeKey + sep;
  if (!pathKey.startsWith(prefix)) return undefined;
  return pathKey.slice(prefix.length).split(sep).filter(Boolean);
}

function startsWithParts(parts: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= parts.length && prefix.every((p, i) => nameKey(p) === nameKey(parts[i]!));
}

/**
 * What the file tools may touch (OBJ-42.4): inside the home folder, not in `~/Library`, not a dotfile or inside a
 * dot folder, and not a secret location. Undefined when the path is fine. A secret location is named as such even
 * though it is also a dotfile or in `~/Library`, so the log says why.
 */
export function pathProblem(path: string, home: string): RuleId | undefined {
  const parts = homeRelative(path, home);
  if (parts === undefined) return "outsideHome";
  if (SECRET_LOCATIONS.some((secret) => startsWithParts(parts, secret.split("/")))) return "secretLocation";
  if (startsWithParts(parts, [LIBRARY_FOLDER])) return "library";
  if (parts.some((part) => part.startsWith("."))) return "dotfile";
  return undefined;
}

/** SPEC-07 r9: the home folder, Desktop, Documents, Downloads, or a Library folder itself. */
export function isProtectedFolder(path: string, home: string): boolean {
  const parts = homeRelative(path, home);
  if (parts === undefined) return nameKey(basename(path)) === nameKey(LIBRARY_FOLDER);
  return PROTECTED_FOLDERS.some((folder) => {
    const folderParts = folder === "" ? [] : folder.split("/");
    return folderParts.length === parts.length && startsWithParts(parts, folderParts);
  });
}

/** What is at a real path, without following a final symlink. */
export function entryKind(path: string): "file" | "folder" | "link" | "other" | "missing" {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return "link";
    if (stats.isDirectory()) return "folder";
    if (stats.isFile()) return "file";
    return "other";
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw error;
  }
}

/** True when the path is an existing folder, following symlinks. */
export function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
