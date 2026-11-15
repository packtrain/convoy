export const AUTH_REDIRECT_PARAM = "redirect_url";

const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//i;

function toAppOrigin(appOrigin: string | URL): URL | null {
  try {
    return new URL(appOrigin);
  } catch {
    return null;
  }
}

function toLocalPath(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function sanitizeAuthRedirectUrl(
  redirectUrl: string | null | undefined,
  appOrigin: string | URL
): string | null {
  if (!redirectUrl) return null;

  const trimmedRedirectUrl = redirectUrl.trim();
  if (
    !trimmedRedirectUrl ||
    (!trimmedRedirectUrl.startsWith("/") &&
      !ABSOLUTE_HTTP_URL_PATTERN.test(trimmedRedirectUrl))
  ) {
    return null;
  }

  const baseUrl = toAppOrigin(appOrigin);
  if (!baseUrl) return null;

  try {
    const targetUrl = new URL(trimmedRedirectUrl, baseUrl);
    if (targetUrl.origin !== baseUrl.origin) return null;

    return toLocalPath(targetUrl);
  } catch {
    return null;
  }
}

export function buildAuthPathWithRedirect(
  authPath: string,
  redirectUrl: string | null | undefined,
  appOrigin: string | URL
): string {
  const safeRedirectUrl = sanitizeAuthRedirectUrl(redirectUrl, appOrigin);
  if (!safeRedirectUrl) return authPath;

  const baseUrl = toAppOrigin(appOrigin);
  if (!baseUrl) return authPath;

  const authUrl = new URL(authPath, baseUrl);
  authUrl.searchParams.set(AUTH_REDIRECT_PARAM, safeRedirectUrl);
  return toLocalPath(authUrl);
}

/**
 * Path that routes a Clerk post-auth redirect through /auth/callback so
 * onboarding always runs. The redirect_url is passed through raw; the
 * callback page sanitizes it before navigating.
 */
export function buildAuthCallbackPath(
  redirectUrl: string | null | undefined
): string {
  if (!redirectUrl) return "/auth/callback";
  return `/auth/callback?${AUTH_REDIRECT_PARAM}=${encodeURIComponent(redirectUrl)}`;
}
