import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { handleMcpRequest } from "./mcp/handler";
import { JsonHttp } from "./mcp/jsonhttp";
import type { Id } from "./_generated/dataModel";
import { withAgentAuth } from "./lib/http/agentAuth";
import { handleCliLoginStart, handleCliLoginPoll } from "./cli/loginHttp";
import {
  buildWwwAuthenticateHeader,
  handleAuthorizationServerMetadata,
  handleOAuthPreflight,
  handleOAuthRegister,
  handleOAuthToken,
  handleProtectedResourceMetadata,
} from "./oauth/httpHandlers";
import {
  checkMinSupportedCliVersion,
  MIN_SUPPORTED_CLI_VERSION,
  parseRegisterAvailableClis,
  parseRegisterPaths,
  validateRegisterScalars,
  type RegisterBody,
} from "./lib/http/registerBody";
import { jsonError, jsonResponse } from "./lib/http/responses";
import { handleGithubWebhook } from "./integrations/github/httpHandlers";

const http = httpRouter();
const API_KEY_USAGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

// Applied to every /api/mcp response (including errors and 204s): browser
// MCP clients pass preflight but still need these on the actual response,
// and WWW-Authenticate must be exposed for OAuth discovery to work there.
const MCP_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
} as const;

function withMcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

async function handleMcpPost(ctx: ActionCtx, request: Request): Promise<Response> {
  // Extract API key from Authorization header. 401s advertise the OAuth
  // discovery metadata (RFC 9728) so MCP clients can run the OAuth flow;
  // invalid/expired keys MUST 401 (not JSON-RPC-error) so expired OAuth
  // tokens trigger re-authentication.
  const wwwAuthenticate = { "WWW-Authenticate": buildWwwAuthenticateHeader(request) };
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return JsonHttp.unauthorized(null, -32001, "Missing or invalid Authorization header", {
      headers: wwwAuthenticate,
    });
  }

  const apiKey = authHeader.slice(7); // Remove "Bearer " prefix
  if (!apiKey) {
    return JsonHttp.unauthorized(null, -32001, "API key is required", { headers: wwwAuthenticate });
  }

  const auth = await ctx.runQuery(internal.apiKeys.core.validateByKey, { apiKey });
  if (!auth) {
    return JsonHttp.unauthorized(null, -32001, "Invalid or expired API key", { headers: wwwAuthenticate });
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return JsonHttp.badRequest(null, -32700, "Parse error: Invalid JSON");
  }

  // Handle MCP request
  try {
    const response = await handleMcpRequest(ctx, apiKey, body, request.url);

    // Record API key usage
    try {
      await ctx.runMutation(internal.apiKeys.core.recordUsageByKeyIfStale, {
        apiKey,
        minIntervalMs: API_KEY_USAGE_MIN_INTERVAL_MS,
      });
    } catch (e) {
      console.error("Failed to record API key usage:", e);
    }

    // Notifications don't get responses (handler returns null)
    if (response === null) {
      return JsonHttp.noContent();
    }

    return JsonHttp.fromJsonRpc(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal error";
    return JsonHttp.serverError(null, -32603, errorMessage);
  }
}

/**
 * MCP endpoint - handles Model Context Protocol requests.
 * Authentication via Bearer token (API key), including OAuth-minted keys.
 */
http.route({
  path: "/api/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => withMcpCors(await handleMcpPost(ctx, request))),
});

// CORS preflight handling (for browser-based MCP clients)
http.route({
  path: "/api/mcp",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    });
  }),
});

// MCP OAuth endpoints (OS-1192): discovery metadata, dynamic client registration, token
// exchange. /oauth/authorize is a Clerk page on the app origin. See docs/specs/mcp-oauth.md.

// RFC 9728 serves the metadata both at the bare well-known path and with the
// resource path appended; clients try the suffixed variant first.
for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
  http.route({ path, method: "GET", handler: httpAction(handleProtectedResourceMetadata) });
  http.route({ path, method: "OPTIONS", handler: httpAction(async () => handleOAuthPreflight()) });
}

for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/api/mcp"]) {
  http.route({ path, method: "GET", handler: httpAction(handleAuthorizationServerMetadata) });
  http.route({ path, method: "OPTIONS", handler: httpAction(async () => handleOAuthPreflight()) });
}

http.route({
  path: "/oauth/register",
  method: "POST",
  handler: httpAction(handleOAuthRegister),
});

http.route({
  path: "/oauth/register",
  method: "OPTIONS",
  handler: httpAction(async () => handleOAuthPreflight()),
});

http.route({
  path: "/oauth/token",
  method: "POST",
  handler: httpAction(handleOAuthToken),
});

http.route({
  path: "/oauth/token",
  method: "OPTIONS",
  handler: httpAction(async () => handleOAuthPreflight()),
});

// ============================================================================
// GitHub App webhook - HMAC-verified. See docs/specs/github-integration.md.
// ============================================================================

http.route({
  path: "/api/integrations/github/webhook",
  method: "POST",
  handler: httpAction(handleGithubWebhook),
});

