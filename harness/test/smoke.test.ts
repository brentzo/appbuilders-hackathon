import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge-client/client.ts";
import { FakeRelay } from "./support/fake-relay.ts";
import { openMacRpcPair } from "./support/mac-rpc.ts";

describe("bridge client smoke", () => {
  it("authenticates and creates a five-minute pairing QR without writing seeds to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yumi-bridge-smoke-"));
    const relay = new FakeRelay();
    await relay.listen();
    const mac = await openMacRpcPair();
    const client = new BridgeClient({ bridgeUrl: "wss://relay.test", relayUrl: relay.url, allowLoopbackWs: true, deviceName: "Test Mac", databasePath: join(dir, "bridge.sqlite"), rpcSocket: mac.socket });
    try {
      await client.start();
      await client.waitForState("connected");
      await until(() => mac.events.some(({ event, payload }) => event === "bridgeStateChanged" && (payload as { state?: string }).state === "connected"));
      const result = await mac.app.request("startPairing", {}) as { qrPayload: string; expiresAt: string };
      const qr = JSON.parse(result.qrPayload) as { deviceId: string; pairingSecret: string; expiresAt: string; platform: string };
      expect(qr.platform).toBe("mac");
      expect(Date.parse(qr.expiresAt) - Date.now()).toBeGreaterThan(4 * 60_000);
      expect((await mac.app.request("listPairedDevices", {}) as { devices: unknown[] }).devices).toEqual([]);
      expect(mac.secrets.has("bridge.device-seeds")).toBe(true);
      const files = await readFile(join(dir, "bridge.sqlite"));
      expect(files.includes(Buffer.from(qr.pairingSecret))).toBe(false);
      expect(JSON.stringify(files).includes(mac.secrets.get("bridge.device-seeds")!)).toBe(false);
    } finally {
      client.stop(); await mac.close(); await relay.close(); await rm(dir, { recursive: true, force: true });
    }
  });
});

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(predicate()).toBe(true);
}
