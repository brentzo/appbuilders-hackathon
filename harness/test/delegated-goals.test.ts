import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { GoalFinishedPayload, Payload, ProgressPayload } from "@yumi/protocol/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeClient } from "../src/bridge-client/client.ts";
import { DelegatedGoals, failureLine } from "../src/bridge-client/delegated-goals.ts";
import { startHarness, type Harness } from "../src/harness.ts";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";
import type { TaskControl } from "../src/scheduler/task-control.ts";
import { TaskStore } from "../src/store/task-store.ts";
import { modelConfig, tempDir } from "./helpers.ts";
import { startMockModelServer, type MockModelServer, type MockReply } from "./mock-model-server.ts";
import { FakeRelay } from "./support/fake-relay.ts";
import { finish, plan, scriptModel, tool, type WorkerRequest } from "./support/harness-run.ts";
import { connectScriptedMac, later, until, type ScriptedMac } from "./support/mock-mac.ts";
import { ScriptedPhone } from "./support/scripted-phone.ts";

/**
 * Goals from the phone, end to end on the Mac side (OBJ-68, SPEC-09 "Phone goal is delegated to the Mac"): the real
 * harness, bridge client, task store, planner, and scheduler, with the mocked model, the protocol's mock Mac app,
 * the fake relay, and a scripted phone that pairs by the QR offer and sends encrypted commands.
 */

vi.setConfig({ testTimeout: 30_000 });

const NOTE = { id: "note", title: "Write the export note", instruction: "Write Export.md in Documents." };

let dir: { path: string; cleanup: () => void };
let home: string;
let model: MockModelServer;
let logger: MemoryLogger;
let relay: FakeRelay;
let running: { harness: Harness; bridge: BridgeClient; mac: ScriptedMac; phone: ScriptedPhone } | undefined;

beforeEach(async () => {
  dir = tempDir();
  home = join(dir.path, "home");
  mkdirSync(join(home, "Documents"), { recursive: true });
  model = await startMockModelServer();
  logger = new MemoryLogger();
  relay = new FakeRelay();
  await relay.listen();
});

afterEach(async () => {
  if (running) {
    running.phone.close();
    running.bridge.stop();
    running.mac.close();
    await running.harness.close();
  }
  running = undefined;
  await relay.close();
  await model.close();
  dir.cleanup();
});

/** Writes the note, then finishes; `hold` keeps the first step waiting until the test lets it go. */
function writeNote(hold?: Promise<void>) {
  return async ({ text }: WorkerRequest): Promise<MockReply> => {
    await hold;
    return text.includes("Created Export.md")
      ? finish("Wrote the note.")
      : tool({ tool: "write_new_file", path: "~/Documents/Export.md", content: "Exported." });
  };
}

/** The harness as `main.ts` wires it, with the bridge on the fake relay, and a phone paired by the QR offer. */
async function startPaired() {
  const secrets = new Map<string, string>();
  // eslint-disable-next-line prefer-const
  let harness: Harness;
  const bridge = new BridgeClient({
    bridgeUrl: "wss://relay.test",
    relayUrl: relay.url,
    allowLoopbackWs: true,
    deviceName: "Brent's MacBook",
    databasePath: join(dir.path, "bridge.sqlite"),
    reconnectBaseMs: 20,
    onMessage: (message, peer, type) => harness.delegated?.handle(message, peer, type),
    rpc: {
      request: (method, params) => harness.server.request(method, params),
      notify: (event, payload) => void harness.server.emit(event, payload),
    },
  });
  harness = await startHarness({ supportDir: dir.path, socketPath: join(dir.path, "h.sock") }, logger, {
    handlers: bridge.handlers,
    phone: bridge,
    deviceId: () => bridge.deviceId,
    work: {
      client: new ModelClient(modelConfig(model.baseUrl), logger),
      logger,
      deviceId: "mac-local",
      home,
      lanes: { helper: fileHelperLane({ home }) },
      slots: 1,
    },
    onReady: () => void bridge.start(),
  });
  const mac = await connectScriptedMac(harness.server.socketPath, {
    loadSecret: (params) => {
      const value = secrets.get((params as { key: string }).key);
      return value === undefined ? {} : { value };
    },
    storeSecret: (params) => {
      const { key, value } = params as { key: string; value: string };
      secrets.set(key, value);
      return {};
    },
  });
  await bridge.waitForState("connected", 5000);
  const phone = new ScriptedPhone();
  await phone.connect(relay.url);
  const { qrPayload } = (await mac.call("startPairing", {})) as { qrPayload: string };
  await phone.pair(qrPayload);
  await until(() => bridge.isPaired(phone.deviceId));
  running = { harness, bridge, mac, phone };
  return running;
}

