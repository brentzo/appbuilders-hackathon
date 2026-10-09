import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { RpcFailure, RpcPeer, type Handler } from "@yumi/protocol";
import { PROTOCOL_VERSION, type HelloParams, type HelloResult } from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";

/**
 * The local JSON-RPC 2.0 server the Mac app connects to: a Unix domain socket in the user's Application Support
 * folder, one JSON message per line, with every message checked against the protocol contract by `RpcPeer`.
 * The Mac app calls `hello` first. After that it can call the harness's methods, the harness can call the app's
 * methods on the same connection, and the harness sends events to it.
 */

export interface RpcServerOptions {
  socketPath: string;
  logger: Logger;
  /** More app-to-harness methods, added by later objectives. `hello` and `ping` are built in. */
  handlers?: Record<string, Handler>;
  /** Called after an app completes the protocol handshake. */
  onReady?: () => void;
  /** This Mac's bridge device id, once known, for the `hello` answer (OBJ-64). */
  deviceId?: () => string | undefined;
}

interface Connection {
  id: number;
  peer: RpcPeer;
  socket: Socket;
  /** True after a successful `hello`. Only these connections get events. */
  ready: boolean;
}

/** Thrown when another harness already listens on the socket. */
export class HarnessAlreadyRunningError extends Error {}

export class HarnessRpcServer {
  private readonly connections = new Map<number, Connection>();
  private nextId = 1;

  private constructor(
    private readonly server: Server,
    readonly socketPath: string,
    private readonly logger: Logger,
    private readonly deviceId?: () => string | undefined,
  ) {}

  static async start(options: RpcServerOptions): Promise<HarnessRpcServer> {
    const { socketPath, logger } = options;
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
    await removeStaleSocket(socketPath);

    const server = createServer();
    const instance = new HarnessRpcServer(server, socketPath, logger, options.deviceId);
    server.on("connection", (socket) => instance.accept(socket, options.handlers ?? {}, options.onReady));
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socketPath, () => resolve()));
    // Only this user may connect.
    chmodSync(socketPath, 0o600);
    logger.info("rpc.listening", { socketPath });
    return instance;
  }

  /** Number of connections that completed `hello`. */
  get readyConnections(): number {
    return [...this.connections.values()].filter((c) => c.ready).length;
  }

  /** Sends an event to every connected app that said hello. Throws if the payload breaks the contract. */
  emit(event: string, payload: unknown): number {
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (!connection.ready) continue;
      connection.peer.notify(event, payload);
      sent++;
    }
    return sent;
  }

  /** Calls a method on the Mac app (the most recent connection that said hello). */
  request(method: string, params: unknown): Promise<unknown> {
    const app = [...this.connections.values()].reverse().find((c) => c.ready);
    if (!app) return Promise.reject(new Error(`No Mac app is connected to call ${method}`));
    return app.peer.request(method, params);
  }

  async close(): Promise<void> {
    for (const connection of this.connections.values()) connection.socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    if (existsSync(this.socketPath)) rmSync(this.socketPath);
    this.logger.info("rpc.closed", { socketPath: this.socketPath });
  }

  private accept(socket: Socket, extraHandlers: Record<string, Handler>, onReady?: () => void): void {
    const id = this.nextId++;
    // Assigned right below; the handlers only run after a message arrives.
    // eslint-disable-next-line prefer-const
    let connection: Connection;
    const handlers: Record<string, Handler> = {
      ...extraHandlers,
      hello: (params) => this.hello(connection, params as HelloParams, onReady),
      ping: () => ({}),
    };
    const peer = new RpcPeer({ role: "harness", socket, handlers });
    connection = { id, peer, socket, ready: false };
    this.connections.set(id, connection);
    this.logger.info("rpc.connected", { connection: id });
    socket.on("error", (error) => this.logger.warn("rpc.socketError", { connection: id, ...describeError(error) }));
    socket.on("close", () => {
      this.connections.delete(id);
      this.logger.info("rpc.disconnected", { connection: id });
    });
  }

  private hello(connection: Connection, params: HelloParams, onReady?: () => void): HelloResult {
    if (params.protocolVersion !== PROTOCOL_VERSION) {
      this.logger.warn("rpc.versionMismatch", {
        connection: connection.id,
        app: params.protocolVersion,
        harness: PROTOCOL_VERSION,
      });
      // The app shows the generic error; the versions are in the log.
      throw new RpcFailure(
        { kind: "unexpected" },
        `Protocol version ${params.protocolVersion} does not match ${PROTOCOL_VERSION}`,
      );
    }
    connection.ready = true;
    onReady?.();
    this.logger.info("rpc.hello", { connection: connection.id, protocolVersion: params.protocolVersion });
    const deviceId = this.deviceId?.();
    return { protocolVersion: PROTOCOL_VERSION, ...(deviceId ? { deviceId } : {}) };
  }
}

/**
 * Removes a socket file left by a harness that crashed. Refuses to start if a harness still answers on it. The harness
 * calls it before it opens the task store too, so a second harness never repairs the records of a running one.
 */
export async function removeStaleSocket(socketPath: string): Promise<void> {
  if (!existsSync(socketPath)) return;
  const live = await new Promise<boolean>((resolve) => {
    const probe = connect(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
  if (live) throw new HarnessAlreadyRunningError(`Another harness is listening on ${socketPath}`);
  rmSync(socketPath);
}
