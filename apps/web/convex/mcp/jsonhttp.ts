import type { JsonRpcId, JsonRpcResponse } from "./jsonrpc";
import { JsonRpc } from "./jsonrpc";

type JsonHttpOptions = {
  status?: number;
  headers?: HeadersInit;
  data?: unknown;
};

const JSON_HEADERS: HeadersInit = {
  "Content-Type": "application/json",
};

function splitHttpOptions(options?: JsonHttpOptions): {
  data?: unknown;
  httpOptions?: { status?: number; headers?: HeadersInit };
} {
  if (!options) return {};
  const { data, status, headers } = options;
  return { data, httpOptions: { status, headers } };
}

export const JsonHttp = {
  fromJsonRpc(payload: JsonRpcResponse, options: JsonHttpOptions = {}): Response {
    const { status = 200, headers } = options;
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...JSON_HEADERS, ...headers },
    });
  },

  ok(id: JsonRpcId, result: unknown, options?: JsonHttpOptions): Response {
    return this.fromJsonRpc(JsonRpc.ok(id, result), options);
  },

  err(id: JsonRpcId, code: number, message: string, options: JsonHttpOptions = {}): Response {
    const { data, httpOptions } = splitHttpOptions(options);
    return this.fromJsonRpc(JsonRpc.err(id, code, message, data), httpOptions);
  },

  badRequest(id: JsonRpcId, code: number, message: string, options: JsonHttpOptions = {}): Response {
    return this.err(id, code, message, { ...options, status: 400 });
  },

  unauthorized(id: JsonRpcId, code: number, message: string, options: JsonHttpOptions = {}): Response {
    return this.err(id, code, message, { ...options, status: 401 });
  },

  forbidden(id: JsonRpcId, code: number, message: string, options: JsonHttpOptions = {}): Response {
    return this.err(id, code, message, { ...options, status: 403 });
  },

  notFound(id: JsonRpcId, code: number, message: string, options: JsonHttpOptions = {}): Response {
    return this.err(id, code, message, { ...options, status: 404 });
  },

  serverError(id: JsonRpcId, code: number, message: string, options: JsonHttpOptions = {}): Response {
    return this.err(id, code, message, { ...options, status: 500 });
  },

  noContent(options: Omit<JsonHttpOptions, "status"> = {}): Response {
    return new Response(null, {
      status: 204,
      headers: options.headers,
    });
  },
} as const;

