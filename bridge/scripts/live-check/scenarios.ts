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
  run(run: ScenarioRun): Promise<void>;
}

export interface ScenarioResult {
  name: string;
  spec: string;
  ok: boolean;
  /** Why it failed; empty when it passed. */
  detail: string;
  ms: number;
}

export interface LiveCheckOptions {
  /** Run only the scenarios with these names. */
  only?: string[];
  /** Leave out the scenarios that wait out the pairing window. */
  skipSlow?: boolean;
  /** The scenarios to choose from; the live scenarios unless a test passes its own. */
  scenarios?: Scenario[];
}

/** Long enough for a deployed relay behind a proxy to notice a closed socket, or to deliver a frame it should not. */
const SETTLE_MS = 1000;
const BAD_SIGNATURE = `${"A".repeat(86)}==`;
/**
 * The relay compares an unpair's time, from the sending device's clock, with its own pairing time, so an unpair sent
 * right after pairing can be dropped when the clocks differ (OBJ-48). The scenarios unpair a few seconds after
 * pairing, as a person would, and the results say so.
 */
const UNPAIR_AFTER_MS = 3000;
/** Far enough in the past that a PC clock running minutes fast still makes the message expired at the relay. */
const LONG_AGO_MS = 10 * 60_000;

/** The devices one scenario uses, and the pairings it must undo when it ends. */
export class ScenarioRun {
  private readonly devices: RelayDevice[] = [];
  private readonly pairingsToUndo: Array<{ mac: RelayDevice; phone: RelayDevice }> = [];

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

  /** Two fresh devices, paired, which are unpaired again when the scenario ends. */
  async paired(): Promise<{ mac: RelayDevice; phone: RelayDevice }> {
    const mac = await this.ready();
    const phone = await this.ready();
    this.unpairAtEnd(mac, phone);
    await pair(mac, phone);
    return { mac, phone };
  }

  /** Unpairs these two when the scenario ends, unless the scenario unpaired them itself. */
  unpairAtEnd(mac: RelayDevice, phone: RelayDevice): void {
    this.pairingsToUndo.push({ mac, phone });
  }

  /** The scenario unpaired these two itself. */
  unpaired(mac: RelayDevice, phone: RelayDevice): void {
    const index = this.pairingsToUndo.findIndex((p) => p.mac === mac && p.phone === phone);
    if (index >= 0) this.pairingsToUndo.splice(index, 1);
  }

  /** Lets the relay notice a closed socket before the next step. */
  settle(): Promise<void> {
    return sleep(SETTLE_MS);
  }

