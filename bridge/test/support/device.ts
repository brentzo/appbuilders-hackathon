import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import {
  deviceKeysFromSeeds,
  fromBase64,
  relayAuthSigningBytes,
  sign,
  toBase64,
  type DeviceKeys,
} from "@yumi/protocol/crypto";
import { PROTOCOL_VERSION, type BridgeFrame } from "@yumi/protocol/types";

export class RelayDevice {
  readonly frames: BridgeFrame[] = [];
  handshake: BridgeFrame | undefined;
  private readonly waiters: Array<{ match: (frame: BridgeFrame) => boolean; resolve: (frame: BridgeFrame) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];

  private constructor(readonly socket: WebSocket, readonly keys: DeviceKeys) {
    socket.on("message", (data) => {
      let frame: BridgeFrame;
      try {
        frame = JSON.parse(data.toString()) as BridgeFrame;
      } catch {
        return;
      }
      this.frames.push(frame);
      for (const waiter of [...this.waiters]) {
        if (waiter.match(frame)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          this.frames.splice(this.frames.indexOf(frame), 1);
          clearTimeout(waiter.timer);
          waiter.resolve(frame);
        }
      }
    });
  }

  static async connect(
    url: string,
    keys = deviceKeysFromSeeds(randomBytes(32), randomBytes(32)),
    protocolVersion = PROTOCOL_VERSION,
    signatureOverride?: string,
  ): Promise<RelayDevice> {
    const socket = new WebSocket(url);
    const device = new RelayDevice(socket, keys);
    await new Promise<void>((resolve, reject) => socket.once("open", resolve).once("error", reject));
    const challenge = (await device.next("challenge")) as Extract<BridgeFrame, { frame: "challenge" }>;
    socket.send(JSON.stringify({
      frame: "authenticate",
      deviceId: keys.deviceId,
      signingPublicKey: toBase64(keys.signing.publicKey),
      protocolVersion,
      signature: signatureOverride ?? toBase64(sign(relayAuthSigningBytes(fromBase64(challenge.nonce), keys.deviceId), keys.signing.secretKey)),
    }));
    device.handshake = await device.next("ready", "refused");
    return device;
  }

  send(frame: unknown): void {
    this.socket.send(JSON.stringify(frame));
  }

  next(...frames: string[]): Promise<BridgeFrame> {
    const found = this.frames.find((frame) => frames.includes(frame.frame));
    if (found) {
      this.frames.splice(this.frames.indexOf(found), 1);
      return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        match: (frame: BridgeFrame) => frames.includes(frame.frame),
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${frames.join(" or ")}`));
        }, 3000),
      };
      this.waiters.push(waiter);
    });
  }

  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }
}
