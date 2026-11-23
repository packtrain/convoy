import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

/** Trim whitespace and trailing slashes so pasted URLs like "….convex.cloud/ " work. */
export function normalizeConvexUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Guess the HTTP actions URL from the client URL: *.convex.cloud → *.convex.site,
 * self-hosted :3210 → :3211. Prefer resolveConvexSiteUrl, which asks the backend.
 */
export function toConvexSiteUrl(cloudUrl: string): string {
  if (cloudUrl.includes(".convex.cloud")) {
    return cloudUrl.replace(".convex.cloud", ".convex.site");
  }
  return cloudUrl.replace(/:3210(\/|$)/, ":3211$1");
}

/**
 * Build the full MCP endpoint URL for a project-scoped connection.
 */
export function buildMcpUrl(
  siteUrl: string,
  orgSlug: string,
  projectAlias: string
): string {
  const project = `${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectAlias)}`;
  return `${siteUrl}/api/mcp?project=${project}`;
}

/** The HTTP actions origin as the backend reports it; the guess above for a backend too old to say. */
export async function resolveConvexSiteUrl(cloudUrl: string): Promise<string> {
  const url = normalizeConvexUrl(cloudUrl);
  const client = new ConvexHttpClient(url, {
    logger: false,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
  });
  try {
    return (await client.query(api.appVersion.core.siteUrl, {})) ?? toConvexSiteUrl(url);
  } catch {
    return toConvexSiteUrl(url);
  }
}
