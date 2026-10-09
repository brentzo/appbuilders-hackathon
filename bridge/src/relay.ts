import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { validate } from "@yumi/protocol";
import {
  deviceIdFor,
  fromBase64,
  pairAcceptSigningBytes,
  relayAuthSigningBytes,
  unpairSigningBytes,
  verify,
  toBase64,
} from "@yumi/protocol/crypto";
import {
  PROTOCOL_VERSION,
  type BridgeFrame,
  type Envelope,
  type RefusedReason,
} from "@yumi/protocol/types";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { RelayStore, type PendingDelivery } from "./store.ts";

const PAIRING_MS = 5 * 60_000;
const NOTICE_MS = 2 * 60_000;
const AUTH_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 1_100_000;

export interface RelayOptions {
  host: string;
  port: number;
  databasePath: string;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
  now?: () => Date;
}

interface Connection {
  nonce: Uint8Array;
  authenticated: string | undefined;
  authTimer: NodeJS.Timeout;
  chain: Promise<void>;
}

export class Relay {
  readonly store: RelayStore;
  private readonly httpServer: Server;
  private readonly wsServer: WebSocketServer;
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly online = new Map<string, WebSocket>();
  private readonly now: () => Date;
  private readonly logger: (event: string, fields?: Record<string, string | number | boolean>) => void;
  private sweepTimer?: NodeJS.Timeout;
  private started = false;
  private closed = false;