// ============================================================================
// CLI browser-login endpoints (OS-1137) - unauthenticated by design; the
// CLI-held verifier gates key retrieval. See docs/specs/cli-browser-login.md.
// ============================================================================

http.route({
  path: "/api/cli/login/start",
  method: "POST",
  handler: httpAction(handleCliLoginStart),
});

http.route({
  path: "/api/cli/login/poll",
  method: "POST",
  handler: httpAction(handleCliLoginPoll),
});

// ============================================================================
// Agent Session endpoints - used by CLI for presence tracking
// ============================================================================

type CliSessionBody = { sessionId?: string };

/**
 * Register an agent session.
 * Called when CLI connects to start tracking presence.
 * Returns session ID for use in subsequent heartbeat/disconnect calls.
 */
http.route({
  path: "/api/agent/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const result = await withAgentAuth<RegisterBody>(ctx, request);
    if (!result.success) return result.response;

    const { auth, body } = result;

    const scalarValidation = validateRegisterScalars(body);
    if (!scalarValidation.success) return scalarValidation.response;
    const scalars = scalarValidation.value;

    const versionCheck = checkMinSupportedCliVersion(
      scalars.appVersion,
      MIN_SUPPORTED_CLI_VERSION
    );
    if (!versionCheck.success) return versionCheck.response;

    try {
      const parsedPaths = parseRegisterPaths(body.paths);
      if (!parsedPaths.success) return parsedPaths.response;

      const parsedAvailableClis = parseRegisterAvailableClis(body.availableClis);
      if (!parsedAvailableClis.success) return parsedAvailableClis.response;

      const result = await ctx.runMutation(internal.cli.sessions.register, {
        instanceId: scalars.instanceId,
        userId: auth.userId,
        apiKeyId: auth.apiKeyId,
        apiKeyScope: auth.apiKeyScope,
        projectId: scalars.projectId as Id<"projects">,
        hostname: scalars.hostname,
        name: scalars.name,
        profileKey: scalars.profileKey,
        paths: parsedPaths.value,
        availableClis: parsedAvailableClis.value,
        appVersion: scalars.appVersion,
        supportsPartialStreaming: scalars.supportsPartialStreaming,
        supportsInteractiveApprovals: scalars.supportsInteractiveApprovals,
        supportsSteering: scalars.supportsSteering,
        steeringCliTypes: scalars.steeringCliTypes,
        force: scalars.force,
      });

      // Record API key usage
      try {
        await ctx.runMutation(internal.apiKeys.core.recordUsageIfStale, {
          apiKeyId: auth.apiKeyId,
          minIntervalMs: API_KEY_USAGE_MIN_INTERVAL_MS,
        });
      } catch (e) {
        console.error("Failed to record API key usage:", e);
      }

      return jsonResponse({ sessionId: result.sessionId, profileId: result.profileId });
    } catch (error) {
      // Handle SESSION_CONFLICT with 409
      if (error instanceof ConvexError) {
        const data = error.data as { code?: string; message?: string; activeSessionCount?: number };
        if (data?.code === "SESSION_CONFLICT") {
          return jsonResponse({
            error: data.message,
            code: "SESSION_CONFLICT",
            activeSessionCount: data.activeSessionCount,
          }, 409);
        }
      }
      const message = error instanceof Error ? error.message : "Failed to register";
      return jsonError(message, 403);
    }
  }),
});

/**
 * Heartbeat to keep session alive.
 * Called periodically by CLI.
 */
http.route({
  path: "/api/agent/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const result = await withAgentAuth<CliSessionBody>(ctx, request);
    if (!result.success) return result.response;

    const { auth, body } = result;

    if (!body.sessionId || typeof body.sessionId !== "string") {
      return jsonError("sessionId is required", 400);
    }

    const success = await ctx.runMutation(internal.cli.sessions.heartbeat, {
      sessionId: body.sessionId as Id<"cliSessions">,
      userId: auth.userId,
      apiKeyScope: auth.apiKeyScope,
    });

    if (!success) {
      return jsonError("Session not found or not owned by this user", 404);
    }

    try {
      await ctx.runMutation(internal.apiKeys.core.recordUsageIfStale, {
        apiKeyId: auth.apiKeyId,
        minIntervalMs: API_KEY_USAGE_MIN_INTERVAL_MS,
      });
    } catch (e) {
      console.error("Failed to record API key usage:", e);
    }

    return jsonResponse({ ok: true });
  }),
});

/**
 * Disconnect an agent session.
 * Called when CLI cleanly shuts down.
 */
http.route({
  path: "/api/agent/disconnect",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const result = await withAgentAuth<CliSessionBody>(ctx, request);
    if (!result.success) return result.response;

    const { auth, body } = result;

    if (!body.sessionId || typeof body.sessionId !== "string") {
      return jsonError("sessionId is required", 400);
    }

    const success = await ctx.runMutation(internal.cli.sessions.disconnect, {
      sessionId: body.sessionId as Id<"cliSessions">,
      userId: auth.userId,
    });

    if (!success) {
      return jsonError("Session not found or not owned by this user", 404);
    }

    return jsonResponse({ ok: true });
  }),
});

export default http;
