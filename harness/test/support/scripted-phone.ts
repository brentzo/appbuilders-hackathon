import { randomBytes } from "node:crypto";
import {
  deviceKeysFromSeeds,
  expiresAt,
  fromBase64,
  openEnvelope,
  relayAuthSigningBytes,
  sealEnvelope,
  sealPairRequest,
  sign,
  toBase64,
  type DeviceKeys,
} from "@yumi/protocol/crypto";
import { PROTOCOL_VERSION, type BridgeFrame, type EnvelopeType, type PairingOffer, type Payload } from "@yumi/protocol/types";
import { WebSocket } from "ws";
import { until } from "./mock-mac.ts";

/** A message the phone received from the Mac, opened. */
export interface PhoneInbox {
  type: EnvelopeType;
  replyTo?: string;
  payload: Payload;
}

/**
 * A phone played by the test on the fake relay (OBJ-68.5): it authenticates, pairs by the Mac's QR offer, sends
 * encrypted commands as the Android app will (OBJ-23, OBJ-67), and opens everything the Mac sends back.
 */
export class ScriptedPhone {
  readonly keys: DeviceKeys = deviceKeysFromSeeds(randomBytes(32), randomBytes(32));
  readonly inbox: PhoneInbox[] = [];
  readonly frames: BridgeFrame[] = [];
  private socket?: WebSocket;
  private mac?: { deviceId: string; signingPublicKey: Uint8Array; kxPublicKey: Uint8Array };

  get deviceId(): string {
    return this.keys.deviceId;
  }

  async connect(relayUrl: string): Promise<void> {
    const socket = new WebSocket(relayUrl);
    this.socket = socket;
    socket.on("message", (data) => this.receive(JSON.parse(data.toString()) as BridgeFrame));
    await until(() => this.frames.some((f) => f.frame === "challenge"));
    const challenge = this.frames.find((f) => f.frame === "challenge") as Extract<BridgeFrame, { frame: "challenge" }>;
    this.send({
      frame: "authenticate",
      deviceId: this.keys.deviceId,
      signingPublicKey: toBase64(this.keys.signing.publicKey),
      protocolVersion: PROTOCOL_VERSION,
      signature: toBase64(
        sign(relayAuthSigningBytes(fromBase64(challenge.nonce), this.keys.deviceId), this.keys.signing.secretKey),
      ),
    });
    await until(() => this.frames.some((f) => f.frame === "ready"));
  }

  /** Scans the QR payload and pairs, as the phone's pairing screen does. */
  async pair(qrPayload: string): Promise<void> {
    const offer = JSON.parse(qrPayload) as PairingOffer;
    this.mac = {
      deviceId: offer.deviceId,
      signingPublicKey: fromBase64(offer.signingPublicKey),
      kxPublicKey: fromBase64(offer.kxPublicKey),
    };
    const request = {
      deviceName: "Brent's Xiaomi",
      platform: "android" as const,
      signingPublicKey: toBase64(this.keys.signing.publicKey),
      kxPublicKey: toBase64(this.keys.kx.publicKey),
    };
    this.send({
      frame: "pairRequest",
      from: this.keys.deviceId,
      to: offer.deviceId,
      sealed: sealPairRequest(request, { from: this.keys.deviceId, to: offer.deviceId }, fromBase64(offer.pairingSecret)),
    });
    await until(() => this.frames.some((f) => f.frame === "pairAccept"));
  }

  /** Sends an encrypted command to the Mac and returns its message id, which the result names as `replyTo`. */
  command(payload: Payload): string {
    const envelope = sealEnvelope({
      sender: this.keys,
      recipient: this.mac!,
      type: "command",
      expiresAt: expiresAt("command"),
      payload,
    });
    this.send({ frame: "envelope", envelope });
    return envelope.id;
  }

  /** The result the Mac sent for a command. */
  resultFor(commandId: string): Payload | undefined {
    return this.inbox.find((m) => m.type === "result" && m.replyTo === commandId)?.payload;
  }

  received(kind: Payload["kind"]): Payload[] {
    return this.inbox.filter((m) => m.payload.kind === kind).map((m) => m.payload);
  }

  close(): void {
    this.socket?.close();
  }

  private receive(frame: BridgeFrame): void {
    this.frames.push(frame);
    if (frame.frame !== "envelope" || !this.mac) return;
    const opened = openEnvelope(frame.envelope, this.keys, this.mac);
    if (!opened.ok) return;
    this.inbox.push({
      type: frame.envelope.type,
      ...(opened.replyTo ? { replyTo: opened.replyTo } : {}),
      payload: opened.payload as Payload,
    });
    this.send({ frame: "ack", messageId: frame.envelope.id });
  }

  private send(frame: unknown): void {
    this.socket!.send(JSON.stringify(frame));
  }
}