function delegate(phone: ScriptedPhone, goalId: string, confirmedGoal = "Export my Keynote deck as a PDF"): string {
  return phone.command({
    kind: "delegateGoal",
    goalId,
    confirmedGoal,
    originDeviceId: phone.deviceId,
    spokenAt: new Date().toISOString(),
  });
}

describe("goals from the phone (OBJ-68)", () => {
  it("Scenario: Phone goal is delegated to the Mac (the Mac side)", async () => {
    scriptModel(model, { plan: plan(NOTE), worker: writeNote() });
    const { harness, mac, phone, bridge } = await startPaired();
    const goalId = randomUUID();

    // Then the confirmed goal is sent to the Mac as text
    const commandId = delegate(phone, goalId);
    await until(() => phone.received("goalFinished").length === 1);

    // The task is the goal, from the phone, and was never asked about again on the Mac
    const task = harness.store.getTask(goalId)!;
    expect(task.originDeviceId).toBe(phone.deviceId);
    expect(task.confirmedGoal).toBe("Export my Keynote deck as a PDF");
    expect(task.status).toBe("done");
    expect(mac.events.filter((e) => e.event === "goalRestated")).toEqual([]);
    // And a cursor spawns on the Mac
    expect(mac.events).toContainEqual({
      event: "cursorCommand",
      payload: { command: "spawn", cursorId: "main", cursorKind: "main" },
    });

    // The answer comes first, then progress with the subtask title, then the result
    expect(phone.resultFor(commandId)).toEqual({ kind: "goalAccepted", goalId, status: "started" });
    const kinds = phone.inbox.map((m) => m.payload.kind);
    expect(kinds.indexOf("goalAccepted")).toBeLessThan(kinds.indexOf("progress"));
    const progress = phone.received("progress") as ProgressPayload[];
    expect(progress[0]).toMatchObject({ goalId, status: "planning", currentSubtaskTitle: "Making a plan" });
    expect(progress.some((p) => p.status === "running" && p.currentSubtaskTitle === NOTE.title)).toBe(true);
    expect(kinds.at(-1)).toBe("goalFinished");
    // And the phone says the summary; the Mac never speaks it
    expect(phone.received("goalFinished")).toEqual([{ kind: "goalFinished", goalId, status: "done", summary: "Done." }]);
    expect(mac.events.filter((e) => e.event === "speak")).toEqual([]);
    expect(mac.events.filter((e) => e.event === "userError")).toEqual([]);

    // This Mac's id reaches the app with bridgeStateChanged (OBJ-64)
    expect(mac.events).toContainEqual({
      event: "bridgeStateChanged",
      payload: { state: "connected", deviceId: bridge.deviceId },
    });
  });

  it("runs the same goal once when the phone sends it again", async () => {
    scriptModel(model, { plan: plan(NOTE), worker: writeNote() });
    const { harness, phone } = await startPaired();
    const goalId = randomUUID();
    const first = delegate(phone, goalId);
    const second = delegate(phone, goalId);
    await until(() => phone.received("goalFinished").length === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(phone.resultFor(first)).toMatchObject({ kind: "goalAccepted", status: "started" });
    expect(phone.resultFor(second)).toMatchObject({ kind: "goalAccepted", status: "started" });
    expect(harness.store.listTasks().filter((t) => t.id === goalId)).toHaveLength(1);
    expect(phone.received("goalFinished")).toHaveLength(1);
  });

  it("Scenario: Stop from the phone pauses the Mac (the Mac side), then resume and cancel", async () => {
    const hold = later<void>();
    scriptModel(model, { plan: plan(NOTE), worker: writeNote(hold.promise) });
    const { harness, phone } = await startPaired();
    const goalId = randomUUID();
    delegate(phone, goalId);
    await until(() => (phone.received("progress") as ProgressPayload[]).some((p) => p.status === "running"));

    // When the user taps "Stop" on the phone
    const pauseId = phone.command({ kind: "pause", goalId });
    // Then the Mac stops before its next action, and only then confirms it paused
    await until(() => phone.resultFor(pauseId) !== undefined);
    hold.resolve();
    expect(phone.resultFor(pauseId)).toEqual({ kind: "pauseConfirmed", goalId });
    expect(harness.store.getTask(goalId)!.status).toBe("paused");
    expect((phone.received("progress") as ProgressPayload[]).at(-1)!.status).toBe("paused");

    const resumeId = phone.command({ kind: "resume", goalId });
    await until(() => phone.resultFor(resumeId) !== undefined);
    expect(phone.resultFor(resumeId)).toEqual({ kind: "resumeConfirmed", goalId });
    await until(() => harness.store.getTask(goalId)!.status === "done");

    const cancelId = phone.command({ kind: "cancel", goalId });
    await until(() => phone.resultFor(cancelId) !== undefined);
    expect(phone.resultFor(cancelId)).toEqual({ kind: "cancelConfirmed", goalId });
    expect(phone.received("goalFinished")).toHaveLength(1);
  });

  it("sends a failure to the phone in SPEC-11 words, not to the Mac", async () => {
    model.respond(() => ({ kind: "content", content: "not a plan" }));
    const { harness, mac, phone } = await startPaired();
    const goalId = randomUUID();
    delegate(phone, goalId);
    await until(() => phone.received("goalFinished").length === 1);
    expect(harness.store.getTask(goalId)!.status).toBe("failed");
    const finished = phone.received("goalFinished")[0] as GoalFinishedPayload;
    expect(finished.status).toBe("failed");
    expect(finished.summary).toBe("Something went wrong and I stopped to be safe.");
    expect(mac.events.filter((e) => e.event === "userError")).toEqual([]);
  });

  it("ignores control of a goal the phone did not send", async () => {
    scriptModel(model, { plan: plan(NOTE), worker: writeNote() });
    const { harness, phone } = await startPaired();
    const task = harness.store.createTask({ originDeviceId: "mac-local", goal: "tidy up" });
    phone.command({ kind: "cancel", goalId: task.id });
    await until(() => logger.entries.some((e) => e.event === "delegated.unknownGoal"));
    expect(harness.store.getTask(task.id)!.status).toBe("awaitingConfirmation");
  });

  it("answers ping", async () => {
    const { phone } = await startPaired();
    const id = phone.command({ kind: "ping" });
    await until(() => phone.resultFor(id) !== undefined);
    expect(phone.resultFor(id)).toEqual({ kind: "pingResult" });
  });

  it("reports this Mac's device id in hello once the bridge has its keys (OBJ-64)", async () => {
    const { harness, bridge } = await startPaired();
    const again = await connectScriptedMac(harness.server.socketPath);
    try {
      expect(await again.call("hello", { protocolVersion: 4 })).toMatchObject({ deviceId: bridge.deviceId });
    } finally {
      again.close();
    }
  });
});

describe("progress heartbeat (SPEC-09 r9)", () => {
  it("repeats progress while nothing changes, and stops when the task ends", async () => {
    const store = TaskStore.open({ dir: dir.path, logger });
    const sent: Payload[] = [];
    const delegated = new DelegatedGoals({
      store,
      logger,
      tasks: () => ({ start: async () => ({ outcome: "aborted" }) }) as unknown as TaskControl,
      app: { emit: () => 1 },
      bridge: {
        isPaired: (id) => id === "phone-1",
        listPairedDevices: () => ({ devices: [] }),
        sendMessage: async (_to, _type, payload) => {
          sent.push(payload);
          return randomUUID();
        },
      },
      heartbeatMs: 30,
    });
    try {
      const goalId = randomUUID();
      await delegated.handle(
        {
          kind: "delegateGoal",
          goalId,
          confirmedGoal: "Export it",
          originDeviceId: "phone-1",
          spokenAt: new Date().toISOString(),
        },
        { deviceId: "phone-1", name: "Phone", pairedAt: new Date().toISOString() },
        "command",
      );
      await until(() => sent.filter((p) => p.kind === "progress").length >= 4);
      store.setTaskStatus(goalId, "cancelled");
      await until(() => sent.some((p) => p.kind === "goalFinished"));
      const count = sent.length;
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(sent.length).toBe(count);
      expect(sent.at(-1)).toEqual({
        kind: "goalFinished",
        goalId,
        status: "cancelled",
        summary: "Okay, I stopped. Nothing else will happen.",
      });
    } finally {
      delegated.close();
      store.close();
    }
  });

  it("words failures from SPEC-11 without the Mac's buttons", () => {
    expect(failureLine({ kind: "stepFailed", step: "Export the deck" })).toBe(
      "I couldn't finish this step: Export the deck. I stopped there before anything else ran on top of it.",
    );
    expect(failureLine({ kind: "unexpected", lastAction: "Clicked File" })).toBe(
      "Something went wrong and I stopped to be safe. Here's the last thing I did: Clicked File.",
    );
  });
});
