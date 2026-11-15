import { describe, expect, it } from "vitest";
import { normalizeConvexUrl, toConvexSiteUrl, buildMcpUrl } from "./url.js";

describe("normalizeConvexUrl", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(normalizeConvexUrl(" https://happy-otter-123.convex.cloud/ ")).toBe(
      "https://happy-otter-123.convex.cloud"
    );
    expect(normalizeConvexUrl("https://x.convex.cloud//")).toBe("https://x.convex.cloud");
    expect(normalizeConvexUrl("https://x.convex.cloud")).toBe("https://x.convex.cloud");
  });
});

describe("toConvexSiteUrl", () => {
  it("converts .convex.cloud to .convex.site", () => {
    expect(toConvexSiteUrl("https://happy-animal-123.convex.cloud")).toBe(
      "https://happy-animal-123.convex.site"
    );
  });

  it("handles URLs without .convex.cloud unchanged", () => {
    expect(toConvexSiteUrl("https://example.com")).toBe(
      "https://example.com"
    );
  });

  it("maps self-hosted port 3210 to the HTTP actions port 3211", () => {
    expect(toConvexSiteUrl("http://127.0.0.1:3210")).toBe(
      "http://127.0.0.1:3211"
    );
    expect(toConvexSiteUrl("https://convex.example.com:3210/")).toBe(
      "https://convex.example.com:3211/"
    );
  });

  it("does not rewrite 3210 outside the port position", () => {
    expect(toConvexSiteUrl("https://example.com/3210")).toBe(
      "https://example.com/3210"
    );
  });
});

describe("buildMcpUrl", () => {
  it("builds a correct project-scoped MCP URL", () => {
    const url = buildMcpUrl(
      "https://happy-animal-123.convex.cloud",
      "acme",
      "WEB"
    );
    expect(url).toBe(
      "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB"
    );
  });

  it("handles different org slugs and aliases", () => {
    const url = buildMcpUrl(
      "https://my-deployment.convex.cloud",
      "my-org",
      "ABC"
    );
    expect(url).toBe(
      "https://my-deployment.convex.site/api/mcp?project=my-org/ABC"
    );
  });

  it("encodes special characters in org slug and alias", () => {
    const url = buildMcpUrl(
      "https://test.convex.cloud",
      "org with spaces",
      "A&B"
    );
    expect(url).toBe(
      "https://test.convex.site/api/mcp?project=org%20with%20spaces/A%26B"
    );
  });
});
