import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "@yumi/protocol";
import { PROTOCOL_VERSION, type ModelState } from "@yumi/protocol/types";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import { ModelReadiness } from "../src/model/readiness.ts";
import { modelConfig, rawClient, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer } from "./mock-model-server.ts";

const MODEL = "mlx-community/Qwen3.5-9B-4bit";

let logger: MemoryLogger;
let server: MockModelServer | undefined;
let readiness: ModelReadiness | undefined;

beforeEach(() => {
  logger = new MemoryLogger();
});

afterEach(async () => {
  readiness?.stop();
  readiness = undefined;
  await server?.close();
  server = undefined;
});

/** A free port with nothing listening on it yet, so the model server can start there later. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Tracks the model server at `port` with short intervals, recording every state change. */
function track(port: number, options: { loadTimeoutMs?: number } = {}): { readiness: ModelReadiness; changes: ModelState[] } {
  const changes: ModelState[] = [];
  readiness = new ModelReadiness({
    config: modelConfig(`http://127.0.0.1:${port}/v1`),
    logger,
    pollMs: 20,
    readyPollMs: 40,
    loadTimeoutMs: options.loadTimeoutMs ?? 5_000,
  });
  readiness.onChange((state) => changes.push(state));
  return { readiness: readiness.start(), changes };
}

async function until(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for the condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const portOf = (s: MockModelServer) => Number(new URL(s.baseUrl).port);

describe("model readiness", () => {
  it("is loading while the server starts slowly, and ready once /health names the configured model", async () => {
    const port = await freePort();
    const { readiness, changes } = track(port);
    expect(readiness.state).toBe("loading");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(readiness.state).toBe("loading");
    server = await startMockModelServer(MODEL, port);
    await until(() => readiness.state === "ready");
    expect(changes).toEqual(["ready"]);
  });

  it("is ready at once when the server already serves the model", async () => {
    server = await startMockModelServer(MODEL);
    const { readiness, changes } = track(portOf(server));
    await until(() => readiness.state === "ready");
    expect(changes).toEqual(["ready"]);
  });

  it("fails when the server never starts within the load timeout", async () => {
    const { readiness, changes } = track(await freePort(), { loadTimeoutMs: 200 });
    await until(() => readiness.state === "failed");
    expect(changes).toEqual(["failed"]);
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "model.readiness.timedOut" }));
  });

  it("recovers from failed when the server starts after the timeout", async () => {
    const port = await freePort();
    const { readiness, changes } = track(port, { loadTimeoutMs: 100 });
    await until(() => readiness.state === "failed");
    server = await startMockModelServer(MODEL, port);
    await until(() => readiness.state === "ready");
    expect(changes).toEqual(["failed", "ready"]);
  });

  it("fails when the server serves another model, and logs both names", async () => {
    server = await startMockModelServer("mlx-community/Qwen3-VL-4B-Instruct-4bit");
    const { readiness, changes } = track(portOf(server));
    await until(() => readiness.state === "failed");
    expect(changes).toEqual(["failed"]);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        event: "model.readiness.otherModel",
        configured: MODEL,
        loaded: "mlx-community/Qwen3-VL-4B-Instruct-4bit",
      }),
    );
  });

  it("accepts a local path that ends in the configured repo id", async () => {
    server = await startMockModelServer(`/Users/me/models/${MODEL}`);
    const { readiness } = track(portOf(server));
    await until(() => readiness.state === "ready");
  });

  it("goes back to loading when the server is lost mid-run, and to ready when it comes back", async () => {
    server = await startMockModelServer(MODEL);
    const port = portOf(server);
    const { readiness, changes } = track(port);
    await until(() => readiness.state === "ready");
    await server.close();
    server = undefined;
    await until(() => readiness.state === "loading");
    server = await startMockModelServer(MODEL, port);
    await until(() => readiness.state === "ready");
    expect(changes).toEqual(["ready", "loading", "ready"]);
  });

  it("notices a lost server from a failed request before the next poll", async () => {
    server = await startMockModelServer(MODEL);
    const port = portOf(server);
    const changes: ModelState[] = [];
    readiness = new ModelReadiness({
      config: modelConfig(server.baseUrl),
      logger,
      pollMs: 20,
      // Far longer than the test: only the failed request can trigger the check.
      readyPollMs: 60_000,
    });
    readiness.onChange((state) => changes.push(state));
    readiness.start();
    await until(() => readiness!.state === "ready");
    await server.close();
    server = undefined;
    const tracked = readiness;
    const client = new ModelClient(modelConfig(`http://127.0.0.1:${port}/v1`), logger, fetch, undefined, (failure) =>
      tracked.noteFailure(failure),
    );
    const result = await client.chat({ messages: [{ role: "user", content: "hi" }], purpose: "test" });
    expect(result).toMatchObject({ ok: false, failure: { kind: "unreachable" } });
    await until(() => tracked.state === "loading", 500);
    expect(changes).toEqual(["ready", "loading"]);
  });

  it("counts the load timeout again from when a lost server went away", async () => {
    server = await startMockModelServer(MODEL);
    const { readiness, changes } = track(portOf(server), { loadTimeoutMs: 300 });
    await until(() => readiness.state === "ready");
    await server.close();
    server = undefined;
    await until(() => readiness.state === "loading");
    await until(() => readiness.state === "failed");
    expect(changes).toEqual(["ready", "loading", "failed"]);
  });
});

describe.skipIf(process.platform === "win32")("model state over the local socket", () => {
  let dir: { path: string; cleanup: () => void };
  let harness: Harness | undefined;

  beforeEach(() => {
    dir = tempDir();
  });

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
    dir.cleanup();
  });

  it("answers hello with the current state and sends every change as modelStateChanged", async () => {
    const port = await freePort();
    const { readiness } = track(port);
    harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "harness.sock") }, logger, {
      model: readiness,
    });
    const app = await rawClient(join(dir.path, "harness.sock"));
    app.send({ jsonrpc: "2.0", id: 1, method: "hello", params: { protocolVersion: PROTOCOL_VERSION } });
    const hello = await app.next();
    expect(hello).toMatchObject({ id: 1, result: { protocolVersion: PROTOCOL_VERSION, modelState: "loading" } });
    expect(validate("HelloResult", (hello as { result: unknown }).result).errors).toEqual([]);

    server = await startMockModelServer(MODEL, port);
    const ready = await app.next();
    expect(ready).toEqual({ jsonrpc: "2.0", method: "modelStateChanged", params: { state: "ready" } });
    app.close();
  });
});
