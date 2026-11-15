import { is } from "@/lib/type-guards";

export interface McpRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export function isValidMcpRequest(request: unknown): request is McpRequest {
  if (!is.record(request)) return false;
  return request.jsonrpc === "2.0" && is.string(request.method);
}

/**
 * Detect Convex errors caused by invalid document IDs, so MCP answers `-32602`
 * rather than an opaque `-32603` with a raw validator blob.
 *
 * "Expected ID for table" comes from a `v.id()` *argument validator* rejecting a
 * well-formed id from another table, before the handler runs — a realistic
 * mistake, since `projectId` is an argument on nearly every other tool.
 */
export function isConvexIdError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("not a valid id") ||
    lower.includes("could not decode id") ||
    lower.includes("expected id for table")
  );
}
