import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type { DeviceKeys } from "@yumi/protocol/crypto";
import { PROTOCOL_VERSION } from "@yumi/protocol/types";
import { RelayDevice } from "../../test/support/device.ts";
import { makeEnvelope, makePairAccept, makePairRequest, makeUnpair, pair } from "../../test/support/frames.ts";

/**
 * The relay side of the SPEC-08 scenarios, run with stand-in devices against any relay (OBJ-30).
 * `npm run live-check` points them at the deployed relay; `test/live-check.test.ts` runs them against a local one.
 * The device side (keys, at-most-once, what the apps show) needs the real Mac and phone; see wiki/bridge-acceptance.md.
 */

/** Moves the relay's clock: real time for a deployed relay, the fixture's clock in tests. */
export interface Clock {
  advance(ms: number): Promise<void>;
}

export interface Scenario {
  name: string;
  /** The SPEC-08 scenario or protocol/docs/pairing.md section it checks. */
  spec: string;
  /** Waits out the 30-second pairing window on a real clock. */
  slow?: boolean;
  run(context: Context): Promise<void>;
}

export interface ScenarioResult {
  name: string;
  spec: string;
  ok: boolean;
  /** Why it failed; empty when it passed. */
  detail: string;
  ms: number;
}

/** Long enough for a deployed relay to notice that a socket closed. */
const SETTLE_MS = 400;
const BAD_SIGNATURE = `${"A".repeat(86)}==`;
const UNPAIR_AFTER_MS = 3000;

export class Context {
  private readonly devices: RelayDevice[] = [];
  private readonly pairs: Array<{ mac: RelayDevice; phone: RelayDevice }> = [];

  constructor(
    readonly url: string,
    readonly clock: Clock,
  ) {}

  /** Connects a device, ready or refused. */
  async connect(keys?: DeviceKeys, protocolVersion = PROTOCOL_VERSION, signature?: string): Promise<RelayDevice> {
    const device = await RelayDevice.connect(this.url, keys, protocolVersion, signature);
    this.devices.push(device);
    return device;
  }

  async ready(keys?: DeviceKeys): Promise<RelayDevice> {
    const device = await this.connect(keys);
    assert.deepEqual(device.handshake, { frame: "ready" }, "the relay did not send ready");
    return device;
  }

  /** Two fresh devices, paired, which the context unpairs again when the scenario ends. */
  async paired(): Promise<{ mac: RelayDevice; phone: RelayDevice }> {
    const mac = await this.ready();
    const phone = await this.ready();
    await pair(mac, phone);
    this.pairs.push({ mac, phone });
    return { mac, phone };
  }

  /** Unpairs these two when the scenario ends. */
  track(mac: RelayDevice, phone: RelayDevice): void {
    this.pairs.push({ mac, phone });
  }

  /** Lets the relay notice a closed socket before the next step. */
  settle(): Promise<void> {
    return sleep(SETTLE_MS);
  }

