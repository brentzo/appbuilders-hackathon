import { constants } from "node:fs";
import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, sep } from "node:path";
import type { ToolCall } from "@yumi/protocol/types";
import type { AgentToolResult } from "../agent/index.ts";
import type { JsonSchema } from "../agent/llm.ts";
import type { Logger } from "../log.ts";
import { checkAction, type FilePlan } from "../safety/gate.ts";
import { nameKey } from "../safety/paths.ts";
import { bundleType } from "../schema/bundle.ts";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

/**
 * The typed file tools (SPEC-07 r3 and r4, OBJ-42.4 and OBJ-42.5): `read_file`, `list_dir`, `write_new_file`,
 * `copy`, and `move`. There is no shell, no AppleScript, and no edit tool. Each tool takes only its protocol schema's
 * arguments and checks its own call with the permission gate when it runs, so a call that skipped the step loop is
 * still refused. Nothing here ever replaces a file: a taken name gets a number ("Report.pdf" becomes "Report 2.pdf"),
 * compared without regard to case as on a default Mac volume.
 *
 * `move_to_trash` is checked by the gate here but runs in OBJ-43, after the user taps Delete. `open_file`,
 * `open_app`, `open_url`, and `reveal_in_finder` run in the Mac app.
 */

export interface FileToolContext {
  /** The user's home folder. Tests pass a temporary one. */
  home: string;
  logger?: Logger | undefined;
}

/** The most bytes `read_file` returns, so one file cannot fill the model's context. */
export const MAX_READ_BYTES = 64 * 1024;
/** The most entries `list_dir` returns. */
export const MAX_LIST_ENTRIES = 500;
/** How many numbered names to try before giving up. */
const MAX_NUMBERED_NAMES = 10_000;

export interface FileToolDetails {
  /** The path the tool read, listed, or created. For copy and move, the new path. */
  path?: string;
  /** Why the tool did nothing: the gate's rule, or the file system's error code. */
  refused?: string;
}

type Result = AgentToolResult<FileToolDetails>;

export const FILE_TOOL_NAMES = ["read_file", "list_dir", "write_new_file", "copy", "move"] as const;
type FileToolName = (typeof FILE_TOOL_NAMES)[number];
type FileToolCall = Extract<ToolCall, { tool: FileToolName }>;
type FileToolArgs<T extends FileToolName> = Omit<Extract<ToolCall, { tool: T }>, "tool">;

const PROTOCOL_TYPE: Record<FileToolName, string> = {
  read_file: "ReadFileCall",
  list_dir: "ListDirCall",
  write_new_file: "WriteNewFileCall",
  copy: "CopyCall",
  move: "MoveCall",
};

const DESCRIPTION: Record<FileToolName, string> = {
  read_file: "Read a text file in the home folder.",
  list_dir: "List a folder in the home folder.",
  write_new_file: "Create a new text file. If the name is taken, the new file gets a number instead of replacing it.",
  copy: "Copy a file or folder. `to` is the new path, or a folder to copy into. A taken name gets a number.",
  move: "Move a file or folder. `to` is the new path, or a folder to move into. A taken name gets a number.",
};

export function registerFileTools(registry: ToolRegistry, context: FileToolContext): void {
  for (const definition of fileTools(context)) registry.register(definition);
}

export function fileTools(context: FileToolContext): ToolDefinition<never, FileToolDetails>[] {
  const handlers: { [T in FileToolName]: (args: FileToolArgs<T>) => Promise<Result> } = {
    read_file: (args) => run({ tool: "read_file", ...args }, context, (plan) => readText(plan)),
    list_dir: (args) => run({ tool: "list_dir", ...args }, context, (plan) => listFolder(plan)),
    write_new_file: (args) => run({ tool: "write_new_file", ...args }, context, (plan) => writeNew(plan, args.content)),
    copy: (args) => run({ tool: "copy", ...args }, context, (plan) => copyNoReplace(plan)),
    move: (args) => run({ tool: "move", ...args }, context, (plan) => moveNoReplace(plan)),
  };
  return FILE_TOOL_NAMES.map((name) => ({
    name,
    description: DESCRIPTION[name],
    parameters: argumentsSchema(PROTOCOL_TYPE[name]),
    handler: handlers[name] as (args: never) => Promise<Result>,
  }));
}

