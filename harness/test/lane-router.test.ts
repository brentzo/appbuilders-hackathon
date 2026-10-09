import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcRemoteError, validate } from "@yumi/protocol";
import type { AppCapability, Lane, RouteDecided, Subtask, Target } from "@yumi/protocol/types";
import { MemoryLogger } from "../src/log.ts";
import {
  AppCapabilities,
  createLaneRouter,
  LaneRouter,
  macAppProbe,
  ProbeFailure,
  type CapabilityProbe,
  type InstalledVersion,
} from "../src/router/index.ts";
import { HarnessRpcServer } from "../src/rpc/server.ts";
import type { TaskStore } from "../src/store/task-store.ts";
import { PROTOCOL_DIR, tempDir } from "./helpers.ts";
import { openStore, TestClock } from "./store-helpers.ts";

const CHROME = "com.google.Chrome";
const KEYNOTE = "com.apple.iWork.Keynote";
/** A canvas app: no actionable accessibility tree and no DevTools. */
const CANVAS = "com.example.CanvasPaint";

const CAPABILITIES: Record<string, Omit<AppCapability, "probedAt">> = {
  [CHROME]: { bundleId: CHROME, appVersion: "141.0 (141.0.7390.55)", accessibility: false, devtools: true },
  [KEYNOTE]: { bundleId: KEYNOTE, appVersion: "14.2 (7041.0.109)", accessibility: true, devtools: false },
  [CANVAS]: { bundleId: CANVAS, appVersion: "3.1 (310)", accessibility: false, devtools: false },
};

/** A fake Mac app probe that answers from CAPABILITIES and counts its calls. */
class FakeProbe {
  calls: string[] = [];
  versions: Record<string, string> = {};
  failWith: ProbeFailure | undefined;
  /** Resolved by the test, to hold a probe in flight. */
  gate: Promise<void> | undefined;

  probe: CapabilityProbe = async (bundleId) => {
    this.calls.push(bundleId);
    await this.gate;
    if (this.failWith) throw this.failWith;
    const known = CAPABILITIES[bundleId];
    if (!known) throw new ProbeFailure(bundleId, { kind: "unsupportedRequest" });
    return { ...known, appVersion: this.versions[bundleId] ?? known.appVersion, probedAt: "2026-10-09T21:40:00+08:00" };
  };
}

let dir: { path: string; cleanup: () => void };
let store: TaskStore;
let logger: MemoryLogger;
let fake: FakeProbe;
let events: { event: string; payload: RouteDecided }[];
let router: LaneRouter;

function routerWith(options: { installedVersion?: InstalledVersion } = {}): LaneRouter {
  const capabilities = new AppCapabilities({ store, probe: fake.probe, logger, ...options });
  return new LaneRouter({ store, capabilities, logger, emit: (event, payload) => events.push({ event, payload }) });
}

beforeEach(() => {
  dir = tempDir();
  logger = new MemoryLogger();
  store = openStore(dir.path, new TestClock(), logger);
  fake = new FakeProbe();
  events = [];
  router = routerWith();
});

afterEach(() => {
  store.close();
  dir.cleanup();
});

/** A subtask the planner proposed, ready to route. */
function subtask(title: string, proposedLane: Lane, target?: Target): Subtask {
  const task = store.createTask({ originDeviceId: "mac-brent", goal: title });
  store.setTaskStatus(task.id, "planning", { confirmedGoal: title });
  return store.addSubtask({
    taskId: task.id,
    title,
    instruction: title,
    proposedLane,
    status: "ready",
    ...(target ? { target } : {}),
  });
}

