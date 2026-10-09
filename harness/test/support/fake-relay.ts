import { randomBytes } from "node:crypto";
import { deviceIdFor, fromBase64, relayAuthSigningBytes, verify } from "@yumi/protocol/crypto";
import { validate } from "@yumi/protocol";
import type { BridgeFrame, DeviceId } from "@yumi/protocol/types";
import { WebSocket, WebSocketServer } from "ws";

type Device = { id: string; socket: WebSocket; signingPublicKey: Uint8Array };

export class FakeRelay {
  readonly server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  readonly paired = new Set<string>();
  readonly pendingRequests = new Map<string, BridgeFrame>();
  readonly clients = new Map<string, Device>();
  url = "";
  nextNotice: "targetOffline" | "expired" | "notPaired" | undefined = undefined;

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("listening", resolve);
      this.server.once("error", reject);
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Fake relay has no TCP address");
    this.url = `ws://127.0.0.1:${address.port}`;
    this.server.on("connection", (socket) => this.accept(socket));
  }

  pair(a: string, b: string): void {
    this.paired.add(pairKey(a, b));
  }

  inject(to: string, frame: BridgeFrame): void {
    const client = this.clients.get(to);
    if (client?.socket.readyState === WebSocket.OPEN) send(client.socket, frame);
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) client.socket.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: WebSocket): void {
    const nonce = randomBytes(32);
    let device: Device | undefined;
    send(socket, { frame: "challenge", nonce: nonce.toString("base64") });
    socket.on("message", (data) => {
      void this.receive(socket, device, nonce, data.toString()).then((authenticated) => {
        if (authenticated) device = authenticated;
      });
    });
    socket.on("close", () => {
      if (device && this.clients.get(device.id)?.socket === socket) this.clients.delete(device.id);
    });
  }

  private async receive(socket: WebSocket, device: Device | undefined, nonce: Uint8Array, text: string): Promise<Device | undefined> {
    let message: unknown;
    try {
      message = JSON.parse(text) as unknown;
    } catch {
      socket.close(1002, "invalid JSON");
      return;
    }
    if (!validate("BridgeFrame", message).valid) {
      socket.close(1002, "invalid frame");
      return;
    }
    const frame = message as BridgeFrame;
    if (!device) {
      if (frame.frame !== "authenticate") return;
      const key = fromBase64(frame.signingPublicKey);
      if (
        deviceIdFor(key) !== frame.deviceId ||
        !verify(fromBase64(frame.signature), relayAuthSigningBytes(nonce, frame.deviceId), key)
      ) {
        send(socket, { frame: "refused", reason: "badSignature" });
        socket.close();
        return;
      }
      device = { id: frame.deviceId, socket, signingPublicKey: key };
      this.clients.set(device.id, device);
      send(socket, { frame: "ready" });
      return device;
    }

    switch (frame.frame) {
      case "pairRequest": {
        if (frame.from !== device.id) break;
        this.pendingRequests.set(frame.to, frame);
        this.forward(frame.to, frame);
        break;
      }
      case "pairAccept": {
        if (frame.from !== device.id) break;
        const request = this.pendingRequests.get(device.id);
        if (request?.frame !== "pairRequest" || request.from !== frame.to || request.to !== frame.from) break;
        this.pair(device.id, frame.to);
        this.pendingRequests.delete(device.id);
        this.forward(frame.to, frame);
        break;
      }
      case "unpair": {
        if (frame.from !== device.id) break;
        this.paired.delete(pairKey(frame.from, frame.to));
        this.forward(frame.to, frame);
        break;
      }
      case "envelope": {
        const { envelope } = frame;
        if (envelope.from !== device.id) break;
        if (this.nextNotice) {
          const notice = this.nextNotice;
          this.nextNotice = undefined;
          send(socket, { frame: notice, messageId: envelope.id, to: envelope.to });
          break;
        }
        if (!this.paired.has(pairKey(envelope.from, envelope.to))) {
          send(socket, { frame: "notPaired", messageId: envelope.id, to: envelope.to });
        } else if (Date.parse(envelope.expiresAt) <= Date.now()) {
          send(socket, { frame: "expired", messageId: envelope.id, to: envelope.to });
        } else if (!this.clients.has(envelope.to) && envelope.type === "command") {
          send(socket, { frame: "targetOffline", messageId: envelope.id, to: envelope.to });
        } else {
          this.forward(envelope.to, frame);
          send(socket, { frame: "ack", messageId: envelope.id });
        }
        break;
      }
      case "ack":
        break;
      default:
        break;
    }
  }

  private forward(to: DeviceId, frame: BridgeFrame): void {
    const target = this.clients.get(to);
    if (target?.socket.readyState === WebSocket.OPEN) send(target.socket, frame);
  }
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function send(socket: WebSocket, frame: unknown): void {
  socket.send(JSON.stringify(frame));
}
