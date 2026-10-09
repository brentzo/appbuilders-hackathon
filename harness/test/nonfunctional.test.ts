import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge-client/client.ts";
import { FakeRelay } from "./support/fake-relay.ts";
import { openMacRpcPair } from "./support/mac-rpc.ts";

describe("bridge client non-functional behavior", () => {
  it("reconnects after a dropped authenticated socket and restores authenticated state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yumi-bridge-reconnect-"));
    const relay = new FakeRelay();
    await relay.listen();
    const mac = await openMacRpcPair();
    const client = new BridgeClient({
      bridgeUrl: "wss://relay.test",
      relayUrl: relay.url,
      allowLoopbackWs: true,
      deviceName: "Test Mac",
      databasePath: join(dir, "bridge.sqlite"),
      rpc: mac.rpc,
    });
    try {
      Object.assign(mac.handlers, client.handlers);
      await client.start();
      await client.waitForState("connected");
      const { qrPayload } = (await mac.app.request("startPairing", {})) as { qrPayload: string };
      const deviceId = (JSON.parse(qrPayload) as { deviceId: string }).deviceId;
      relay.clients.get(deviceId)!.socket.terminate();
      await client.waitForState("reconnecting");
      await client.waitForState("connected", 5000);
    } finally {
      client.stop();
      await mac.close();
      await relay.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not tell the user the bridge is down when no phone is paired", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yumi-bridge-offline-"));
    const mac = await openMacRpcPair();
    const logs: string[] = [];
    const client = new BridgeClient({
      bridgeUrl: "wss://relay.test",
      relayUrl: "ws://127.0.0.1:9",
      allowLoopbackWs: true,
      deviceName: "Test Mac",
      databasePath: join(dir, "bridge.sqlite"),
      rpc: mac.rpc,
      reconnectBaseMs: 1,
      onLog: (event) => logs.push(event),
    });
    try {
      Object.assign(mac.handlers, client.handlers);
      await client.start();
      await client.waitForState("reconnecting", 5000);
      await client.waitForState("offline", 5000);
      expect(mac.events.filter((e) => e.event === "userError")).toEqual([]);
      expect(logs).toContain("relay-offline");
    } finally {
      client.stop();
      await mac.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tells the user the bridge is down when a phone is paired", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yumi-bridge-offline-paired-"));
    const databasePath = join(dir, "bridge.sqlite");
    const mac = await openMacRpcPair();
    const client = new BridgeClient({
      bridgeUrl: "wss://relay.test",
      relayUrl: "ws://127.0.0.1:9",
      allowLoopbackWs: true,
      deviceName: "Test Mac",
      databasePath,
      rpc: mac.rpc,
      reconnectBaseMs: 1,
    });
    try {
      Object.assign(mac.handlers, client.handlers);
      const db = new Database(databasePath);
      db.prepare("INSERT INTO peers (device_id, name, platform, signing_key, kx_key, paired_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        "phone-1",
        "Test phone",
        "android",
        "k",
        "k",
        new Date().toISOString(),
      );
      db.close();
      await client.start();
      await client.waitForState("offline", 5000);
      // The event crosses a real socket, so wait for it rather than for a fixed time.
      const deadline = Date.now() + 2000;
      while (!mac.events.some((e) => e.event === "userError") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(mac.events.filter((e) => e.event === "userError")).toEqual([
        { event: "userError", payload: { kind: "bridgeDown" } },
      ]);
    } finally {
      client.stop();
      await mac.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-TLS remote bridge endpoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yumi-bridge-url-"));
    const mac = await openMacRpcPair();
    try {
      expect(
        () =>
          new BridgeClient({
            bridgeUrl: "ws://relay.example",
            deviceName: "Test",
            databasePath: join(dir, "x.sqlite"),
            rpc: mac.rpc,
          }),
      ).toThrow("must use wss://");
    } finally {
      await mac.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
