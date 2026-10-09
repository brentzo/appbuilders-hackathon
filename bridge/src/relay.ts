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
  PAIRING_ANSWER_SECONDS,
  PROTOCOL_VERSION,
  type BridgeFrame,
  type Envelope,
  type RefusedReason,
} from "@yumi/protocol/types";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { RelayStore } from "./store.ts";

const PAIRING_ANSWER_MS = PAIRING_ANSWER_SECONDS * 1000;
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
    const { expiredDeliveries, expiredPairRequests } = this.store.sweep(now.toISOString());
    for (const delivery of expiredDeliveries) {
      if (delivery.category === "envelope") {
        this.notice(delivery.sender, delivery.recipient, delivery.messageId, "expired");
        this.logger("message.expired", { from: delivery.sender, to: delivery.recipient, messageId: delivery.messageId });
      }
    }
    for (const { fromDevice, toDevice } of expiredPairRequests) {
      this.pairingExpired(fromDevice, toDevice);
      this.logger("pairing.expired", { from: fromDevice, to: toDevice });
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
      case "pairCancel":
        this.pairCancel(frame);
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
    const publicKey = fromBase64(frame.signingPublicKey);
    if (deviceIdFor(publicKey) !== frame.deviceId) return this.refuse(socket, "deviceIdMismatch");
    if (!verify(fromBase64(frame.signature), relayAuthSigningBytes(connection.nonce, frame.deviceId), publicKey)) return this.refuse(socket, "badSignature");
    if (frame.protocolVersion !== PROTOCOL_VERSION) return this.refuseVersion(socket, frame.deviceId, frame.protocolVersion);
    if (!this.store.registerDevice(frame.deviceId, frame.signingPublicKey, this.now().toISOString())) return this.refuse(socket, "deviceIdMismatch");

    this.store.clearNeedsUpdate(frame.deviceId);
    clearTimeout(connection.authTimer);
    connection.authenticated = frame.deviceId;
    const old = this.online.get(frame.deviceId);
    if (old && old !== socket) old.close(4001, "replaced by a newer connection");
    this.online.set(frame.deviceId, socket);
    this.send(socket, { frame: "ready" });
    this.logger("device.authenticated", { deviceId: frame.deviceId, protocolVersion: frame.protocolVersion });
    this.flush(frame.deviceId, socket);
  }

  /**
   * Opens a pairing request for PAIRING_ANSWER_SECONDS by the relay's clock. The Mac gets it now, or when it
   * reconnects within the window; when the window ends unanswered, sweepExpired sends both devices pairExpired.
   */
  private pairRequest(frame: Extract<BridgeFrame, { frame: "pairRequest" }>): void {
    if (frame.from === frame.to) return this.logger("pairing.invalidRoute", { from: frame.from, to: frame.to });
    const now = this.now();
    this.store.clearPairingNotices(frame.from, frame.to);
    this.store.rememberPairRequest(frame.from, frame.to, frame.sealed, now.toISOString(), new Date(now.getTime() + PAIRING_ANSWER_MS).toISOString());
    const recipient = this.online.get(frame.to);
    const delivered = recipient !== undefined && this.send(recipient, frame);
    this.logger("pairing.request", { from: frame.from, to: frame.to, delivered });
  }

  /**
   * The Mac's answer counts only while its request is open and the phone is connected to receive it. Pairing,
   * forwarding, and telling the Mac happen together, so the relay alone decides and a request it closed never pairs.
   */
  private pairAccept(frame: Extract<BridgeFrame, { frame: "pairAccept" }>): void {
    const now = this.now();
    const open = this.store.pendingPairRequest(frame.to, frame.from, now.toISOString()) !== undefined;
    const phone = this.online.get(frame.to);
    if (open && phone && this.send(phone, frame)) {
      this.store.pair(frame.from, frame.to, now.toISOString());
      this.store.finishPairRequest(frame.to, frame.from);
      this.pairingVerdict(frame.from, { frame: "paired", device: frame.to });
      this.logger("pairing.accepted", { from: frame.from, to: frame.to });
      return;
    }
    const phoneWaited = this.store.finishPairRequest(frame.to, frame.from);
    this.pairingExpired(frame.to, frame.from, phoneWaited);
    this.logger("pairing.acceptRefused", { from: frame.from, to: frame.to, open, phoneOnline: phone !== undefined });
  }

  /** The phone stopped waiting. The Mac learns the request closed; a pairAccept already forwarded is the phone's to undo. */
  private pairCancel(frame: Extract<BridgeFrame, { frame: "pairCancel" }>): void {
    if (!this.store.finishPairRequest(frame.from, frame.to)) return this.logger("pairing.cancelIgnored", { from: frame.from, to: frame.to });
    this.pairingExpired(frame.from, frame.to, false);
    this.logger("pairing.cancelled", { from: frame.from, to: frame.to });
  }

  /** An unpair closes any request still open between the two, and tells both, so neither keeps waiting on it. */
  private closePairRequests(a: string, b: string): void {
    if (this.store.finishPairRequest(a, b)) this.pairingExpired(a, b);
    if (this.store.finishPairRequest(b, a)) this.pairingExpired(b, a);
  }

  /** Tells the Mac, and the phone unless it stopped waiting, that the phone's request to the Mac closed without pairing. */
  private pairingExpired(phone: string, mac: string, tellPhone = true): void {
    if (tellPhone) this.pairingVerdict(phone, { frame: "pairExpired", device: mac });
    this.pairingVerdict(mac, { frame: "pairExpired", device: phone });
  }

  /**
   * Sends a pairing verdict now, or holds it for NOTICE_MS for a device that is offline. A device that never
   * connected has no request of its own to close, so nothing is held for it.
   */
  private pairingVerdict(deviceId: string, frame: Extract<BridgeFrame, { frame: "paired" | "pairExpired" }>): void {
    const socket = this.online.get(deviceId);
    if (socket && this.send(socket, frame)) return;
    if (!this.store.isRegistered(deviceId)) return;
    const now = this.now();
    this.store.queuePairingNotice(deviceId, frame, new Date(now.getTime() + NOTICE_MS).toISOString(), now.toISOString());
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
        const notice = this.store.needsUpdate(envelope.to) ? "targetNeedsUpdate" : "targetOffline";
        this.notice(envelope.from, envelope.to, envelope.id, notice);
        this.logger(`message.${notice}`, { from: envelope.from, to: envelope.to, messageId: envelope.id });
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
    const previous = this.store.pendingUnpair(frame.from, frame.to);
    if (previous) {
      const priorFrame = parseFrame(previous.frame);
      if (priorFrame.frame === "unpair" && priorFrame.id === frame.id && previous.frame === JSON.stringify(frame)) {
        const sender = this.online.get(frame.from);
        if (sender) this.send(sender, { frame: "ack", messageId: frame.id });
        if (!previous.acknowledged) {
          const recipient = this.online.get(frame.to);
          if (recipient) this.send(recipient, frame);
        }
        return;
      }
      const legacy = JSON.parse(previous.frame) as { id?: string; at?: string };
      const publicKey = this.store.signingKey(frame.from);
      if (
        legacy.id === undefined &&
        legacy.at !== undefined &&
        Date.parse(frame.at) >= Date.parse(legacy.at) &&
        publicKey &&
        verify(fromBase64(frame.signature), unpairSigningBytes(frame), fromBase64(publicKey))
      ) {
        this.closePairRequests(frame.from, frame.to);
        this.store.revokeAndRememberUnpair(frame.from, frame.to, frame, this.now().toISOString());
        const sender = this.online.get(frame.from);
        if (sender) this.send(sender, { frame: "ack", messageId: frame.id });
        const recipient = this.online.get(frame.to);
        if (recipient) this.send(recipient, frame);
        this.logger("pairing.revoked", { from: frame.from, to: frame.to });
        return;
      }
    }
    const pairedAt = this.store.pairedAt(frame.from, frame.to);
    const publicKey = this.store.signingKey(frame.from);
    if (!pairedAt || !publicKey || Date.parse(frame.at) <= Date.parse(pairedAt) ||
      !verify(fromBase64(frame.signature), unpairSigningBytes(frame), fromBase64(publicKey))) {
      this.logger("unpair.rejected", { from: frame.from, to: frame.to });
      return;
    }
    const now = this.now().toISOString();
    this.closePairRequests(frame.from, frame.to);
    this.store.revokeAndRememberUnpair(frame.from, frame.to, frame, now);
    const sender = this.online.get(frame.from);
    if (sender) this.send(sender, { frame: "ack", messageId: frame.id });
    const recipient = this.online.get(frame.to);
    if (recipient) this.send(recipient, frame);
    this.logger("pairing.revoked", { from: frame.from, to: frame.to });
  }

  private acknowledge(deviceId: string, messageId: string): void {
    for (const frameText of this.store.pendingUnpairs(deviceId)) {
      const frame = parseFrame(frameText);
      if (frame.frame === "unpair" && frame.id === messageId && frame.to === deviceId) {
        if (this.store.acknowledgeUnpair(frame.from, frame.to, messageId))
          this.logger("pairing.unpairAcknowledged", { deviceId, messageId });
        return;
      }
    }
    const delivery = this.store.findEnvelopeDelivery(deviceId, messageId);
    if (!delivery) return;
    this.store.deleteDelivery(delivery.rowid);
    this.logger("message.acknowledged", { deviceId, messageId });
  }

  private notice(sender: string, target: string, messageId: string, type: Extract<BridgeFrame["frame"], "targetOffline" | "targetNeedsUpdate" | "expired" | "notPaired">): void {
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

  private refuse(socket: WebSocket, reason: Exclude<RefusedReason, "unsupportedVersion">): void {
    this.logger("device.refused", { reason });
    this.closeRefused(socket, { frame: "refused", reason });
  }

  /**
   * Runs only after the device proved its key, so nobody can mark someone else's device. The relay names its own
   * version so the device knows which side needs an update, and remembers a registered device that is behind, so a
   * sender is told it needs an update rather than that it is offline. The device keeps its registration and pairings.
   */
  private refuseVersion(socket: WebSocket, deviceId: string, protocolVersion: number): void {
    if (this.store.isRegistered(deviceId)) {
      if (protocolVersion < PROTOCOL_VERSION) this.store.markNeedsUpdate(deviceId, protocolVersion, this.now().toISOString());
      else this.store.clearNeedsUpdate(deviceId);
    }
    this.logger("device.refused", { reason: "unsupportedVersion", deviceId, protocolVersion });
    this.closeRefused(socket, { frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
  }

  private closeRefused(socket: WebSocket, frame: Extract<BridgeFrame, { frame: "refused" }>): void {
    this.send(socket, frame);
    setTimeout(() => socket.close(1008, frame.reason), 20).unref();
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
