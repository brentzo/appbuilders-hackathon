import { posix } from "node:path";

/**
 * File paths in model text, such as a plan's instructions or a worker's question, and the plain names the user sees
 * for them. Model text writes a name with spaces without quotes ("Open /Users/ana/Documents/Q3 Report.key in
 * Keynote"), so a path runs on past a space as far as a file extension, inside one line.
 */

/** A path in quotes: everything between the quotes. */
const QUOTED = /(["'`“‘])((?:~\/|\/(?!\/))[^"'`“”‘’\n]*)(["'`”’])/g;
/** A path whose last part ends with an extension. The last part may have spaces; the folders before it may not. */
const WITH_EXTENSION =
  /(?<![\w./])((?:~\/|\/(?!\/))(?:[^\s/"'`“”‘’]+\/)*[^/\n"'`“”‘’]*?\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s"'`“”‘’?!,;:)\]]|\.(?:\s|$))/g;
/** Any other path, such as a folder: up to the next space. */
const BARE = /(?<![\w./])((?:~\/|\/(?!\/))[^\s"'`“”‘’?!,;:)\]]*)/g;

/** The paths named in `text`, quoted ones and those with an extension first, each once, in the order found. */
export function pathsIn(text: string): string[] {
  const found: string[] = [];
  let rest = text.replace(QUOTED, (_, _open: string, path: string) => {
    found.push(trimEnd(path));
    return " ";
  });
  rest = rest.replace(WITH_EXTENSION, (path: string) => {
    found.push(path);
    return " ";
  });
  for (const match of rest.matchAll(BARE)) if (match[1]!.length > 1) found.push(trimEnd(match[1]!));
  return [...new Set(found)];
}

/**
 * `text` with every path replaced by the name the user knows it by: the file's name without its folders or
 * extension ("Q3 Report"), a folder's own name, and "your home folder" for the home folder itself.
 */
export function withPlainNames(text: string, home: string): string {
  const name = (path: string) => plainName(path, home);
  return text
    .replace(QUOTED, (_, open: string, path: string, close: string) => `${open}${name(path)}${close}`)
    .replace(WITH_EXTENSION, name)
    .replace(BARE, (path: string) => (path.length > 1 ? name(path) : path));
}

/** "Q3 Report" for `/Users/ana/Documents/Q3 Report.key`, "Documents" for a folder, "your home folder" for home. */
export function plainName(path: string, home: string): string {
  const full = posix.normalize(trimEnd(path).replace(/^~(?=\/|$)/, home)).replace(/\/+$/, "");
  if (full === posix.normalize(home).replace(/\/+$/, "") || full === "") return "your home folder";
  const base = posix.basename(full);
  const stem = base.replace(/\.[A-Za-z][A-Za-z0-9]{0,7}$/, "");
  return stem === "" ? base : stem;
}

function trimEnd(path: string): string {
  return path.replace(/[.:]+$/, "");
}
