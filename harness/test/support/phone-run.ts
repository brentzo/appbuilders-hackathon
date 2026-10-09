import { join } from "node:path";
import type { Handler } from "@yumi/protocol";
import type { Payload, Task } from "@yumi/protocol/types";
import { BridgeClient } from "../../src/bridge-client/client.ts";
import type { ScreenLock } from "../../src/device.ts";
import { startHarness, type Harness } from "../../src/harness.ts";
import type { MemoryLogger } from "../../src/log.ts";
import { ModelClient } from "../../src/model/client.ts";
import type { LaneRunners } from "../../src/scheduler/lanes.ts";
import { modelConfig } from "../helpers.ts";
import type { MockModelServer } from "../mock-model-server.ts";
import { FakeRelay } from "./fake-relay.ts";
import { connectScriptedMac, until, type ScriptedMac } from "./mock-mac.ts";
import { ScriptedPhone } from "./scripted-phone.ts";

/**
 * A whole harness wired to a paired phone as `src/main.ts` wires it, for the SPEC-09 scenarios beyond the delegated
 * goal itself (OBJ-65, OBJ-70, OBJ-77, OBJ-80): the real bridge client on the relay stand-in with every hook, the
 * task store, planner, scheduler, gate, and approval flow, with the mocked model, the protocol's mock Mac app (which
 * keeps the bridge keys in memory instead of the Keychain), and a scripted phone.
 */

export const WAKE_ADDRESS = "a4:83:e7:1c:2b:9f";

export interface PhoneRun {
  harness: Harness;
  mac: ScriptedMac;
  phone: ScriptedPhone;
  relay: FakeRelay;
  bridge: BridgeClient;
  /** Creates a confirmed task spoken on the Mac and starts it. */
  startMacTask(goal: string): Task;
  /** The phone's tool list, as the Android app sends it on connect. */
  sendPhoneTools(): void;
  /** Sends a command from the phone and waits for the Mac's result to it. */
  ask(payload: Payload): Promise<Payload>;
  close(): Promise<void>;
}

export async function startWithPhone(options: {
  dir: string;
  home: string;
  logger: MemoryLogger;
  model: MockModelServer;
  lanes: LaneRunners;
  answers?: Record<string, Handler>;
  screen?: ScreenLock;
  heartbeatMs?: number;
  /** The approval flow's clock, to reach an approval's 5-minute expiry without waiting. */
  approvalClock?: () => Date;
}): Promise<PhoneRun> {
  const relay = new FakeRelay();
  await relay.listen();
  // The bridge and the harness need each other; the harness is set right below, before any message can arrive.
  // eslint-disable-next-line prefer-const
  let harness: Harness;
  const bridge = new BridgeClient({
    bridgeUrl: "wss://relay.test",
    relayUrl: relay.url,
    allowLoopbackWs: true,
    deviceName: "Test Mac",
    databasePath: join(options.dir, "bridge.sqlite"),
    reconnectBaseMs: 20,
    rpc: {
      request: (method, params) => harness.server.request(method, params),
      notify: (event, payload) => void harness.server.emit(event, payload),
    },
    onMessage: (message, peer, type, replyTo) => harness.delegated?.handle(message, peer, type, replyTo),
    onConnected: () => harness.phoneTools?.connected(),
    onUndelivered: (messageId, reason) => {
      harness.phoneTools?.undelivered(messageId, reason);
      harness.phoneApprovals?.undelivered(messageId, reason);
    },
  });
  harness = await startHarness({ supportDir: options.dir, socketPath: join(options.dir, "h.sock") }, options.logger, {
    handlers: bridge.handlers,
    phone: bridge,
    deviceId: () => bridge.deviceId,
    wakeAddresses: () => [WAKE_ADDRESS],
    ...(options.screen ? { screen: options.screen } : {}),
    ...(options.heartbeatMs ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.approvalClock ? { approvalClock: options.approvalClock } : {}),
    work: {
      client: new ModelClient(modelConfig(options.model.baseUrl), options.logger),
      logger: options.logger,
      deviceId: "mac-brent",
      home: options.home,
      lanes: options.lanes,
      slots: 1,
    },
  });
  const secrets = new Map<string, string>();
  const mac = await connectScriptedMac(harness.server.socketPath, {
    storeSecret: (params) => {
      const { key, value } = params as { key: string; value: string };
      secrets.set(key, value);
      return {};
    },
    loadSecret: (params) => {
      const value = secrets.get((params as { key: string }).key);
      return value === undefined ? {} : { value };
    },
    ...options.answers,
  });
  await until(() => harness.server.readyConnections === 1);
  await bridge.start();
  await bridge.waitForState("connected");
  const phone = new ScriptedPhone();
  await phone.connect(relay.url);
  const { qrPayload } = (await mac.call("startPairing", {})) as { qrPayload: string };
  await phone.pair(qrPayload);
  return {
    harness,
    mac,
    phone,
    relay,
    bridge,
    startMacTask: (goal) => {
      const task = harness.store.createTask({ originDeviceId: "mac-brent", goal });
      harness.store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });
      void harness.tasks.start(task.id);
      return harness.store.getTask(task.id)!;
    },
    sendPhoneTools: () => {
      phone.envelope("event", {
        kind: "toolList",
        deviceId: phone.deviceId,
        tools: [
          {
            name: "set_alarm",
            description: "Set an alarm on this phone.",
            arguments: [
              {
                name: "time",
                type: "string",
                required: true,
                description: "Local time in 24-hour HH:MM format.",
                format: "HH:MM",
              },
              { name: "label", type: "string", required: false, description: "Optional alarm label." },
            ],
          },
          {
            name: "set_timer",
            description: "Start a timer on this phone.",
            arguments: [
              {
                name: "seconds",
                type: "integer",
                required: true,
                description: "Timer duration in seconds.",
                minimum: 1,
                maximum: 86400,
              },
            ],
          },
          {
            name: "open_app",
            description: "Open an installed app on this phone.",
            arguments: [{ name: "app", type: "string", required: true, description: "App name or Android package name." }],
          },
        ],
      });
    },
    ask: async (payload) => {
      const id = phone.command(payload);
      await until(() => phone.resultFor(id) !== undefined);
      return phone.resultFor(id)!;
    },
    close: async () => {
      phone.close();
      mac.close();
      await harness.close();
      bridge.stop();
      await relay.close();
    },
  };
}
