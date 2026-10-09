import { randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { RpcFailure, type Handler } from "@yumi/protocol";
import { validate } from "@yumi/protocol";
import {
  deviceKeysFromSeeds,
  deviceIdFor,
  fromBase64,
  openPairRequest,
  pairAcceptSigningBytes,
  openEnvelope,
  relayAuthSigningBytes,
  sealEnvelope,
  sign,
  toBase64,
  unpairSigningBytes,
  verify,
  expiresAt,
  type DeviceKeys,
} from "@yumi/protocol/crypto";
import {
  PROTOCOL_VERSION,
  type BridgeFrame,
  type DeviceId,
  type EnvelopeType,
  type PairingOffer,
  type PairedDevice,
  type UnpairFrame,
  type Uuid,
} from "@yumi/protocol/types";
import { WebSocket } from "ws";

const SEED_KEY = "bridge.device-seeds";
const OFFER_MS = 5 * 60_000;

export interface BridgeClientOptions {
  /** Public relay URL embedded in the QR offer. Must be WSS outside tests. */
  bridgeUrl: string;
  /** Optional loopback endpoint used by protocol tests instead of the public URL. */
  relayUrl?: string;
  deviceName: string;
  rpc: BridgeRpc;
  databasePath: string;
  /** Allows plain ws only for an explicitly loopback test endpoint. */
  allowLoopbackWs?: boolean;
  /**
   * A message from a paired device, opened. A command's return value is its encrypted result; a result names the
   * command it answers in `replyTo`.
   */
  onMessage?: (message: unknown, peer: PairedDevice, type: EnvelopeType, replyTo?: Uuid) => unknown | Promise<unknown>;
  /** The relay connected and authenticated this Mac, so paired devices can be reached again (SPEC-09 r1). */
  onConnected?: () => void;
  /** The relay sent back a message this Mac sent, for example because the phone is offline (SPEC-09 r16). */
  onUndelivered?: (messageId: Uuid, reason: UndeliveredReason) => void;
  onLog?: (event: string) => void;
  /** First reconnect delay; it doubles up to 30 seconds. Tests shorten it. */
  reconnectBaseMs?: number;
}

/** Why the relay sent a message back undelivered. */
export type UndeliveredReason = "targetOffline" | "targetNeedsUpdate" | "expired" | "notPaired";

export interface BridgeRpc {
  request(method: string, params: unknown): Promise<unknown>;
  notify(event: string, payload: unknown): void;
}

export class BridgeClient {
  private readonly db: Database.Database;
  private started: Promise<void> | undefined;
  private socket?: WebSocket;
  private keys?: DeviceKeys;
  private stopped = false;
  private reconnectTimer?: NodeJS.Timeout;
  private attempt = 0;
  private reconnectScheduled = false;
  private offlineErrorReported = false;
  private state: "connected" | "reconnecting" | "offline" = "offline";
  private readonly offers = new Map<string, { secret: Uint8Array; expiresAt: number }>();
  private readonly processing = new Map<string, Promise<void>>();
  private readonly waiters: Array<{ state: string; resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

  constructor(private readonly options: BridgeClientOptions) {
    if (!secureUrl(options.bridgeUrl)) {
      throw new TypeError("The bridge URL must use wss://");
    }
    const connectUrl = options.relayUrl ?? options.bridgeUrl;
    if (!secureUrl(connectUrl) && !(options.allowLoopbackWs && isLoopbackWs(connectUrl)))
      throw new TypeError("The connection URL must use wss://");
    this.db = new Database(options.databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS peers (device_id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, signing_key TEXT NOT NULL, kx_key TEXT NOT NULL, paired_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS processed (message_id TEXT PRIMARY KEY, result TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (message_id TEXT PRIMARY KEY, frame TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS message_tasks (message_id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_unpairs (device_id TEXT PRIMARY KEY, frame TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS received_unpairs (from_device TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY (from_device, message_id));`);
    this.db.prepare("DELETE FROM processed WHERE julianday(created_at) < julianday('now', '-1 day')").run();
  }

  get handlers(): Record<string, Handler> {
    return {
      startPairing: (async () => this.startPairing()) as Handler,
      listPairedDevices: (() => this.listPairedDevices()) as Handler,
      unpair: (async (p: { deviceId: string }) => this.unpair(p.deviceId)) as Handler,
    };
  }

  async start(): Promise<void> {
    if (this.started) return this.started;
    this.started = this.startOnce();
    try {
      await this.started;
    } catch (error) {
      this.started = undefined;
      throw error;
    }
  }

  private async startOnce(): Promise<void> {
    if (!this.keys) {
      const loaded = (await this.options.rpc.request("loadSecret", { key: SEED_KEY })) as { value?: string };
      let seed: Uint8Array;
      if (loaded.value) seed = fromBase64(loaded.value);
      else {
        seed = randomBytes(64);
        await this.options.rpc.request("storeSecret", { key: SEED_KEY, value: toBase64(seed) });
      }
      if (seed.length !== 64) throw new Error("Invalid device seed length");
      this.keys = deviceKeysFromSeeds(seed.slice(0, 32), seed.slice(32));
    }
    this.resignLegacyPendingUnpairs();
    this.stopped = false;
    this.connect();
  }

  waitForState(state: "connected" | "reconnecting" | "offline", timeoutMs = 3000): Promise<void> {
    if (state === this.state) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = {
        state,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for bridge state ${state}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** This Mac's bridge device id, once the keys are loaded at start. */
  get deviceId(): DeviceId | undefined {
    return this.keys?.deviceId;
  }

  /** True when `deviceId` is a paired device that is not being unpaired. */
  isPaired(deviceId: DeviceId): boolean {
    return this.listPairedDevices().devices.some((device) => device.deviceId === deviceId);
  }

  listPairedDevices(): { devices: PairedDevice[] } {
    const devices = this.db
      .prepare(
        `SELECT p.device_id AS deviceId, p.name, p.paired_at AS pairedAt FROM peers p
      WHERE NOT EXISTS (SELECT 1 FROM pending_unpairs u WHERE u.device_id = p.device_id) ORDER BY p.paired_at`,
      )
      .all() as PairedDevice[];
    return { devices };
  }

  async unpair(deviceId: string): Promise<Record<string, never>> {
    const peer = this.peer(deviceId);
    if (!peer || !this.keys) throw new RpcFailure({ kind: "unpairedDevice", device: deviceId });
    if (this.db.prepare("SELECT 1 FROM pending_unpairs WHERE device_id = ?").get(deviceId)) return {};
    const at = new Date().toISOString();
    const id = randomUUID();
    const frame: UnpairFrame = {
      frame: "unpair",
      id,
      from: this.keys.deviceId,
      to: deviceId,
      at,
      signature: toBase64(
        sign(unpairSigningBytes({ id, from: this.keys.deviceId, to: deviceId, at }), this.keys.signing.secretKey),
      ),
    };
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO pending_unpairs VALUES (?, ?)").run(deviceId, JSON.stringify(frame));
      this.db.prepare("DELETE FROM peers WHERE device_id = ?").run(deviceId);
    })();
    this.send(frame);
    return {};
  }

  async sendMessage(
    deviceId: string,
    type: "command" | "result" | "event",
    payload: unknown,
    replyTo?: string,
    taskId?: string,
  ): Promise<string> {
    const peer = this.peer(deviceId);
    if (!peer || !this.keys || this.db.prepare("SELECT 1 FROM pending_unpairs WHERE device_id = ?").get(deviceId)) {
      throw new RpcFailure({ kind: "unpairedDevice", device: deviceId });
    }
    if (taskId !== undefined && !validate("Uuid", taskId).valid) throw new TypeError("taskId must be a UUID");
    const envelope = sealEnvelope({
      sender: this.keys,
      recipient: { deviceId, signingPublicKey: fromBase64(peer.signing_key), kxPublicKey: fromBase64(peer.kx_key) },
      type,
      // An approval request lives exactly as long as the approval: 5 minutes, the time in its payload.
      expiresAt: isApprovalRequest(payload) ? payload.expiresAt : expiresAt(type),
      payload,
      ...(replyTo ? { replyTo } : {}),
    });
    const frame: BridgeFrame = { frame: "envelope", envelope };
    this.db.prepare("INSERT OR REPLACE INTO outbox VALUES (?, ?, ?)").run(envelope.id, JSON.stringify(frame), envelope.expiresAt);
    if (taskId) this.db.prepare("INSERT OR REPLACE INTO message_tasks VALUES (?, ?)").run(envelope.id, taskId);
    this.send(frame);
    return envelope.id;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.db.close();
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Client stopped"));
    }
  }

  private connect(): void {
    if (this.stopped || !this.keys) return;
    this.reconnectScheduled = false;
    this.socket = new WebSocket(this.options.relayUrl ?? this.options.bridgeUrl);
    this.socket.on("message", (data) => this.receive(data.toString()));
    this.socket.on("close", () => this.disconnected());
    this.socket.on("error", () => this.disconnected());
  }

  private receive(text: string): void {
    if (this.stopped) return;
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      this.options.onLog?.("invalid-frame");
      return;
    }
    if (!validate("BridgeFrame", raw).valid) {
      this.options.onLog?.("invalid-frame");
      return;
    }
    const frame = raw as BridgeFrame;
    if (frame.frame === "challenge" && this.keys) {
      this.send({
        frame: "authenticate",
        deviceId: this.keys.deviceId,
        signingPublicKey: toBase64(this.keys.signing.publicKey),
        protocolVersion: PROTOCOL_VERSION,
        signature: toBase64(
          sign(relayAuthSigningBytes(fromBase64(frame.nonce), this.keys.deviceId), this.keys.signing.secretKey),
        ),
      });
    } else if (frame.frame === "ready") {
      this.attempt = 0;
      this.reconnectScheduled = false;
      this.offlineErrorReported = false;
      this.notifyState("connected");
      this.resendOutbox();
      this.resendPendingUnpairs();
      this.options.onConnected?.();
    } else if (frame.frame === "refused") {
      this.options.onLog?.("relay-refused");
      this.reportBridgeDown();
      this.socket?.close();
    } else if (frame.frame === "pairRequest") {
      void this.acceptPairRequest(frame);
    } else if (frame.frame === "ack") {
      const pendingUnpairs = this.db.prepare("SELECT device_id, frame FROM pending_unpairs").all() as Array<{
        device_id: string;
        frame: string;
      }>;
      const unpair = pendingUnpairs.find(({ frame: text }) => (JSON.parse(text) as UnpairFrame).id === frame.messageId);
      if (unpair) {
        this.db.prepare("DELETE FROM pending_unpairs WHERE device_id = ?").run(unpair.device_id);
        return;
      }
      this.db.prepare("DELETE FROM outbox WHERE message_id = ?").run(frame.messageId);
      this.db.prepare("DELETE FROM message_tasks WHERE message_id = ?").run(frame.messageId);
    } else if (
      frame.frame === "targetOffline" ||
      frame.frame === "targetNeedsUpdate" ||
      frame.frame === "expired" ||
      frame.frame === "notPaired"
    ) {
      this.db.prepare("DELETE FROM outbox WHERE message_id = ?").run(frame.messageId);
      const task = this.db.prepare("SELECT task_id FROM message_tasks WHERE message_id = ?").get(frame.messageId) as
        { task_id: string } | undefined;
      this.db.prepare("DELETE FROM message_tasks WHERE message_id = ?").run(frame.messageId);
      this.options.onUndelivered?.(frame.messageId, frame.frame);
      this.options.rpc.notify("userError", {
        // targetNeedsUpdate reads as offline until OBJ-42 adds its own kind (protocol/docs/pairing.md).
        kind:
          frame.frame === "targetOffline" || frame.frame === "targetNeedsUpdate"
            ? "otherDeviceOffline"
            : frame.frame === "expired"
              ? "commandExpired"
              : "unpairedDevice",
        device: frame.to,
        ...(task ? { taskId: task.task_id } : {}),
      });
    } else if (frame.frame === "unpair") {
      this.receiveUnpair(frame);
    } else if (frame.frame === "envelope") {
      void this.receiveEnvelope(frame.envelope);
    }
  }

  private async startPairing(): Promise<{ qrPayload: string; expiresAt: string }> {
    if (!this.keys || this.state !== "connected" || this.socket?.readyState !== WebSocket.OPEN)
      throw new RpcFailure({ kind: "bridgeDown" });
    const secret = randomBytes(32);
    const expiresAt = new Date(Date.now() + OFFER_MS).toISOString();
    const offer: PairingOffer = {
      protocolVersion: PROTOCOL_VERSION,
      deviceId: this.keys.deviceId,
      deviceName: this.options.deviceName,
      platform: "mac",
      signingPublicKey: toBase64(this.keys.signing.publicKey),
      kxPublicKey: toBase64(this.keys.kx.publicKey),
      pairingSecret: toBase64(secret),
      bridgeUrl: this.options.bridgeUrl,
      expiresAt,
    };
    if (!validate("PairingOffer", offer).valid) throw new Error("Generated an invalid pairing offer");
    this.offers.set(this.keys.deviceId, { secret, expiresAt: Date.parse(expiresAt) });
    return { qrPayload: JSON.stringify(offer), expiresAt };
  }

  private async acceptPairRequest(frame: Extract<BridgeFrame, { frame: "pairRequest" }>): Promise<void> {
    const offer = this.offers.get(frame.to);
    if (!offer || Date.now() >= offer.expiresAt || !this.keys || frame.to !== this.keys.deviceId) return;
    const request = openPairRequest(frame.sealed, { from: frame.from, to: frame.to }, offer.secret);
    if (!request || deviceIdFor(fromBase64(request.signingPublicKey)) !== frame.from) return;
    this.offers.delete(frame.to);
    const at = new Date().toISOString();
    this.db
      .prepare("INSERT OR REPLACE INTO peers VALUES (?, ?, ?, ?, ?, ?)")
      .run(frame.from, request.deviceName, request.platform, request.signingPublicKey, request.kxPublicKey, at);
    this.db.prepare("DELETE FROM pending_unpairs WHERE device_id = ?").run(frame.from);
    this.db.prepare("DELETE FROM received_unpairs WHERE from_device IN (?, ?)").run(frame.from, this.keys.deviceId);
    const accept = {
      signature: toBase64(
        sign(
          pairAcceptSigningBytes({
            from: this.keys.deviceId,
            to: frame.from,
            signingPublicKey: fromBase64(request.signingPublicKey),
            kxPublicKey: fromBase64(request.kxPublicKey),
          }),
          this.keys.signing.secretKey,
        ),
      ),
    };
    this.send({ frame: "pairAccept", from: this.keys.deviceId, to: frame.from, accept });
  }

  private receiveUnpair(frame: UnpairFrame): void {
    const seen = this.db
      .prepare("SELECT 1 FROM received_unpairs WHERE from_device = ? AND message_id = ?")
      .get(frame.from, frame.id);
    if (seen) {
      this.send({ frame: "ack", messageId: frame.id });
      return;
    }
    const peer = this.peer(frame.from);
    if (
      !peer ||
      !this.keys ||
      Date.parse(frame.at) <= Date.parse(peer.pairedAt) ||
      !verify(fromBase64(frame.signature), unpairSigningBytes(frame), fromBase64(peer.signing_key))
    )
      return;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM peers WHERE device_id = ?").run(frame.from);
      this.db.prepare("DELETE FROM pending_unpairs WHERE device_id = ?").run(frame.from);
      this.db.prepare("INSERT INTO received_unpairs VALUES (?, ?)").run(frame.from, frame.id);
    })();
    this.send({ frame: "ack", messageId: frame.id });
  }

  private resignLegacyPendingUnpairs(): void {
    if (!this.keys) return;
    const rows = this.db.prepare("SELECT device_id, frame FROM pending_unpairs").all() as Array<{
      device_id: string;
      frame: string;
    }>;
    for (const row of rows) {
      const old = JSON.parse(row.frame) as {
        frame: "unpair";
        id?: string;
        from: string;
        to: string;
        at: string;
        signature?: string;
      };
      if ("id" in old) continue;
      const id = randomUUID();
      const unsigned = { id, from: old.from, to: old.to, at: old.at };
      const frame: UnpairFrame = {
        frame: "unpair",
        ...unsigned,
        signature: toBase64(sign(unpairSigningBytes(unsigned), this.keys.signing.secretKey)),
      };
      this.db.prepare("UPDATE pending_unpairs SET frame = ? WHERE device_id = ?").run(JSON.stringify(frame), row.device_id);
    }
  }

  private async receiveEnvelope(envelope: Extract<BridgeFrame, { frame: "envelope" }>["envelope"]): Promise<void> {
    const inFlight = this.processing.get(envelope.id);
    if (inFlight) {
      await inFlight;
      const cached = this.db.prepare("SELECT result FROM processed WHERE message_id = ?").get(envelope.id) as
        { result: string } | undefined;
      if (cached?.result) this.send(JSON.parse(cached.result) as unknown);
      this.send({ frame: "ack", messageId: envelope.id });
      return;
    }
    const work = this.processEnvelope(envelope);
    this.processing.set(envelope.id, work);
    try {
      await work;
    } catch {
      this.options.onLog?.("envelope-processing-failed");
    } finally {
      this.processing.delete(envelope.id);
    }
  }

  private async processEnvelope(envelope: Extract<BridgeFrame, { frame: "envelope" }>["envelope"]): Promise<void> {
    if (!this.keys) return;
    const peer = this.peer(envelope.from);
    if (!peer) {
      this.options.onLog?.("dropped-unpaired-envelope");
      return;
    }
    if (this.db.prepare("SELECT 1 FROM pending_unpairs WHERE device_id = ?").get(envelope.from)) {
      this.options.onLog?.("dropped-unpaired-envelope");
      return;
    }
    const sender = {
      deviceId: envelope.from,
      signingPublicKey: fromBase64(peer.signing_key),
      kxPublicKey: fromBase64(peer.kx_key),
    };
    const opened = openEnvelope(envelope, this.keys, sender);
    if (!opened.ok) {
      if (opened.reason === "expired") {
        const cached = this.db.prepare("SELECT result FROM processed WHERE message_id = ?").get(envelope.id) as
          { result: string } | undefined;
        if (cached?.result) this.send(JSON.parse(cached.result) as unknown);
        else this.options.rpc.notify("userError", { kind: "commandExpired", device: envelope.from });
        this.send({ frame: "ack", messageId: envelope.id });
      } else this.options.onLog?.("dropped-invalid-envelope");
      return;
    }
    const seen = this.db.prepare("SELECT result FROM processed WHERE message_id = ?").get(envelope.id) as
      { result: string } | undefined;
    if (seen) {
      if (seen.result) this.send(JSON.parse(seen.result) as unknown);
      else this.options.onLog?.("message-interrupted-before-ack");
      this.send({ frame: "ack", messageId: envelope.id });
      return;
    }
    if (envelope.type === "event" || envelope.type === "result") {
      this.db.prepare("INSERT INTO processed VALUES (?, ?, ?)").run(envelope.id, "", new Date().toISOString());
      try {
        await this.options.onMessage?.(
          opened.payload,
          { deviceId: peer.deviceId, name: peer.name, pairedAt: peer.pairedAt },
          envelope.type,
          opened.replyTo,
        );
      } catch {
        this.options.onLog?.("message-handler-failed");
      }
      this.send({ frame: "ack", messageId: envelope.id });
      return;
    }
    // Recorded before the handler runs, so a repeat after a crash is never run twice. Until there is a result, a
    // repeat gets only an ack: the protocol has no result for "not answered", and the sender's own timeout covers it.
    this.db.prepare("INSERT INTO processed VALUES (?, ?, ?)").run(envelope.id, "", new Date().toISOString());
    let output: unknown;
    try {
      output = await this.options.onMessage?.(
        opened.payload,
        { deviceId: peer.deviceId, name: peer.name, pairedAt: peer.pairedAt },
        envelope.type,
      );
    } catch {
      output = undefined;
      this.options.onLog?.("message-handler-failed");
    }
    if (output === undefined) {
      // A command the handler refused, such as control of a goal the sender does not own: no result to send.
      this.options.onLog?.("command-unanswered");
      this.send({ frame: "ack", messageId: envelope.id });
      return;
    }
    const resultFrame: BridgeFrame = {
      frame: "envelope",
      envelope: sealEnvelope({
        sender: this.keys,
        recipient: sender,
        type: "result",
        expiresAt: expiresAt("result"),
        payload: output,
        replyTo: envelope.id,
      }),
    };
    const serialized = JSON.stringify(resultFrame);
    this.db
      .prepare("UPDATE processed SET result = ?, created_at = ? WHERE message_id = ?")
      .run(serialized, new Date().toISOString(), envelope.id);
    this.send(resultFrame);
    this.send({ frame: "ack", messageId: envelope.id });
  }

  private peer(id: string): (PairedDevice & { signing_key: string; kx_key: string; platform: string }) | undefined {
    return this.db
      .prepare(
        "SELECT device_id AS deviceId, name, paired_at AS pairedAt, signing_key, kx_key, platform FROM peers WHERE device_id = ?",
      )
      .get(id) as (PairedDevice & { signing_key: string; kx_key: string; platform: string }) | undefined;
  }

  private send(frame: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private disconnected(): void {
    if (this.stopped || this.reconnectScheduled) return;
    this.reconnectScheduled = true;
    this.notifyState("reconnecting");
    if (this.attempt >= 5) {
      this.notifyState("offline");
      if (!this.offlineErrorReported) {
        this.offlineErrorReported = true;
        this.options.onLog?.("relay-offline");
        this.reportBridgeDown();
      }
    }
    const delay = Math.min(30_000, (this.options.reconnectBaseMs ?? 500) * 2 ** Math.min(this.attempt++, 6));
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /**
   * Tells the user the bridge is down, but only when a phone is paired. With nothing paired there is no phone to
   * reach, so the error would interrupt the user about something they never set up. The connection state still
   * goes to the app, and the log records the failure.
   */
  private reportBridgeDown(): void {
    if (this.listPairedDevices().devices.length === 0) return;
    this.options.rpc.notify("userError", { kind: "bridgeDown" });
  }

  private resendOutbox(): void {
    const now = Date.now();
    const rows = this.db.prepare("SELECT frame, expires_at FROM outbox ORDER BY rowid").all() as {
      frame: string;
      expires_at: string;
    }[];
    for (const row of rows) {
      if (Date.parse(row.expires_at) <= now) {
        const frame = JSON.parse(row.frame) as Extract<BridgeFrame, { frame: "envelope" }>;
        const task = this.db.prepare("SELECT task_id FROM message_tasks WHERE message_id = ?").get(frame.envelope.id) as
          { task_id: string } | undefined;
        if (frame.envelope.type === "command")
          this.options.rpc.notify("userError", {
            kind: "commandExpired",
            device: frame.envelope.to,
            ...(task ? { taskId: task.task_id } : {}),
          });
        this.db.prepare("DELETE FROM outbox WHERE message_id = ?").run(frame.envelope.id);
        this.db.prepare("DELETE FROM message_tasks WHERE message_id = ?").run(frame.envelope.id);
        continue;
      }
      this.send(JSON.parse(row.frame) as unknown);
    }
  }

  private resendPendingUnpairs(): void {
    const rows = this.db.prepare("SELECT frame FROM pending_unpairs").all() as { frame: string }[];
    for (const row of rows) this.send(JSON.parse(row.frame) as unknown);
  }

  private notifyState(state: "connected" | "reconnecting" | "offline"): void {
    this.state = state;
    // With this Mac's device id, which the app sends as originDeviceId (OBJ-64).
    this.options.rpc.notify("bridgeStateChanged", { state, ...(this.keys ? { deviceId: this.keys.deviceId } : {}) });
    for (const waiter of [...this.waiters])
      if (waiter.state === state) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
  }
}

function isApprovalRequest(payload: unknown): payload is { kind: "approvalRequest"; expiresAt: string } {
  return (payload as { kind?: unknown } | null)?.kind === "approvalRequest";
}

function secureUrl(url: string): boolean {
  return url.startsWith("wss://");
}
function isLoopbackWs(url: string): boolean {
  return /^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(url);
}
