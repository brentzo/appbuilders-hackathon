import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcRemoteError, validate } from "@yumi/protocol";
import type { AppCapability, Lane, RouteDecided, Subtask, Target } from "@yumi/protocol/types";
import { MemoryLogger } from "../src/log.ts";
import {
  AppCapabilities,
  createLaneRouter,
  LaneRouter,
  macAppProbe,
  macAppVersion,
  ProbeFailure,
  type CapabilityProbe,
  type InstalledVersion,
} from "../src/router/index.ts";
import { HarnessRpcServer } from "../src/rpc/server.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import type { TaskStore } from "../src/store/task-store.ts";
import { PROTOCOL_DIR, tempDir } from "./helpers.ts";
import { openStore, TestClock } from "./store-helpers.ts";

const CHROME = "com.google.Chrome";
const KEYNOTE = "com.apple.iWork.Keynote";
/** A canvas app: no actionable accessibility tree and no DevTools. */
const CANVAS = "com.example.CanvasPaint";
/** Draws its window itself, so it has no actionable accessibility tree (OBJ-27). One of the mock Mac app's apps. */
const WEZTERM = "com.github.wez.wezterm";

const CAPABILITIES: Record<string, Omit<AppCapability, "probedAt">> = {
  [CHROME]: { bundleId: CHROME, appVersion: "141.0 (141.0.7390.55)", accessibility: false, devtools: true },
  [KEYNOTE]: { bundleId: KEYNOTE, appVersion: "15.2.1 (7048.0.3)", accessibility: true, devtools: false },
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
function subtask(title: string, proposedLane: Lane, target?: Target, needsKeyboard?: boolean): Subtask {
  const task = store.createTask({ originDeviceId: "mac-brent", goal: title });
  store.setTaskStatus(task.id, "planning", { confirmedGoal: title });
  return store.addSubtask({
    taskId: task.id,
    title,
    instruction: title,
    proposedLane,
    status: "ready",
    ...(target ? { target } : {}),
    ...(needsKeyboard !== undefined ? { needsKeyboard } : {}),
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

  it("Scenario: Parallel goal splits into lanes", async () => {
    // "pull this month's numbers from my sheets, fill the expense form in Chrome, and put the chart in Keynote"
    const sheets = subtask("pull this month's numbers from my sheets", "helper");
    const form = subtask("fill the expense form in Chrome", "ghost", { bundleId: CHROME });
    const chart = subtask("put the chart in Keynote", "main", { bundleId: KEYNOTE }, true);

    for (const s of [sheets, form, chart]) await router.route(s, s.proposedLane);

    expect(store.getSubtask(sheets.id)).toMatchObject({ lane: "helper", routeReason: "noUI" });
    expect(store.getSubtask(form.id)).toMatchObject({ lane: "ghost", routeReason: "backgroundCapable" });
    // Keynote is background-capable, but the planner marked the subtask as needing the keyboard to paste the chart.
    expect(store.getSubtask(chart.id)).toMatchObject({ lane: "main", routeReason: "needsKeyboard", needsKeyboard: true });
  });

  it("sends a subtask that needs the keyboard to main without probing its app (SPEC-03 r17)", async () => {
    const paste = subtask("paste the chart", "ghost", { bundleId: CHROME }, true);
    expect(await router.route(paste, "ghost")).toEqual({ lane: "main", reason: "needsKeyboard" });
    expect(fake.calls).toEqual([]);
    expect(events.map((e) => e.payload.reason)).toEqual(["needsKeyboard"]);
  });

  it("routes by capability when the planner says the keyboard is not needed", async () => {
    const form = subtask("fill the form", "ghost", { bundleId: CHROME }, false);
    expect(await router.route(form, "ghost")).toEqual({ lane: "ghost", reason: "backgroundCapable" });
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
    installed[KEYNOTE] = "15.3 (7050.0.1)";
    fake.versions[KEYNOTE] = "15.3 (7050.0.1)";
    const updated = routerWith({ installedVersion });
    await updated.route(subtask("chart 3", "main", { bundleId: KEYNOTE }), "main");
    await updated.route(subtask("chart 4", "main", { bundleId: KEYNOTE }), "main");
    expect(fake.calls).toEqual([KEYNOTE, KEYNOTE]);
    expect(store.getAppCapability(KEYNOTE, "15.2.1 (7048.0.3)")).toBeDefined();
    expect(store.getAppCapability(KEYNOTE, "15.3 (7050.0.1)")).toBeDefined();
  });

  it("probes once per run when the version lookup has no answer, for example a Mac app without getAppVersion", async () => {
    const installedVersion: InstalledVersion = async () => undefined;
    const noLookup = routerWith({ installedVersion });
    await noLookup.route(subtask("chart 1", "main", { bundleId: KEYNOTE }), "main");
    await noLookup.route(subtask("chart 2", "main", { bundleId: KEYNOTE }), "main");
    expect(fake.calls).toEqual([KEYNOTE]);
  });

  it("probes once per run, and warns, when the version lookup and the probe disagree on the format", async () => {
    const installedVersion: InstalledVersion = async () => "15.2.1";
    const mismatched = routerWith({ installedVersion });
    await mismatched.route(subtask("chart 1", "main", { bundleId: KEYNOTE }), "main");
    await mismatched.route(subtask("chart 2", "main", { bundleId: KEYNOTE }), "main");
    expect(fake.calls).toEqual([KEYNOTE]);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        event: "router.versionMismatch",
        installedVersion: "15.2.1",
        probedVersion: "15.2.1 (7048.0.3)",
      }),
    );
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

describe("the version lookup through the Mac app", () => {
  it("asks getAppVersion and returns the version, or nothing when the app is not installed", async () => {
    const calls: unknown[] = [];
    const versions: Record<string, string> = { [KEYNOTE]: "15.2.1 (7048.0.3)" };
    const lookup = macAppVersion(
      {
        request: async (method, params) => {
          calls.push([method, params]);
          const version = versions[(params as { bundleId: string }).bundleId];
          return version ? { appVersion: version } : {};
        },
      },
      logger,
    );
    expect(await lookup(KEYNOTE)).toBe("15.2.1 (7048.0.3)");
    expect(await lookup("com.example.NotInstalled")).toBeUndefined();
    expect(calls[0]).toEqual(["getAppVersion", { bundleId: KEYNOTE }]);
  });

  it("has no answer, and logs why, when the Mac app does not serve getAppVersion yet", async () => {
    const lookup = macAppVersion(
      { request: () => Promise.reject(new RpcRemoteError({ code: -32601, message: "Method not found" })) },
      logger,
    );
    expect(await lookup(KEYNOTE)).toBeUndefined();
    expect(logger.entries).toContainEqual(expect.objectContaining({ event: "router.versionLookupFailed", bundleId: KEYNOTE }));
  });
});

describe("the planner's needsKeyboard in the task store", () => {
  it("keeps it, and leaves it out when the planner did", () => {
    const marked = subtask("paste the chart", "main", { bundleId: KEYNOTE }, true);
    const unmarked = subtask("fill the form", "ghost", { bundleId: CHROME }, false);
    const plain = subtask("extract totals", "helper");
    store.close();
    store = openStore(dir.path);
    expect(store.getSubtask(marked.id)!.needsKeyboard).toBe(true);
    expect(store.getSubtask(unmarked.id)!.needsKeyboard).toBe(false);
    expect(store.getSubtask(plain.id)).not.toHaveProperty("needsKeyboard");
  });

  it("upgrades a database written before the column existed", () => {
    store.close();
    const old = tempDir();
    try {
      const db = new DatabaseSync(join(old.path, "tasks.db"));
      db.exec(MIGRATIONS[0]!);
      db.exec("PRAGMA user_version = 1");
      db.close();
      store = openStore(old.path);
      const s = subtask("paste the chart", "main", { bundleId: KEYNOTE }, true);
      expect(store.getSubtask(s.id)!.needsKeyboard).toBe(true);
      store.close();
    } finally {
      old.cleanup();
      store = openStore(dir.path);
    }
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

  it("routes several apps by what each supports, sends routeDecided, and reuses the cache after a restart", async () => {
    // The mock knows Chrome (DevTools), Keynote (accessibility), and WezTerm (neither), as in OBJ-27's real probes.
    const rpc = await connectMock();
    const live = createLaneRouter({ store, server: rpc, logger });
    const form = subtask("fill the expense form in Chrome", "ghost", { bundleId: CHROME });
    const title = subtask("add a title in Keynote", "main", { bundleId: KEYNOTE });
    const shell = subtask("run the build in WezTerm", "ghost", { bundleId: WEZTERM });
    const chart = subtask("paste the chart in Keynote", "main", { bundleId: KEYNOTE }, true);

    const decisions = [];
    for (const s of [form, title, shell, chart]) decisions.push(await live.route(s, s.proposedLane));

    expect(decisions).toEqual([
      { lane: "ghost", reason: "backgroundCapable" },
      { lane: "ghost", reason: "backgroundCapable" },
      { lane: "main", reason: "appNotBackgroundCapable" },
      { lane: "main", reason: "needsKeyboard" },
    ]);
    expect(store.getAppCapability(CHROME, "154.0.8037.99 (8037.99)")).toMatchObject({ devtools: true });
    expect(store.getAppCapability(KEYNOTE, "15.2.1 (7048.0.3)")).toMatchObject({ accessibility: true, devtools: false });
    expect(store.getAppCapability(WEZTERM, "0.1.0 (1)")).toMatchObject({ accessibility: false, devtools: false });
    const event = { taskId: shell.taskId, subtaskId: shell.id, lane: "main", reason: "appNotBackgroundCapable" };
    await waitFor(() => output.includes(`[mock Mac app] event routeDecided ${JSON.stringify(event)}`));
    expect(output.match(/probeAppCapability/g)).toHaveLength(3);

    // A restart: a new router over the same database reads each version and probes nothing.
    const restarted = createLaneRouter({ store, server: rpc, logger });
    for (const app of [CHROME, KEYNOTE, WEZTERM])
      await restarted.route(subtask(`again in ${app}`, "ghost", { bundleId: app }), "ghost");
    expect(output.match(/getAppVersion/g)!.length).toBeGreaterThanOrEqual(6);
    expect(output.match(/probeAppCapability/g)).toHaveLength(3);
  }, 30_000);

  it("fails the route for an app that is not installed, as the real Mac app does", async () => {
    const rpc = await connectMock();
    const live = createLaneRouter({ store, server: rpc, logger });
    const missing = subtask("open the report in Numbers", "ghost", { bundleId: "com.apple.iWork.Numbers" });

    const failure = (await live.route(missing, "ghost").catch((e: unknown) => e)) as ProbeFailure;

    expect(failure).toBeInstanceOf(ProbeFailure);
    expect(failure.userError).toEqual({ kind: "unsupportedRequest" });
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