/** The protocol's call schema without its `tool` field, which the registry carries as the tool's name. */
function argumentsSchema(typeName: string): JsonSchema {
  const bundle = bundleType(typeName);
  const defs = bundle.$defs as Record<string, JsonSchema>;
  const call = structuredClone(defs[typeName]!) as { properties: Record<string, unknown>; required: string[] };
  delete call.properties.tool;
  call.required = call.required.filter((name) => name !== "tool");
  defs[typeName] = call;
  return bundle;
}

async function run(call: FileToolCall, context: FileToolContext, act: (plan: FilePlan) => Promise<Result>): Promise<Result> {
  const decision = checkAction({ action: { kind: "tool", call } }, { home: context.home });
  if (decision.level !== "allowed" || !decision.plan) {
    context.logger?.warn("tool.refused", { tool: call.tool, level: decision.level, rule: decision.rule });
    return failure("Yumi's safety rules do not allow this, so nothing was done.", decision.rule);
  }
  try {
    return await act(decision.plan);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    context.logger?.warn("tool.failed", { tool: call.tool, code });
    return failure(FILE_ERROR_TEXT[code] ?? "The file operation did not work, so nothing was changed.", code);
  }
}

/** What the model reads when the file system refuses. The model reads it; the user never does. */
const FILE_ERROR_TEXT: Record<string, string> = {
  ENOENT: "Nothing is at that path.",
  ENOTDIR: "A folder in that path is a file.",
  EISDIR: "That is a folder, not a file.",
  EACCES: "macOS did not allow access to that file.",
  EPERM: "macOS did not allow access to that file.",
  EXDEV: "That is on another disk, and moving between disks is not supported. Copy it instead.",
  EINVAL: "A folder cannot be copied or moved into itself.",
  ENOTEMPTY: "Something else was saved at the new path at the same moment, so nothing was moved.",
  ENOSPC: "The disk is full.",
  EEXIST: "Every numbered name for that file is taken.",
};

function failure(text: string, refused: string): Result {
  return { content: [{ type: "text", text }], details: { refused }, isError: true };
}

function success(text: string, path: string): Result {
  return { content: [{ type: "text", text }], details: { path } };
}

function planPath(plan: FilePlan): string {
  if (!("path" in plan)) throw new Error(`Expected a single-path plan for ${plan.tool}`);
  return plan.path;
}

function planFromTo(plan: FilePlan): { from: string; to: string } {
  if (!("from" in plan)) throw new Error(`Expected a copy or move plan for ${plan.tool}`);
  return plan;
}

async function readText(plan: FilePlan): Promise<Result> {
  const path = planPath(plan);
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    if (stats.isDirectory()) return failure("That is a folder. Use list_dir to see what is in it.", "EISDIR");
    const buffer = Buffer.alloc(Math.min(stats.size, MAX_READ_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    let text: string;
    try {
      // A cut at the limit can split a character, so only a complete file must be valid UTF-8.
      text = new TextDecoder("utf-8", { fatal: stats.size <= MAX_READ_BYTES }).decode(bytes);
      if (text.includes("\0")) throw new Error("binary");
    } catch {
      return failure(`This is not a text file (${stats.size} bytes), so it cannot be read as text.`, "binary");
    }
    const note = stats.size > MAX_READ_BYTES ? `\n\n[Only the first ${MAX_READ_BYTES} of ${stats.size} bytes.]` : "";
    return success(text + note, path);
  } finally {
    await handle.close();
  }
}

async function listFolder(plan: FilePlan): Promise<Result> {
  const path = planPath(plan);
  const entries = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));
  const lines = entries.slice(0, MAX_LIST_ENTRIES).map((entry) => `${entry.name}${entry.isDirectory() ? " (folder)" : ""}`);
  if (entries.length > MAX_LIST_ENTRIES) lines.push(`[and ${entries.length - MAX_LIST_ENTRIES} more]`);
  return success(lines.length > 0 ? lines.join("\n") : "The folder is empty.", path);
}

