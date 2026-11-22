import { clerkClient } from "@clerk/nextjs/server";

import type { HttpCookies } from "@convex-dev/auth/ssr";

import { authMode, isLocalDemoAuthMode } from "@/lib/auth/auth-mode";
import { signInWithPasswordCookies } from "@/lib/auth/convex-auth-server";
import {
  buildAgentBrowserAppSignInUrl,
  buildAgentBrowserRedirectUrl,
  getAgentBrowserLoginConfig,
  getProvidedAgentBrowserSecret,
  getRedirectUrlFromSearchParams,
  getStringProperty,
  isAllowedAgentBrowserHost,
  isValidAgentBrowserSecret,
} from "./lib";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type BrowserLoginResponse = {
  url: string;
  redirectUrl: string;
  /** Convex Auth mode: the session cookies the redirect sets. */
  cookies?: HttpCookies;
};

function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

async function getPostRedirectUrl(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;

  try {
    const body: unknown = await request.json();
    return getStringProperty(body, "redirectUrl");
  } catch {
    return null;
  }
}

async function createBrowserLogin(request: Request): Promise<BrowserLoginResponse | Response> {
  const config = getAgentBrowserLoginConfig();
  const secret = config.secret;
  if (!config.enabled || !secret) {
    return jsonError("Agent browser login is not configured.", 404);
  }

  if (!isAllowedAgentBrowserHost(request.url, config.allowedHosts)) {
    return jsonError("Agent browser login is only available from allowed local hosts.", 403);
  }

  const providedSecret = getProvidedAgentBrowserSecret(request);
  if (!isValidAgentBrowserSecret(providedSecret, secret)) {
    return jsonError("Unauthorized.", 401);
  }

  // Convex Auth mode: the session is a cookie, so it must be set on the agent's browser itself.
  if (authMode === "convex" && request.method !== "GET") {
    return jsonError("In Convex Auth mode, open this endpoint with GET in the browser to sign in.", 405);
  }

  const requestedRedirectUrl = request.method === "POST" ? await getPostRedirectUrl(request) : getRedirectUrlFromSearchParams(request.url);
  const redirectUrl = buildAgentBrowserRedirectUrl(requestedRedirectUrl, request, config.appOrigin);

  // Local-demo mode (OS-1230): anonymous calls already resolve to the demo
  // user, so no Clerk sign-in token (and no userEmail config) is needed —
  // go straight to the requested page.
  if (isLocalDemoAuthMode) {
    return { url: redirectUrl, redirectUrl };
  }

  const userEmail = config.userEmail;
  if (!userEmail) {
    return jsonError("Agent browser login is not configured.", 404);
  }

  if (authMode === "convex") {
    if (!config.userPassword) return jsonError("Agent browser login is not configured.", 404);
    const cookies = await signInWithPasswordCookies(request, userEmail, config.userPassword);
    if (!cookies) return jsonError("The configured agent browser user could not sign in.", 401);
    // Relative, so the browser stays on the host that got the cookies (worktrees copy the primary's app URL).
    const { pathname, search } = new URL(redirectUrl);
    return { url: pathname + search, redirectUrl, cookies };
  }

  const client = await clerkClient();
  const users = await client.users.getUserList({
    emailAddress: [userEmail],
    limit: 2,
  });
  const user = users.data[0];
  if (!user) {
    return jsonError("Configured agent browser user was not found in Clerk.", 404);
  }

  const signInToken = await client.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: 5 * 60,
  });

  if (!signInToken.url) {
    return jsonError("Clerk did not return an agent browser login URL.", 502);
  }

  return {
    url: buildAgentBrowserAppSignInUrl(signInToken.url, redirectUrl, request, config.appOrigin),
    redirectUrl,
  };
}

export async function POST(request: Request): Promise<Response> {
  const result = await createBrowserLogin(request);
  if (result instanceof Response) return result;

  return Response.json(result, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const result = await createBrowserLogin(request);
  if (result instanceof Response) return result;

  const response = new Response(null, {
    status: 307,
    headers: { Location: result.url, "Cache-Control": "no-store, max-age=0" },
  });
  result.cookies?.applyTo(response.headers);
  return response;
}
