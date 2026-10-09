import { describe, expect, it } from "vitest";
import { validate } from "../src/index.ts";

const envelope = {
  id: "5b0c6f8e-2f4d-4c1a-9a57-1f0e2d3c4b5a",
  from: "3f2a9c1e7b4d6a8f0e1c2b3a4d5e6f70",
  to: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  type: "command",
  expiresAt: "2026-10-09T15:44:00+08:00",
  protocolVersion: 4,
  signature: `${"A".repeat(86)}==`,
  payload: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

describe("Envelope", () => {
  it("accepts a command with the routing fields, a signature, and a sealed payload", () => {
    expect(validate("Envelope", envelope).errors).toEqual([]);
  });

  it("keeps replyTo out of the readable envelope", () => {
    expect(validate("Envelope", { ...envelope, type: "result" }).valid).toBe(true);
    expect(validate("Envelope", { ...envelope, type: "result", replyTo: envelope.id }).valid).toBe(false);
  });

  it("has no readable field that says what the message means (SPEC-08 'VPS cannot read messages')", () => {
    expect(validate("Envelope", { ...envelope, kind: "toolCall" }).valid).toBe(false);
    expect(validate("Envelope", { ...envelope, payload: { tool: "set_alarm", time: "06:30" } }).valid).toBe(false);
  });

  it("rejects a payload or signature that is not base64", () => {
    expect(validate("Envelope", { ...envelope, payload: "set an alarm for 6:30 am" }).valid).toBe(false);
    expect(validate("Envelope", { ...envelope, signature: "not a signature" }).valid).toBe(false);
  });

  it("rejects another protocol version", () => {
    expect(validate("Envelope", { ...envelope, protocolVersion: 2 }).valid).toBe(false);
  });
});

const key = `${"B".repeat(43)}=`;

describe("BridgeFrame", () => {
  it("carries an envelope without opening it", () => {
    expect(validate("BridgeFrame", { frame: "envelope", envelope }).errors).toEqual([]);
  });

  it("authenticates a device by its signing key and a signed challenge", () => {
    expect(validate("BridgeFrame", { frame: "challenge", nonce: key }).valid).toBe(true);
    const auth = { frame: "authenticate", deviceId: envelope.from, signingPublicKey: key, protocolVersion: 4, signature: envelope.signature };
    expect(validate("BridgeFrame", auth).errors).toEqual([]);
    expect(validate("BridgeFrame", { ...auth, signature: undefined }).valid).toBe(false);
  });

  it("lets a device on another version through the schema, so the relay can answer unsupportedVersion", () => {
    const auth = { frame: "authenticate", deviceId: envelope.from, signingPublicKey: key, protocolVersion: 4, signature: envelope.signature };
    expect(validate("BridgeFrame", { ...auth, protocolVersion: 2 }).errors).toEqual([]);
    expect(validate("BridgeFrame", { ...auth, protocolVersion: 4 }).errors).toEqual([]);
    expect(validate("BridgeFrame", { ...auth, protocolVersion: 0 }).valid).toBe(false);
    expect(validate("BridgeFrame", { ...auth, protocolVersion: "4" }).valid).toBe(false);
    expect(validate("BridgeFrame", { frame: "refused", reason: "unsupportedVersion" }).valid).toBe(true);
  });

  it("tells the sender at once that a command's target is offline (SPEC-08 'Command to an offline device fails at once')", () => {
    expect(validate("BridgeFrame", { frame: "targetOffline", messageId: envelope.id, to: envelope.to }).valid).toBe(true);
  });

  it("tells the sender a message expired before delivery (SPEC-08 'Expired command is not run')", () => {
    expect(validate("BridgeFrame", { frame: "expired", messageId: envelope.id, to: envelope.to }).valid).toBe(true);
  });

  it("acknowledges a message so the relay can delete what it held", () => {
    expect(validate("BridgeFrame", { frame: "ack", messageId: envelope.id }).valid).toBe(true);
  });

  it("refuses a connection with a structured reason, never free text", () => {
    expect(validate("BridgeFrame", { frame: "refused", reason: "badSignature" }).valid).toBe(true);
    expect(validate("BridgeFrame", { frame: "refused", reason: "Error: signature check failed at line 12" }).valid).toBe(false);
  });

  it("rejects a frame the contract does not know", () => {
    expect(validate("BridgeFrame", { frame: "queueCommand", envelope }).valid).toBe(false);
  });
});

describe("Pairing", () => {
  const offer = {
    protocolVersion: 4,
    deviceId: envelope.from,
    deviceName: "Jepoy's MacBook Pro",
    platform: "mac",
    signingPublicKey: key,
    kxPublicKey: key,
    pairingSecret: key,
    bridgeUrl: "wss://bridge.example.com/v1",
    expiresAt: "2026-10-09T15:47:00+08:00",
  };

  it("puts the Mac's id, keys, a one-time secret, and the bridge URL in the QR code (SPEC-08 r1)", () => {
    expect(validate("PairingOffer", offer).errors).toEqual([]);
  });

  it("lets an offer from another version validate, so the phone can say the versions differ (SPEC-11)", () => {
    expect(validate("PairingOffer", { ...offer, protocolVersion: 2 }).errors).toEqual([]);
    expect(validate("PairingOffer", { ...offer, protocolVersion: 4 }).errors).toEqual([]);
    expect(validate("PairingOffer", { ...offer, protocolVersion: 0 }).valid).toBe(false);
    expect(validate("PairingOffer", { ...offer, protocolVersion: 2.5 }).valid).toBe(false);
  });

  it("only points at an encrypted bridge URL", () => {
    expect(validate("PairingOffer", { ...offer, bridgeUrl: "ws://bridge.example.com/v1" }).valid).toBe(false);
  });

  it("describes the phone to the Mac in a pairing request", () => {
    const request = { deviceName: "Pixel 9", platform: "android", signingPublicKey: key, kxPublicKey: key };
    expect(validate("PairRequest", request).errors).toEqual([]);
  });

  it("sends the pairing request sealed, so the relay never reads the phone's name (SPEC-08 r3)", () => {
    const frame = { frame: "pairRequest", from: envelope.to, to: envelope.from, sealed: envelope.payload };
    expect(validate("BridgeFrame", frame).errors).toEqual([]);
    expect(validate("BridgeFrame", { ...frame, sealed: undefined, request: { deviceName: "Pixel 9" } }).valid).toBe(false);
  });

  it("answers with the Mac's signature", () => {
    expect(validate("BridgeFrame", { frame: "pairAccept", from: envelope.from, to: envelope.to, accept: { signature: envelope.signature } }).valid).toBe(true);
  });

  it("signs an unpair with the device's own key, so the relay cannot unpair two devices on its own", () => {
    const unpair = { frame: "unpair", id: envelope.id, from: envelope.to, to: envelope.from, at: "2026-10-09T15:50:00+08:00", signature: envelope.signature };
    expect(validate("BridgeFrame", unpair).errors).toEqual([]);
    expect(validate("BridgeFrame", { ...unpair, id: undefined }).valid).toBe(false);
    expect(validate("BridgeFrame", { ...unpair, signature: undefined }).valid).toBe(false);
  });
});