async function writeNew(plan: FilePlan, content: string): Promise<Result> {
  const requested = planPath(plan);
  await mkdir(dirname(requested), { recursive: true });
  const path = await withFreeName(requested, (candidate) => writeFile(candidate, content, { flag: "wx" }));
  return success(`Created ${path}.`, path);
}

async function copyNoReplace(plan: FilePlan): Promise<Result> {
  const { from, to } = planFromTo(plan);
  const source = await lstat(from);
  if (source.isDirectory()) refuseIntoItself(from, to);
  const path = source.isDirectory()
    ? await withFreeName(to, async (candidate) => {
        // The empty folder holds the name; its new children are copied in one by one and never overwrite anything.
        await mkdir(candidate);
        for (const child of await readdir(from)) {
          await cp(join(from, child), join(candidate, child), {
            recursive: true,
            force: false,
            errorOnExist: true,
            verbatimSymlinks: true,
          });
        }
      })
    : await withFreeName(to, (candidate) => copyFile(from, candidate, constants.COPYFILE_EXCL));
  return success(`Copied to ${path}.`, path);
}

/**
 * A move that cannot replace anything. A file gets its new name as a hard link, which fails if the name is taken,
 * and then loses the old name; a link is recreated the same way; a folder is renamed onto an empty folder that holds
 * the new name. The data is never copied or removed.
 */
async function moveNoReplace(plan: FilePlan): Promise<Result> {
  const { from, to } = planFromTo(plan);
  const source = await lstat(from);
  let path: string;
  if (source.isDirectory()) {
    refuseIntoItself(from, to);
    path = await withFreeName(to, async (candidate) => {
      await mkdir(candidate);
      try {
        await rename(from, candidate);
      } catch (error) {
        await rmdir(candidate);
        throw error;
      }
    });
  } else if (source.isSymbolicLink()) {
    const target = await readlink(from);
    path = await withFreeName(to, (candidate) => symlink(target, candidate));
    await unlink(from);
  } else {
    path = await withFreeName(to, (candidate) => link(from, candidate));
    await unlink(from);
  }
  return success(`Moved to ${path}.`, path);
}

/** A folder cannot be copied or moved into itself. */
function refuseIntoItself(from: string, to: string): void {
  const fromKey = nameKey(from);
  const toKey = nameKey(to);
  if (toKey === fromKey || toKey.startsWith(`${fromKey}${sep}`)) {
    throw Object.assign(new Error("Into itself"), { code: "EINVAL" });
  }
}

/**
 * SPEC-07 r4: runs `create` with the requested name, or the first numbered name that is free, compared without
 * regard to case. `create` must fail with EEXIST when the name is taken, so a file saved at the same moment is never
 * replaced either.
 */
async function withFreeName(requested: string, create: (path: string) => Promise<unknown>): Promise<string> {
  const folder = dirname(requested);
  const name = basename(requested);
  const taken = new Set((await readdir(folder)).map(nameKey));
  for (let n = 1; n <= MAX_NUMBERED_NAMES; n++) {
    const candidate = numberedName(name, n);
    if (taken.has(nameKey(candidate))) continue;
    try {
      await create(join(folder, candidate));
      return join(folder, candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      taken.add(nameKey(candidate));
    }
  }
  throw Object.assign(new Error("No free name"), { code: "EEXIST" });
}

/** "Report.pdf" as the nth name: "Report.pdf", "Report 2.pdf", "Report 3.pdf". */
export function numberedName(name: string, n: number): string {
  if (n === 1) return name;
  const extension = extname(name);
  return `${name.slice(0, name.length - extension.length)} ${n}${extension}`;
}
