import { timingSafeEqual } from "node:crypto";

import { AUTH_REDIRECT_PARAM, sanitizeAuthRedirectUrl } from "@/lib/routing/auth-redirects";
import { appRoute } from "@/lib/navigation/routes";

export const AGENT_BROWSER_AUTH_HEADER = "x-convoy-agent-browser-secret";
export const DEFAULT_AGENT_BROWSER_REDIRECT_URL = "/";

const DEFAULT_ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "app.convoy",
  "app.convoy.localhost",
]);

export type AgentBrowserLoginConfig = {
  enabled: boolean;
  secret: string | undefined;
  userEmail: string | undefined;
  /** Convex Auth mode only: the agent user's password. */
  userPassword: string | undefined;
  allowedHosts: ReadonlySet<string>;
  appOrigin: string | undefined;
};

export type AgentBrowserLoginRequest = {
  method: string;
  url: string;
  headers: Headers;
};

export function getAgentBrowserLoginConfig(): AgentBrowserLoginConfig {
  return {
    enabled: process.env.CONVOY_AGENT_BROWSER_LOGIN_ENABLED === "true",
    secret: process.env.CONVOY_AGENT_BROWSER_AUTH_SECRET,
    userEmail: process.env.CONVOY_AGENT_BROWSER_USER_EMAIL,
    userPassword: process.env.CONVOY_AGENT_BROWSER_USER_PASSWORD || undefined,
    allowedHosts: parseAllowedHosts(process.env.CONVOY_AGENT_BROWSER_ALLOWED_HOSTS),
    appOrigin: process.env.NEXT_PUBLIC_APP_URL,
  };
}

export function parseAllowedHosts(value: string | undefined): ReadonlySet<string> {
  if (!value) return DEFAULT_ALLOWED_HOSTS;

  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return hosts.length > 0 ? new Set(hosts) : DEFAULT_ALLOWED_HOSTS;
}

export function isAllowedAgentBrowserHost(requestUrl: string, allowedHosts: ReadonlySet<string>): boolean {
  try {
    const url = new URL(requestUrl);
    return allowedHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isValidAgentBrowserSecret(providedSecret: string | null, expectedSecret: string): boolean {
  if (!providedSecret) return false;

  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

export function getProvidedAgentBrowserSecret(request: AgentBrowserLoginRequest): string | null {
  const headerSecret = request.headers.get(AGENT_BROWSER_AUTH_HEADER);
  if (headerSecret) return headerSecret;

  if (request.method !== "GET") return null;

  try {
    return new URL(request.url).searchParams.get("secret");
  } catch {
    return null;
  }
}

export function buildAgentBrowserRedirectUrl(
  redirectUrl: string | null | undefined,
  request: AgentBrowserLoginRequest,
  appOrigin: string | undefined
): string {
  const requestOrigin = getBrowserFacingOrigin(request);
  const origin = toOrigin(appOrigin) || requestOrigin;
  const safeRedirectUrl =
    sanitizeAuthRedirectUrl(redirectUrl, origin) || DEFAULT_AGENT_BROWSER_REDIRECT_URL;

  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set(AUTH_REDIRECT_PARAM, safeRedirectUrl);
  return callbackUrl.toString();
}

export function buildAgentBrowserAppSignInUrl(
  clerkSignInTokenUrl: string,
  callbackRedirectUrl: string,
  request: AgentBrowserLoginRequest,
  appOrigin: string | undefined
): string {
  const requestOrigin = getBrowserFacingOrigin(request);
  const origin = toOrigin(appOrigin) || requestOrigin;
  const sourceUrl = new URL(clerkSignInTokenUrl);
  const signInUrl = new URL(appRoute.authSignIn().pathname, origin);

  for (const [key, value] of sourceUrl.searchParams.entries()) {
    if (key !== "redirect_url") {
      signInUrl.searchParams.set(key, value);
    }
  }

  signInUrl.searchParams.set(AUTH_REDIRECT_PARAM, callbackRedirectUrl);
  return signInUrl.toString();
}

export function getBrowserFacingOrigin(request: AgentBrowserLoginRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto =
      request.headers.get("x-forwarded-proto") ||
      (forwardedHost.endsWith(".localhost") ? "https" : "http");
    return `${forwardedProto}://${forwardedHost}`;
  }

  const forwardedUrl = request.headers.get("x-forwarded-url");
  if (forwardedUrl) {
    try {
      return new URL(forwardedUrl).origin;
    } catch {
      // Fall back to the request URL below.
    }
  }

  return new URL(request.url).origin;
}

export function getRedirectUrlFromSearchParams(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    return url.searchParams.get(AUTH_REDIRECT_PARAM) || url.searchParams.get("redirectUrl");
  } catch {
    return null;
  }
}

export function getStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return typeof property === "string" ? property : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
