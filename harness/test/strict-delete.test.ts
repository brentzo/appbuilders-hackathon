import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@yumi/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkTrash } from "../src/safety/trash.ts";
import { tempHome, tool } from "./safety-helpers.ts";

let home: string;
let real: string;
let file: (relative: string, content?: string) => string;
let cleanup: () => void;

beforeEach(() => {
  ({ home, file, cleanup } = tempHome());
  real = realpathSync(home);
});

afterEach(() => cleanup());

const trash = (...paths: string[]) => tool({ tool: "move_to_trash", paths }, home);
const at = (relative: string) => join(real, relative);

/** Everything in the temporary home, to show a check moved nothing. */
function snapshot(): string[] {
  return (readdirSync(home, { recursive: true, encoding: "utf8" }) as string[]).sort();
}

describe("move_to_trash checks (SPEC-07 r7-r10)", () => {
  it("always asks, with a FileSummary from the real file list that is valid against the contract", () => {
    const invoices = Array.from({ length: 12 }, (_, i) => `invoice-${String(i + 1).padStart(2, "0")}.pdf`);
    for (const name of invoices) file(`Downloads/${name}`);
    const decision = trash(...invoices.map((name) => `~/Downloads/${name}`));
    expect(decision).toMatchObject({ level: "ask", rule: "delete" });
    expect(decision.files).toEqual({
      folder: at("Downloads"),
      count: 12,
      firstNames: invoices.slice(0, 5),
      allPaths: invoices.map((name) => at(`Downloads/${name}`)),
    });
    expect(validate("FileSummary", decision.files).valid).toBe(true);
  });

  it("a folder is opened up and every file in it is counted (r8)", () => {
    file("Downloads/old/a.pdf");
    file("Downloads/old/b.pdf");
    file("Downloads/old/nested/c.pdf");
    file("Downloads/old/.DS_Store");
    mkdirSync(at("Downloads/old/empty"));
    const decision = trash("~/Downloads/old");
    expect(decision.level).toBe("ask");
    expect(decision.files).toEqual({
      folder: at("Downloads"),
      count: 5,
      firstNames: [".DS_Store", "a.pdf", "b.pdf", "empty", "c.pdf"],
      allPaths: [
        at("Downloads/old/.DS_Store"),
        at("Downloads/old/a.pdf"),
        at("Downloads/old/b.pdf"),
        at("Downloads/old/empty"),
        at("Downloads/old/nested/c.pdf"),
      ],
    });
  });

  it("a document package counts as one file", () => {
    file("Documents/Deck.key/Index.zip");
    file("Documents/Deck.key/Data/image.png");
    expect(trash("~/Documents/Deck.key").files).toMatchObject({ count: 1, firstNames: ["Deck.key"] });
  });

  it("files in several folders name their shared folder, and a path listed twice counts once", () => {
    file("Downloads/a.pdf");
    file("Desktop/b.pdf");
    const decision = trash("~/Downloads/a.pdf", "~/Desktop/b.pdf", "~/Downloads/A.pdf");
    expect(decision.files).toMatchObject({ folder: real, count: 2, firstNames: ["a.pdf", "b.pdf"] });
  });

  it("a link is moved to the Trash itself, so only the link is listed, never what it points to", () => {
    symlinkSync(at("Documents"), at("Desktop/Documents shortcut"));
    expect(trash("~/Desktop/Documents shortcut").files).toMatchObject({ count: 1, allPaths: [at("Desktop/Documents shortcut")] });
  });

  it("a link into a protected or secret place cannot be used to name it", () => {
    symlinkSync(real, at("Desktop/home"));
    symlinkSync(at(".ssh"), at("Desktop/ssh"));
    expect(trash("~/Desktop/home/Documents").rule).toBe("protectedFolder");
    expect(trash("~/Desktop/ssh/id_ed25519").rule).toBe("secretLocation");
  });

  it("blocks the home folder, Desktop, Documents, Downloads, and the Library folders themselves (r9)", () => {
    for (const path of [
      "~",
      "~/",
      "~/Desktop",
      "~/Documents",
      "~/Downloads/",
      "~/Library",
      "~/documents",
      "/Library",
      "/System/Library",
    ]) {
      expect(trash(path).level, path).toBe("blocked");
    }
    expect(trash("~/Desktop").rule).toBe("protectedFolder");
  });

  it("blocks app bundles, dotfiles, ~/Library, secret locations, and anything outside the home folder (r9)", () => {
    mkdirSync(at("Applications/Tool.app/Contents"), { recursive: true });
    file("Downloads/stuff/Old.app/Contents/Info.plist");
    file("Downloads/stuff/notes.txt");
    expect(trash("~/Applications/Tool.app").rule).toBe("appBundle");
    expect(trash("~/Applications/Tool.app/Contents").rule).toBe("appBundle");
    expect(trash("~/Downloads/stuff").rule).toBe("appBundle");
    expect(trash("~/.zshrc").rule).toBe("dotfile");
    expect(trash("~/Library/Preferences/com.apple.finder.plist").rule).toBe("library");
    expect(trash("~/.ssh/id_ed25519").rule).toBe("secretLocation");
    expect(trash("/etc/hosts").rule).toBe("outsideHome");
    expect(trash("/Applications/Safari.app").level).toBe("blocked");
  });

  it("one blocked path blocks the whole request", () => {
    file("Downloads/a.pdf");
    expect(trash("~/Downloads/a.pdf", "~/Documents").level).toBe("blocked");
  });

  it("a path with nothing at it is refused, because there is no real file list to show", () => {
    expect(trash("~/Downloads/gone.pdf")).toMatchObject({ level: "blocked", rule: "missingPath" });
  });

  it("checks wildcards before anything else, without touching the file system", () => {
    // A home that does not exist would fail any file system check; a wildcard is rejected before one runs.
    expect(checkTrash(["~/Downloads/a.pdf", "~/Downloads/*.pdf"], "/nonexistent-home")).toEqual({
      level: "blocked",
      rule: "inexactPath",
    });
  });
});

describe("Feature: Strict delete", () => {
  it("Scenario: Protected folder cannot be deleted", () => {
    file("Downloads/old-invoice.pdf");
    const before = snapshot();
    const decision = trash("~/Downloads");
    expect(decision).toMatchObject({ level: "blocked", rule: "protectedFolder" });
    expect(decision.files).toBeUndefined();
    expect(snapshot()).toEqual(before);
  });

  it("Scenario: Wildcards are rejected", () => {
    file("Downloads/a.pdf");
    const before = snapshot();
    // The Path contract already rejects * and ?, so the gate refuses the call before any delete check runs.
    expect(trash("~/Downloads/*.pdf").level).toBe("blocked");
    expect(trash("~/Downloads/report?.pdf").level).toBe("blocked");
    expect(existsSync(at("Downloads/a.pdf"))).toBe(true);
    expect(snapshot()).toEqual(before);
  });
});
