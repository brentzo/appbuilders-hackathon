import { readdirSync } from "node:fs";
import { createServer, connect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exampleOf } from "../mocks/examples.ts";
import { connectMockMacApp } from "../mocks/mock-mac-app.ts";
import { loadScript, SCRIPT_DIR, startMockHarness } from "../mocks/mock-harness.ts";
import { loadRpcContract, RpcPeer, RpcRemoteError } from "../src/index.ts";

const contract = loadRpcContract();
const methods = (direction: "appToHarness" | "harnessToApp") =>
  Object.entries(contract.methods).filter(([, m]) => m.direction === direction);

let counter = 0;
function socketPath(): string {
  counter += 1;
  return process.platform === "win32" ? `\\\\.\\pipe\\yumi-test-${process.pid}-${counter}` : join(tmpdir(), `yumi-test-${process.pid}-${counter}.sock`);
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function appClient(path: string, onEvent?: (event: string, payload: unknown) => void): Promise<RpcPeer> {
  const socket: Socket = await new Promise((resolve, reject) => {
    const s = connect(path, () => resolve(s)).on("error", reject);
  });
  cleanups.push(() => void socket.destroy());
  return new RpcPeer({ role: "app", socket, handlers: {}, ...(onEvent ? { onEvent } : {}) });
}

describe("mock harness", () => {
  it("answers every method the Mac app can call, with valid example data", async () => {
    const path = socketPath();
    const harness = await startMockHarness({ socketPath: path, quiet: true });
    cleanups.push(() => harness.close());
    const app = await appClient(path);
    for (const [name, method] of methods("appToHarness")) {
      await expect(app.request(name, exampleOf(method.params)), name).resolves.toBeDefined();
    }
  });

  it("plays a scripted event sequence after a goal is submitted", async () => {
    const path = socketPath();
    const harness = await startMockHarness({ socketPath: path, script: "keynote-export", speed: 0, quiet: true });
    cleanups.push(() => harness.close());
    const received: string[] = [];
    const expected = loadScript("keynote-export").events.map((e) => e.event);
    const done = new Promise<void>((resolve) => {
      void appClient(path, (event) => {
        received.push(event);
        if (received.length === expected.length) resolve();
      }).then((app) => app.request("submitGoal", exampleOf("SubmitGoalParams")));
    });
    await done;
    expect(received).toEqual(expected);
  });

  it("returns a structured error for a method set to fail, the same shape the real harness returns", async () => {
    const path = socketPath();
    const harness = await startMockHarness({ socketPath: path, fail: { submitGoal: "bridgeDown" }, quiet: true });
    cleanups.push(() => harness.close());
    const app = await appClient(path);
    const error = await app.request("submitGoal", exampleOf("SubmitGoalParams")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcRemoteError);
    expect((error as RpcRemoteError).error.data).toEqual({ kind: "bridgeDown" });
  });

  it("rejects params that break the contract", async () => {
    const path = socketPath();
    const harness = await startMockHarness({ socketPath: path, quiet: true });
    cleanups.push(() => harness.close());
    const app = await appClient(path);
    // Bypass the client's own check by writing the raw message.
    const error = await new Promise((resolve) => {
      const socket = connect(path, () => socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "submitGoal", params: {} })}\n`));
      socket.setEncoding("utf8").on("data", (line: string) => {
        resolve(JSON.parse(line).error);
        socket.destroy();
      });
    });
    expect(error).toMatchObject({ code: -32602 });
    void app;
  });
});

describe("mock Mac app", () => {
  it("answers every method the harness can call, with valid example data", async () => {
    const path = socketPath();
    const harnessSide = new Promise<RpcPeer>((resolve) => {
      const server: Server = createServer((socket) => {
        resolve(new RpcPeer({ role: "harness", socket, handlers: { hello: () => ({ protocolVersion: 2 }) } }));
      });
      server.listen(path);
      cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    });
    const app = await connectMockMacApp({ socketPath: path, quiet: true });
    cleanups.push(() => app.close());
    const harness = await harnessSide;
    for (const [name, method] of methods("harnessToApp")) {
      await expect(harness.request(name, exampleOf(method.params)), name).resolves.toBeDefined();
    }
  });
});

describe("event scripts", () => {
  it.each(readdirSync(SCRIPT_DIR).filter((f) => f.endsWith(".json")))("%s only sends valid events", (file) => {
    expect(() => loadScript(file.replace(/\.json$/, ""))).not.toThrow();
  });
});
