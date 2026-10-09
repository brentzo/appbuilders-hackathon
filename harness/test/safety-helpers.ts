import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelAction, ResolvedElement, ToolCall } from "@yumi/protocol/types";
import { checkAction, type GateDecision } from "../src/safety/gate.ts";
import { tempDir } from "./helpers.ts";

/**
 * A temporary home folder on the real file system, laid out like a Mac's: the protected folders, a Library with
 * Keychains and a Chrome profile, and dot folders with secrets in them. Tests never touch the real home folder.
 */
export function tempHome(): { home: string; cleanup: () => void; file: (relative: string, content?: string) => string } {
  const dir = tempDir();
  const home = join(dir.path, "home");
  const file = (relative: string, content = "") => {
    const path = join(home, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  };
  for (const folder of ["Desktop", "Documents", "Downloads", "Library/Keychains", "Applications"]) {
    mkdirSync(join(home, folder), { recursive: true });
  }
  file(".ssh/id_ed25519", "PRIVATE KEY");
  file(".gnupg/secring.gpg", "PRIVATE KEY");
  file(".aws/credentials", "SECRET");
  file(".zshrc", "export PATH");
  file("Library/Keychains/login.keychain-db", "KEYCHAIN");
  file("Library/Application Support/Google/Chrome/Default/Cookies", "COOKIES");
  file("Library/Preferences/com.apple.finder.plist", "PLIST");
  return { home, cleanup: dir.cleanup, file };
}

export function tool(call: ToolCall, home: string): GateDecision {
  return checkAction({ action: { kind: "tool", call } }, { home });
}

export function click(label: string, app: string | undefined, role: ResolvedElement["role"] = "button"): GateDecision {
  return checkAction({ action: { kind: "click", element: 3 }, element: element(label, role) }, { home: "/nonexistent", app });
}

export function key(combo: string, app: string | undefined): GateDecision {
  return checkAction({ action: { kind: "key", combo } }, { home: "/nonexistent", app });
}

export function gui(action: ModelAction, app: string | undefined, resolved?: ResolvedElement): GateDecision {
  return checkAction({ action, ...(resolved ? { element: resolved } : {}) }, { home: "/nonexistent", app });
}

export function element(label: string, role: ResolvedElement["role"] = "button"): ResolvedElement {
  return { path: `/AXApplication/AXWindow[0]/AX${role}[${label}]`, role, label };
}
