import { mkdirSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join, sep } from "node:path";
import type { Path } from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";

/**
 * Finds the files a `gui_act` attempt created or changed through an app, such as the PDF Keynote exported, which no
 * tool call names (SPEC-05 r4, objectives README G9). It watches the home folder for the length of the attempt with
 * the file system's own change events (FSEvents on macOS, through Node's recursive `fs.watch`), and reports a file
 * only if it still exists and was written after the attempt began. `~/Library` and hidden files and folders are
 * never reported: apps write caches and settings there all the time, and the file tools may not touch them either.
 *
 * Events arrive a little after the write, later when the Mac is busy, and a new watch goes live a little after it is
 * set up. So the watcher writes a marker file of its own in `~/Library/Application Support/Yumi` and waits for that file's event,
 * once before the attempt's first action and again before each report: events come in order, so every write before
 * the marker has been seen by then.
 *
 * It cannot tell who wrote a file: a download or another subtask writing at the same time is reported too.
 */

export interface FileChange {
  /** The path as the user would say it, starting with ~/. */
  path: Path;
  /** True when the file did not exist before the attempt; false when an existing file was changed. */
  created: boolean;
}

export interface FileWatch {
  /** Files created or changed since the last call, each reported once. */
  takeNew(): Promise<FileChange[]>;
  /** Every file created or changed during the attempt that still exists. */
  all(): Promise<FileChange[]>;
  close(): void;
}

/**
 * Starts watching, and resolves once the watch is live: changes made before then are not seen, and the file system
 * starts delivering events a little after the watch is set up, later on a busy Mac.
 */
export type WatchHome = (home: string, logger: Logger) => Promise<FileWatch>;

/** Document packages are folders that the user sees as one file. A change inside one is a change to the package. */
const PACKAGE = /\.(?:key|pages|numbers|rtfd|app|bundle|pkg|photoslibrary)$/i;

/** Some file systems round timestamps; a file written in the same second the attempt began still counts. */
const CLOCK_SLACK_MS = 1000;

/**
 * The marker's folder: Yumi's own support folder, under the home folder so the watch sees it, and in `~/Library`,
 * which is never reported. Not `~/Library/Caches`: on the development Mac, FSEvents sent nothing for it.
 */
const MARKER_DIR = ["Library", "Application Support", "Yumi"];

/** Each watcher has its own marker, so two attempts at once never take the other's marker for their own. */
let watchers = 0;

/** How long to wait for the marker's event before reporting what has arrived. */
const FLUSH_TIMEOUT_MS = 2000;
/** How often to write the marker again while waiting for its event. */
const MARKER_RETRY_MS = 100;

export const watchHome: WatchHome = async (home, logger) => {
  const startedMs = Date.now();
  const markerRelative = join(...MARKER_DIR, `file-watch-${process.pid}-${++watchers}`);
  const seen = new Set<string>();
  const reported: FileChange[] = [];
  let pending = new Set<string>();
  let markerEvents = 0;
  let wakeFlush: (() => void) | undefined;
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(home, { recursive: true }, (_event, name) => {
      if (name === null) return;
      if (String(name) === markerRelative) {
        markerEvents++;
        wakeFlush?.();
        return;
      }
      const relative = visibleFile(String(name));
      if (relative !== undefined) pending.add(relative);
    });
    watcher.on("error", (error) => logger.warn("gui.fileWatchFailed", describeError(error)));
  } catch (error) {
    // Without the watch, the attempt still runs; its result just cannot name files made through an app.
    logger.warn("gui.fileWatchFailed", describeError(error));
  }

  /**
   * Waits until every change made before now has arrived, or the timeout passes: writes the marker and waits for its
   * event, writing it again every so often, because a stream that has just started may miss the first write.
   */
  const flush = async (): Promise<boolean> => {
    if (!watcher) return false;
    const before = markerEvents;
    const deadline = Date.now() + FLUSH_TIMEOUT_MS;
    while (markerEvents === before && Date.now() < deadline && watcher) {
      try {
        mkdirSync(join(home, ...MARKER_DIR), { recursive: true });
        writeFileSync(join(home, markerRelative), String(Date.now()));
      } catch (error) {
        logger.warn("gui.fileWatchFlushFailed", describeError(error));
        return false;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(MARKER_RETRY_MS, Math.max(0, deadline - Date.now())));
        wakeFlush = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wakeFlush = undefined;
    }
    if (markerEvents > before) return true;
    logger.warn("gui.fileWatchSlow", { waitedMs: FLUSH_TIMEOUT_MS });
    return false;
  };

  const check = (relative: string): FileChange | undefined => {
    try {
      const stat = statSync(join(home, relative));
      const isFile = stat.isFile() || (stat.isDirectory() && PACKAGE.test(relative));
      if (!isFile || stat.mtimeMs < startedMs - CLOCK_SLACK_MS) return undefined;
      return { path: `~/${relative.split(sep).join("/")}`, created: stat.birthtimeMs >= startedMs - CLOCK_SLACK_MS };
    } catch {
      // Gone again, such as a temporary file an app renamed into place.
      return undefined;
    }
  };

  const takeNew = async (): Promise<FileChange[]> => {
    await flush();
    const names = [...pending];
    pending = new Set();
    const found: FileChange[] = [];
    for (const relative of names) {
      if (seen.has(relative)) continue;
      const change = check(relative);
      if (!change) continue;
      seen.add(relative);
      found.push(change);
      reported.push(change);
    }
    return found;
  };

  await flush();
  return {
    takeNew,
    async all() {
      await takeNew();
      return reported.filter((change) => check(change.path.slice(2)) !== undefined);
    },
    close() {
      watcher?.close();
      watcher = undefined;
      wakeFlush?.();
      rmSync(join(home, markerRelative), { force: true });
    },
  };
};

/**
 * The path to report for a change event, relative to the home folder: the package around it when there is one, and
 * nothing for `~/Library`, hidden files, or anything inside a hidden folder.
 */
function visibleFile(relative: string): string | undefined {
  const parts = relative.split(sep).filter((part) => part !== "");
  if (parts.length === 0 || parts[0] === "Library" || parts.some((part) => part.startsWith("."))) return undefined;
  const packageEnd = parts.findIndex((part) => PACKAGE.test(part));
  return (packageEnd >= 0 ? parts.slice(0, packageEnd + 1) : parts).join(sep);
}
