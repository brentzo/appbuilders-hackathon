import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where the harness listens: the user's Application Support folder on the Mac (OBJ-03), a temp file
 * elsewhere, and a named pipe on Windows, which has no Unix sockets in Node.
 */
export function defaultSocketPath(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Yumi", "harness.sock");
  if (process.platform === "win32") return "\\\\.\\pipe\\yumi-harness";
  return join(tmpdir(), "yumi-harness.sock");
}

/** Reads `--name value` options from argv. */
export function readArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args.set(arg.slice(2), "true");
      else args.set(arg.slice(2), next), i++;
    }
  }
  return args;
}

/** Parses `method=kind,method=kind` into a failure map. */
export function readFailures(value: string | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(value.split(",").map((pair) => pair.split("=") as [string, string]));
}
