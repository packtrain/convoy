/** Trim whitespace and trailing slashes so pasted URLs like "….convex.cloud/ " work. */
export function normalizeConvexUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Convert a Convex Cloud URL to its HTTP site URL.
 * Convex queries use *.convex.cloud, but HTTP routes (including MCP)
 * are served from *.convex.site. Self-hosted Convex serves HTTP routes
 * on port 3211 next to the client API on port 3210.
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
  convexCloudUrl: string,
  orgSlug: string,
  projectAlias: string
): string {
  const siteUrl = toConvexSiteUrl(convexCloudUrl);
  const project = `${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectAlias)}`;
  return `${siteUrl}/api/mcp?project=${project}`;
}