  constructor(private readonly options: RelayOptions) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.log ?? ((event, fields = {}) => console.log(JSON.stringify({ at: this.now().toISOString(), event, ...fields })));
    this.store = new RelayStore(options.databasePath);
    mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    this.httpServer = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end('{"status":"ok"}');
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
    this.httpServer.on("upgrade", (request, socket, head) => {
      if (request.url !== "/") {
        socket.destroy();
        return;
      }
      this.wsServer.handleUpgrade(request, socket, head, (client) => this.wsServer.emit("connection", client, request));
    });
    this.wsServer.on("connection", (socket) => this.accept(socket));
    this.wsServer.on("error", () => this.logger("relay.websocketServerError"));
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.closed) throw new Error("A closed relay cannot be restarted");
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.httpServer.once("error", onError);
      this.httpServer.listen(this.options.port, this.options.host, () => {
        this.httpServer.off("error", onError);
        resolve();
      });
    });
    this.started = true;
    this.sweepTimer = setInterval(() => this.sweepExpired(), 1000);
    this.sweepTimer.unref();
    this.logger("relay.listening", { host: this.options.host, port: this.address().port });
  }

  url(): string {
    if (!this.started) throw new Error("Relay is not started");
    const address = this.address();
    const host = address.address.includes(":") ? `[${address.address}]` : address.address;
    return `ws://${host}:${address.port}/`;
  }

  address(): { address: string; port: number } {
    const address = this.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Relay is not listening on a TCP address");
    return { address: address.address, port: address.port };
  }

  sweepExpired(): void {
    const now = this.now();
    const { expiredDeliveries } = this.store.sweep(now.toISOString());
    for (const delivery of expiredDeliveries) {
      if (delivery.category === "envelope") {
        this.notice(delivery.sender, delivery.recipient, delivery.messageId, "expired");
        this.logger("message.expired", { from: delivery.sender, to: delivery.recipient, messageId: delivery.messageId });
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.sweepTimer);
    for (const [socket, connection] of this.connections) {
      clearTimeout(connection.authTimer);
      socket.close(1001, "server shutdown");
    }
    this.online.clear();
    await new Promise<void>((resolve) => {
      if (!this.httpServer.listening) return resolve();
      this.httpServer.close(() => resolve());
      this.wsServer.close(() => undefined);
    });
    this.store.close();
    this.started = false;
  }

  private accept(socket: WebSocket): void {
    const connection: Connection = {
      nonce: randomBytes(32),
      authenticated: undefined,
      authTimer: setTimeout(() => this.refuse(socket, "invalidFrame"), AUTH_TIMEOUT_MS),
      chain: Promise.resolve(),
    };
    connection.authTimer.unref();
    this.connections.set(socket, connection);
    this.send(socket, { frame: "challenge", nonce: toBase64(connection.nonce) });
    socket.on("message", (raw) => {
      connection.chain = connection.chain.then(() => this.receive(socket, connection, raw)).catch(() => {
        this.logger("frame.processingFailed", ...(connection.authenticated ? [{ deviceId: connection.authenticated }] : []));
      });
    });
    socket.on("close", () => this.disconnected(socket, connection));
    socket.on("error", () => this.logger("connection.socketError", ...(connection.authenticated ? [{ deviceId: connection.authenticated }] : [])));
  }

  private async receive(socket: WebSocket, connection: Connection, raw: RawData): Promise<void> {
    if (socket.readyState !== WebSocket.OPEN) return;
    let value: unknown;
    try {
      value = JSON.parse(raw.toString()) as unknown;
    } catch {
      this.invalidFrame(socket, connection);
      return;
    }
    if (!validate("BridgeFrame", value).valid) {
      this.invalidFrame(socket, connection);
      return;
    }
    const frame = value as BridgeFrame;
    if (!connection.authenticated) {
      if (frame.frame !== "authenticate") {
        this.refuse(socket, "invalidFrame");
        return;
      }
      this.authenticate(socket, connection, frame);
      return;
    }
    if (this.online.get(connection.authenticated) !== socket) return;
    if (frame.frame === "authenticate" || frame.frame === "challenge" || frame.frame === "ready" || frame.frame === "refused") {
      this.logger("frame.invalidDirection", { deviceId: connection.authenticated, type: frame.frame });
      return;
    }
    if ("from" in frame && frame.from !== connection.authenticated) {
      this.logger("frame.senderMismatch", { deviceId: connection.authenticated, from: frame.from, type: frame.frame });
      return;
    }
    switch (frame.frame) {
      case "pairRequest":
        this.pairRequest(frame);
        break;
      case "pairAccept":
        this.pairAccept(frame);
        break;
      case "envelope":
        this.envelope(socket, connection.authenticated, frame.envelope);
        break;
      case "ack":
        this.acknowledge(connection.authenticated, frame.messageId);
        break;
      case "unpair":
        this.unpair(frame);
        break;
      default:
        this.logger("frame.invalidDirection", { deviceId: connection.authenticated, type: frame.frame });
    }
  }

  private authenticate(socket: WebSocket, connection: Connection, frame: Extract<BridgeFrame, { frame: "authenticate" }>): void {
    if (frame.protocolVersion !== PROTOCOL_VERSION) return this.refuse(socket, "unsupportedVersion");
    const publicKey = fromBase64(frame.signingPublicKey);
    if (deviceIdFor(publicKey) !== frame.deviceId) return this.refuse(socket, "deviceIdMismatch");
    if (!verify(fromBase64(frame.signature), relayAuthSigningBytes(connection.nonce, frame.deviceId), publicKey)) return this.refuse(socket, "badSignature");
    if (!this.store.registerDevice(frame.deviceId, frame.signingPublicKey, this.now().toISOString())) return this.refuse(socket, "deviceIdMismatch");

    clearTimeout(connection.authTimer);
    connection.authenticated = frame.deviceId;
    const old = this.online.get(frame.deviceId);
    if (old && old !== socket) old.close(4001, "replaced by a newer connection");
    this.online.set(frame.deviceId, socket);
    this.send(socket, { frame: "ready" });
    this.logger("device.authenticated", { deviceId: frame.deviceId, protocolVersion: frame.protocolVersion });
    this.flush(frame.deviceId, socket);
  }

  private pairRequest(frame: Extract<BridgeFrame, { frame: "pairRequest" }>): void {
    if (frame.from === frame.to) return this.logger("pairing.invalidRoute", { from: frame.from, to: frame.to });
    const recipient = this.online.get(frame.to);
    if (!recipient) {
      this.logger("pairing.targetOffline", { from: frame.from, to: frame.to });
      return;
    }
    const now = this.now();
    this.store.rememberPairRequest(frame.from, frame.to, frame.sealed, now.toISOString(), new Date(now.getTime() + PAIRING_MS).toISOString());
    if (!this.send(recipient, frame)) {
      this.store.finishPairRequest(frame.from, frame.to);
      this.logger("pairing.targetOffline", { from: frame.from, to: frame.to });
      return;
    }
    this.logger("pairing.request", { from: frame.from, to: frame.to });
  }

  private pairAccept(frame: Extract<BridgeFrame, { frame: "pairAccept" }>): void {
    const now = this.now();
    const pending = this.store.pendingPairRequest(frame.to, frame.from, now.toISOString());
    const recipient = this.online.get(frame.to);
    if (!pending || !recipient || !this.send(recipient, frame)) {
      this.logger("pairing.acceptDropped", { from: frame.from, to: frame.to });
      return;
    }
    this.store.pair(frame.from, frame.to, now.toISOString());
    this.store.finishPairRequest(frame.to, frame.from);
    this.logger("pairing.accepted", { from: frame.from, to: frame.to });
  }

  private envelope(socket: WebSocket, authenticatedDevice: string, envelope: Envelope): void {
    if (envelope.from !== authenticatedDevice) {
      this.logger("frame.senderMismatch", { deviceId: authenticatedDevice, from: envelope.from, type: "envelope" });
      return;
    }
    if (!this.store.isPaired(envelope.from, envelope.to)) {
      this.notice(envelope.from, envelope.to, envelope.id, "notPaired");
      this.logger("message.notPaired", { from: envelope.from, to: envelope.to, messageId: envelope.id });
      return;
    }
    if (Date.parse(envelope.expiresAt) <= this.now().getTime()) {
      this.notice(envelope.from, envelope.to, envelope.id, "expired");
      this.logger("message.expired", { from: envelope.from, to: envelope.to, messageId: envelope.id });
      return;
    }
    if (envelope.type === "command") {
      const recipient = this.online.get(envelope.to);
      if (!recipient || !this.send(recipient, { frame: "envelope", envelope })) {
        this.notice(envelope.from, envelope.to, envelope.id, "targetOffline");
        this.logger("message.targetOffline", { from: envelope.from, to: envelope.to, messageId: envelope.id });
      } else {
        this.send(socket, { frame: "ack", messageId: envelope.id });
        this.logger("message.routed", { from: envelope.from, to: envelope.to, messageId: envelope.id, type: envelope.type });
      }
      return;
    }

    const seen = this.store.hasSeen(envelope.from, envelope.id);
    if (!seen) {
      this.store.markSeen(envelope);
      this.store.queueEnvelope(envelope, { frame: "envelope", envelope }, this.now().toISOString());
    }
    this.send(socket, { frame: "ack", messageId: envelope.id });
    const delivery = this.store.findEnvelopeDelivery(envelope.to, envelope.id);
    const recipient = this.online.get(envelope.to);
    if (delivery && recipient) this.send(recipient, parseFrame(delivery.frame));
    this.logger("message.routed", { from: envelope.from, to: envelope.to, messageId: envelope.id, type: envelope.type });
  }

  private unpair(frame: Extract<BridgeFrame, { frame: "unpair" }>): void {
    const pairedAt = this.store.pairedAt(frame.from, frame.to);
    const publicKey = this.store.signingKey(frame.from);
    if (!pairedAt || !publicKey || Date.parse(frame.at) <= Date.parse(pairedAt) ||
      !verify(fromBase64(frame.signature), unpairSigningBytes(frame), fromBase64(publicKey))) {
      this.logger("unpair.rejected", { from: frame.from, to: frame.to });
      return;
    }
    const now = this.now().toISOString();
    this.store.unpair(frame.from, frame.to);
    this.store.rememberUnpair(frame.from, frame.to, frame, frame.at, now);
    const recipient = this.online.get(frame.to);
    if (recipient) this.send(recipient, frame);
    this.logger("pairing.revoked", { from: frame.from, to: frame.to });
  }

  private acknowledge(deviceId: string, messageId: string): void {
    const delivery = this.store.findEnvelopeDelivery(deviceId, messageId);
    if (!delivery) return;
    this.store.deleteDelivery(delivery.rowid);
    this.logger("message.acknowledged", { deviceId, messageId });
  }

  private notice(sender: string, target: string, messageId: string, type: "targetOffline" | "expired" | "notPaired"): void {
    const frame: BridgeFrame = { frame: type, messageId, to: target };
    const recipient = this.online.get(sender);
    if (recipient && this.send(recipient, frame)) return;
    const now = this.now();
    this.store.queueNotice(sender, target, messageId, frame, new Date(now.getTime() + NOTICE_MS).toISOString(), now.toISOString());
  }

  private flush(deviceId: string, socket: WebSocket): void {
    for (const text of this.store.pendingUnpairs(deviceId)) this.send(socket, parseFrame(text));
    const now = this.now();
    for (const pending of this.store.pendingPairRequests(deviceId, now.toISOString())) {
      this.send(socket, { frame: "pairRequest", from: pending.fromDevice, to: deviceId, sealed: pending.sealed });
    }
    for (const delivery of this.store.queued(deviceId)) {
      if (Date.parse(delivery.expiresAt) <= now.getTime()) {
        this.store.deleteDelivery(delivery.rowid);
        if (delivery.category === "envelope") this.notice(delivery.sender, deviceId, delivery.messageId, "expired");
        continue;
      }
      this.send(socket, parseFrame(delivery.frame));
    }
  }

  private refuse(socket: WebSocket, reason: RefusedReason): void {
    this.logger("device.refused", { reason });
    this.send(socket, { frame: "refused", reason });
    setTimeout(() => socket.close(1008, reason), 20).unref();
  }

  private invalidFrame(socket: WebSocket, connection: Connection): void {
    if (connection.authenticated) this.logger("frame.invalid", { deviceId: connection.authenticated });
    else this.refuse(socket, "invalidFrame");
  }

  private disconnected(socket: WebSocket, connection: Connection): void {
    clearTimeout(connection.authTimer);
    this.connections.delete(socket);
    if (connection.authenticated && this.online.get(connection.authenticated) === socket) {
      this.online.delete(connection.authenticated);
      this.logger("device.disconnected", { deviceId: connection.authenticated });
    }
  }

  private send(socket: WebSocket, frame: unknown): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }
}

function parseFrame(value: string): BridgeFrame {
  return JSON.parse(value) as BridgeFrame;
}
