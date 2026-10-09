// The mock Mac app: a stand-in for the Mac app's native services (OBJ-27 and the Mac objectives) until they exist.
// It connects to the harness's socket, says hello, and answers every method the harness can call with example data.
// Run: npm run mock:mac -- [--socket <path>] [--fail method=kind,...]
import { connect, type Socket } from "node:net";
import { pathToFileURL } from "node:url";
import {
  PROTOCOL_VERSION,
  type AppCapability,
  type AppVersionResult,
  type GetAppVersionParams,
  type MoveToTrashParams,
  type MoveToTrashResult,
  type ProbeAppCapabilityParams,
  type ResolveAppParams,
  type ResolveAppResult,
} from "../generated/ts/index.ts";
import { loadRpcContract, RpcFailure, RpcPeer, type Handler } from "../src/index.ts";
import { exampleOf, examplesOf } from "./examples.ts";
import { defaultSocketPath, readArgs, readFailures } from "./socket.ts";

export interface MockMacAppOptions {
  socketPath?: string;
  /** Methods that fail with the given ErrorKind, to test error handling. */
  fail?: Record<string, string>;
  /**
   * Answers that replace the mock's own for some methods, for tests that script the user or the screen (for
   * example a "Don't delete" tap, or To and Cc fields that change). They must return what the real Mac app would.
   */
  answers?: Record<string, Handler>;
  /** Called for every event the harness sends. */
  onEvent?: (event: string, payload: unknown) => void;
  quiet?: boolean;
}

export interface MockMacApp {
  peer: RpcPeer;
  close(): void;
}

/**
 * The apps installed on the mock Mac: one per AppCapability example. Like the real Mac app, the mock answers for the
 * app that was asked, and an app it does not have is not installed.
 */
const INSTALLED_APPS = new Map((examplesOf("AppCapability") as AppCapability[]).map((app) => [app.bundleId, app]));

/**
 * The names the user sees for the installed apps (kMDItemDisplayName of each app on the Mac the examples came from;
 * Keynote's bundle is "Keynote Creator Studio.app" but shows as Keynote). Launch Services ignores case, so the mock
 * does too.
 */
const APP_NAMES = new Map([
  ["google chrome", "com.google.Chrome"],
  ["keynote", "com.apple.Keynote"],
  ["wezterm", "com.github.wez.wezterm"],
]);

/** Methods whose answer depends on the params. Every other method answers with its example result. */
const ANSWERS: Record<string, Handler> = {
  probeAppCapability: (params) => {
    const { bundleId } = params as ProbeAppCapabilityParams;
    const app = INSTALLED_APPS.get(bundleId);
    // The real Mac app's answer for an app that is not installed.
    if (!app) throw new RpcFailure({ kind: "unsupportedRequest" }, `Mock: ${bundleId} is not installed`);
    return app;
  },
  resolveApp: (params): ResolveAppResult => {
    const bundleId = APP_NAMES.get((params as ResolveAppParams).name.toLowerCase());
    return bundleId && INSTALLED_APPS.has(bundleId) ? { bundleId } : {};
  },
  getAppVersion: (params): AppVersionResult => {
    const app = INSTALLED_APPS.get((params as GetAppVersionParams).bundleId);
    return app ? { appVersion: app.appVersion } : {};
  },
  // Answers for the paths it was asked about, as the real app does, but moves nothing: the mock never touches files.
  moveToTrash: (params): MoveToTrashResult => ({ trashed: [...(params as MoveToTrashParams).paths] }),
};

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
      const answer = options.answers?.[name] ?? ANSWERS[name];
      return answer ? answer(params) : exampleOf(method.result);
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
  await peer.request("hello", { protocolVersion: PROTOCOL_VERSION });
  log(`connected to ${socketPath}`);
  return { peer, close: () => peer.close() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = readArgs(process.argv.slice(2));
  const socket = args.get("socket");
  await connectMockMacApp({ ...(socket ? { socketPath: socket } : {}), fail: readFailures(args.get("fail")) });
}
