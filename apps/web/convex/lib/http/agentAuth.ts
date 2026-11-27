import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { jsonError } from "./responses";
import type { ApiKeyScope } from "../access/permissions";

export type AgentAuthResult = {
  userId: Id<"users">;
  apiKeyId: Id<"apiKeys">;
  apiKeyScope: ApiKeyScope;
  lastUsedAt?: number;
};

export async function withAgentAuth<T>(
  ctx: ActionCtx,
  request: Request
): Promise<
  | { success: true; auth: AgentAuthResult; body: T; apiKey: string }
  | { success: false; response: Response }
> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      response: jsonError("Missing or invalid Authorization header", 401),
    };
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey) {
    return {
      success: false,
      response: jsonError("Missing or invalid Authorization header", 401),
    };
  }

  const authResult = await ctx.runQuery(internal.apiKeys.core.validateByKey, {
    apiKey,
  });
  if (!authResult) {
    return {
      success: false,
      response: jsonError("Invalid or expired API key", 401),
    };
  }

  // OAuth-minted tokens are audience-bound to the MCP endpoint; the consent
  // screen never granted agent-bridge access.
  if (authResult.kind === "mcp-oauth") {
    return {
      success: false,
      response: jsonError("This API key is restricted to the MCP API", 403),
    };
  }

  let body: T;
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      response: jsonError("Invalid JSON body", 400),
    };
  }

  return { success: true, auth: authResult, body, apiKey };
}
