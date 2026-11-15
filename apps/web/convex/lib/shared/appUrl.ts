export const APP_URL_FALLBACK = "https://app.convoy.localhost";

/**
 * Base URL of the web app (Clerk-authenticated pages), for backend-built
 * links such as task URLs, CLI approve links, and OAuth authorize URLs.
 */
export function getAppUrlBase(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return base ? base.replace(/\/+$/, "") : APP_URL_FALLBACK;
}
