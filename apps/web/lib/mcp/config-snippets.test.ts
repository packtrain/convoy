import { describe, expect, test } from "vitest";
import { getToolDefinitions } from "../../convex/mcp/tools";
import {
  CODEX_APPROVAL_TOOLS,
  buildCodexApprovalConfig,
  buildCodexFullConfig,
  buildCodexRequiredConfig,
  buildGenericMcpConfig,
  buildMcpJsonConfig,
  buildMcpUrl,
  buildProjectScopedMcpUrl,
  toConvexSiteUrl,
} from "./config-snippets";

describe("MCP config snippets", () => {
  test("converts Convex cloud URLs to the HTTP site host", () => {
    expect(toConvexSiteUrl("https://happy-animal-123.convex.cloud")).toBe(
      "https://happy-animal-123.convex.site"
    );
    expect(toConvexSiteUrl("https://happy-animal-123.convex.site/")).toBe(
      "https://happy-animal-123.convex.site"
    );
    expect(buildMcpUrl("https://happy-animal-123.convex.cloud")).toBe(
      "https://happy-animal-123.convex.site/api/mcp"
    );
  });

  test("maps self-hosted port 3210 to the HTTP actions port 3211", () => {
    expect(toConvexSiteUrl("http://127.0.0.1:3210")).toBe(
      "http://127.0.0.1:3211"
    );
    expect(toConvexSiteUrl("https://convex.example.com:3210/")).toBe(
      "https://convex.example.com:3211"
    );
    expect(toConvexSiteUrl("https://example.com/3210")).toBe(
      "https://example.com/3210"
    );
    expect(buildMcpUrl("http://127.0.0.1:3210")).toBe(
      "http://127.0.0.1:3211/api/mcp"
    );
  });

  test("builds project-scoped URLs from route params", () => {
    expect(
      buildProjectScopedMcpUrl({
        organizationSlug: "acme org",
        projectAlias: "WEB/API",
        convexUrl: "https://happy-animal-123.convex.cloud",
      })
    ).toBe(
      "https://happy-animal-123.convex.site/api/mcp?project=acme%20org/WEB%2FAPI"
    );
  });

  test("falls back to an unscoped MCP URL without route params", () => {
    expect(
      buildProjectScopedMcpUrl({
        organizationSlug: "acme",
        convexUrl: "https://happy-animal-123.convex.cloud",
      })
    ).toBe("https://happy-animal-123.convex.site/api/mcp");
  });

  test("builds the .mcp.json snippet", () => {
    expect(
      buildMcpJsonConfig(
        "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB"
      )
    ).toBe(`{
  "mcpServers": {
    "convoy": {
      "type": "http",
      "url": "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB",
      "headers": {
        "Authorization": "Bearer <YOUR_API_KEY>"
      }
    }
  }
}`);
  });

  test("builds Codex minimal, full, and generic snippets", () => {
    const mcpUrl = "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB";

    expect(buildCodexRequiredConfig(mcpUrl)).toBe(`[mcp_servers.convoy]
url = "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB"

[mcp_servers.convoy.http_headers]
Authorization = "Bearer <YOUR_API_KEY>"`);
    expect(buildCodexFullConfig(mcpUrl)).toContain(
      "[mcp_servers.convoy.tools.update_task_link]"
    );
    expect(buildCodexApprovalConfig()).not.toContain("get_tasks_by_ref");
    expect(buildGenericMcpConfig(mcpUrl)).toBe(`URL: ${mcpUrl}
Authorization: Bearer <YOUR_API_KEY>`);
  });

  test("keeps Codex approval tools aligned with backend MCP tools", () => {
    expect(CODEX_APPROVAL_TOOLS).toEqual(
      getToolDefinitions().map((tool) => tool.name)
    );
  });
});