describe("Feature: Lane routing (SPEC-03)", () => {
  it("Scenario: Subtask with no UI runs as a helper", async () => {
    const extract = subtask("extract totals from 20 spreadsheets", "helper");

    const decision = await router.route(extract, extract.proposedLane);

    expect(decision).toEqual({ lane: "helper", reason: "noUI" });
    expect(store.getSubtask(extract.id)).toMatchObject({ lane: "helper", routeReason: "noUI" });
    // No cursor is spawned for it: the router sends only its decision, and never asks the Mac app anything.
    expect(events.map((e) => e.event)).toEqual(["routeDecided"]);
    expect(fake.calls).toEqual([]);
  });

  it("Scenario: Background-capable app gets a ghost cursor (lane decision only)", async () => {
    // The window lock and the cursor cap (OBJ-08) and spawning the cursor (OBJ-18) are not part of the router core.
    const form = subtask("fill the expense form in Chrome", "ghost", { bundleId: CHROME, windowId: 4211 });

    const decision = await router.route(form, form.proposedLane);

    expect(decision).toEqual({ lane: "ghost", reason: "backgroundCapable" });
    expect(fake.calls).toEqual([CHROME]);
    expect(store.getSubtask(form.id)).toMatchObject({ lane: "ghost", routeReason: "backgroundCapable" });
  });

  it("routes an app with an actionable accessibility tree but no DevTools to a ghost too", async () => {
    const chart = subtask("add the chart in Keynote", "main", { bundleId: KEYNOTE });
    expect(await router.route(chart, chart.proposedLane)).toEqual({ lane: "ghost", reason: "backgroundCapable" });
  });

  it("Scenario: App without background control goes to the main cursor", async () => {
    const paint = subtask("draw a circle", "main", { bundleId: CANVAS });

    const decision = await router.route(paint, paint.proposedLane);

    expect(decision.lane).toBe("main");
    expect(decision.reason).toBe("appNotBackgroundCapable");
    expect(store.getSubtask(paint.id)).toMatchObject({ lane: "main", routeReason: "appNotBackgroundCapable" });
  });

  it("Scenario: Planner proposes the wrong lane", async () => {
    const paint = subtask("draw a circle on the canvas", "ghost", { bundleId: CANVAS });

    const decision = await router.route(paint, "ghost");

    expect(decision.lane).toBe("main");
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ event: "router.decided", proposed: "ghost", lane: "main", reason: "appNotBackgroundCapable" }),
    );
  });

  it.each([
    ["helper for a UI subtask", "helper", { bundleId: CHROME }, "ghost"],
    ["helper for an app without background control", "helper", { bundleId: CANVAS }, "main"],
    ["ghost for a subtask with no UI", "ghost", undefined, "helper"],
    ["main for a subtask with no UI", "main", undefined, "helper"],
  ] as const)("overrides a wrong proposal: %s", async (_name, proposed, target, lane) => {
    const wrong = subtask("a subtask", proposed, target);
    expect((await router.route(wrong, proposed)).lane).toBe(lane);
  });
});

describe("recording decisions", () => {
  it("stores every routed subtask's lane and reason, and emits each decision as a valid routeDecided event", async () => {
    const routed = [
      subtask("extract totals", "helper"),
      subtask("fill the form", "ghost", { bundleId: CHROME }),
      subtask("draw", "ghost", { bundleId: CANVAS }),
    ];
    for (const s of routed) await router.route(s, s.proposedLane);

    for (const s of routed) {
      const stored = store.getSubtask(s.id)!;
      expect(stored.lane).toBeDefined();
      expect(stored.routeReason).toBeDefined();
      expect(validate("Subtask", stored).errors).toEqual([]);
    }
    expect(events.map((e) => e.payload)).toEqual(
      routed.map((s) => ({
        taskId: s.taskId,
        subtaskId: s.id,
        lane: store.getSubtask(s.id)!.lane,
        reason: store.getSubtask(s.id)!.routeReason,
      })),
    );
    for (const { event, payload } of events) {
      expect(event).toBe("routeDecided");
      expect(validate("RouteDecided", payload).errors).toEqual([]);
    }
  });

  it("keeps the decision after the store is closed and reopened", async () => {
    const form = subtask("fill the form", "ghost", { bundleId: CHROME });
    await router.route(form, "ghost");
    store.close();
    store = openStore(dir.path);
    expect(store.getSubtask(form.id)).toMatchObject({ lane: "ghost", routeReason: "backgroundCapable" });
  });
});

