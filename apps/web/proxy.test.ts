import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";

import { createGenericLinkPreviewResponse, isLinkPreviewCrawler, isPublicRoute } from "./proxy";

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
