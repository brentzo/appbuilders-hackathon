import type { DeviceId, ErrorKind, PairedDevice, Payload, PhoneToolCall, ToolDescriptor, Uuid } from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";
import type { LaneTools, ToolRunResult } from "../scheduler/lanes.ts";
import type { UndeliveredReason } from "./client.ts";
import type { PhoneBridge } from "./delegated-goals.ts";

/**
 * The phone's tools on the Mac (SPEC-09 r1, r2, r16, r19, OBJ-65, OBJ-77, OBJ-80).
 *
 * - The Mac keeps each paired phone's latest `toolList`, and answers it with its own, which carries this Mac's wake
 *   addresses. The phone never answers the Mac's, so the two never loop. On every relay connection the Mac sends its
 *   own list to each paired device.
 * - The helper lane offers the phone's tools as one `phone` tool while a list is known (`withPhone`), so the
 *   orchestrator stays within SPEC-05's 8-tool cap.
 * - A call is a `toolCall` command. It waits at most 2 minutes, is never queued, and fails at once when the relay
 *   answers `targetOffline`; the bridge client then tells the app with the "Other device offline" error.
 */

/** How long a phone tool call may wait for its result: the command expiry (SPEC-09 r16). */
export const PHONE_CALL_MS = 2 * 60_000;

export interface PhoneToolsDeps {
  bridge: PhoneBridge;
  /** This Mac's bridge device id, once known. */
  ownDeviceId: () => DeviceId | undefined;
  logger: Logger;
  /** This Mac's hardware addresses for Wake-on-LAN (SPEC-09 r19). */
  wakeAddresses?: () => string[];
  /** Shorter in tests. */
  callMs?: number;
}

/** How a phone tool call ended. */
export type PhoneCallResult = ({ ok: true; data?: string } | { ok: false; error: ErrorKind }) & { deviceId?: DeviceId };

export class PhoneTools {
  private readonly lists = new Map<DeviceId, ToolDescriptor[]>();
  /** Calls waiting for their result, by command id. */
  private readonly calls = new Map<Uuid, (result: PhoneCallResult) => void>();

  constructor(private readonly deps: PhoneToolsDeps) {}

  /** The paired phone's latest tool list, or undefined while none is known. */
  phoneTools(): { deviceId: DeviceId; tools: ToolDescriptor[] } | undefined {
    for (const [deviceId, tools] of this.lists) {
      if (this.deps.bridge.isPaired(deviceId)) return { deviceId, tools };
      this.lists.delete(deviceId);
    }
    return undefined;
  }

  /** The messages this module answers: tool lists, tool results, and an expired call. */
  handles(payload: Payload): boolean {
    return payload.kind === "toolList" || payload.kind === "toolResult" || payload.kind === "commandExpired";
  }

  handle(payload: Payload, peer: PairedDevice, replyTo?: Uuid): void {
    switch (payload.kind) {
      case "toolList":
        this.lists.set(peer.deviceId, payload.tools);
        this.deps.logger.info("phoneTools.list", { from: peer.deviceId, tools: payload.tools.map((tool) => tool.name) });
        this.sendOwnList(peer.deviceId);
        return;
      case "toolResult":
        this.calls.get(replyTo ?? "")?.(
          payload.success ? { ok: true, ...(payload.data ? { data: payload.data } : {}) } : { ok: false, error: payload.error! },
        );
        return;
      case "commandExpired":
        this.calls.get(replyTo ?? "")?.({ ok: false, error: "commandExpired" });
        return;
      default:
        return;
    }
  }

  /** The relay connected: every paired device gets this Mac's tool list again. */
  connected(): void {
    for (const device of this.deps.bridge.listPairedDevices().devices) this.sendOwnList(device.deviceId);
  }

  /** The relay sent a call back undelivered: it fails at once, never queued (SPEC-09 r16). */
  undelivered(messageId: Uuid, reason: UndeliveredReason): void {
    const error: ErrorKind =
      reason === "expired" ? "commandExpired" : reason === "notPaired" ? "unpairedDevice" : "otherDeviceOffline";
    this.calls.get(messageId)?.({ ok: false, error });
  }

