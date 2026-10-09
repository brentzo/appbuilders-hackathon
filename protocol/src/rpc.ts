import type { Socket } from "node:net";
import { loadSchemaFiles } from "./schemas.ts";
import { validate } from "./index.ts";

/**
 * A JSON-RPC 2.0 peer for the local socket between the harness and the Mac app: one JSON message per line,
 * requests in both directions on one connection, and events as notifications. Every message is validated
 * against the protocol schemas in both directions, so a peer can never send or accept a shape the contract
 * does not allow.
 */

export type RpcRole = "harness" | "app";

interface MethodContract {
  direction: "appToHarness" | "harnessToApp";
  params: string;
  result: string;
}

export interface RpcContract {
  methods: Record<string, MethodContract>;
  events: Record<string, string>;
  errorData: string;
}

export function loadRpcContract(): RpcContract {
  const file = loadSchemaFiles().find((f) => f.schema["x-rpc"]);
  if (!file) throw new Error("No schema file declares x-rpc");
  return file.schema["x-rpc"] as RpcContract;
}

/** JSON-RPC error codes used on the local socket. */
export const RpcErrorCode = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  /** The method ran and failed. The error's data is a UserError. */
  failed: -32000,
} as const;

export interface RpcErrorObject {
  code: number;
  /** For logs only. Never shown to users. */
  message: string;
  data?: unknown;
}

/** Thrown by a handler to return a structured failure. `data` must be a valid UserError. */
export class RpcFailure extends Error {
  constructor(
    readonly data: unknown,
    message = "Method failed",
  ) {
    super(message);
  }
}

/** Raised on the calling side when the other peer answered with an error. */
export class RpcRemoteError extends Error {
  constructor(readonly error: RpcErrorObject) {
    super(`${error.code} ${error.message}`);
  }
}

export type Handler = (params: unknown) => unknown | Promise<unknown>;

export interface RpcPeerOptions {
  role: RpcRole;
  socket: Socket;
  /** Methods this side serves, by name. Every one must be a method the contract sends to this role. */
  handlers: Record<string, Handler>;
  onEvent?: (event: string, payload: unknown) => void;
  contract?: RpcContract;
}

const INCOMING: Record<RpcRole, MethodContract["direction"]> = { harness: "appToHarness", app: "harnessToApp" };

export class RpcPeer {
  private readonly contract: RpcContract;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; result: string }>();
  private nextId = 1;
  private buffer = "";

  constructor(private readonly options: RpcPeerOptions) {
    this.contract = options.contract ?? loadRpcContract();
    for (const name of Object.keys(options.handlers)) {
      if (this.contract.methods[name]?.direction !== INCOMING[options.role]) {
        throw new Error(`${options.role} cannot serve ${name}: the contract does not send it to the ${options.role}`);
      }
    }
    options.socket.setEncoding("utf8");
    options.socket.on("data", (chunk: string) => this.receive(chunk));
    options.socket.on("close", () => this.failPending(new Error("Connection closed")));
  }

  /** Calls a method on the other side and resolves with its validated result. */
  request(method: string, params: unknown): Promise<unknown> {
    const contract = this.contract.methods[method];
    if (!contract || contract.direction === INCOMING[this.options.role]) {
      return Promise.reject(new Error(`${this.options.role} cannot call ${method}`));
    }
    const check = validate(contract.params, params);
    if (!check.valid) return Promise.reject(new Error(`Invalid params for ${method}: ${check.errors.join("; ")}`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, result: contract.result });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Sends an event. Only the harness sends events. */
  notify(event: string, payload: unknown): void {
    const type = this.contract.events[event];
    if (this.options.role !== "harness" || !type) throw new Error(`${this.options.role} cannot send event ${event}`);
    const check = validate(type, payload);
    if (!check.valid) throw new Error(`Invalid payload for ${event}: ${check.errors.join("; ")}`);
    this.send({ jsonrpc: "2.0", method: event, params: payload });
  }

  close(): void {
    this.options.socket.end();
  }

  private send(message: unknown): void {
    this.options.socket.write(`${JSON.stringify(message)}\n`);
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) void this.dispatch(line);
    }
  }

  private async dispatch(line: string): Promise<void> {
    let message: { id?: number; method?: string; params?: unknown; result?: unknown; error?: RpcErrorObject };
    try {
      message = JSON.parse(line);
    } catch {
      this.send({ jsonrpc: "2.0", id: null, error: { code: RpcErrorCode.parseError, message: "Parse error" } });
      return;
    }
    if (message.method === undefined) return this.settle(message);
    if (message.id === undefined) return this.receiveEvent(message.method, message.params);
    this.send({ jsonrpc: "2.0", id: message.id, ...(await this.answer(message.method, message.params)) });
  }

  private async answer(method: string, params: unknown): Promise<{ result: unknown } | { error: RpcErrorObject }> {
    const contract = this.contract.methods[method];
    const handler = this.options.handlers[method];
    if (!contract || contract.direction !== INCOMING[this.options.role] || !handler) {
      return { error: { code: RpcErrorCode.methodNotFound, message: `Method not found: ${method}` } };
    }
    const check = validate(contract.params, params ?? {});
    if (!check.valid) return { error: { code: RpcErrorCode.invalidParams, message: check.errors.join("; ") } };
    try {
      const result = await handler(params ?? {});
      const checked = validate(contract.result, result);
      if (!checked.valid) throw new Error(`Handler for ${method} returned an invalid result: ${checked.errors.join("; ")}`);
      return { result };
    } catch (error) {
      if (error instanceof RpcFailure) {
        const data = validate(this.contract.errorData, error.data);
        if (data.valid) return { error: { code: RpcErrorCode.failed, message: error.message, data: error.data } };
      }
      // Anything else is a bug on this side: report it as the generic SPEC-11 kind, with details only in the message for logs.
      return {
        error: { code: RpcErrorCode.failed, message: error instanceof Error ? error.message : String(error), data: { kind: "unexpected" } },
      };
    }
  }

  private settle(message: { id?: number; result?: unknown; error?: RpcErrorObject }): void {
    const pending = message.id === undefined ? undefined : this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id!);
    if (message.error) return pending.reject(new RpcRemoteError(message.error));
    const check = validate(pending.result, message.result);
    if (check.valid) pending.resolve(message.result);
    else pending.reject(new Error(`Invalid result: ${check.errors.join("; ")}`));
  }

  private receiveEvent(event: string, payload: unknown): void {
    const type = this.contract.events[event];
    if (this.options.role !== "app" || !type || !validate(type, payload).valid) return;
    this.options.onEvent?.(event, payload);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
