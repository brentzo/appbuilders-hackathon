import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Relay } from "../../src/relay.ts";

export interface RelayFixture {
  relay: Relay;
  directory: string;
  databasePath: string;
  logs: Array<{ event: string; fields: Record<string, unknown> }>;
  close(): Promise<void>;
}

export async function openRelayFixture(databasePath?: string, now?: () => Date): Promise<RelayFixture> {
  const directory = await mkdtemp(join(tmpdir(), "yumi-relay-test-"));
  const path = databasePath ?? join(directory, "relay.sqlite");
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const relay = new Relay({
    host: "127.0.0.1",
    port: 0,
    databasePath: path,
    ...(now ? { now } : {}),
    log: (event, fields = {}) => logs.push({ event, fields }),
  });
  await relay.start();
  return {
    relay,
    directory,
    databasePath: path,
    logs,
    close: async () => {
      await relay.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
