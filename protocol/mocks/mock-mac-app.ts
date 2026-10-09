// The mock Mac app: a stand-in for the Mac app's native services (OBJ-27 and the Mac objectives) until they exist.
// It connects to the harness's socket, says hello, and answers every method the harness can call with example data.
// Run: npm run mock:mac -- [--socket <path>] [--fail method=kind,...]
import { connect, type Socket } from "node:net";
import { pathToFileURL } from "node:url";
import { loadRpcContract, RpcFailure, RpcPeer, type Handler } from "../src/rpc.ts";
import { exampleOf } from "./examples.ts";
import { defaultSocketPath, readArgs, readFailures } from "./socket.ts";

export interface MockMacAppOptions {
  socketPath?: string;
  /** Methods that fail with the given ErrorKind, to test error handling. */
  fail?: Record<string, string>;
  /** Called for every event the harness sends. */
  onEvent?: (event: string, payload: unknown) => void;
  quiet?: boolean;
}

export interface MockMacApp {
  peer: RpcPeer;
  close(): void;
}

export async function connectMockMacApp(options: MockMacAppOptions = {}): Promise<MockMacApp> {
  const socketPath = options.socketPath ?? defaultSocketPath();
  const contract = loadRpcContract();
  const log = (line: string) => options.quiet || console.log(`[mock Mac app] ${line}`);

  const handlers: Record<string, Handler> = {};
  for (const [name, method] of Object.entries(contract.methods)) {
    if (method.direction !== "harnessToApp") continue;
    handlers[name] = (params) => {
      log(`${name} ${JSON.stringify(params)}`);
      const failure = options.fail?.[name];
      if (failure) throw new RpcFailure({ kind: failure }, `Mock failure for ${name}`);
      return exampleOf(method.result);
    };
  }

  const socket: Socket = await new Promise((resolve, reject) => {
    const s = connect(socketPath, () => resolve(s)).once("error", reject);
  });
  const peer = new RpcPeer({
    role: "app",
    socket,
    handlers,
    contract,
    onEvent: (event, payload) => {
      log(`event ${event} ${JSON.stringify(payload)}`);
      options.onEvent?.(event, payload);
    },
  });
  await peer.request("hello", { protocolVersion: 1 });
  log(`connected to ${socketPath}`);
  return { peer, close: () => peer.close() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = readArgs(process.argv.slice(2));
  const socket = args.get("socket");
  await connectMockMacApp({ ...(socket ? { socketPath: socket } : {}), fail: readFailures(args.get("fail")) });
}
