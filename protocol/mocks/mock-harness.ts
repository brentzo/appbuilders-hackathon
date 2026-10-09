// The mock harness: a stand-in for the real harness (OBJ-03 and later) until it exists.
// It listens on the local socket, answers every method the Mac app can call with example data, and plays
// scripted event sequences. Run: npm run mock:harness -- [--socket <path>] [--script <name>] [--fail method=kind,...]
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROTOCOL_VERSION } from "../generated/ts/index.ts";
import { loadRpcContract, RpcFailure, RpcPeer, validate, type Handler } from "../src/index.ts";
import { exampleByName, exampleOf } from "./examples.ts";
import { defaultSocketPath, readArgs, readFailures } from "./socket.ts";

export const SCRIPT_DIR = fileURLToPath(new URL("./scripts/", import.meta.url));

export interface ScriptEvent {
  /** Wait this long after the previous event, in milliseconds. */
  afterMs: number;
  event: string;
  /** Either an inline payload, or the name of an example ("GoalRestated.invoices"). */
  payload?: unknown;
  example?: string;
}

export interface Script {
  description: string;
  /** "connect" plays as soon as the app sends hello; a method name plays after that method answers. */
  trigger: string;
  events: (ScriptEvent & { resolved: unknown })[];
}

/** Loads a script from mocks/scripts and checks every event against the contract. */
export function loadScript(name: string): Script {
  const raw = JSON.parse(readFileSync(`${SCRIPT_DIR}${name}.json`, "utf8")) as Omit<Script, "events"> & { events: ScriptEvent[] };
  const contract = loadRpcContract();
  if (raw.trigger !== "connect" && contract.methods[raw.trigger]?.direction !== "appToHarness") {
    throw new Error(`${name}: trigger ${raw.trigger} is not connect or a method the app calls`);
  }
  const events = raw.events.map((e, i) => {
    const type = contract.events[e.event];
    if (!type) throw new Error(`${name} event ${i}: unknown event ${e.event}`);
    const resolved = e.example ? exampleByName(e.example) : e.payload;
    const check = validate(type, resolved);
    if (!check.valid) throw new Error(`${name} event ${i} (${e.event}): ${check.errors.join("; ")}`);
    return { ...e, resolved };
  });
  return { ...raw, events };
}

export interface MockHarnessOptions {
  socketPath?: string;
  /** A script name from mocks/scripts. */
  script?: string;
  /** Methods that fail with the given ErrorKind, to test error handling. */
  fail?: Record<string, string>;
  /** Multiplies script delays. 0 plays every event at once. */
  speed?: number;
  quiet?: boolean;
}

export interface MockHarness {
  socketPath: string;
  close(): Promise<void>;
}

export async function startMockHarness(options: MockHarnessOptions = {}): Promise<MockHarness> {
  const socketPath = options.socketPath ?? defaultSocketPath();
  const contract = loadRpcContract();
  const script = options.script ? loadScript(options.script) : undefined;
  const log = (line: string) => options.quiet || console.log(`[mock harness] ${line}`);

  const play = (peer: RpcPeer) => {
    if (!script) return;
    let delay = 0;
    for (const e of script.events) {
      delay += e.afterMs * (options.speed ?? 1);
      setTimeout(() => {
        log(`event ${e.event}`);
        peer.notify(e.event, e.resolved);
      }, delay);
    }
  };

  const server: Server = createServer((socket) => {
    let peer: RpcPeer;
    const handlers: Record<string, Handler> = {};
    for (const [name, method] of Object.entries(contract.methods)) {
      if (method.direction !== "appToHarness") continue;
      handlers[name] = (params) => {
        log(`${name} ${JSON.stringify(params)}`);
        const failure = options.fail?.[name];
        if (failure) throw new RpcFailure({ kind: failure }, `Mock failure for ${name}`);
        if (name === "hello") {
          const version = (params as { protocolVersion: number }).protocolVersion;
          if (version !== PROTOCOL_VERSION) {
            throw new RpcFailure({ kind: "unexpected" }, `Protocol version ${version} does not match ${PROTOCOL_VERSION}`);
          }
          if (script?.trigger === "connect") setTimeout(() => play(peer), 0);
        }
        if (script?.trigger === name) setTimeout(() => play(peer), 0);
        return exampleOf(method.result);
      };
    }
    peer = new RpcPeer({ role: "harness", socket, handlers, contract });
    socket.on("error", () => socket.destroy());
  });

  if (process.platform !== "win32") {
    mkdirSync(dirname(socketPath), { recursive: true });
    if (existsSync(socketPath)) rmSync(socketPath);
  }
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socketPath, () => resolve()));
  log(`listening on ${socketPath}${script ? `, script ${options.script} on ${script.trigger}` : ""}`);
  return { socketPath, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = readArgs(process.argv.slice(2));
  const socket = args.get("socket");
  const script = args.get("script");
  const speed = args.get("speed");
  await startMockHarness({
    ...(socket ? { socketPath: socket } : {}),
    ...(script ? { script } : {}),
    ...(speed ? { speed: Number(speed) } : {}),
    fail: readFailures(args.get("fail")),
  });
}
