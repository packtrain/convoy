import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";

/**
 * Minimal JSON-RPC client for `codex app-server`: newline-delimited JSON over
 * stdio, bare `{ id, method, params }` messages (no `jsonrpc` envelope).
 * Server→client requests (approvals, user input) must be answered through
 * `onRequest`; unhandled methods get a method-not-found error reply.
 */

export interface AppServerRpcHandlers {
  onNotification?: (method: string, params: Record<string, unknown>) => void;
  /** Resolve with the `result` payload; throw to reply with an error. */
  onRequest?: (
    method: string,
    params: Record<string, unknown>,
    requestId: unknown
  ) => Promise<unknown>;
}

export interface AppServerRpc {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  /** Reject all pending requests and stop reading. Idempotent. */
  close(reason?: string): void;
}

export class AppServerRpcError extends Error {
  constructor(
    message: string,
    public readonly method?: string
  ) {
    super(message);
    this.name = "AppServerRpcError";
  }
}

export function createAppServerRpc(
  io: { stdin: Writable; stdout: Readable },
  handlers: AppServerRpcHandlers
): AppServerRpc {
  let nextId = 1;
  let closed = false;
  const pending = new Map<
    number,
    { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const serverRequests = new Set<string>();
  const serverKey = (threadId: unknown, id: unknown) => JSON.stringify([threadId, id]);

  const write = (message: Record<string, unknown>): void => {
    if (closed || !io.stdin.writable) {
      return;
    }
    io.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const handleServerRequest = (
    id: unknown,
    method: string,
    params: Record<string, unknown>
  ): void => {
    const key = serverKey(params.threadId, id);
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
      if (method === "serverRequest/resolved") {
        serverRequests.delete(serverKey(params.threadId, params.requestId));
      }
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
      entry.reject(new AppServerRpcError(`${entry.method}: ${errorMessage}`, entry.method));
      return;
    }
    entry.resolve(message.result);
  };

  const reader: Interface = createInterface({ input: io.stdout });
  reader.on("line", handleLine);

  return {
    request(method, params) {
      if (closed) {
        return Promise.reject(new AppServerRpcError("Codex app-server connection is closed", method));
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
      const error = new AppServerRpcError(reason ?? "Codex app-server connection closed");
      for (const entry of pending.values()) {
        entry.reject(error);
      }
      pending.clear();
      serverRequests.clear();
    },
  };
}