  /** Runs one tool on the paired phone. At most 2 minutes. */
  async call(call: PhoneToolCall, taskId?: Uuid): Promise<PhoneCallResult> {
    const phone = this.phoneTools();
    if (!phone) return { ok: false, error: "unpairedDevice" };
    let settle!: (result: PhoneCallResult) => void;
    const settled = new Promise<PhoneCallResult>((resolve) => (settle = resolve));
    let messageId: Uuid;
    try {
      messageId = await this.deps.bridge.sendMessage(phone.deviceId, "command", { kind: "toolCall", call }, undefined, taskId);
    } catch (error) {
      this.deps.logger.warn("phoneTools.notSent", { tool: call.tool, ...describeError(error) });
      return { ok: false, error: "otherDeviceOffline", deviceId: phone.deviceId };
    }
    this.calls.set(messageId, settle);
    const timer = setTimeout(() => settle({ ok: false, error: "commandExpired" }), this.deps.callMs ?? PHONE_CALL_MS);
    try {
      const result = await settled;
      this.deps.logger.info("phoneTools.called", {
        tool: call.tool,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      });
      return { ...result, deviceId: phone.deviceId };
    } finally {
      clearTimeout(timer);
      this.calls.delete(messageId);
    }
  }

  private sendOwnList(deviceId: DeviceId): void {
    const own = this.deps.ownDeviceId();
    if (!own) return;
    const wake = [...new Set(this.deps.wakeAddresses?.() ?? [])];
    const list: Payload = { kind: "toolList", deviceId: own, tools: [], ...(wake.length > 0 ? { wakeAddresses: wake } : {}) };
    this.deps.bridge
      .sendMessage(deviceId, "event", list)
      .catch((error: unknown) => this.deps.logger.warn("phoneTools.listNotSent", { to: deviceId, ...describeError(error) }));
  }
}

/** What the worker reads when a phone call fails. For the model only; the user hears the SPEC-11 copy. */
const FAILED: Partial<Record<ErrorKind, string>> = {
  otherDeviceOffline: "The phone can't be reached right now, and the user was told. Do not call the phone again; finish.",
  commandExpired: "The phone did not answer in time. Do not call the phone again; finish.",
  unpairedDevice: "No phone is paired. Do not call the phone; finish.",
};

/** Adds the one `phone` tool to a lane's tools while a phone tool list is known (SPEC-09 r2). */
export function withPhone(tools: LaneTools, phone: PhoneTools): LaneTools {
  return {
    get tools() {
      const known = phone.phoneTools();
      return known ? [...tools.tools, { name: "phone" as const, description: describePhoneTool(known.tools) }] : tools.tools;
    },
    async run(call, signal, context): Promise<ToolRunResult> {
      if (call.tool !== "phone") return tools.run(call, signal, context);
      const result = await phone.call(call.call, context?.taskId);
      const device = result.deviceId ? { deviceId: result.deviceId } : {};
      return result.ok
        ? { outcome: "ok", output: result.data ?? "Done on the phone.", ...device }
        : { outcome: "error", output: FAILED[result.error] ?? "The phone could not do it.", ...device };
    },
  };
}

/** The `phone` tool's description: each phone tool and its arguments, from the phone's own list. */
export function describePhoneTool(tools: readonly ToolDescriptor[]): string {
  const lines = tools.map((tool) => {
    const args = tool.arguments.map(
      (arg) => `${arg.name}${arg.required ? "" : "?"}: ${arg.type}${arg.format ? ` (${arg.format})` : ""}`,
    );
    return `${tool.name}(${args.join(", ")}): ${tool.description}`;
  });
  return `Run one tool on the user's paired phone. Give call: {tool, ...arguments}. Tools: ${lines.join(" ")}`.slice(0, 1000);
}
