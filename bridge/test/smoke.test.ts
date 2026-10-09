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

  it("refuses an unsupported protocol version and a forged challenge signature", async () => {
    const fixture = await openRelayFixture();
    const wrongVersion = await RelayDevice.connect(fixture.relay.url(), undefined, PROTOCOL_VERSION + 1);
    const forged = await RelayDevice.connect(fixture.relay.url(), undefined, PROTOCOL_VERSION, `${"A".repeat(86)}==`);
    try {
      expect(wrongVersion.handshake).toEqual({ frame: "refused", reason: "unsupportedVersion" });
      expect(forged.handshake).toEqual({ frame: "refused", reason: "badSignature" });
    } finally {
      await wrongVersion.close();
      await forged.close();
      await fixture.close();
    }
  });
});
