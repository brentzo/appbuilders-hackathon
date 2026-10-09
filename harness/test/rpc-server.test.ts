import { spawn, type ChildProcess } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@yumi/protocol";
import { PROTOCOL_VERSION } from "@yumi/protocol/types";
import { MemoryLogger } from "../src/log.ts";
import { HarnessAlreadyRunningError, HarnessRpcServer } from "../src/rpc/server.ts";
import { PROTOCOL_DIR, tempDir } from "./helpers.ts";

let dir: { path: string; cleanup: () => void };
let socketPath: string;
let logger: MemoryLogger;
let server: HarnessRpcServer | undefined;

beforeEach(() => {
  dir = tempDir();
  socketPath = join(dir.path, "harness.sock");
  logger = new MemoryLogger();
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  dir.cleanup();
});

/** A bare JSON-RPC client: one JSON message per line, as the contract says. */
async function rawClient(path: string) {
  const socket: Socket = await new Promise((resolve, reject) => {
    const s = connect(path, () => resolve(s)).once("error", reject);
  });
  socket.setEncoding("utf8");
  const lines: unknown[] = [];
  let buffer = "";
  const waiters: (() => void)[] = [];
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      lines.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
      waiters.splice(0).forEach((w) => w());
    }
  });
  return {
    send: (message: unknown) => socket.write(`${JSON.stringify(message)}\n`),
    next: async (): Promise<unknown> => {
      while (lines.length === 0) await new Promise<void>((resolve) => waiters.push(resolve));
      return lines.shift();
    },
    close: () => socket.destroy(),
  };
}

describe.skipIf(process.platform === "win32")("the local RPC server", () => {
  it("answers ping from a client on the socket", async () => {
    server = await HarnessRpcServer.start({ socketPath, logger });
    const client = await rawClient(socketPath);
    client.send({ jsonrpc: "2.0", id: 1, method: "ping", params: {} });
    expect(await client.next()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    client.close();
  });

  it("answers hello with its protocol version, and refuses another version with a UserError", async () => {
    server = await HarnessRpcServer.start({ socketPath, logger });
    const client = await rawClient(socketPath);
    client.send({ jsonrpc: "2.0", id: 1, method: "hello", params: { protocolVersion: PROTOCOL_VERSION } });
    expect(await client.next()).toEqual({ jsonrpc: "2.0", id: 1, result: { protocolVersion: PROTOCOL_VERSION } });

    const other = await rawClient(socketPath);
    other.send({ jsonrpc: "2.0", id: 1, method: "hello", params: { protocolVersion: PROTOCOL_VERSION + 1 } });
    // HelloParams accepts any version (protocol v3), so the harness's own check answers with a UserError.
    expect(await other.next()).toMatchObject({ id: 1, error: { code: -32000, data: { kind: "unexpected" } } });
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ event: "rpc.versionMismatch", app: PROTOCOL_VERSION + 1, harness: PROTOCOL_VERSION }),
    );
    expect(server.readyConnections).toBe(1);
    client.close();
    other.close();
  });

  it("answers an unknown method with -32601", async () => {
    server = await HarnessRpcServer.start({ socketPath, logger });
    const client = await rawClient(socketPath);
    client.send({ jsonrpc: "2.0", id: 7, method: "runShell", params: {} });
    expect(await client.next()).toMatchObject({ id: 7, error: { code: -32601 } });
    client.close();
  });

  it("only lets this user connect", async () => {
    server = await HarnessRpcServer.start({ socketPath, logger });
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
  });

  it("replaces a stale socket file left by a crash", async () => {
    writeFileSync(socketPath, "");
    server = await HarnessRpcServer.start({ socketPath, logger });
    const client = await rawClient(socketPath);
    client.send({ jsonrpc: "2.0", id: 1, method: "ping", params: {} });
    expect(await client.next()).toMatchObject({ result: {} });
    client.close();
  });

  it("refuses to start when another harness is listening", async () => {
    const other = createServer();
    await new Promise<void>((resolve) => other.listen(socketPath, resolve));
    try {
      await expect(HarnessRpcServer.start({ socketPath, logger })).rejects.toThrow(HarnessAlreadyRunningError);
    } finally {
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });

  it("sends events only to apps that said hello, and refuses payloads that break the contract", async () => {
    server = await HarnessRpcServer.start({ socketPath, logger });
    const client = await rawClient(socketPath);
    client.send({ jsonrpc: "2.0", id: 1, method: "ping", params: {} });
    await client.next();
    expect(server.emit("speak", { text: "Hi." })).toBe(0);

    client.send({ jsonrpc: "2.0", id: 2, method: "hello", params: { protocolVersion: PROTOCOL_VERSION } });
    await client.next();
    expect(server.emit("speak", { text: "Hi." })).toBe(1);
    expect(await client.next()).toEqual({ jsonrpc: "2.0", method: "speak", params: { text: "Hi." } });
    expect(() => server!.emit("speak", { words: "Hi." })).toThrow("Invalid payload");
    client.close();
  });
});

describe.skipIf(process.platform === "win32")("with the protocol's mock Mac app (npm run mock:mac)", () => {
  let mock: ChildProcess | undefined;
  let output = "";

  afterEach(() => {
    mock?.kill();
    mock = undefined;
    output = "";
  });

  async function startMockMac(): Promise<void> {
    mock = spawn("npm", ["run", "mock:mac", "--", "--socket", socketPath], {
      cwd: PROTOCOL_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    mock.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    mock.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    await waitFor(() => output.includes("[mock Mac app] connected"));
  }

  async function waitFor(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Timed out. Mock output:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("connects, says hello, receives events, and answers the harness's calls", async () => {
    server = await HarnessRpcServer.start({ socketPath, logger });
    await startMockMac();
    expect(server.readyConnections).toBe(1);
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "rpc.hello", protocolVersion: PROTOCOL_VERSION }));

    server.emit("speak", { text: "Done. I exported the deck." });
    await waitFor(() => output.includes('[mock Mac app] event speak {"text":"Done. I exported the deck."}'));

    const windows = await server.request("listWindows", {});
    expect(validate("WindowList", windows).valid).toBe(true);
  }, 30_000);
});