  /**
   * Unpairs every pairing the scenario left, and acknowledges the unpair as the Mac, so a deployed relay keeps no test
   * pairing and no unpair waiting for an acknowledgement. Then closes every socket, and throws if any of it failed.
   */
  async close(): Promise<void> {
    const errors: string[] = [];
    for (const { mac, phone } of this.pairingsToUndo) {
      try {
        const phoneAgain = await this.ready(phone.keys);
        // A minute ahead, so a PC clock behind the relay cannot make the relay drop it (OBJ-48).
        const unpair = makeUnpair(phoneAgain, mac, new Date(Date.now() + 60_000).toISOString());
        phoneAgain.send(unpair);
        await phoneAgain.next("ack");
        await mac.close();
        const macAgain = await this.ready(mac.keys);
        await macAgain.next("unpair");
        macAgain.send({ frame: "ack", messageId: unpair.id });
      } catch (error) {
        errors.push(messageOf(error));
      }
    }
    await Promise.all(
      this.devices.map(async (device) => {
        try {
          await device.close();
        } catch (error) {
          errors.push(messageOf(error));
        }
      }),
    );
    if (errors.length) throw new Error(`cleanup failed: ${errors.join("; ")}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function expectRouted(sender: RelayDevice, recipient: RelayDevice): Promise<void> {
  const command = makeEnvelope(sender, recipient, "command", { action: "ping" });
  sender.send({ frame: "envelope", envelope: command });
  assert.deepEqual(await recipient.next("envelope"), { frame: "envelope", envelope: command });
  assert.deepEqual(await sender.next("ack", "notPaired", "targetOffline"), { frame: "ack", messageId: command.id });
}

export const liveScenarios: Scenario[] = [
  {
    name: "Devices authenticate",
    spec: "pairing.md \"Connecting\"",
    run: async (run) => {
      await run.ready();
    },
  },
  {
    name: "Refusals name their reason",
    spec: "pairing.md \"Connecting\", \"Another protocol version\"",
    run: async (run) => {
      const forged = await run.connect(undefined, PROTOCOL_VERSION, BAD_SIGNATURE);
      assert.deepEqual(forged.handshake, { frame: "refused", reason: "badSignature" });
      const other = await run.connect(undefined, 999);
      assert.deepEqual(other.handshake, { frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
    },
  },
  {
    name: "Pair the phone with the Mac",
    spec: "SPEC-08 \"Pair the phone with the Mac\"",
    run: async (run) => {
      const mac = await run.ready();
      const phone = await run.ready();
      run.unpairAtEnd(mac, phone);
      const request = makePairRequest(phone, mac);
      phone.send(request);
      assert.deepEqual(await mac.next("pairRequest"), request);
      const accept = makePairAccept(mac, phone);
      mac.send(accept);
      assert.deepEqual(await phone.next("pairAccept"), accept);
      assert.deepEqual(await mac.next("paired", "pairExpired"), { frame: "paired", device: phone.keys.deviceId });
    },
  },
  {
    name: "Messages pass through unchanged",
    spec: "SPEC-08 \"VPS cannot read messages\" (the relay forwards ciphertext as is)",
    run: async (run) => {
      const { mac, phone } = await run.paired();
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
    run: async (run) => {
      const { mac, phone } = await run.paired();
      await phone.close();
      await run.settle();
      const command = makeEnvelope(mac, phone, "command", { action: "set_alarm" });
      mac.send({ frame: "envelope", envelope: command });
      assert.deepEqual(await mac.next("targetOffline", "ack"), { frame: "targetOffline", messageId: command.id, to: phone.keys.deviceId });
    },
  },
  {
    name: "Result survives a short reconnect",
    spec: "SPEC-08 \"Result survives a short reconnect\"",
    run: async (run) => {
      const { mac, phone } = await run.paired();
      await mac.close();
      await run.settle();
      const result = makeEnvelope(phone, mac, "result", { replyTo: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8" });
      phone.send({ frame: "envelope", envelope: result });
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: result.id });
      const back = await run.ready(mac.keys);
      assert.deepEqual(await back.next("envelope"), { frame: "envelope", envelope: result });
      back.send({ frame: "ack", messageId: result.id });
      await run.settle();
      await back.close();
      const again = await run.ready(mac.keys);
      await expectNothing(again, "envelope");
    },
  },
  {
    name: "A message sent twice is delivered once",
    spec: "SPEC-08 \"Duplicate delivery runs once\" (the relay's part: an acknowledged message is not delivered again)",
    run: async (run) => {
      const { mac, phone } = await run.paired();
      const event = makeEnvelope(phone, mac, "event", { progress: 1 });
      phone.send({ frame: "envelope", envelope: event });
      assert.deepEqual(await mac.next("envelope"), { frame: "envelope", envelope: event });
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: event.id });
      mac.send({ frame: "ack", messageId: event.id });
      await run.settle();
      phone.send({ frame: "envelope", envelope: event });
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: event.id }, "a resent message was not acknowledged again");
      await expectNothing(mac, "envelope");
    },
  },
  {
    name: "Expired command is not delivered",
    spec: "SPEC-08 \"Expired command is not run\" (the relay's part: an expired message is never delivered)",
    run: async (run) => {
      const { mac, phone } = await run.paired();
      const late = makeEnvelope(mac, phone, "command", { action: "set_alarm" }, new Date(Date.now() - LONG_AGO_MS).toISOString());
      mac.send({ frame: "envelope", envelope: late });
      assert.deepEqual(await mac.next("expired", "ack"), { frame: "expired", messageId: late.id, to: phone.keys.deviceId });
      await expectNothing(phone, "envelope");
    },
  },
  {
    name: "Message from an unknown device is dropped",
    spec: "SPEC-08 \"Message from an unknown device is dropped\" (the relay refuses to route it)",
    run: async (run) => {
      const { mac } = await run.paired();
      const stranger = await run.ready();
      await expectNotPaired(stranger, mac);
      await expectNothing(mac, "envelope");
    },
  },
  {
    name: "Unpair from the phone",
    spec: `SPEC-08 "Unpair a device", with the Mac offline and a retry (sent ${UNPAIR_AFTER_MS / 1000} s after pairing; OBJ-48)`,
    run: async (run) => {
      const { mac, phone } = await run.paired();
      await mac.close();
      await sleep(UNPAIR_AFTER_MS);
      const unpair = makeUnpair(phone, mac, new Date().toISOString());
      phone.send(unpair);
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: unpair.id });
      run.unpaired(mac, phone);
      await expectNotPaired(phone, mac);
      const back = await run.ready(mac.keys);
      assert.deepEqual(await back.next("unpair"), unpair);
      back.send({ frame: "ack", messageId: unpair.id });
      phone.send(unpair);
      assert.deepEqual(await phone.next("ack"), { frame: "ack", messageId: unpair.id }, "a retried unpair was not acknowledged again");
    },
  },
  {
    name: "Unpair from the Mac, then pair again",
    spec: `SPEC-08 "Unpair a device" from the other side; pairing.md "Unpairing" step 7 (sent ${UNPAIR_AFTER_MS / 1000} s after pairing; OBJ-48)`,
    run: async (run) => {
      const { mac, phone } = await run.paired();
      await sleep(UNPAIR_AFTER_MS);
      const unpair = makeUnpair(mac, phone, new Date().toISOString());
      mac.send(unpair);
      assert.deepEqual(await mac.next("ack"), { frame: "ack", messageId: unpair.id });
      run.unpaired(mac, phone);
      assert.deepEqual(await phone.next("unpair"), unpair);
      phone.send({ frame: "ack", messageId: unpair.id });
      await expectNotPaired(mac, phone);
      run.unpairAtEnd(mac, phone);
      await pair(mac, phone);
      await expectRouted(mac, phone);
    },
  },
  {
    name: "Phone cancels pairing",
    spec: "pairing.md \"The answer window\", Cancelled",
    run: async (run) => {
      const mac = await run.ready();
      const phone = await run.ready();
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
    run: async (run) => {
      const mac = await run.ready();
      const phone = await run.ready();
      phone.send(makePairRequest(phone, mac));
      await mac.next("pairRequest");
      await run.clock.advance(31_000);
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
    run: async (run) => {
      const { mac, phone } = await run.paired();
      await phone.close();
      await run.settle();
      const old = await run.connect(phone.keys, PROTOCOL_VERSION - 1);
      assert.deepEqual(old.handshake, { frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
      await run.settle();
      const blocked = makeEnvelope(mac, phone, "command", { action: "set_alarm" });
      mac.send({ frame: "envelope", envelope: blocked });
      assert.deepEqual(await mac.next("targetNeedsUpdate", "targetOffline", "ack"), { frame: "targetNeedsUpdate", messageId: blocked.id, to: phone.keys.deviceId });
      const updated = await run.ready(phone.keys);
      await expectRouted(mac, updated);
    },
  },
];

/** Which scenarios run, and which are left out because they are slow. */
export function chooseScenarios(options: LiveCheckOptions = {}): { chosen: Scenario[]; skipped: Scenario[] } {
  const named = (options.scenarios ?? liveScenarios).filter((s) => (options.only ? options.only.includes(s.name) : true));
  const skipped = named.filter((s) => options.skipSlow && s.slow);
  return { chosen: named.filter((s) => !skipped.includes(s)), skipped };
}

/** Runs the scenarios in order, each with fresh devices. A failure is reported, never thrown. */
export async function runLiveCheck(url: string, clock: Clock, options: LiveCheckOptions = {}): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of chooseScenarios(options).chosen) {
    const started = Date.now();
    const run = new ScenarioRun(url, clock);
    const problems: string[] = [];
    try {
      await scenario.run(run);
    } catch (error) {
      problems.push(messageOf(error));
    }
    try {
      await run.close();
    } catch (error) {
      problems.push(messageOf(error));
    }
    const detail = problems.join("; ");
    results.push({ name: scenario.name, spec: scenario.spec, ok: detail === "", detail, ms: Date.now() - started });
  }
  return results;
}
