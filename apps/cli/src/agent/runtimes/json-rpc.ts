import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { isRecord } from "../sdk/adapters/adapter-interface.js";

/**
 * Minimal JSON-RPC client over newline-delimited stdio, shared by `codex app-server`
 * and ACP agents. Server→client requests are answered through `onRequest`.
 */

export interface JsonRpcHandlers {
  onNotification?: (method: string, params: Record<string, unknown>) => void;
  /** Resolve with the `result` payload; throw to reply with an error. */
  onRequest?: (
    method: string,
    params: Record<string, unknown>,
    requestId: unknown
  ) => Promise<unknown>;
}

export interface JsonRpcOptions {
  /** Names the peer in connection errors, e.g. "Codex app-server". */
  label: string;
  /** Stamp `jsonrpc: "2.0"` on every message; Codex sends bare messages. */
  envelope?: boolean;
  /** Dedupe key of a server request; Codex scopes request ids per thread. */
  serverRequestKey?: (id: unknown, params: Record<string, unknown>) => string;
  /** Key of the server request a notification withdraws, so its late reply is dropped. */
  withdrawnRequestKey?: (method: string, params: Record<string, unknown>) => string | undefined;
}

export interface JsonRpc {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  /** Reject all pending requests and stop reading. Idempotent. */
  close(reason?: string): void;
}

export class JsonRpcError extends Error {
  constructor(
    message: string,
    public readonly method?: string,
    /** The peer's JSON-RPC error code, when it replied with one. */
    public readonly code?: number
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

export function createJsonRpc(
  io: { stdin: Writable; stdout: Readable },
  handlers: JsonRpcHandlers,
  options: JsonRpcOptions
): JsonRpc {
  let nextId = 1;
  let closed = false;
  const pending = new Map<
    number,
    { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const serverRequests = new Set<string>();
  const serverKey = options.serverRequestKey ?? ((id: unknown) => JSON.stringify(id));

  const write = (message: Record<string, unknown>): void => {
    if (closed || !io.stdin.writable) {
      return;
    }
    io.stdin.write(`${JSON.stringify(options.envelope ? { jsonrpc: "2.0", ...message } : message)}\n`);
  };

  const handleServerRequest = (
    id: unknown,
    method: string,
    params: Record<string, unknown>
  ): void => {
    const key = serverKey(id, params);
    if (serverRequests.has(key)) return;
    serverRequests.add(key);
    const respond = handlers.onRequest
      ? handlers.onRequest(method, params, id)
      : Promise.reject(new Error(`Unsupported server request "${method}"`));
    respond
      .then((result) => {
        if (serverRequests.delete(key)) write({ id, result: result ?? null });
      })
      .catch((error: unknown) => {
        if (!serverRequests.delete(key)) return;
        write({
          id,
          error: {
            code: -32601,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      });
  };

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(trimmed) as unknown;
    } catch {
      return;
    }
    if (!isRecord(message)) {
      return;
    }

    const method = typeof message.method === "string" ? message.method : undefined;
    const params = isRecord(message.params) ? message.params : {};

    if (message.id !== undefined && method) {
      handleServerRequest(message.id, method, params);
      return;
    }
    if (method) {
      const withdrawn = options.withdrawnRequestKey?.(method, params);
      if (withdrawn !== undefined) serverRequests.delete(withdrawn);
      handlers.onNotification?.(method, params);
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    if (isRecord(message.error)) {
      const errorMessage =
        typeof message.error.message === "string"
          ? message.error.message
          : JSON.stringify(message.error);
      const code = typeof message.error.code === "number" ? message.error.code : undefined;
      entry.reject(new JsonRpcError(`${entry.method}: ${errorMessage}`, entry.method, code));
      return;
    }
    entry.resolve(message.result);
  };

  const reader: Interface = createInterface({ input: io.stdout });
  reader.on("line", handleLine);

  return {
    request(method, params) {
      if (closed) {
        return Promise.reject(new JsonRpcError(`${options.label} connection is closed`, method));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject });
        write(params === undefined ? { id, method } : { id, method, params });
      });
    },

    notify(method, params) {
      write(params === undefined ? { method } : { method, params });
    },

    close(reason) {
      if (closed) {
        return;
      }
      closed = true;
      reader.close();
      const error = new JsonRpcError(reason ?? `${options.label} connection closed`);
      for (const entry of pending.values()) {
        entry.reject(error);
      }
      pending.clear();
      serverRequests.clear();
    },
  };
}
