import {
  httpCookies,
  setupConvexAuthServer,
  writeAuthCookies,
  type HttpCookies,
  type RequestHandler,
} from "@convex-dev/auth/ssr";
import { ConvexHttpClient } from "convex/browser";
import { setupConvexAuthNextjs, type ConvexAuthNextjsProxyHandler } from "@convex-dev/auth/ssr/nextjs";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { authMode } from "./auth-mode";

/** Convex Auth's cookie session on the Next server (docs/specs/auth-adapters.md#session). */
function setup() {
  const browserUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
  // Where this server reaches the backend, e.g. a Docker service name; the browser's URL by default.
  const convexUrl = process.env.CONVEX_SERVER_URL || browserUrl;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  // From the app URL, so an http self-hosted install still gets its cookie.
  const cookieOptions = { secure: appUrl ? /^https:/i.test(appUrl) : process.env.NODE_ENV === "production" };
  const server = setupConvexAuthServer({
    convexUrl,
    refreshSession: api.auth.refreshSession,
    signOut: api.auth.signOut,
    // Every function that mints a session. The sign-in route answers 403 for anything else.
    signIn: [
      api.auth.signInWithEmailPassword,
      api.auth.completeSignUpWithEmailPassword,
      api.auth.completePasswordRecovery,
      api.auth.signUpWithoutEmailVerification,
      api.auth.completeSignInWithGoogle,
    ],
    cookieOptions,
    allowedOrigins: [
      ...(appUrl ? [appUrl] : []),
      // portless rewrites Origin to localhost:<PORT> in dev (see next.config.ts serverActions).
      ...(process.env.NODE_ENV !== "production" && process.env.PORT ? [`localhost:${process.env.PORT}`] : []),
    ],
  });
  // The package uses one URL for its server calls and the rendered client, so one setup per side.
  const nextjs = (url: string) =>
    setupConvexAuthNextjs({
      convexUrl: url,
      refreshSession: api.auth.refreshSession,
      isAuthenticated: api.auth.isAuthenticated,
      cookieOptions,
    });
  return {
    convexUrl,
    cookieOptions,
    server,
    proxy: nextjs(convexUrl).convexAuthNextjsProxy,
    Provider: nextjs(browserUrl).ConvexAuthNextjsServerProvider,
  };
}

// Lazy, so Clerk and local-demo builds, which also load proxy.ts, never build a Convex client here.
let instance: ReturnType<typeof setup> | undefined;
const convexAuth = () => (instance ??= setup());

type RouteName = "convexProxyHandler" | "refreshHandler" | "signOutHandler";

/** A POST handler for one of the package's fixed `/auth/*` routes; 404 outside Convex Auth mode. */
export function convexAuthRoute(name: RouteName): RequestHandler {
  return async (request) =>
    authMode === "convex" ? convexAuth().server[name](request) : new Response(null, { status: 404 });
}

/** Signs in by password on this server; the cookies to set, or null when the sign-in is refused. */
export async function signInWithPasswordCookies(
  request: Request,
  email: string,
  password: string
): Promise<HttpCookies | null> {
  const { convexUrl, cookieOptions } = convexAuth();
  const result = await new ConvexHttpClient(convexUrl).mutation(api.auth.signInWithEmailPassword, { email, password });
  if (result.status !== "complete") return null;
  const cookies = httpCookies(request);
  await writeAuthCookies(cookies, result.tokens, cookieOptions);
  return cookies;
}

export function buildConvexAuthProxy(handler: ConvexAuthNextjsProxyHandler) {
  return convexAuth().proxy(handler);
}

/** Reads the session cookie and hydrates the client auth provider with its access token. */
export function ConvexAuthServerProvider({ children }: { children: ReactNode }) {
  return convexAuth().Provider({ children });
}
