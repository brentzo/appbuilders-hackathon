import { createServer, connect, type Server, type Socket } from "node:net";
import { RpcPeer, type Handler } from "@yumi/protocol";

export interface MacRpcPair {
  app: RpcPeer;
  socket: Socket;
  secrets: Map<string, string>;
  events: Array<{ event: string; payload: unknown }>;
  close(): Promise<void>;
}

export async function openMacRpcPair(secrets = new Map<string, string>()): Promise<MacRpcPair> {
  const events: Array<{ event: string; payload: unknown }> = [];
  let app: RpcPeer | undefined;
  const server: Server = createServer((socket) => {
    app = new RpcPeer({
      role: "app",
      socket,
      handlers: {
        storeSecret: ((params: { key: string; value: string }) => {
          secrets.set(params.key, params.value);
          return {};
        }) as Handler,
        loadSecret: ((params: { key: string }) => {
          const value = secrets.get(params.key);
          return value === undefined ? {} : { value };
        }) as Handler,
      },
      onEvent: (event, payload) => events.push({ event, payload }),
    });
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Mac RPC server has no TCP address");
  const socket = connect(address.port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  await waitFor(() => app !== undefined);
  return {
    app: app!,
    socket,
    secrets,
    events,
    close: async () => {
      app?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let tries = 0; tries < 50 && !predicate(); tries++) await new Promise((resolve) => setTimeout(resolve, 2));
  if (!predicate()) throw new Error("Fake Mac RPC did not accept its socket");
}
