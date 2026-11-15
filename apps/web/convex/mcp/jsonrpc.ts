export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

function base(id: JsonRpcId): Pick<JsonRpcResponse, "jsonrpc" | "id"> {
  return { jsonrpc: "2.0", id };
}

export const JsonRpc = {
  ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
    return { ...base(id), result };
  },

  err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
    return {
      ...base(id),
      error: { code, message, ...(data !== undefined && { data }) },
    };
  },

  // Standard JSON-RPC errors
  parseError(id: JsonRpcId = null, message = "Parse error"): JsonRpcResponse {
    return this.err(id, -32700, message);
  },

  invalidRequest(id: JsonRpcId = null, message = "Invalid request"): JsonRpcResponse {
    return this.err(id, -32600, message);
  },

  methodNotFound(id: JsonRpcId, method: string): JsonRpcResponse {
    return this.err(id, -32601, `Method not found: ${method}`);
  },

  invalidParams(id: JsonRpcId, message = "Invalid params", data?: unknown): JsonRpcResponse {
    return this.err(id, -32602, message, data);
  },

  internalError(id: JsonRpcId, message = "Internal error", data?: unknown): JsonRpcResponse {
    return this.err(id, -32603, message, data);
  },
} as const;

