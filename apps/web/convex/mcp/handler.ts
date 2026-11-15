import type { ActionCtx } from "../_generated/server";
import { JsonRpc, type JsonRpcResponse } from "./jsonrpc";
import { isValidMcpRequest } from "./lib/protocol/guards";
import { dispatch } from "./router";

/**
 * Extract the raw `?project=` value from the MCP request URL query string.
 * The value can be a Convex document ID or an `org-slug/ALIAS` compound identifier.
 */
function extractDefaultProjectParam(requestUrl: string): string | undefined {
  try {
    return new URL(requestUrl).searchParams.get("project") ?? undefined;
  } catch {
    // Invalid URL — no default project
    return undefined;
  }
}

/**
 * Handle an MCP protocol request.
 * Returns null for notifications (which don't get responses).
 *
 * @param requestUrl - The full request URL, used to extract default project
 *   from `?project=<id>` or `?project=org-slug/ALIAS` query parameter.
 */
export async function handleMcpRequest(
  ctx: ActionCtx,
  apiKey: string,
  request: unknown,
  requestUrl: string = ""
): Promise<JsonRpcResponse | null> {
  const defaultProjectParam = extractDefaultProjectParam(requestUrl);
  if (!isValidMcpRequest(request)) {
    return JsonRpc.invalidRequest(null, "Invalid request");
  }
  return dispatch(ctx, apiKey, request, defaultProjectParam);
}
