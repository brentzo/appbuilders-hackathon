import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Path, PermissionLevel, ToolCall } from "@yumi/protocol/types";
import type { LaneTools, ToolRunResult } from "../../src/scheduler/lanes.ts";

/**
 * STAND-IN FILE TOOLS, FOR TESTS ONLY (OBJ-05.8). OBJ-37.4 replaces this whole file with the typed file tools behind
 * the permission gate. Until then these let a helper read, list, and write files so the planner and scheduler can
 * be tested end to end.
 *
 * What they do NOT do, and OBJ-37 must: resolve symlinks, block `~/Library`, dotfiles, and secret locations
 * (SPEC-07 r2), or give a taken name a number (SPEC-07 r4). They only keep every path inside `home`, read text,
 * and refuse to replace a file. Never register them in a running harness.
 */

/** Longest observation line a step can store (`Step.observation`). */
const MAX_OBSERVATION = 300;

const TOOLS = [
  { name: "read_file", description: "Read a text file. Arguments: path." },
  { name: "list_dir", description: "List the names in a folder. Arguments: path." },
  { name: "write_new_file", description: "Create a new text file. Never replaces a file. Arguments: path, content." },
] as const;

export interface StandInFileToolsOptions {
  /** The folder `~/` means. Tests pass a temporary folder; never the real home folder. */
  home: string;
}

export function createStandInFileTools(options: StandInFileToolsOptions): LaneTools {
  const home = resolve(options.home);

  /** The absolute path, or undefined when it is outside `home`. */
  const locate = (path: Path): string | undefined => {
    const absolute = path.startsWith("~/") ? join(home, path.slice(2)) : resolve(path);
    const inside = relative(home, absolute);
    return inside.startsWith("..") || isAbsolute(inside) ? undefined : absolute;
  };

  const failed = (observation: string, description: string): ToolRunResult => ({ outcome: "error", observation, description });

  return {
    tools: TOOLS,
    permission(call: ToolCall): PermissionLevel {
      // SPEC-07 r1: reading, listing, and creating files need no approval. Anything else is not a tool here.
      return TOOLS.some((tool) => tool.name === call.tool) ? "allowed" : "blocked";
    },
    async run(call: ToolCall): Promise<ToolRunResult> {
      switch (call.tool) {
        case "read_file": {
          const path = locate(call.path);
          const name = basename(call.path);
          if (!path) return failed(`${call.path} is outside the home folder.`, `Could not read ${name}`);
          try {
            const text = await readFile(path, "utf8");
            return {
              outcome: "ok",
              observation: fit(`Read ${call.path}: ${JSON.stringify(text)}`),
              description: `Read ${name}`,
            };
          } catch {
            return failed(`Could not read ${call.path}.`, `Could not read ${name}`);
          }
        }
        case "list_dir": {
          const path = locate(call.path);
          const name = basename(call.path);
          if (!path) return failed(`${call.path} is outside the home folder.`, `Could not list ${name}`);
          try {
            const names = (await readdir(path)).filter((entry) => !entry.startsWith(".")).sort();
            return {
              outcome: "ok",
              observation: fit(`${call.path} has ${names.length} items: ${names.map((n) => JSON.stringify(n)).join(", ")}`),
              description: `Listed the folder ${name}`,
            };
          } catch {
            return failed(`Could not list ${call.path}.`, `Could not list ${name}`);
          }
        }
        case "write_new_file": {
          const path = locate(call.path);
          const name = basename(call.path);
          if (!path) return failed(`${call.path} is outside the home folder.`, `Could not create ${name}`);
          try {
            await mkdir(dirname(path), { recursive: true });
            // "wx" never replaces a file (SPEC-07 r4).
            await writeFile(path, call.content, { flag: "wx" });
            return {
              outcome: "ok",
              observation: fit(`Created ${call.path}.`),
              description: `Created ${name} in ${basename(dirname(path))}`,
            };
          } catch {
            return failed(`Could not create ${call.path}. A file with that name may already exist.`, `Could not create ${name}`);
          }
        }
        default:
          return failed(`The tool ${call.tool} is not available here.`, `Refused the tool ${call.tool}`);
      }
    },
  };
}

function fit(line: string): string {
  return line.length <= MAX_OBSERVATION ? line : `${line.slice(0, MAX_OBSERVATION - 3)}...`;
}
