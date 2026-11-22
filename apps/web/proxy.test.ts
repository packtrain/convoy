import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config, convexAuthGate, createGenericLinkPreviewResponse, isLinkPreviewCrawler, isPublicRoute } from "./proxy";

describe("proxy link previews", () => {
  test("detects common link-preview crawler user agents", () => {
    expect(isLinkPreviewCrawler("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe(true);
    expect(isLinkPreviewCrawler("Discordbot/2.0")).toBe(true);
    expect(isLinkPreviewCrawler("Mozilla/5.0")).toBe(false);
    expect(isLinkPreviewCrawler(null)).toBe(false);
  });

  test("returns generic Convoy metadata without a 404 title", async () => {
    const response = createGenericLinkPreviewResponse();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html).toContain("<title>Convoy</title>");
    expect(html).toContain('<meta property="og:description" content="Convoy is a platform for managing your tasks and projects.">');
    expect(html).not.toContain("404: This page could not be found.");
  });
});

describe("proxy public routes", () => {
  test("allows only the exact app-version endpoint without authentication", () => {
    expect(isPublicRoute(new NextRequest("https://app.convoy.build/api/app-version"))).toBe(true);
    expect(isPublicRoute(new NextRequest("https://app.convoy.build/api/app-version-secret"))).toBe(false);
    expect(isPublicRoute(new NextRequest("https://app.convoy.build/api/app-version/anything"))).toBe(false);
  });
});

describe("Convex Auth route gate", () => {
  const signedOut = { getToken: async () => null };

  test("sends a signed-out deep link to sign-in with the page as redirect_url", async () => {
    const response = await convexAuthGate(new NextRequest("https://convoy.example/o/acme/WEB?task=WEB-7"), signedOut);

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://convoy.example/auth/sign-in?redirect_url=%2Fo%2Facme%2FWEB%3Ftask%3DWEB-7"
    );
  });

  test("lets a request with a session through", async () => {
    const response = await convexAuthGate(new NextRequest("https://convoy.example/o/acme/WEB"), {
      getToken: async () => "token",
    });

    expect(response).toBeUndefined();
  });

  test("leaves the sign-in, verification and password reset pages public", async () => {
    for (const path of ["/auth/sign-in", "/auth/sign-up", "/auth/verify-email?code=x", "/auth/forgot-password", "/auth/reset-password", "/api/app-version"]) {
      expect(await convexAuthGate(new NextRequest(`https://convoy.example${path}`), signedOut)).toBeUndefined();
    }
  });

  test("answers a link-preview crawler with the generic preview", async () => {
    const request = new NextRequest("https://convoy.example/o/acme/WEB?task=WEB-7", {
      headers: { "user-agent": "Slackbot-LinkExpanding 1.0" },
    });

    const response = await convexAuthGate(request, signedOut);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain("<title>Convoy</title>");
  });

  test("the matcher skips the package's auth routes and still runs for the auth pages", () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

    expect(["/auth/signin", "/auth/refresh", "/auth/signout"].map(matches)).toEqual([false, false, false]);
    expect(["/auth/sign-in", "/auth/signing", "/o/acme/WEB"].map(matches)).toEqual([true, true, true]);
  });
});
