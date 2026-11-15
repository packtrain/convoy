import { clerkClient } from "@clerk/nextjs/server";

import { isLocalDemoAuthMode } from "@/lib/auth/auth-mode";
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

  return Response.redirect(result.url, 307);
}