  /** Attempts every unpair and socket close, then throws if any cleanup failed. */
  async close(): Promise<void> {
    const errors: string[] = [];
    for (const { mac, phone } of this.pairs) {
      try {
        const cleaner = await this.ready(phone.keys);
        // A minute ahead, so a device clock behind the relay cannot make the relay drop it (see OBJ-48).
        const unpair = makeUnpair(cleaner, mac, new Date(Date.now() + 60_000).toISOString());
        cleaner.send(unpair);
        await cleaner.next("ack");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    await Promise.all(
      this.devices.map(async (device) => {
        try {
          await device.close();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }),
    );
    if (errors.length) throw new Error(`cleanup failed: ${errors.join("; ")}`);
  }
}

async function expectNothing(device: RelayDevice, frame: string): Promise<void> {
  await sleep(SETTLE_MS);
  assert.equal(device.frames.some((f) => f.frame === frame), false, `the device got an unexpected ${frame}`);
}

async function expectNotPaired(sender: RelayDevice, recipient: RelayDevice): Promise<void> {
  const probe = makeEnvelope(sender, recipient, "command", { probe: true });
  sender.send({ frame: "envelope", envelope: probe });
  assert.deepEqual(await sender.next("notPaired", "ack", "targetOffline"), { frame: "notPaired", messageId: probe.id, to: recipient.keys.deviceId });
}

export const liveScenarios: Scenario[] = [
  {
    name: "Devices authenticate",
    spec: "pairing.md \"Connecting\"",
    run: async (context) => {
      await context.ready();
    },
  },
  {
    name: "Refusals name their reason",
    spec: "pairing.md \"Connecting\", \"Another protocol version\"",
    run: async (context) => {
      const forged = await context.connect(undefined, PROTOCOL_VERSION, BAD_SIGNATURE);
      assert.deepEqual(forged.handshake, { frame: "refused", reason: "badSignature" });
      const other = await context.connect(undefined, 999);
      assert.deepEqual(other.handshake, { frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
    },
  },
  {
    name: "Pair the phone with the Mac",
    spec: "SPEC-08 \"Pair the phone with the Mac\"",
    run: async (context) => {
      const mac = await context.ready();
      const phone = await context.ready();
      const request = makePairRequest(phone, mac);
      phone.send(request);
      assert.deepEqual(await mac.next("pairRequest"), request);
      const accept = makePairAccept(mac, phone);
      mac.send(accept);
      assert.deepEqual(await phone.next("pairAccept"), accept);
      assert.deepEqual(await mac.next("paired", "pairExpired"), { frame: "paired", device: phone.keys.deviceId });
      context.track(mac, phone);
    },
  },
  {
    name: "Messages pass through unchanged",
    spec: "SPEC-08 \"VPS cannot read messages\" (the relay forwards ciphertext as is)",
    run: async (context) => {
      const { mac, phone } = await context.paired();
      const command = makeEnvelope(mac, phone, "command", { action: "ping" });
      mac.send({ frame: "envelope", envelope: command });
      assert.deepEqual(await phone.next("envelope"), { frame: "envelope", envelope: command });
      assert.deepEqual(await mac.next("ack"), { frame: "ack", messageId: command.id });
      const result = makeEnvelope(phone, mac, "result", { replyTo: command.id });
      phone.send({ frame: "envelope", envelope: result });
      assert.deepEqual(await mac.next("envelope"), { frame: "envelope", envelope: result });
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: result.id });
    },
  },
  {
    name: "Command to an offline device fails at once",
    spec: "SPEC-08 \"Command to an offline device fails at once\"",
    run: async (context) => {
      const { mac, phone } = await context.paired();
      await phone.close();
      await context.settle();
      const command = makeEnvelope(mac, phone, "command", { action: "set_alarm" });
      mac.send({ frame: "envelope", envelope: command });
      assert.deepEqual(await mac.next("targetOffline", "ack"), { frame: "targetOffline", messageId: command.id, to: phone.keys.deviceId });
    },
  },
  {
    name: "Result survives a short reconnect",
    spec: "SPEC-08 \"Result survives a short reconnect\"",
    run: async (context) => {
      const { mac, phone } = await context.paired();
      await mac.close();
      await context.settle();
      const result = makeEnvelope(phone, mac, "result", { replyTo: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8" });
      phone.send({ frame: "envelope", envelope: result });
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: result.id });
      const back = await context.ready(mac.keys);
      assert.deepEqual(await back.next("envelope"), { frame: "envelope", envelope: result });
      back.send({ frame: "ack", messageId: result.id });
      await context.settle();
      await back.close();
      const again = await context.ready(mac.keys);
      await expectNothing(again, "envelope");
    },
  },
  {
    name: "Expired command is not delivered",
    spec: "SPEC-08 \"Expired command is not run\" (the relay's part: an expired message is never delivered)",
    run: async (context) => {
      const { mac, phone } = await context.paired();
      const late = makeEnvelope(mac, phone, "command", { action: "set_alarm" }, new Date(Date.now() - 60_000).toISOString());
      mac.send({ frame: "envelope", envelope: late });
      assert.deepEqual(await mac.next("expired", "ack"), { frame: "expired", messageId: late.id, to: phone.keys.deviceId });
      await expectNothing(phone, "envelope");
    },
  },
  {
    name: "Message from an unknown device is dropped",
    spec: "SPEC-08 \"Message from an unknown device is dropped\" (the relay refuses to route it)",
    run: async (context) => {
      const { mac } = await context.paired();
      const stranger = await context.ready();
      await expectNotPaired(stranger, mac);
      await expectNothing(mac, "envelope");
    },
  },
  {
    name: "Unpair a device",
    spec: "SPEC-08 \"Unpair a device\"",
    run: async (context) => {
      const mac = await context.ready();
      const phone = await context.ready();
      await pair(mac, phone);
      await mac.close();
      // As a person would, unpair a few seconds after pairing. The relay compares the unpair's time, from the
      // device's clock, with its own, so an unpair sent sooner can be dropped when the clocks differ (OBJ-48).
      await sleep(UNPAIR_AFTER_MS);
      const unpair = makeUnpair(phone, mac, new Date().toISOString());
      phone.send(unpair);
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: unpair.id });
      await expectNotPaired(phone, mac);
      const back = await context.ready(mac.keys);
      assert.deepEqual(await back.next("unpair"), unpair);
      back.send({ frame: "ack", messageId: unpair.id });
      phone.send(unpair);
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: unpair.id }, "a retried unpair was not acknowledged again");
    },
  },
  {
    name: "Phone cancels pairing",
    spec: "pairing.md \"The answer window\", Cancelled",
    run: async (context) => {
      const mac = await context.ready();
      const phone = await context.ready();
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      phone.send({ frame: "pairCancel", from: phone.keys.deviceId, to: mac.keys.deviceId });
      assert.deepEqual(await mac.next("pairExpired", "paired"), { frame: "pairExpired", device: phone.keys.deviceId });
      mac.send(makePairAccept(mac, phone));
      assert.deepEqual(await mac.next("pairExpired", "paired"), { frame: "pairExpired", device: phone.keys.deviceId });
      await expectNothing(phone, "pairAccept");
      await expectNotPaired(phone, mac);
    },
  },
  {
    name: "Mac does not answer pairing, then answers too late",
    spec: "SPEC-08 \"Mac does not answer pairing\", \"Mac answers pairing too late\"",
    slow: true,
    run: async (context) => {
      const mac = await context.ready();
      const phone = await context.ready();
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      await context.clock.advance(31_000);
      assert.deepEqual(await phone.next("pairExpired", "pairAccept"), { frame: "pairExpired", device: mac.keys.deviceId });
      assert.deepEqual(await mac.next("pairExpired", "paired"), { frame: "pairExpired", device: phone.keys.deviceId });
      mac.send(makePairAccept(mac, phone));
      assert.deepEqual(await mac.next("pairExpired", "paired"), { frame: "pairExpired", device: phone.keys.deviceId });
      await expectNothing(phone, "pairAccept");
      await expectNotPaired(phone, mac);
    },
  },
  {
    name: "A device that needs an update keeps its pairing",
    spec: "SPEC-08 \"Device needs an update\", \"Command to a device that needs an update\", \"Devices reconnect after an update\"",
    run: async (context) => {
      const { mac, phone } = await context.paired();
      await phone.close();
      await context.settle();
      const old = await context.connect(phone.keys, PROTOCOL_VERSION - 1);
      assert.deepEqual(old.handshake, { frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
      await context.settle();
      const blocked = makeEnvelope(mac, phone, "command", { action: "set_alarm" });
      mac.send({ frame: "envelope", envelope: blocked });
      assert.deepEqual(await mac.next("targetNeedsUpdate", "targetOffline", "ack"), { frame: "targetNeedsUpdate", messageId: blocked.id, to: phone.keys.deviceId });
      const updated = await context.ready(phone.keys);
      const command = makeEnvelope(mac, updated, "command", { action: "set_alarm" });
      mac.send({ frame: "envelope", envelope: command });
      assert.deepEqual(await updated.next("envelope"), { frame: "envelope", envelope: command });
      assert.deepEqual(await mac.next("ack", "targetOffline", "targetNeedsUpdate"), { frame: "ack", messageId: command.id });
    },
  },
];

/** Runs the scenarios in order, each with fresh devices. A failure is reported, never thrown. */
export async function runLiveCheck(url: string, clock: Clock, only?: string[], options: { skipSlow?: boolean } = {}): Promise<ScenarioResult[]> {
  const chosen = liveScenarios.filter((s) => (only ? only.includes(s.name) : true) && !(options.skipSlow && s.slow));
  const results: ScenarioResult[] = [];
  for (const scenario of chosen) {
    const started = Date.now();
    const context = new Context(url, clock);
    let detail = "";
    try {
      await scenario.run(context);
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        await context.close();
      } catch (error) {
        const cleanupError = error instanceof Error ? error.message : String(error);
        detail = detail ? `${detail}; ${cleanupError}` : cleanupError;
      }
    }
    results.push({ name: scenario.name, spec: scenario.spec, ok: detail === "", detail, ms: Date.now() - started });
  }
  return results;
}