describe("the capability cache", () => {
  it("probes an app once and reuses the result for later subtasks", async () => {
    for (let i = 0; i < 3; i++) {
      const form = subtask(`fill form ${i}`, "ghost", { bundleId: CHROME });
      await router.route(form, "ghost");
    }
    expect(fake.calls).toEqual([CHROME]);
    expect(store.getAppCapability(CHROME, CAPABILITIES[CHROME]!.appVersion)).toMatchObject({ devtools: true });
  });

  it("probes once when two subtasks for the same app are routed at the same time", async () => {
    let open!: () => void;
    fake.gate = new Promise((resolve) => (open = resolve));
    const a = subtask("form a", "ghost", { bundleId: CHROME });
    const b = subtask("form b", "ghost", { bundleId: CHROME });
    const both = Promise.all([router.route(a, "ghost"), router.route(b, "ghost")]);
    open();
    expect((await both).map((d) => d.lane)).toEqual(["ghost", "ghost"]);
    expect(fake.calls).toEqual([CHROME]);
  });

  it("with the installed version, reuses the stored result across restarts and probes again only when the version changes", async () => {
    const installed: Record<string, string> = { [KEYNOTE]: CAPABILITIES[KEYNOTE]!.appVersion };
    const installedVersion: InstalledVersion = async (bundleId) => installed[bundleId];

    await routerWith({ installedVersion }).route(subtask("chart 1", "main", { bundleId: KEYNOTE }), "main");
    expect(fake.calls).toEqual([KEYNOTE]);

    // A restart: a new router over the same database.
    store.close();
    store = openStore(dir.path, new TestClock(), logger);
    await routerWith({ installedVersion }).route(subtask("chart 2", "main", { bundleId: KEYNOTE }), "main");
    expect(fake.calls).toEqual([KEYNOTE]);
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "router.capabilityCached", bundleId: KEYNOTE }));

    // Keynote updated.
    installed[KEYNOTE] = "14.3 (7043.0.93)";
    fake.versions[KEYNOTE] = "14.3 (7043.0.93)";
    const updated = routerWith({ installedVersion });
    await updated.route(subtask("chart 3", "main", { bundleId: KEYNOTE }), "main");
    await updated.route(subtask("chart 4", "main", { bundleId: KEYNOTE }), "main");
    expect(fake.calls).toEqual([KEYNOTE, KEYNOTE]);
    expect(store.getAppCapability(KEYNOTE, "14.2 (7041.0.109)")).toBeDefined();
    expect(store.getAppCapability(KEYNOTE, "14.3 (7043.0.93)")).toBeDefined();
  });

  it("does not cache a failed probe, stores and emits nothing, and probes again next time", async () => {
    fake.failWith = new ProbeFailure(CHROME, { kind: "accessibilityPermissionMissing" });
    const form = subtask("fill the form", "ghost", { bundleId: CHROME });

    const failure = await router.route(form, "ghost").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProbeFailure);
    expect((failure as ProbeFailure).userError).toEqual({ kind: "accessibilityPermissionMissing" });
    expect(store.getSubtask(form.id)!.lane).toBeUndefined();
    expect(events).toEqual([]);

    fake.failWith = undefined;
    expect((await router.route(form, "ghost")).lane).toBe("ghost");
    expect(fake.calls).toEqual([CHROME, CHROME]);
  });
});

