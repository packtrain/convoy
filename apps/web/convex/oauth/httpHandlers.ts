import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { getAppUrlBase } from "../lib/shared/appUrl";

/**
 * HTTP layer for the MCP OAuth flow (OS-1192): discovery metadata (RFC 8414 + RFC
 * 9728), dynamic client registration (RFC 7591), and token exchange.
 * /oauth/authorize is NOT here — it is a Clerk-authenticated Next.js page on the app
 * origin, which the metadata points clients at.
 *
 * CORS is permissive: browser-based MCP clients preflight these requests.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
} as const;

function corsJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return corsJson({ error, error_description: description }, status);
}

/** Token responses carry credentials: never cacheable (RFC 6749 §5.1). */
function tokenJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...CORS_HEADERS,
    },
  });
}

function tokenError(error: string, description: string, status = 400): Response {
  return tokenJson({ error, error_description: description }, status);
}

export function handleOAuthPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Origin of the Convex HTTP router (the *.convex.site host). */
function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

/** The WWW-Authenticate value /api/mcp 401s carry so clients find us. */
export function buildWwwAuthenticateHeader(request: Request): string {
  return `Bearer resource_metadata="${requestOrigin(request)}/.well-known/oauth-protected-resource"`;
}

/** RFC 9728 protected resource metadata. */
export async function handleProtectedResourceMetadata(_ctx: ActionCtx, request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  return corsJson({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  });
}

/** RFC 8414 authorization server metadata. */
export async function handleAuthorizationServerMetadata(_ctx: ActionCtx, request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  return corsJson({
    issuer: origin,
    authorization_endpoint: `${getAppUrlBase()}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}

function parseRegisterBody(body: unknown): { redirectUris: string[]; clientName?: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.redirect_uris) || !record.redirect_uris.every((uri) => typeof uri === "string")) {
    return null;
  }
  if (record.client_name !== undefined && typeof record.client_name !== "string") return null;
  return { redirectUris: record.redirect_uris, clientName: record.client_name };
}

/** RFC 7591 dynamic client registration. */
export async function handleOAuthRegister(ctx: ActionCtx, request: Request): Promise<Response> {
  const body = parseRegisterBody(await request.json().catch(() => undefined));
  if (!body) {
    return oauthError("invalid_client_metadata", "redirect_uris (string array) is required");
  }

  try {
    const { clientId } = await ctx.runMutation(internal.oauth.core.register, {
      clientName: body.clientName,
      redirectUris: body.redirectUris,
    });

    return corsJson(
      {
        client_id: clientId,
        client_name: body.clientName,
        redirect_uris: body.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      },
      201
    );
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "string") {
      return oauthError("invalid_client_metadata", error.data);
    }
    throw error;
  }
}

type TokenParams = { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource?: string };

async function parseTokenParams(request: Request): Promise<TokenParams | { error: string } | null> {
  const contentType = request.headers.get("Content-Type") ?? "";
  let params: URLSearchParams | Record<string, unknown>;

  if (contentType.includes("application/json")) {
    const body: unknown = await request.json().catch(() => undefined);
    if (typeof body !== "object" || body === null) return null;
    params = body as Record<string, unknown>;
  } else {
    params = new URLSearchParams(await request.text());
  }

  const get = (key: string): string | undefined => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    return typeof value === "string" ? value : undefined;
  };

  const grantType = get("grant_type");
  if (grantType !== "authorization_code") {
    return { error: "unsupported_grant_type" };
  }

  const code = get("code");
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  const codeVerifier = get("code_verifier");
  if (!code || !clientId || !redirectUri || !codeVerifier) return null;

  return { code, clientId, redirectUri, codeVerifier, resource: get("resource") };
}

/** OAuth 2.1 token endpoint (authorization_code + PKCE, public client). */
export async function handleOAuthToken(ctx: ActionCtx, request: Request): Promise<Response> {
  const parsed = await parseTokenParams(request);
  if (!parsed) {
    return tokenError("invalid_request", "code, client_id, redirect_uri and code_verifier are required");
  }
  if ("error" in parsed) {
    return tokenError(parsed.error, "Only authorization_code grants are supported");
  }

  // RFC 8707: when the client names a resource, it must be our MCP endpoint
  // (tokens minted here are audience-bound to it — see apiKeys `kind`).
  if (parsed.resource !== undefined && parsed.resource !== `${requestOrigin(request)}/api/mcp`) {
    return tokenError("invalid_target", "Unknown resource; this server only issues tokens for its MCP endpoint");
  }

  try {
    const result = await ctx.runMutation(internal.oauth.core.token, {
      code: parsed.code,
      clientId: parsed.clientId,
      redirectUri: parsed.redirectUri,
      codeVerifier: parsed.codeVerifier,
    });

    if (!result.ok) {
      return tokenError(result.error, result.errorDescription);
    }

    return tokenJson({
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresInSeconds,
    });
  } catch (error) {
    // e.g. active-key limit reached while minting.
    if (error instanceof ConvexError && typeof error.data === "string") {
      return tokenError("invalid_grant", error.data);
    }
    throw error;
  }
}
