import { describe, expect, test } from "vitest";
import {
  buildAuthCallbackPath,
  buildAuthPathWithRedirect,
  sanitizeAuthRedirectUrl,
} from "./auth-redirects";

const APP_ORIGIN = "https://app.convoy.test";

describe("sanitizeAuthRedirectUrl", () => {
  test("keeps app-relative redirect paths with query and hash", () => {
    expect(
      sanitizeAuthRedirectUrl("/o/acme/WEB/threads/t1?task=WEB-7#events", APP_ORIGIN)
    ).toBe("/o/acme/WEB/threads/t1?task=WEB-7#events");
  });

  test("normalizes same-origin absolute URLs to local paths", () => {
    expect(
      sanitizeAuthRedirectUrl(
        "https://app.convoy.test/o/acme/API/kanban?filter=active",
        APP_ORIGIN
      )
    ).toBe("/o/acme/API/kanban?filter=active");
  });

  test("rejects external and non-http redirect targets", () => {
    expect(sanitizeAuthRedirectUrl("https://evil.test/o/acme/WEB", APP_ORIGIN)).toBeNull();
    expect(sanitizeAuthRedirectUrl("//evil.test/o/acme/WEB", APP_ORIGIN)).toBeNull();
    expect(sanitizeAuthRedirectUrl("javascript:alert(1)", APP_ORIGIN)).toBeNull();
  });

  test("rejects empty and path-relative redirect targets", () => {
    expect(sanitizeAuthRedirectUrl("", APP_ORIGIN)).toBeNull();
    expect(sanitizeAuthRedirectUrl("threads/t1", APP_ORIGIN)).toBeNull();
  });
});

describe("buildAuthPathWithRedirect", () => {
  test("adds a sanitized redirect_url parameter to an auth path", () => {
    expect(
      buildAuthPathWithRedirect(
        "/auth/sign-in",
        "https://app.convoy.test/o/acme/WEB?task=WEB-7",
        APP_ORIGIN
      )
    ).toBe("/auth/sign-in?redirect_url=%2Fo%2Facme%2FWEB%3Ftask%3DWEB-7");
  });

  test("keeps existing auth path params when adding redirect_url", () => {
    expect(
      buildAuthPathWithRedirect(
        "/auth/sign-in?mode=reauth",
        "/o/acme/WEB",
        APP_ORIGIN
      )
    ).toBe("/auth/sign-in?mode=reauth&redirect_url=%2Fo%2Facme%2FWEB");
  });

  test("omits redirect_url when the target is unsafe", () => {
    expect(
      buildAuthPathWithRedirect(
        "/auth/sign-in",
        "https://evil.test/o/acme/WEB",
        APP_ORIGIN
      )
    ).toBe("/auth/sign-in");
  });
});

describe("buildAuthCallbackPath", () => {
  test("carries the raw redirect_url through to the callback", () => {
    expect(buildAuthCallbackPath("/o/acme/WEB?task=WEB-7")).toBe(
      "/auth/callback?redirect_url=%2Fo%2Facme%2FWEB%3Ftask%3DWEB-7"
    );
  });

  test("returns the bare callback path without a redirect", () => {
    expect(buildAuthCallbackPath(null)).toBe("/auth/callback");
    expect(buildAuthCallbackPath("")).toBe("/auth/callback");
  });

  // The callback page processes once per mount, so a nested callback never onboards.
  test("does not nest a redirect_url that is already the callback", () => {
    expect(buildAuthCallbackPath("/auth/callback?redirect_url=%2F")).toBe("/auth/callback?redirect_url=%2F");
    expect(buildAuthCallbackPath("http://app.example/auth/callback?redirect_url=%2F")).toBe(
      "/auth/callback?redirect_url=%2F"
    );
    expect(buildAuthCallbackPath("http://[bad")).toBe("/auth/callback?redirect_url=http%3A%2F%2F%5Bbad");
  });
});