describe("the probe through the Mac app", () => {
  const capability = (bundleId: string): AppCapability => ({ ...CAPABILITIES[bundleId]!, probedAt: "2026-10-09T21:40:00+08:00" });

  it("asks the Mac app with the bundle id and returns its answer", async () => {
    const calls: unknown[] = [];
    const probe = macAppProbe({ request: async (method, params) => (calls.push([method, params]), capability(CHROME)) }, logger);
    expect(await probe(CHROME)).toEqual(capability(CHROME));
    expect(calls).toEqual([["probeAppCapability", { bundleId: CHROME }]]);
  });

  it("keeps the UserError the Mac app reports, and logs the detail", async () => {
    // What RpcPeer raises when the app answers -32000, as the real Mac app does without Accessibility permission.
    const reply = new RpcRemoteError({
      code: -32000,
      message: "probeAppCapability: Accessibility permission missing",
      data: { kind: "accessibilityPermissionMissing" },
    });
    const probe = macAppProbe({ request: () => Promise.reject(reply) }, logger);

    const failure = (await probe(CHROME).catch((error: unknown) => error)) as ProbeFailure;

    expect(failure).toBeInstanceOf(ProbeFailure);
    expect(failure.userError).toEqual({ kind: "accessibilityPermissionMissing" });
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ event: "router.probeFailed", bundleId: CHROME, kind: "accessibilityPermissionMissing" }),
    );
  });

  it.each([
    ["no Mac app is connected", new Error("No Mac app is connected to call probeAppCapability")],
    ["the app does not serve the method", new RpcRemoteError({ code: -32601, message: "Method not found" })],
    ["the reply is not a UserError", new RpcRemoteError({ code: -32000, message: "boom", data: { kind: "ECONNRESET" } })],
  ])("turns anything else into the unexpected error with no detail: %s", async (_name, error) => {
    const probe = macAppProbe({ request: () => Promise.reject(error) }, logger);

    const failure = (await probe(CHROME).catch((e: unknown) => e)) as ProbeFailure;

    expect(failure.userError).toEqual({ kind: "unexpected" });
    expect(validate("UserError", failure.userError).errors).toEqual([]);
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "router.probeFailed", errorMessage: error.message }));
  });

  it("refuses an answer for another app, so the cache never files it under the wrong name", async () => {
    const probe = macAppProbe({ request: async () => capability(KEYNOTE) }, logger);
    const failure = (await probe(CHROME).catch((e: unknown) => e)) as ProbeFailure;
    expect(failure.userError).toEqual({ kind: "unexpected" });
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "router.probeWrongApp", answeredFor: KEYNOTE }));
  });
});

describe.skipIf(process.platform === "win32")("over the local RPC with the protocol's mock Mac app (npm run mock:mac)", () => {
  let server: HarnessRpcServer | undefined;
  let mock: ChildProcess | undefined;
  let output = "";

  afterEach(async () => {
    mock?.kill();
    mock = undefined;
    output = "";
    await server?.close();
    server = undefined;
  });

  async function waitFor(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Timed out. Mock output:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function connectMock(...extra: string[]): Promise<HarnessRpcServer> {
    const socketPath = join(dir.path, "h.sock");
    server = await HarnessRpcServer.start({ socketPath, logger });
    mock = spawn("npm", ["run", "mock:mac", "--", "--socket", socketPath, ...extra], {
      cwd: PROTOCOL_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    mock.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    mock.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    await waitFor(() => server!.readyConnections === 1);
    return server;
  }

  it("probes the app, caches the answer, stores the decision, and sends routeDecided to the app", async () => {
    // The mock answers every probe with the protocol's Keynote example, so the subtask targets Keynote.
    const rpc = await connectMock();
    const live = createLaneRouter({ store, server: rpc, logger });
    const chart = subtask("add the chart in Keynote", "main", { bundleId: KEYNOTE });

    const decision = await live.route(chart, "main");

    expect(decision).toEqual({ lane: "ghost", reason: "backgroundCapable" });
    expect(store.getAppCapability(KEYNOTE, "14.2")).toMatchObject({ accessibility: true, devtools: false });
    expect(store.getSubtask(chart.id)).toMatchObject({ lane: "ghost", routeReason: "backgroundCapable" });
    const event = { taskId: chart.taskId, subtaskId: chart.id, lane: "ghost", reason: "backgroundCapable" };
    await waitFor(() => output.includes(`[mock Mac app] event routeDecided ${JSON.stringify(event)}`));

    await live.route(subtask("add a title in Keynote", "ghost", { bundleId: KEYNOTE }), "ghost");
    expect(output.match(/probeAppCapability/g)).toHaveLength(1);
  }, 30_000);

  it("passes on the error the Mac app reports and routes nothing", async () => {
    const rpc = await connectMock("--fail", "probeAppCapability=accessibilityPermissionMissing");
    const live = createLaneRouter({ store, server: rpc, logger });
    const chart = subtask("add the chart in Keynote", "main", { bundleId: KEYNOTE });

    const failure = (await live.route(chart, "main").catch((e: unknown) => e)) as ProbeFailure;

    expect(failure).toBeInstanceOf(ProbeFailure);
    expect(failure.userError).toEqual({ kind: "accessibilityPermissionMissing" });
    expect(store.getSubtask(chart.id)!.routeReason).toBeUndefined();
  }, 30_000);
});
