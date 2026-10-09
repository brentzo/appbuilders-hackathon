import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@yumi/protocol/types";
import { RelayDevice } from "./support/device.ts";
import { openRelayFixture } from "./support/relay-fixture.ts";

describe("bridge relay smoke", () => {
  it("challenges and authenticates a protocol client before sending ready", async () => {
    const fixture = await openRelayFixture();
    try {
      const device = await RelayDevice.connect(fixture.relay.url());
      try {
        expect(device.handshake).toEqual({ frame: "ready" });
        expect(device.frames).toEqual([]);
        expect(fixture.logs.some(({ event }) => event === "device.authenticated")).toBe(true);
      } finally {
        await device.close();
      }
    } finally {
      await fixture.close();
    }
  });

  it("reports its protocol version and deployed commit on /health, so a live check can name the relay it ran against (OBJ-30.5)", async () => {
    const fixture = await openRelayFixture(undefined, undefined, "0487067");
    try {
      const response = await fetch(fixture.relay.url().replace("ws://", "http://").replace(/\/$/, "") + "/health");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", protocolVersion: PROTOCOL_VERSION, revision: "0487067" });
    } finally {
      await fixture.close();
    }
  });

  it("refuses an unsupported protocol version and a forged challenge signature", async () => {
    const fixture = await openRelayFixture();
    const wrongVersion = await RelayDevice.connect(fixture.relay.url(), undefined, PROTOCOL_VERSION + 1);
    const forged = await RelayDevice.connect(fixture.relay.url(), undefined, PROTOCOL_VERSION, `${"A".repeat(86)}==`);
    try {
      expect(wrongVersion.handshake).toEqual({ frame: "refused", reason: "unsupportedVersion", protocolVersion: PROTOCOL_VERSION });
      expect(forged.handshake).toEqual({ frame: "refused", reason: "badSignature" });
    } finally {
      await wrongVersion.close();
      await forged.close();
      await fixture.close();
    }
  });
});
