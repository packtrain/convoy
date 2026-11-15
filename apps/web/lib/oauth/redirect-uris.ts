/**
 * Redirect-URI rules for the MCP OAuth flow, shared by the Convex backend (the
 * authoritative checks) and the /oauth/authorize page (early validation + safe deny
 * redirects).
 *
 * Public clients only: https URIs match exactly, loopback http URIs (RFC 8252 §7.3)
 * match on every component but the port, since CLI clients bind a random port per run.
 * Fragments and embedded credentials are rejected at registration.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const MAX_REDIRECT_URI_LENGTH = 2000;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname === "::1" ? "[::1]" : url.hostname);
}

/** A URI a client may register: https or loopback http; no fragment, no credentials. */
export function isRegistrableRedirectUri(value: string): boolean {
  if (value.length > MAX_REDIRECT_URI_LENGTH) return false;
  const url = parseUrl(value);
  if (!url) return false;
  if (url.hash !== "" || url.username !== "" || url.password !== "") return false;
  return url.protocol === "https:" || isLoopback(url);
}

/** Whether a requested redirect URI matches one of the registered URIs. */
export function isRedirectUriAllowed(registered: string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;

  const candidateUrl = parseUrl(candidate);
  if (!candidateUrl || !isLoopback(candidateUrl)) return false;
  if (candidateUrl.hash !== "" || candidateUrl.username !== "" || candidateUrl.password !== "") return false;

  // Loopback: exact match on everything except the port (RFC 8252 §7.3).
  return registered.some((entry) => {
    const registeredUrl = parseUrl(entry);
    if (!registeredUrl || !isLoopback(registeredUrl)) return false;
    return (
      registeredUrl.hostname === candidateUrl.hostname &&
      registeredUrl.pathname === candidateUrl.pathname &&
      registeredUrl.search === candidateUrl.search
    );
  });
}
