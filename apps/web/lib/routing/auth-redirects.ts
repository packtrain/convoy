import { readLocalString, removeLocalValue, writeLocalString } from "@/lib/browser/local-storage";

export const AUTH_REDIRECT_PARAM = "redirect_url";

// The emailed sign-up link can't carry redirect_url, so the starting browser keeps it.
const SIGN_UP_REDIRECT_KEY = "convoy.signUpRedirect";

export function rememberSignUpRedirect(redirectUrl: string | null): void {
  if (redirectUrl) writeLocalString(SIGN_UP_REDIRECT_KEY, redirectUrl);
  else removeLocalValue(SIGN_UP_REDIRECT_KEY);
}

/** The redirect_url kept at sign-up. */
export function readSignUpRedirect(): string | null {
  return readLocalString(SIGN_UP_REDIRECT_KEY);
}

/** The redirect_url kept at sign-up, removed from storage. */
export function takeSignUpRedirect(): string | null {
  const redirectUrl = readSignUpRedirect();
  removeLocalValue(SIGN_UP_REDIRECT_KEY);
  return redirectUrl;
}

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

const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Path that routes a post-auth redirect through /auth/callback so onboarding
 * always runs. The redirect_url is passed through raw; the callback page
 * sanitizes it before navigating.
 */
export function buildAuthCallbackPath(
  redirectUrl: string | null | undefined
): string {
  if (!redirectUrl) return AUTH_CALLBACK_PATH;
  // Already the callback: nesting it would stall, since the page onboards once per mount.
  if (URL.canParse(redirectUrl, "http://local.invalid")) {
    const target = new URL(redirectUrl, "http://local.invalid");
    if (target.pathname === AUTH_CALLBACK_PATH) return toLocalPath(target);
  }
  return `${AUTH_CALLBACK_PATH}?${AUTH_REDIRECT_PARAM}=${encodeURIComponent(redirectUrl)}`;
}
