import { describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { handleMcpRequest } from "./handler";
import { EMPTY_PAGE } from "../lib/shared/pagination";
import { getAppUrlBase } from "../lib/shared/appUrl";
import { createTestContext } from "../../convex-testing";
import { buildPathEntry } from "../../convex-testing/builders";
import { isRecord } from "@/lib/type-guards";
import { isConvoyMcpTool } from "@/lib/ai-tools/mcp-tool";

const BASE_URL = "https://example.convex.site/api/mcp";

/** `runQueryResult` may be a value, or a per-query resolver when a handler runs more than one query. */
function createActionCtx(runQueryResult: unknown | ((ref: unknown, args: unknown) => unknown)): {
  ctx: ActionCtx;
  runQuery: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
} {
  const runQuery =
    typeof runQueryResult === "function"
      ? vi.fn().mockImplementation(async (ref: unknown, args: unknown) =>
          (runQueryResult as (ref: unknown, args: unknown) => unknown)(ref, args)
        )
      : vi.fn().mockResolvedValue(runQueryResult);
  const runMutation = vi.fn().mockResolvedValue(runQueryResult);
  const ctx = {
    runQuery,
    runMutation,
  } as unknown as ActionCtx;
  return { ctx, runQuery, runMutation };
}

function parseToolContentJson(response: Awaited<ReturnType<typeof handleMcpRequest>>): unknown {
  if (!response || !isRecord(response.result)) {
    throw new Error("Expected JSON-RPC result payload");
  }
  const content = response.result.content;
  if (!Array.isArray(content) || content.length < 1 || !isRecord(content[0])) {
    throw new Error("Expected MCP content array");
  }
  const text = content[0].text;
  if (typeof text !== "string") {
    throw new Error("Expected MCP content text");
  }

  return JSON.parse(text);
}

function getToolSchemaProperty(
  tools: Array<Record<string, unknown>>,
  toolName: string,
  propertyName: string
): unknown {
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!isRecord(tool?.inputSchema)) {
    return undefined;
  }

  const properties = tool.inputSchema.properties;
  if (!isRecord(properties)) {
    return undefined;
  }

  return properties[propertyName];
}

describe("handleMcpRequest prompt tools", () => {
  test("tools/list advertises prompt tools with scope properties", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "prompt-tools",
      method: "tools/list",
    });

    expect(response?.error).toBeUndefined();
    const result = response?.result;
    expect(isRecord(result)).toBe(true);
    const tools = Array.isArray((result as Record<string, unknown>).tools)
      ? ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>)
      : [];
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_prompts", "create_prompt", "update_prompt"])
    );
    expect(getToolSchemaProperty(tools, "create_prompt", "scope")).toMatchObject({
      enum: ["project", "organization"],
    });
    expect(getToolSchemaProperty(tools, "update_prompt", "description")).toMatchObject({
      type: ["string", "null"],
    });
  });

  test("runtimeCommand descriptions name /goal for codex (OS-2277)", async () => {
    const { ctx } = createActionCtx(null);
    const response = await handleMcpRequest(ctx, "sk_user_test", { jsonrpc: "2.0", id: "goal", method: "tools/list" });
    const tools = ((response?.result as Record<string, unknown>).tools as Array<Record<string, unknown>>);
    for (const toolName of ["create_thread", "send_thread_message"]) {
      expect(getToolSchemaProperty(tools, toolName, "runtimeCommand")).toMatchObject({
        description: expect.stringContaining("/goal"),
      });
    }
  });

  test("create_prompt defaults to the URL project scope", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce("prompt_123");

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "create-project-prompt",
        method: "tools/call",
        params: {
          name: "create_prompt",
          arguments: {
            key: "review",
            content: "Review this contract.",
            description: "Review a contract",
            autoSubmit: true,
          },
        },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ promptId: "prompt_123" });
    expect(runMutation).toHaveBeenCalledWith(api.slashCommands.core.createInProject, {
      projectId: "project_123",
      key: "review",
      content: "Review this contract.",
      description: "Review a contract",
      autoSubmit: true,
      apiKey: "sk_user_test",
    });
  });

  test("organization scope without an organization argument uses the default project's organization", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx({
      _id: "project_123",
      organizationId: "org_123",
    });
    runMutation.mockResolvedValueOnce("prompt_456");

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "create-org-prompt",
        method: "tools/call",
        params: {
          name: "create_prompt",
          arguments: {
            scope: "organization",
            key: "handoff",
            content: "Write a handoff doc.",
          },
        },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ promptId: "prompt_456" });
    expect(runQuery).toHaveBeenCalledWith(api.projects.core.getById, {
      id: "project_123",
      apiKey: "sk_user_test",
    });
    expect(runMutation).toHaveBeenCalledWith(api.slashCommands.core.createInOrganization, {
      organizationId: "org_123",
      key: "handoff",
      content: "Write a handoff doc.",
      apiKey: "sk_user_test",
    });
  });

  test("an explicit organization slug wins over the default project", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) => {
      return getFunctionName(query) === "organizations/core:getByRef" ? { _id: "org_from_slug" } : null;
    });
    const runMutation = vi.fn().mockResolvedValue("prompt_789");
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "create-org-prompt-slug",
        method: "tools/call",
        params: {
          name: "create_prompt",
          arguments: {
            scope: "organization",
            organization: "acme",
            key: "handoff",
            content: "Write a handoff doc.",
          },
        },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.organizations.core.getByRef, {
      ref: "acme",
      apiKey: "sk_user_test",
    });
    const queriedNames = runQuery.mock.calls.map(([query]) => getFunctionName(query));
    expect(queriedNames).not.toContain("projects/core:getById");
    expect(runMutation).toHaveBeenCalledWith(api.slashCommands.core.createInOrganization, {
      organizationId: "org_from_slug",
      key: "handoff",
      content: "Write a handoff doc.",
      apiKey: "sk_user_test",
    });
  });

  test("list_prompts returns serialized rows for the organization scope", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) => {
      if (getFunctionName(query) === "slashCommands/core:listByOrganization") {
        return [
          {
            _id: "prompt_123",
            scope: "organization",
            key: "review",
            description: "Review a contract",
            category: "Legal",
            content: "Review this contract.",
            autoExpand: true,
          },
        ];
      }
      return getFunctionName(query) === "organizations/core:getByRef" ? { _id: "org_123" } : null;
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-prompts",
      method: "tools/call",
      params: {
        name: "list_prompts",
        arguments: { scope: "organization", organization: "org_123" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual([
      {
        promptId: "prompt_123",
        scope: "organization",
        key: "review",
        description: "Review a contract",
        category: "Legal",
        content: "Review this contract.",
        autoExpand: true,
        autoSubmit: false,
      },
    ]);
    // A raw ID resolves through the same key-aware lookup as a slug.
    expect(runQuery).toHaveBeenCalledWith(api.organizations.core.getByRef, {
      ref: "org_123",
      apiKey: "sk_user_test",
    });
    expect(runQuery).toHaveBeenCalledWith(api.slashCommands.core.listByOrganization, {
      organizationId: "org_123",
      apiKey: "sk_user_test",
    });
  });

  test("list_prompts defaults to the URL project scope", async () => {
    const { ctx, runQuery } = createActionCtx([
      { _id: "prompt_1", scope: "project", key: "review", content: "Review this contract.", autoExpand: false },
    ]);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-project-prompts",
        method: "tools/call",
        params: { name: "list_prompts", arguments: {} },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.slashCommands.core.listByProject, {
      projectId: "project_123",
      apiKey: "sk_user_test",
    });
  });

  test("an unresolvable organization fails by name instead of downstream", async () => {
    const { ctx, runQuery } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "unknown-org",
      method: "tools/call",
      params: { name: "list_prompts", arguments: { scope: "organization", organization: "ghost" } },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("Organization 'ghost' not found or outside API key scope");
    const queriedNames = runQuery.mock.calls.map(([query]) => getFunctionName(query));
    expect(queriedNames).not.toContain("slashCommands/core:listByOrganization");
  });

  test("organization scope with no organization and no project names both arguments", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "no-org-no-project",
      method: "tools/call",
      params: { name: "list_prompts", arguments: { scope: "organization" } },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("organization");
  });

  test("update_prompt passes nullable field clears through without a scope", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "update-prompt",
      method: "tools/call",
      params: {
        name: "update_prompt",
        arguments: {
          promptId: "prompt_123",
          key: "review-v2",
          description: null,
          category: null,
          autoExpand: false,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.slashCommands.core.update, {
      slashCommandId: "prompt_123",
      key: "review-v2",
      description: null,
      category: null,
      autoExpand: false,
      apiKey: "sk_user_test",
    });
  });

  test("create_prompt rejects an unknown scope", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "invalid-prompt-scope",
      method: "tools/call",
      params: {
        name: "create_prompt",
        arguments: {
          scope: "personal",
          projectId: "project_123",
          key: "review",
          content: "Review this contract.",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("scope must be one of: project, organization");
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest Skill tools", () => {
  test("tools/list advertises the Skill tools, scoped and agent-facing", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "skill-tools",
      method: "tools/list",
    });

    expect(response?.error).toBeUndefined();
    const result = response?.result;
    const tools = isRecord(result) && Array.isArray(result.tools) ? (result.tools as Array<Record<string, unknown>>) : [];
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_skills",
        "get_skill",
        "create_skill",
        "update_skill",
        "delete_skill",
        "install_skill",
        "load_skill",
        "read_skill_file",
      ])
    );
    // Every file write is a batch of edits on update_skill, so there are no
    // per-file tools to advertise (docs/specs/skills.md#authoring).
    expect(tools.map((tool) => tool.name)).not.toContain("create_skill_file");
    expect(getToolSchemaProperty(tools, "update_skill", "edits")).toMatchObject({
      type: "array",
      items: { required: ["op", "path"] },
    });
    expect(getToolSchemaProperty(tools, "create_skill", "scope")).toMatchObject({
      enum: ["project", "organization"],
    });
    expect(getToolSchemaProperty(tools, "create_skill", "organization")).toMatchObject({ type: "string" });
    // With no default project there is no project to enumerate, which is not the
    // same as a project holding no Skills — the agent can still pass a projectId.
    const loadSkill = tools.find((tool) => tool.name === "load_skill")?.description ?? "";
    expect(loadSkill).toContain("This connection is not scoped to a project");
    expect(loadSkill).not.toContain("This project has no Skills.");
  });

  test("tools/list enumerates the project's Skills into load_skill's description", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) => {
      if (getFunctionName(query) === "skills/core:listByProject") {
        return [
          { _id: "skill_2", name: "pdf-tools", description: "Fill and read PDFs" },
          { _id: "skill_1", name: "changelog", description: undefined },
        ];
      }
      return { _id: "project_123", organizationId: "org_123" };
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      { jsonrpc: "2.0", id: "skill-discovery", method: "tools/list" },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    const result = response?.result;
    const tools = isRecord(result) && Array.isArray(result.tools) ? (result.tools as Array<Record<string, unknown>>) : [];
    // Discovery is the tool schema, sorted by name, so an unchanged project
    // produces an unchanged schema.
    expect(tools.find((tool) => tool.name === "load_skill")?.description).toContain(
      "Skills available in this project:\n- changelog\n- pdf-tools: Fill and read PDFs"
    );
    expect(runQuery).toHaveBeenCalledWith(api.skills.core.listByProject, {
      projectId: "project_123",
      apiKey: "sk_user_test",
    });
  });

  test("list_skills defaults to the connection's project and drops file content", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) => {
      if (getFunctionName(query) === "skills/core:listByProject") {
        return [
          {
            _id: "skill_123",
            scope: "project",
            name: "pdf-tools",
            description: "Fill and read PDFs",
            category: "Docs",
            version: 3,
            normalizedName: "pdf-tools",
          },
        ];
      }
      return { _id: "project_123", organizationId: "org_123" };
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-skills-project",
        method: "tools/call",
        params: { name: "list_skills", arguments: {} },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual([
      {
        skillId: "skill_123",
        scope: "project",
        name: "pdf-tools",
        description: "Fill and read PDFs",
        category: "Docs",
        version: 3,
      },
    ]);
    expect(runQuery).toHaveBeenCalledWith(api.skills.core.listByProject, {
      projectId: "project_123",
      apiKey: "sk_user_test",
    });
  });

  test("list_skills at organization scope uses the default project's organization", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) => {
      if (getFunctionName(query) === "skills/core:listByOrganization") {
        return [
          {
            _id: "skill_123",
            scope: "organization",
            name: "pdf-tools",
            description: "Fill and read PDFs",
            category: "Docs",
            version: 3,
            normalizedName: "pdf-tools",
          },
        ];
      }
      return { _id: "project_123", organizationId: "org_123" };
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-skills",
        method: "tools/call",
        params: { name: "list_skills", arguments: { scope: "organization" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual([
      {
        skillId: "skill_123",
        scope: "organization",
        name: "pdf-tools",
        description: "Fill and read PDFs",
        category: "Docs",
        version: 3,
      },
    ]);
    expect(runQuery).toHaveBeenCalledWith(api.skills.core.listByOrganization, {
      organizationId: "org_123",
      apiKey: "sk_user_test",
    });
  });

  test("get_skill returns the whole bundle", async () => {
    const { ctx } = createActionCtx({
      _id: "skill_123",
      scope: "organization",
      name: "pdf-tools",
      version: 2,
      skillMd: "# PDF tools",
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "get-skill",
      method: "tools/call",
      params: { name: "get_skill", arguments: { skillId: "skill_123" } },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({
      skillId: "skill_123",
      scope: "organization",
      name: "pdf-tools",
      version: 2,
      skillMd: "# PDF tools",
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });
  });

  test("create_skill defaults to the connection's project", async () => {
    const runMutation = vi.fn().mockResolvedValue("skill_new");
    const ctx = { runQuery: vi.fn(), runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "create-skill-project",
        method: "tools/call",
        params: { name: "create_skill", arguments: { name: "pdf-tools", content: "# PDF tools" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ skillId: "skill_new" });
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.createInProject, {
      projectId: "project_123",
      name: "pdf-tools",
      content: "# PDF tools",
      apiKey: "sk_user_test",
    });
  });

  test("create_skill passes the git provenance through, and reads give it back", async () => {
    const source = { repoUrl: "https://github.com/anthropics/skills", ref: "main", commitSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12" };
    const runMutation = vi.fn().mockResolvedValue("skill_new");
    const ctx = { runQuery: vi.fn(), runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "create-skill-source",
        method: "tools/call",
        params: { name: "create_skill", arguments: { name: "pdf-tools", content: "# PDF tools", source } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.createInProject, {
      projectId: "project_123",
      name: "pdf-tools",
      content: "# PDF tools",
      source,
      apiKey: "sk_user_test",
    });

    // Reading it back is how a later check compares against upstream.
    const { ctx: readCtx } = createActionCtx({
      _id: "skill_123",
      scope: "project",
      name: "pdf-tools",
      version: 1,
      skillMd: "# PDF tools",
      files: [],
      source,
    });
    const read = await handleMcpRequest(readCtx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "get-skill-source",
      method: "tools/call",
      params: { name: "get_skill", arguments: { skillId: "skill_123" } },
    });

    expect(parseToolContentJson(read)).toMatchObject({ source });
  });

  test("install_skill copies an organization Skill into the connection's project", async () => {
    const runMutation = vi.fn().mockResolvedValue("skill_copy");
    const ctx = { runQuery: vi.fn(), runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "install-skill",
        method: "tools/call",
        params: { name: "install_skill", arguments: { skillId: "skill_template" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ skillId: "skill_copy" });
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.copyFromSkill, {
      projectId: "project_123",
      skillId: "skill_template",
      apiKey: "sk_user_test",
    });
  });

  // Dropping the argument would write to the project instead — silently, and to a
  // different owner under a different permission.
  test("the Skill tools reject an organization argument that project scope would ignore", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(null);

    for (const [id, name, args] of [
      ["list-skills-contradiction", "list_skills", { organization: "acme" }],
      ["create-skills-contradiction", "create_skill", { scope: "project", organization: "acme", name: "pdf-tools", content: "#" }],
    ] as const) {
      const response = await handleMcpRequest(
        ctx,
        "sk_user_test",
        { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
        `${BASE_URL}?project=project_123`
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain('organization is organization scope only; pass scope: "organization"');
    }
    expect(runMutation).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("create_skill rejects an unknown scope before its other arguments", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-skill-bad-scope",
      method: "tools/call",
      params: { name: "create_skill", arguments: { scope: "personal", content: "# PDF tools" } },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("scope must be one of: project, organization");
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("load_skill and read_skill_file read the connection project's Skills by name", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) =>
      getFunctionName(query) === "skills/core:loadByName"
        ? { name: "pdf-tools", skillMd: "# PDF tools", paths: ["references/fields.md"] }
        : { path: "references/fields.md", content: "# Fields" }
    );
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const loaded = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "load-skill",
        method: "tools/call",
        params: { name: "load_skill", arguments: { name: "pdf-tools" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(loaded?.error).toBeUndefined();
    expect(parseToolContentJson(loaded)).toEqual({
      name: "pdf-tools",
      skillMd: "# PDF tools",
      paths: ["references/fields.md"],
    });
    expect(runQuery).toHaveBeenCalledWith(api.skills.core.loadByName, {
      projectId: "project_123",
      name: "pdf-tools",
      apiKey: "sk_user_test",
    });

    const read = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "read-skill-file",
        method: "tools/call",
        params: { name: "read_skill_file", arguments: { name: "pdf-tools", path: "references/fields.md" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(read?.error).toBeUndefined();
    expect(parseToolContentJson(read)).toEqual({ path: "references/fields.md", content: "# Fields" });
    expect(runQuery).toHaveBeenCalledWith(api.skills.core.readFileByName, {
      projectId: "project_123",
      name: "pdf-tools",
      path: "references/fields.md",
      apiKey: "sk_user_test",
    });
  });

  /**
   * The whole slice against the real functions: author a project Skill through MCP,
   * see it in `tools/list`, then load it the way an agent does. A `vi.fn()` cannot
   * catch a validator mismatch between the tool schema and the mutation.
   */
  describe("authoring and loading a project Skill end to end", () => {
    test("a Skill created through MCP is discoverable and loadable in the same project", async () => {
      const testCtx = createTestContext();
      const { project, asUser, t } = await testCtx.setupProject();
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "MCP skills",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const ctx = {
        runQuery: (ref: Parameters<typeof t.query>[0], args: Parameters<typeof t.query>[1]) => t.query(ref, args),
        runMutation: (ref: Parameters<typeof t.mutation>[0], args: Parameters<typeof t.mutation>[1]) => t.mutation(ref, args),
      } as unknown as ActionCtx;
      const url = `${BASE_URL}?project=${project._id}`;
      const call = (id: string, name: string, args: Record<string, unknown>) => ({
        jsonrpc: "2.0" as const,
        id,
        method: "tools/call",
        params: { name, arguments: args },
      });

      const created = await handleMcpRequest(
        ctx,
        key,
        call("e2e-create", "create_skill", {
          name: "pdf-tools",
          content: "# PDF tools\n\nUse these steps.",
          description: "Fill and read PDFs",
        }),
        url
      );
      expect(created?.error).toBeUndefined();
      const { skillId } = parseToolContentJson(created) as { skillId: string };

      const edited = await handleMcpRequest(
        ctx,
        key,
        call("e2e-edit", "update_skill", {
          skillId,
          edits: [{ op: "write", path: "references/fields.md", content: "# Fields" }],
        }),
        url
      );
      expect(edited?.error).toBeUndefined();

      const listed = await handleMcpRequest(ctx, key, { jsonrpc: "2.0", id: "e2e-tools", method: "tools/list" }, url);
      const listResult = listed?.result;
      const tools =
        isRecord(listResult) && Array.isArray(listResult.tools) ? (listResult.tools as Array<Record<string, unknown>>) : [];
      expect(tools.find((tool) => tool.name === "load_skill")?.description).toContain("- pdf-tools: Fill and read PDFs");

      const loaded = await handleMcpRequest(ctx, key, call("e2e-load", "load_skill", { name: "pdf-tools" }), url);
      expect(parseToolContentJson(loaded)).toEqual({
        name: "pdf-tools",
        description: "Fill and read PDFs",
        skillMd: "# PDF tools\n\nUse these steps.",
        paths: ["references/fields.md"],
      });

      const read = await handleMcpRequest(
        ctx,
        key,
        call("e2e-read", "read_skill_file", { name: "pdf-tools", path: "references/fields.md" }),
        url
      );
      expect(parseToolContentJson(read)).toEqual({ path: "references/fields.md", content: "# Fields" });
    });

    test("an organization Skill installed through MCP becomes loadable in the project", async () => {
      const testCtx = createTestContext();
      const { org, project, asUser, t } = await testCtx.setupProject();
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "MCP skill install",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const templateId = await asUser.mutation(api.skills.core.createInOrganization, {
        organizationId: org._id,
        name: "invoice-parser",
        content: "# Invoice parser",
        description: "Read invoices",
        files: [{ path: "references/fields.md", content: "# Fields" }],
      });
      const ctx = {
        runQuery: (ref: Parameters<typeof t.query>[0], args: Parameters<typeof t.query>[1]) => t.query(ref, args),
        runMutation: (ref: Parameters<typeof t.mutation>[0], args: Parameters<typeof t.mutation>[1]) => t.mutation(ref, args),
      } as unknown as ActionCtx;
      const url = `${BASE_URL}?project=${project._id}`;

      // A template is invisible to an agent until it is installed.
      const before = await handleMcpRequest(
        ctx,
        key,
        { jsonrpc: "2.0", id: "e2e-load-template", method: "tools/call", params: { name: "load_skill", arguments: { name: "invoice-parser" } } },
        url
      );
      expect(parseToolContentJson(before)).toBeNull();

      const installed = await handleMcpRequest(
        ctx,
        key,
        { jsonrpc: "2.0", id: "e2e-install", method: "tools/call", params: { name: "install_skill", arguments: { skillId: templateId } } },
        url
      );
      expect(installed?.error).toBeUndefined();

      const loaded = await handleMcpRequest(
        ctx,
        key,
        { jsonrpc: "2.0", id: "e2e-load-copy", method: "tools/call", params: { name: "load_skill", arguments: { name: "invoice-parser" } } },
        url
      );
      expect(parseToolContentJson(loaded)).toEqual({
        name: "invoice-parser",
        description: "Read invoices",
        skillMd: "# Invoice parser",
        paths: ["references/fields.md"],
      });
    });
  });

  test("read_skill_file needs both the Skill name and the path", async () => {
    const { ctx, runQuery } = createActionCtx(null);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "read-skill-file-missing-path",
        method: "tools/call",
        params: { name: "read_skill_file", arguments: { name: "pdf-tools" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  // `organization` alone does not switch scope, matching create_prompt: naming an
  // organization is not the same as asking for organization scope.
  test("create_skill at organization scope targets the organization named by the argument", async () => {
    const runQuery = vi
      .fn()
      .mockImplementation(async (query) =>
        getFunctionName(query) === "organizations/core:getByRef" ? { _id: "org_from_slug" } : null
      );
    const runMutation = vi.fn().mockResolvedValue("skill_new");
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-skill",
      method: "tools/call",
      params: {
        name: "create_skill",
        arguments: { scope: "organization", organization: "acme", name: "pdf-tools", content: "# PDF tools", category: "Docs" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ skillId: "skill_new" });
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.createInOrganization, {
      organizationId: "org_from_slug",
      name: "pdf-tools",
      content: "# PDF tools",
      category: "Docs",
      apiKey: "sk_user_test",
    });
  });

  test("update_skill passes clears through and needs no organization", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce({ ok: true, version: 3 });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "update-skill",
      method: "tools/call",
      params: {
        name: "update_skill",
        arguments: { skillId: "skill_123", name: "pdf-forms", description: null, category: null },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.update, {
      skillId: "skill_123",
      name: "pdf-forms",
      description: null,
      category: null,
      apiKey: "sk_user_test",
    });
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("delete_skill carries the skill id through to its mutation", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "delete-skill",
      method: "tools/call",
      params: { name: "delete_skill", arguments: { skillId: "skill_123" } },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.deleteSkill, {
      skillId: "skill_123",
      apiKey: "sk_user_test",
    });
  });

  test("every edit op reaches the mutation as its typed shape", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce({ ok: true, version: 4 });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "update-skill-edits",
      method: "tools/call",
      params: {
        name: "update_skill",
        arguments: {
          skillId: "skill_123",
          edits: [
            { op: "write", path: "references/fields.md", content: "# Fields" },
            { op: "replace", path: "SKILL.md", oldString: "pdftk", newString: "qpdf", replaceAll: true },
            { op: "move", path: "a.md", newPath: "b.md" },
            { op: "delete", path: "c.md" },
          ],
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ ok: true, version: 4 });
    // Each op keeps only the fields it uses: the flat JSON Schema is one shape,
    // the mutation's validator is a union.
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.update, {
      skillId: "skill_123",
      edits: [
        { op: "write", path: "references/fields.md", content: "# Fields" },
        { op: "replace", path: "SKILL.md", oldString: "pdftk", newString: "qpdf", replaceAll: true },
        { op: "move", path: "a.md", newPath: "b.md" },
        { op: "delete", path: "c.md" },
      ],
      apiKey: "sk_user_test",
    });
  });

  test("an empty file is a legal write, not a missing argument", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce({ ok: true, version: 2 });

    // The backend byte-caps an additional file's content and nothing more, and
    // the web dialog saves a blank file happily, so scaffolding placeholders and
    // truncating a file must not fail here.
    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "update-skill-empty-write",
      method: "tools/call",
      params: {
        name: "update_skill",
        arguments: { skillId: "skill_123", edits: [{ op: "write", path: "references/notes.md", content: "" }] },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.update, {
      skillId: "skill_123",
      edits: [{ op: "write", path: "references/notes.md", content: "" }],
      apiKey: "sk_user_test",
    });
  });

  test("a malformed edit is rejected with its batch position", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    for (const [edits, expected] of [
      [[{ op: "rename", path: "a.md" }], "edits[0]: op must be one of: write, replace, move, delete"],
      [[{ op: "write", path: "a.md", content: "x" }, { op: "move", path: "b.md" }], "edits[1]: newPath is required"],
      [[{ op: "write", path: "a.md" }], "edits[0]: content is required"],
      ["not-an-array", "edits must be an array of edit objects"],
    ] as const) {
      const response = await handleMcpRequest(ctx, "sk_user_test", {
        jsonrpc: "2.0",
        id: "update-skill-bad-edit",
        method: "tools/call",
        params: { name: "update_skill", arguments: { skillId: "skill_123", edits } },
      });

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain(expected);
    }

    expect(runMutation).not.toHaveBeenCalled();
  });

  test("create_skill still requires a non-empty SKILL.md", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-skill-blank",
      method: "tools/call",
      params: { name: "create_skill", arguments: { organization: "acme", name: "pdf-tools", content: "" } },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("a replace edit accepts an empty newString and surfaces a miss as a tool error", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce({ ok: true, version: 2 });

    const deletion = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "replace-edit",
      method: "tools/call",
      params: {
        name: "update_skill",
        arguments: {
          skillId: "skill_123",
          edits: [{ op: "replace", path: "SKILL.md", oldString: "drop me", newString: "" }],
        },
      },
    });

    expect(deletion?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.skills.core.update, {
      skillId: "skill_123",
      edits: [{ op: "replace", path: "SKILL.md", oldString: "drop me", newString: "" }],
      apiKey: "sk_user_test",
    });

    // A reported miss is the agent's to recover from, so it comes back as an
    // error result rather than a JSON-RPC failure, and it names the edit.
    runMutation.mockResolvedValueOnce({
      ok: false,
      index: 0,
      code: "multiple_matches",
      message: "oldString matches 2 locations in SKILL.md; pass replaceAll to replace every occurrence",
      occurrences: 2,
    });

    const ambiguous = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "replace-edit-ambiguous",
      method: "tools/call",
      params: {
        name: "update_skill",
        arguments: {
          skillId: "skill_123",
          edits: [{ op: "replace", path: "SKILL.md", oldString: "pdftk", newString: "qpdf" }],
        },
      },
    });

    expect(ambiguous?.error).toBeUndefined();
    expect(isRecord(ambiguous?.result) ? ambiguous.result.isError : undefined).toBe(true);
    expect(parseToolContentJson(ambiguous)).toMatchObject({ index: 0, code: "multiple_matches", occurrences: 2 });
  });

  test("a replace edit missing newString is rejected before reaching the mutation", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "replace-edit-invalid",
      method: "tools/call",
      params: {
        name: "update_skill",
        arguments: { skillId: "skill_123", edits: [{ op: "replace", path: "SKILL.md", oldString: "pdftk" }] },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("edits[0]: newString is required");
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest Project-agent tools", () => {
  test("tools/list advertises create and update Project-agent tools", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "project-agent-tools",
      method: "tools/list",
    });

    expect(response?.error).toBeUndefined();
    const result = response?.result;
    expect(isRecord(result)).toBe(true);
    const tools = Array.isArray((result as Record<string, unknown>).tools)
      ? ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>)
      : [];
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_project_agents",
        "create_project_agent",
        "update_project_agent",
      ])
    );
    expect(getToolSchemaProperty(tools, "create_project_agent", "appearance")).toMatchObject({
      type: "object",
      required: ["color"],
    });
    expect(getToolSchemaProperty(tools, "update_project_agent", "prompt")).toMatchObject({
      type: ["string", "null"],
    });
  });

  test("create_project_agent uses default project scope and returns the new id", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce("project_agent_123");

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "create-project-agent",
        method: "tools/call",
        params: {
          name: "create_project_agent",
          arguments: {
            name: "Code Reviewer",
            description: "Reviews code",
            prompt: "Review the diff.",
            category: "Engineering",
            appearance: { color: "#3b82f6" },
          },
        },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({
      projectAgentId: "project_agent_123",
    });
    expect(runMutation).toHaveBeenCalledWith(api.agents.projectAgents.create, {
      projectId: "project_123",
      name: "Code Reviewer",
      description: "Reviews code",
      prompt: "Review the diff.",
      category: "Engineering",
      appearance: { color: "#3b82f6" },
      apiKey: "sk_user_test",
    });
  });

  test("update_project_agent passes nullable field clears through", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "update-project-agent",
      method: "tools/call",
      params: {
        name: "update_project_agent",
        arguments: {
          projectAgentId: "project_agent_123",
          name: "Updated Reviewer",
          description: null,
          prompt: null,
          category: null,
          appearance: { color: "#22c55e" },
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.agents.projectAgents.update, {
      projectAgentId: "project_agent_123",
      name: "Updated Reviewer",
      description: null,
      prompt: null,
      category: null,
      appearance: { color: "#22c55e" },
      apiKey: "sk_user_test",
    });
  });

  test("create_project_agent rejects malformed appearance", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "invalid-project-agent",
      method: "tools/call",
      params: {
        name: "create_project_agent",
        arguments: {
          projectId: "project_123",
          name: "Invalid Agent",
          appearance: { color: "#000000" },
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("appearance.color must be one of");
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("create_project_agent reports a missing appearance as required", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "missing-project-agent-appearance",
      method: "tools/call",
      params: {
        name: "create_project_agent",
        arguments: {
          projectId: "project_123",
          name: "Missing Appearance Agent",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toBe(
      "appearance is required and must be an object"
    );
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest search_tasks", () => {
  test("uses defaults for archiveMode, limit, and cursor", async () => {
    const mockResult = EMPTY_PAGE;
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "auth",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.search.byProject, {
      projectId: "project_123",
      query: "auth",
      archiveMode: "active",
      paginationOpts: {
        numItems: 20,
        cursor: null,
      },
      apiKey: "sk_user_test",
    });
  });

  test("passes optional args through to searchByProject", async () => {
    const mockResult = {
      page: [{ _id: "task_1", name: "Task 1" }],
      isDone: false,
      continueCursor: "cursor_2",
    };
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "security",
          archiveMode: "archived",
          filters: {
            status: "In Progress",
            assigneeId: "user_456",
            delegatedToAgentId: "agent_789",
          },
          limit: 15,
          cursor: "cursor_1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.search.byProject, {
      projectId: "project_123",
      query: "security",
      archiveMode: "archived",
      filters: {
        status: "In Progress",
        assigneeId: "user_456",
        delegatedToAgentId: "agent_789",
      },
      paginationOpts: {
        numItems: 15,
        cursor: "cursor_1",
      },
      apiKey: "sk_user_test",
    });
  });

  test("includes typed assignee in search task output", async () => {
    const mockResult = {
      page: [
        {
          _id: "task_1",
          refId: "ABC-1",
          parentId: null,
          name: "Agent task",
          status: "To Do",
          priority: "Medium",
          dueDate: null,
          assignee: {
            type: "projectAgent",
            projectAgentId: "projectAgent_1",
            name: "Code Review",
            appearance: { color: "#3b82f6" },
            isDeleted: false,
          },
          assigneeAvatarUrl: null,
          tags: ["agents"],
          taskType: { key: "task", name: "Task" },
          list: {
            type: "system",
            key: "backlog",
            ref: "BACKLOG",
            name: "Backlog",
          },
        },
      ],
      isDone: true,
      continueCursor: "",
    };
    const { ctx } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 2.25,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "agent",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    const parsed = parseToolContentJson(response);
    if (!isRecord(parsed) || !Array.isArray(parsed.page) || !isRecord(parsed.page[0])) {
      throw new Error("Expected MCP search result page");
    }

    expect(parsed.page[0]).toHaveProperty("assignee", {
      type: "projectAgent",
      projectAgentId: "projectAgent_1",
      name: "Code Review",
      appearance: { color: "#3b82f6" },
      isDeleted: false,
    });
    expect(parsed.page[0]).not.toHaveProperty("assigneeAvatarUrl");
    expect(parsed.page[0]).toMatchObject({
      _id: "task_1",
      refId: "ABC-1",
      name: "Agent task",
      taskType: { key: "task", name: "Task" },
      list: {
        type: "system",
        ref: "BACKLOG",
        name: "Backlog",
      },
    });
  });

  test("passes listId directly to searchByProject", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) => {
      const queryName = getFunctionName(query);
      if (queryName === "tasks/core/search:byProject") {
        return EMPTY_PAGE;
      }
      return null;
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 2.25,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "security",
          listId: "list_1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.search.byProject, {
      projectId: "project_123",
      query: "security",
      archiveMode: "active",
      listId: "list_1",
      paginationOpts: {
        numItems: 20,
        cursor: null,
      },
      apiKey: "sk_user_test",
    });
  });

  test("accepts Plan Review as a search status filter", async () => {
    const mockResult = EMPTY_PAGE;
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 2.5,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "plan",
          filters: {
            status: "Plan Review",
          },
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(
      api.tasks.core.search.byProject,
      expect.objectContaining({
        filters: {
          status: "Plan Review",
        },
      })
    );
  });

  test("allows filters.assigneeId = null for tasks with no owner", async () => {
    const mockResult = EMPTY_PAGE;
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "backlog",
          filters: {
            assigneeId: null,
          },
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(
      api.tasks.core.search.byProject,
      expect.objectContaining({
        filters: {
          assigneeId: null,
        },
      })
    );
  });

  test("rejects the removed filters.assignee param", async () => {
    const mockResult = EMPTY_PAGE;
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 3.1,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "backlog",
          filters: {
            assignee: { type: "user", userId: "user_456" },
          },
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("filters.assignee is no longer supported");
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns invalid params for invalid archiveMode", async () => {
    const { ctx, runQuery } = createActionCtx(EMPTY_PAGE);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "api",
          archiveMode: "all",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns invalid params for invalid limit values", async () => {
    const invalidLimits: unknown[] = ["10", 0, 51, 1.5];

    for (const limit of invalidLimits) {
      const { ctx, runQuery } = createActionCtx(EMPTY_PAGE);

      const response = await handleMcpRequest(ctx, "sk_user_test",  {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "search_tasks",
          arguments: {
            projectId: "project_123",
            query: "api",
            limit,
          },
        },
      });

      expect(response?.error?.code).toBe(-32602);
      expect(runQuery).not.toHaveBeenCalled();
    }
  });

  test("returns invalid params for empty or whitespace query", async () => {
    const invalidQueries = ["", "   "];

    for (const query of invalidQueries) {
      const { ctx, runQuery } = createActionCtx(EMPTY_PAGE);

      const response = await handleMcpRequest(ctx, "sk_user_test",  {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "search_tasks",
          arguments: {
            projectId: "project_123",
            query,
          },
        },
      });

      expect(response?.error?.code).toBe(-32602);
      expect(runQuery).not.toHaveBeenCalled();
    }
  });

  test("returns invalid params when projectId is missing", async () => {
    const { ctx, runQuery } = createActionCtx(EMPTY_PAGE);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          query: "Task",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns invalid params when cursor has wrong type", async () => {
    const { ctx, runQuery } = createActionCtx(EMPTY_PAGE);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "Task",
          cursor: 123,
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns invalid params for legacy tool invalid enum inputs", async () => {
    const runMutation = vi.fn();
    const ctx = {
      runQuery: vi.fn(),
      runMutation,
    } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "delete_task",
        arguments: {
          taskId: "task_123",
          cascadeMode: "invalid_mode",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns search response payload projected for MCP content text", async () => {
    const mockResult = {
      page: [{ _id: "task_1", name: "Task 1", refId: "ABC-1" }],
      isDone: true,
      continueCursor: "",
    };
    const { ctx } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "search_tasks",
        arguments: {
          projectId: "project_123",
          query: "Task",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    if (!response || !isRecord(response.result)) {
      throw new Error("Expected JSON-RPC result payload");
    }
    const content = response.result.content;
    if (!Array.isArray(content) || content.length < 1 || !isRecord(content[0])) {
      throw new Error("Expected MCP content array");
    }
    const text = content[0].text;
    if (typeof text !== "string") {
      throw new Error("Expected MCP content text");
    }

    expect(JSON.parse(text)).toEqual({
      page: [
        {
          _id: "task_1",
          refId: "ABC-1",
          name: "Task 1",
        },
      ],
      isDone: true,
      continueCursor: "",
    });
  });
});

describe("handleMcpRequest get_tasks", () => {
  test("passes identifiers and projectId to getByRefs", async () => {
    const mockResult = {
      results: [
        { ref: "ABC-5", task: null },
        { ref: "ABC-12", task: null },
      ],
    };
    const runQuery = vi.fn().mockImplementation(async (query, args) => {
      const queryName = getFunctionName(query);

      if (queryName === "tasks/core:getByRefs") {
        expect(args).toEqual({
          refs: ["ABC-5", "ABC-12"],
          projectId: "project_123",
          apiKey: "sk_user_test",
        });
        return mockResult;
      }

      return null;
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_tasks",
        arguments: {
          identifiers: ["ABC-5", "ABC-12"],
          projectId: "project_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
  });

  test("returns invalid params when identifiers is empty", async () => {
    const { ctx, runQuery } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_tasks",
        arguments: {
          identifiers: [],
          projectId: "project_123",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns invalid params when identifiers is missing", async () => {
    const { ctx, runQuery } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_tasks",
        arguments: {
          projectId: "project_123",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns invalid params when identifiers contains non-strings", async () => {
    const { ctx, runQuery } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_tasks",
        arguments: {
          identifiers: [123, "ABC-5"],
          projectId: "project_123",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns per-item errors when bare refs are missing project context", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_tasks",
        arguments: {
          identifiers: ["ABC-5"],
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toMatchObject({
      results: [
        {
          identifier: "ABC-5",
          task: null,
          error:
            "projectId is required (provide it in tool arguments or via ?project= URL parameter)",
        },
      ],
    });
  });

  test("returns tasks enriched with artifact and file summaries", async () => {
    const mockResult = {
      results: [
        {
          ref: "ABC-5",
          task: {
            _id: "task_1",
            _creationTime: 50,
            projectId: "project_123",
            clientId: "client_1",
            refNumber: 5,
            refId: "ABC-5",
            name: "Fix login",
            description: "Rich detail",
            rank: "0|abc:",
            createdBy: "user_1",
            createdByName: "Alex",
            createdAt: 60,
            updatedAt: 70,
            assigneeAvatarUrl: null,
            tags: ["auth"],
            taskType: {
              key: "task",
              name: "Task",
              icon: "SquareCheckBig",
              color: "#64748b",
              isSystem: true,
            },
            isDeleted: false,
            isArchived: true,
          },
        },
      ],
    };
    const runQuery = vi.fn().mockImplementation(async (query, args) => {
      const queryName = getFunctionName(query);

      if (queryName === "tasks/core:getByRefs") {
        expect(args).toEqual({
          refs: ["ABC-5"],
          projectId: "project_123",
          apiKey: "sk_user_test",
        });
        return mockResult;
      }

      if (queryName === "tasks/artifacts:listTaskArtifactsByTask") {
        return [
          {
            _id: "artifact_1",
            taskId: "task_1",
            name: "Plan",
            fileName: "plan.md",
            source: "user",
            createdAt: 100,
            updatedAt: 100,
          },
        ];
      }

      if (queryName === "tasks/attachments:listTaskAttachmentsByTask") {
        return [
          {
            _id: "attachment_1",
            taskId: "task_1",
            fileName: "spec.pdf",
            fileSize: 1024,
            contentType: "application/pdf",
            uploadedAt: 200,
            url: "https://files.example/spec.pdf",
          },
        ];
      }

      if (queryName === "tasks/comments:listByTask") {
        return {
          page: [
            {
              _id: "comment_1",
              taskId: "task_1",
              authorId: "user_1",
              authorName: "Alex",
              authorAvatarUrl: null,
              content: "Please review this fix",
              createdAt: 300,
              updatedAt: 300,
              isEdited: false,
              attachments: [
                {
                  _id: "comment_attachment_1",
                  fileName: "trace.log",
                  fileSize: 512,
                  contentType: "text/plain",
                  url: "https://files.example/trace.log",
                },
              ],
              canEdit: false,
              canDelete: false,
            },
          ],
          isDone: false,
          continueCursor: "cursor_3",
        };
      }

      if (queryName === "tasks/core:listByParent") {
        return [];
      }

      if (queryName === "checks/checklists:getForTask") {
        return null;
      }

      return [];
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test",  {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "get_tasks",
        arguments: {
          identifiers: ["ABC-5"],
          projectId: "project_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    if (!response || !isRecord(response.result)) {
      throw new Error("Expected JSON-RPC result payload");
    }
    const content = response.result.content;
    if (!Array.isArray(content) || content.length < 1 || !isRecord(content[0])) {
      throw new Error("Expected MCP content array");
    }
    const text = content[0].text;
    if (typeof text !== "string") {
      throw new Error("Expected MCP content text");
    }

    expect(JSON.parse(text)).toEqual({
      results: [
        {
          identifier: "ABC-5",
          task: {
            _id: "task_1",
            refId: "ABC-5",
            name: "Fix login",
            description: "Rich detail",
            createdAt: 60,
            updatedAt: 70,
            tags: ["auth"],
            taskType: {
              key: "task",
              name: "Task",
            },
            isArchived: true,
            artifacts: [
              {
                _id: "artifact_1",
                name: "Plan",
                contentType: "markdown",
                source: "user",
                createdAt: 100,
                updatedAt: 100,
              },
            ],
            files: [
              {
                _id: "attachment_1",
                fileName: "spec.pdf",
                fileSize: 1024,
                contentType: "application/pdf",
                uploadedAt: 200,
                url: "https://files.example/spec.pdf",
              },
            ],
            comments: [
              {
                _id: "comment_1",
                authorId: "user_1",
                authorName: "Alex",
                content: "Please review this fix",
                createdAt: 300,
                updatedAt: 300,
                isEdited: false,
                attachments: [
                  {
                    _id: "comment_attachment_1",
                    fileName: "trace.log",
                    fileSize: 512,
                    contentType: "text/plain",
                    url: "https://files.example/trace.log",
                  },
                ],
              },
            ],
            commentsHasMore: true,
            subtasks: [],
          },
        },
      ],
    });
  });

  test("resolves raw IDs, bare refs, and scoped refs in one request", async () => {
    const runQuery = vi.fn().mockImplementation(async (query, args) => {
      const queryName = getFunctionName(query);

      if (queryName === "tasks/core:getById") {
        expect(args).toEqual({ id: "task_id", apiKey: "sk_user_test" });
        return {
          _id: "task_id",
          projectId: "project_123",
          refId: "ABC-1",
          name: "Raw ID task",
        };
      }

      if (queryName === "tasks/core:getByRefs") {
        expect(args).toEqual({
          refs: ["ABC-5", "OS-7"],
          projectId: "project_123",
          apiKey: "sk_user_test",
        });
        return {
          results: [
            {
              ref: "ABC-5",
              task: { _id: "task_ref", refId: "ABC-5", name: "Bare ref task" },
            },
            {
              ref: "OS-7",
              task: { _id: "task_scoped", refId: "OS-7", name: "Scoped ref task" },
            },
          ],
        };
      }

      if (queryName === "tasks/artifacts:listTaskArtifactsByTask") {
        return [];
      }

      if (queryName === "tasks/attachments:listTaskAttachmentsByTask") {
        return [];
      }

      if (queryName === "tasks/comments:listByTask") {
        return {
          page: [],
          isDone: true,
          continueCursor: "cursor_done",
        };
      }

      if (queryName === "tasks/core:listByParent") {
        return [];
      }

      return null;
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "get_tasks",
          arguments: {
            identifiers: ["task_id", "ABC-5", "contoso/OS-7"],
            projectId: "project_123",
          },
        },
      }
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toMatchObject({
      results: [
        { identifier: "task_id", task: { _id: "task_id", refId: "ABC-1", name: "Raw ID task" } },
        { identifier: "ABC-5", task: { _id: "task_ref", refId: "ABC-5", name: "Bare ref task" } },
        {
          identifier: "contoso/OS-7",
          task: { _id: "task_scoped", refId: "OS-7", name: "Scoped ref task" },
        },
      ],
    });
  });

  test("returns per-item errors for all refs when project context is missing", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "get_tasks",
        arguments: {
          identifiers: ["ABC-5", "contoso/OS-7"],
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toMatchObject({
      results: [
        {
          identifier: "ABC-5",
          task: null,
          error:
            "projectId is required (provide it in tool arguments or via ?project= URL parameter)",
        },
        {
          identifier: "contoso/OS-7",
          task: null,
          error:
            "projectId is required (provide it in tool arguments or via ?project= URL parameter)",
        },
      ],
    });
  });
});

describe("handleMcpRequest task types", () => {
  test("lists built-in task types via list_task_types without DB query", async () => {
    const { ctx, runQuery } = createActionCtx([]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 901,
      method: "tools/call",
      params: {
        name: "list_task_types",
        arguments: {},
      },
    });

    expect(response?.error).toBeUndefined();
    const types = parseToolContentJson(response) as Array<{ key: string }>;
    expect(types.map((t) => t.key)).toEqual([
      "task", "bug", "feature", "epic", "investigation", "chore", "idea",
    ]);
    // No DB query needed — built-in types are static
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns invalid params for create_task when taskTypeKey is invalid", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    const runMutation = vi.fn();
    const ctx = {
      runQuery,
      runMutation,
    } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 902,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: {
          projectId: "project_123",
          name: "Implement task types",
          taskTypeKey: "unknown-type",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest get_task", () => {
  test("accepts a bare ref using scoped project context", async () => {
    // Catch-all mirrors real result shapes: comment listing returns a page.
    const runQuery = vi.fn().mockImplementation(async (query) => {
      const queryName = getFunctionName(query);
      if (queryName === "checks/checklists:getForTask") return null;
      return queryName === "tasks/comments:listByTask" ? EMPTY_PAGE : [];
    });
    runQuery
      .mockResolvedValueOnce({
        results: [
          {
            ref: "ABC-5",
            task: { _id: "task_1", refId: "ABC-5", name: "Fix login" },
          },
        ],
      })
      .mockResolvedValueOnce({ _id: "task_1", refId: "ABC-5", name: "Fix login" });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 29,
        method: "tools/call",
        params: {
          name: "get_task",
          arguments: {
            taskId: "ABC-5",
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenNthCalledWith(1, api.tasks.core.getByRefs, {
      refs: ["ABC-5"],
      projectId: "url_project_456",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toMatchObject({
      _id: "task_1",
      refId: "ABC-5",
      name: "Fix login",
    });
  });

  test("accepts a scoped ref with project context", async () => {
    // Catch-all mirrors real result shapes: comment listing returns a page.
    const runQuery = vi.fn().mockImplementation(async (query) => {
      const queryName = getFunctionName(query);
      if (queryName === "checks/checklists:getForTask") return null;
      return queryName === "tasks/comments:listByTask" ? EMPTY_PAGE : [];
    });
    runQuery
      .mockResolvedValueOnce({
        results: [
          {
            ref: "OS-7",
            task: { _id: "task_7", refId: "OS-7", name: "Scoped task" },
          },
        ],
      })
      .mockResolvedValueOnce({ _id: "task_7", refId: "OS-7", name: "Scoped task" });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 29.5,
      method: "tools/call",
      params: {
        name: "get_task",
        arguments: {
          taskId: "contoso/OS-7",
          projectId: "project_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toMatchObject({
      _id: "task_7",
      refId: "OS-7",
      name: "Scoped task",
    });
  });

  test("returns task enriched with artifact and file summaries", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "task_1",
        _creationTime: 50,
        projectId: "project_123",
        clientId: "client_1",
        refNumber: 5,
        refId: "ABC-5",
        name: "Fix login",
        description: "Rich detail",
        rank: "0|abc:",
        createdBy: "user_1",
        createdByName: "Alex",
        createdAt: 60,
        updatedAt: 70,
        assigneeId: "user_legacy",
        assigneeName: "Legacy User",
        assigneeAvatarUrl: null,
        tags: ["auth"],
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#64748b",
          isSystem: true,
        },
        isDeleted: false,
        isArchived: false,
      })
      .mockResolvedValueOnce([
        {
          _id: "artifact_1",
          taskId: "task_1",
          name: "Plan",
          fileName: "plan.md",
          source: "agent",
          createdAt: 100,
          updatedAt: 120,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: "attachment_1",
          taskId: "task_1",
          fileName: "design.png",
          fileSize: 2048,
          contentType: "image/png",
          uploadedAt: 300,
          url: "https://files.example/design.png",
        },
      ])
      .mockResolvedValueOnce({
        page: [
          {
            _id: "comment_1",
            taskId: "task_1",
            authorId: "user_2",
            authorName: "Sam",
            authorAvatarUrl: "https://avatars.example/sam.png",
            content: "Looks good to me",
            createdAt: 400,
            updatedAt: 420,
            isEdited: true,
            attachments: [],
            canEdit: true,
            canDelete: true,
          },
        ],
        isDone: true,
        continueCursor: "",
      })
      // listByParent (subtasks)
      .mockResolvedValueOnce([])
      // getForTask (project has no checklists)
      .mockResolvedValueOnce(null);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "get_task",
        arguments: {
          taskId: "task_1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    if (!response || !isRecord(response.result)) {
      throw new Error("Expected JSON-RPC result payload");
    }
    const content = response.result.content;
    if (!Array.isArray(content) || content.length < 1 || !isRecord(content[0])) {
      throw new Error("Expected MCP content array");
    }
    const text = content[0].text;
    if (typeof text !== "string") {
      throw new Error("Expected MCP content text");
    }

    expect(JSON.parse(text)).toEqual({
      _id: "task_1",
      refId: "ABC-5",
      name: "Fix login",
      description: "Rich detail",
      createdAt: 60,
      updatedAt: 70,
      tags: ["auth"],
      taskType: {
        key: "task",
        name: "Task",
      },
      artifacts: [
        {
          _id: "artifact_1",
          name: "Plan",
          contentType: "markdown",
          source: "agent",
          createdAt: 100,
          updatedAt: 120,
        },
      ],
      files: [
        {
          _id: "attachment_1",
          fileName: "design.png",
          fileSize: 2048,
          contentType: "image/png",
          uploadedAt: 300,
          url: "https://files.example/design.png",
        },
      ],
      comments: [
        {
          _id: "comment_1",
          authorId: "user_2",
          authorName: "Sam",
          content: "Looks good to me",
          createdAt: 400,
          updatedAt: 420,
          isEdited: true,
          attachments: [],
        },
      ],
      commentsHasMore: false,
      subtasks: [],
    });
  });

  test("returns subtasks with subtaskCount", async () => {
    const runQuery = vi
      .fn()
      // getById
      .mockResolvedValueOnce({ _id: "task_1", refId: "ABC-5", name: "Parent task" })
      // listTaskArtifactsByTask
      .mockResolvedValueOnce([])
      // listTaskAttachmentsByTask
      .mockResolvedValueOnce([])
      // listByTask (comments)
      .mockResolvedValueOnce({ page: [], isDone: true, continueCursor: "" })
      // listByParent (subtasks)
      .mockResolvedValueOnce([
        {
          _id: "subtask_1",
          refId: "ABC-6",
          name: "Child A",
          status: "To Do",
          priority: "Medium",
          assignee: {
            type: "user",
            userId: "user_1",
            name: "Alex",
            avatarUrl: null,
          },
          dueDate: null,
        },
        {
          _id: "subtask_2",
          refId: "ABC-7",
          name: "Child B",
          status: "Done",
          priority: "Low",
          assignee: null,
          dueDate: 1700000000000,
        },
      ])
      // getForTask (project has no checklists)
      .mockResolvedValueOnce(null)
      // countChildrenBatch
      .mockResolvedValueOnce([
        { parentId: "subtask_1", count: 3 },
        { parentId: "subtask_2", count: 0 },
      ]);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "get_task",
        arguments: {
          taskId: "task_1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    if (!response || !isRecord(response.result)) {
      throw new Error("Expected JSON-RPC result payload");
    }
    const content = response.result.content;
    if (!Array.isArray(content) || content.length < 1 || !isRecord(content[0])) {
      throw new Error("Expected MCP content array");
    }
    const text = content[0].text;
    if (typeof text !== "string") {
      throw new Error("Expected MCP content text");
    }

    const parsed = JSON.parse(text);
    expect(parsed.subtasks).toEqual([
      {
        _id: "subtask_1",
        refId: "ABC-6",
        name: "Child A",
        status: "To Do",
        priority: "Medium",
        assignee: {
          type: "user",
          userId: "user_1",
          name: "Alex",
          avatarUrl: null,
        },
        dueDate: null,
        subtaskCount: 3,
      },
      {
        _id: "subtask_2",
        refId: "ABC-7",
        name: "Child B",
        status: "Done",
        priority: "Low",
        assignee: null,
        dueDate: 1700000000000,
        subtaskCount: 0,
      },
    ]);
  });
});

describe("handleMcpRequest list_tasks", () => {
  test("returns MCP task summaries without internal or UI-only fields", async () => {
    const mockResult = [
      {
        _id: "task_1",
        _creationTime: 100,
        projectId: "project_123",
        parentId: null,
        clientId: "client_1",
        refNumber: 5,
        refId: "ABC-5",
        name: "Fix login",
        description: "Full detail only",
        list: {
          type: "list",
          id: "list_1",
          ref: "SPRINT-1",
          name: "Sprint 1",
        },
        priority: "High",
        dueDate: 123456,
        status: "To Do",
        assignee: {
          type: "user",
          userId: "user_1",
          name: "Alex",
          avatarUrl: "https://avatars.example/alex.png",
        },
        tags: ["auth"],
        rank: "0|abc:",
        createdBy: "user_2",
        createdByName: "Sam",
        createdAt: 200,
        updatedAt: 300,
        taskType: {
          key: "bug",
          name: "Bug",
          icon: "Bug",
          color: "#ef4444",
          isSystem: true,
        },
        isDeleted: false,
        isArchived: false,
      },
    ];
    const { ctx } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 30.5,
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: {
          projectId: "project_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual([
      {
        _id: "task_1",
        refId: "ABC-5",
        parentId: null,
        name: "Fix login",
        list: {
          type: "list",
          id: "list_1",
          ref: "SPRINT-1",
          name: "Sprint 1",
          isDefault: false,
        },
        status: "To Do",
        priority: "High",
        dueDate: 123456,
        assignee: {
          type: "user",
          userId: "user_1",
          name: "Alex",
        },
        tags: ["auth"],
        taskType: {
          key: "bug",
          name: "Bug",
        },
      },
    ]);
  });

  test("passes status through to listByProject", async () => {
    const mockResult = [{ _id: "task_1", name: "Task 1" }];
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: {
          projectId: "project_123",
          status: "Done",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.listByProject, {
      projectId: "project_123",
      archiveFilter: undefined,
      status: "Done",
      apiKey: "sk_user_test",
    });
  });

  test("passes listId directly to listByProject", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) => {
      const queryName = getFunctionName(query);
      if (queryName === "tasks/core:listByProject") {
        return [];
      }
      return null;
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 31.25,
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: {
          projectId: "project_123",
          listId: "SPRINT-1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.listByProject, {
      projectId: "project_123",
      archiveFilter: undefined,
      listId: "SPRINT-1",
      apiKey: "sk_user_test",
    });
  });

  test("passes Plan Review status through to listByProject", async () => {
    const mockResult = [{ _id: "task_1", name: "Task 1" }];
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 31.5,
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: {
          projectId: "project_123",
          status: "Plan Review",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.listByProject, {
      projectId: "project_123",
      archiveFilter: undefined,
      status: "Plan Review",
      apiKey: "sk_user_test",
    });
  });

  test("returns invalid params for legacy statuses values", async () => {
    const { ctx, runQuery } = createActionCtx([]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: {
          projectId: "project_123",
          statuses: ["Done"],
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("Use status instead of statuses");
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("returns invalid params for invalid status value", async () => {
    const { ctx, runQuery } = createActionCtx([]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: {
          projectId: "project_123",
          status: "Backlog",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest list_task_lists", () => {
  test("lists active project Lists with pagination defaults", async () => {
    const mockResult = {
      page: [
        {
          _id: "list_1",
          _creationTime: 10,
          projectId: "project_123",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 20,
          updatedAt: 30,
        },
      ],
      isDone: true,
      continueCursor: "",
    };
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "list_task_lists",
        arguments: {
          projectId: "project_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.lists.list, {
      projectId: "project_123",
      archived: false,
      paginationOpts: {
        numItems: 19,
        cursor: null,
      },
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      page: [
        {
          _id: "BACKLOG",
          type: "system",
          name: "Backlog",
          ref: "BACKLOG",
          isArchived: false,
          isDefault: false,
        },
        {
          _id: "list_1",
          type: "list",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          isDefault: false,
        },
      ],
      isDone: true,
      continueCursor: "",
    });
  });

  test("reports isDefault: true for the project default List", async () => {
    const mockResult = {
      page: [
        {
          _id: "list_inbox",
          _creationTime: 10,
          projectId: "project_123",
          name: "Inbox",
          ref: "INBOX",
          isArchived: false,
          isDefault: true,
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 20,
          updatedAt: 30,
        },
        {
          _id: "list_sprint",
          _creationTime: 11,
          projectId: "project_123",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          isDefault: false,
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 21,
          updatedAt: 31,
        },
      ],
      isDone: true,
      continueCursor: "",
    };
    const { ctx } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: {
        name: "list_task_lists",
        arguments: {
          projectId: "project_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({
      page: [
        {
          _id: "BACKLOG",
          type: "system",
          name: "Backlog",
          ref: "BACKLOG",
          isArchived: false,
          isDefault: false,
        },
        {
          _id: "list_inbox",
          type: "list",
          name: "Inbox",
          ref: "INBOX",
          isArchived: false,
          isDefault: true,
        },
        {
          _id: "list_sprint",
          type: "list",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          isDefault: false,
        },
      ],
      isDone: true,
      continueCursor: "",
    });
  });

  test("counts Backlog against the first active page limit", async () => {
    const mockResult = {
      page: [
        {
          _id: "list_1",
          _creationTime: 10,
          projectId: "project_123",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 20,
          updatedAt: 30,
        },
      ],
      isDone: false,
      continueCursor: "cursor_1",
    };
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: {
        name: "list_task_lists",
        arguments: {
          projectId: "project_123",
          limit: 2,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.lists.list, {
      projectId: "project_123",
      archived: false,
      paginationOpts: {
        numItems: 1,
        cursor: null,
      },
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      page: [
        {
          _id: "BACKLOG",
          type: "system",
          name: "Backlog",
          ref: "BACKLOG",
          isArchived: false,
          isDefault: false,
        },
        {
          _id: "list_1",
          type: "list",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          isDefault: false,
        },
      ],
      isDone: false,
      // More pages remain, so the cursor is marked to suppress Backlog on the
      // next page (exact encoding is an internal detail).
      continueCursor: expect.any(String),
    });
  });

  test("continues persisted Lists after a Backlog-only first page", async () => {
    const mockResult = {
      page: [
        {
          _id: "list_1",
          _creationTime: 10,
          projectId: "project_123",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 20,
          updatedAt: 30,
        },
      ],
      isDone: false,
      continueCursor: "cursor_1",
    };
    const { ctx, runQuery } = createActionCtx(mockResult);

    const firstResponse = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 44,
      method: "tools/call",
      params: {
        name: "list_task_lists",
        arguments: {
          projectId: "project_123",
          limit: 1,
        },
      },
    });
    const firstPage = parseToolContentJson(firstResponse) as {
      page: unknown[];
      isDone: boolean;
      continueCursor: string;
    };

    expect(firstPage).toEqual({
      page: [
        {
          _id: "BACKLOG",
          type: "system",
          name: "Backlog",
          ref: "BACKLOG",
          isArchived: false,
          isDefault: false,
        },
      ],
      isDone: false,
      continueCursor: expect.any(String),
    });

    runQuery.mockClear();
    const secondResponse = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 45,
      method: "tools/call",
      params: {
        name: "list_task_lists",
        arguments: {
          projectId: "project_123",
          limit: 1,
          cursor: firstPage.continueCursor,
        },
      },
    });

    expect(runQuery).toHaveBeenCalledWith(api.tasks.lists.list, {
      projectId: "project_123",
      archived: false,
      paginationOpts: {
        numItems: 1,
        cursor: null,
      },
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(secondResponse)).toEqual({
      page: [
        {
          _id: "list_1",
          type: "list",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          isDefault: false,
        },
      ],
      isDone: false,
      continueCursor: "cursor_1",
    });
  });

  test("does not re-emit Backlog on later pages when limit > 1", async () => {
    const firstPageResult = {
      page: [
        {
          _id: "list_1",
          _creationTime: 10,
          projectId: "project_123",
          name: "Sprint 1",
          ref: "SPRINT-1",
          isArchived: false,
          isDefault: false,
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 20,
          updatedAt: 30,
        },
      ],
      isDone: false,
      continueCursor: "cursor_1",
    };
    const secondPageResult = {
      page: [
        {
          _id: "list_2",
          _creationTime: 11,
          projectId: "project_123",
          name: "Sprint 2",
          ref: "SPRINT-2",
          isArchived: false,
          isDefault: false,
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 21,
          updatedAt: 31,
        },
      ],
      isDone: true,
      continueCursor: "",
    };
    const { ctx, runQuery } = createActionCtx(firstPageResult);

    const firstResponse = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 46,
      method: "tools/call",
      params: {
        name: "list_task_lists",
        arguments: {
          projectId: "project_123",
          limit: 2,
        },
      },
    });
    const firstPage = parseToolContentJson(firstResponse) as {
      page: Array<{ _id: string }>;
      isDone: boolean;
      continueCursor: string;
    };
    // First page leads with Backlog and the first persisted List.
    expect(firstPage.page.map((row) => row._id)).toEqual(["BACKLOG", "list_1"]);

    runQuery.mockClear();
    runQuery.mockResolvedValueOnce(secondPageResult);
    const secondResponse = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 47,
      method: "tools/call",
      params: {
        name: "list_task_lists",
        arguments: {
          projectId: "project_123",
          limit: 2,
          cursor: firstPage.continueCursor,
        },
      },
    });

    const secondPage = parseToolContentJson(secondResponse) as {
      page: Array<{ _id: string }>;
    };
    // The follow-up page must NOT repeat Backlog...
    expect(secondPage.page.map((row) => row._id)).toEqual(["list_2"]);
    // ...and should fetch the full limit from the persisted cursor (no slot
    // reserved for an already-shown Backlog).
    const secondCallArgs = runQuery.mock.calls[0]?.[1] as {
      paginationOpts: { numItems: number; cursor: string | null };
    };
    expect(secondCallArgs.paginationOpts).toEqual({ numItems: 2, cursor: "cursor_1" });
  });

  test("passes archived, query, limit, and cursor to taskLists.list", async () => {
    const { ctx, runQuery } = createActionCtx({
      page: [],
      isDone: true,
      continueCursor: "",
    });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: {
        name: "list_task_lists",
        arguments: {
          projectId: "project_123",
          archived: true,
          query: "sprint",
          limit: 10,
          cursor: "cursor_1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.lists.list, {
      projectId: "project_123",
      archived: true,
      query: "sprint",
      paginationOpts: {
        numItems: 10,
        cursor: "cursor_1",
      },
      apiKey: "sk_user_test",
    });
  });
});

// Rich task cards render only when the advertised server name matches the
// thread UI's detection pattern — a mismatch degrades silently (OS-1739).
describe("handleMcpRequest initialize serverInfo", () => {
  test("advertises a server name the thread UI detects as Convoy", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      { jsonrpc: "2.0", id: 0, method: "initialize" },
      BASE_URL
    );

    const result = response?.result;
    const serverInfo = isRecord(result) ? result.serverInfo : undefined;
    const name = isRecord(serverInfo) ? serverInfo.name : undefined;

    expect(typeof name).toBe("string");
    expect(isConvoyMcpTool({ server: String(name), tool: "get_task" })).toBe(true);
  });
});

describe("handleMcpRequest URL-based default projectId", () => {
  const URL_PROJECT = {
    _id: "url_project_456",
    disabledStatuses: ["Blocked", "Plan Review"],
  };
  const DEFAULT_TASK = {
    _id: "task_123",
    projectId: "project_123",
    refId: "ABC-1",
    taskType: {
      key: "task",
      name: "Task",
      icon: "SquareCheckBig",
      color: "#64748b",
      isSystem: true,
    },
  };

  test("includes project-scoped allowed statuses in initialize", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(URL_PROJECT);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(response?.result).toMatchObject({
      projectContext: {
        projectId: "url_project_456",
        disabledTaskStatuses: ["Plan Review", "Blocked"],
        allowedTaskStatuses: [
          "To Do",
          "Triage",
          "Planning",
          "In Progress",
          "In Review",
          "Done",
          "Canceled",
        ],
        taskTypeKeys: ["task", "bug", "feature", "epic", "investigation", "chore", "idea"],
      },
    });
    expect(runQuery).toHaveBeenCalledWith(api.projects.core.getById, {
      id: "url_project_456",
      apiKey: "sk_user_test",
    });
  });

  // docs/specs/cli-thread-message-links.md
  test("teaches the task link format with the project's URL prefix in initialize", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "org_1", slug: "acme" })
      .mockResolvedValueOnce(URL_PROJECT);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;
    const initialize = (project: string) =>
      handleMcpRequest(ctx, "sk_user_test", { jsonrpc: "2.0", id: 0, method: "initialize" }, `${BASE_URL}?project=${project}`);

    const scoped = await initialize("acme/WEB");
    const instructions = (scoped?.result as { instructions?: string }).instructions;
    expect(instructions).toContain(`[Task title](${getAppUrlBase()}/o/acme/WEB?task=WEB-123 "type=bug; status=In Progress")`);
    expect(instructions).toContain(`?task=WEB-123&artifact=ARTIFACT_ID "type=md")`);
    expect(runQuery).toHaveBeenCalledTimes(2);

    runQuery.mockResolvedValueOnce(URL_PROJECT);
    const byId = await initialize("url_project_456");
    expect((byId?.result as { instructions?: string }).instructions).not.toContain("?task=");
  });

  test("narrows create and update status enums in tools/list for scoped projects", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(URL_PROJECT);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "tools",
        method: "tools/list",
      },
      `${BASE_URL}?project=url_project_456`
    );

    const result = response?.result;
    expect(response?.error).toBeUndefined();
    expect(isRecord(result)).toBe(true);
    const tools = Array.isArray((result as Record<string, unknown>).tools)
      ? ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>)
      : [];
    const createStatus = getToolSchemaProperty(tools, "create_task", "status");
    const updateStatus = getToolSchemaProperty(tools, "update_task", "status");
    const createTaskTypeKey = getToolSchemaProperty(tools, "create_task", "taskTypeKey");
    const updateTaskTypeKey = getToolSchemaProperty(tools, "update_task", "taskTypeKey");

    expect(isRecord(createStatus)).toBe(true);
    expect((createStatus as { enum?: string[] }).enum).toEqual([
      "To Do",
      "Triage",
      "Planning",
      "In Progress",
      "In Review",
      "Done",
      "Canceled",
    ]);
    expect(isRecord(updateStatus)).toBe(true);
    expect((updateStatus as { enum?: string[] }).enum).toEqual([
      "To Do",
      "Triage",
      "Planning",
      "In Progress",
      "In Review",
      "Done",
      "Canceled",
    ]);
    expect(isRecord(createTaskTypeKey)).toBe(true);
    expect((createTaskTypeKey as { enum?: string[] }).enum).toEqual([
      "task", "bug", "feature", "epic", "investigation", "chore", "idea",
    ]);
    expect(isRecord(updateTaskTypeKey)).toBe(true);
    expect(
      updateTaskTypeKey as { type?: Array<string>; enum?: Array<string | null> }
    ).toEqual({
      type: ["string", "null"],
      enum: ["task", "bug", "feature", "epic", "investigation", "chore", "idea", null],
      description: "New task type key (pass null to reset to the default 'task' type)",
    });
  });

  test("initialize returns invalidParams for an out-of-scope default project", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce(null);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "init-out-of-scope",
        method: "initialize",
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("outside API key scope");
    expect(runQuery).toHaveBeenCalledWith(api.projects.core.getById, {
      id: "url_project_456",
      apiKey: "sk_user_test",
    });
  });

  test("tools/list returns invalidParams for an out-of-scope default project", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce(null);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "tools-out-of-scope",
        method: "tools/list",
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("outside API key scope");
    expect(runQuery).toHaveBeenCalledWith(api.projects.core.getById, {
      id: "url_project_456",
      apiKey: "sk_user_test",
    });
  });

  test("list_projects delegates to scoped project discovery with apiKey", async () => {
    const scopedProjects = [{ _id: "project_allowed", name: "Allowed" }];
    const runQuery = vi.fn().mockResolvedValueOnce(scopedProjects);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-projects",
      method: "tools/call",
      params: {
        name: "list_projects",
        arguments: {},
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual(scopedProjects);
    expect(runQuery).toHaveBeenCalledWith(api.projects.core.listAccessible, {
      apiKey: "sk_user_test",
    });
  });

  test("default-project task tools fail closed when org/alias is outside scope", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "org_123", slug: "acme" })
      .mockResolvedValueOnce(null);
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "default-tool-out-of-scope",
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {},
        },
      },
      `${BASE_URL}?project=acme/WEB`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("WEB");
    expect(runQuery).toHaveBeenCalledWith(api.organizations.core.getBySlug, {
      slug: "acme",
      apiKey: "sk_user_test",
    });
    expect(runQuery).toHaveBeenCalledWith(api.projects.core.getByAlias, {
      organizationId: "org_123",
      alias: "WEB",
      apiKey: "sk_user_test",
    });
    expect(
      runQuery.mock.calls.some(
        ([query]) => getFunctionName(query) === "tasks/core:listByProject"
      )
    ).toBe(false);
  });

  test("uses URL project when tool arg omitted (list_tasks)", async () => {
    const mockResult = [{ _id: "task_1", name: "Task 1" }];
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {},
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(
      api.tasks.core.listByProject,
      expect.objectContaining({ projectId: "url_project_456" })
    );
  });

  test("uses URL project when tool arg omitted (create_task)", async () => {
    const mockResult = { _id: "task_new" };
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: { name: "New task" },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.objectContaining({ projectId: "url_project_456" })
    );
  });

  test("create_task returns structured URL metadata object", async () => {
    const previousBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
    try {
      process.env.NEXT_PUBLIC_APP_URL = "https://app.convoy.build";

      const runMutation = vi.fn().mockResolvedValue({
        taskId: "task_new_id",
        projectId: "project_123",
        organizationId: "org_123",
        projectAlias: "OS",
        refNumber: 542,
        refId: "OS-542",
      });
      const runQuery = vi.fn().mockResolvedValueOnce({
        _id: "org_123",
        slug: "contoso",
      });
      const ctx = { runQuery, runMutation } as unknown as ActionCtx;

      const response = await handleMcpRequest(ctx, "sk_user_test", {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            projectId: "project_123",
            name: "New task",
          },
        },
      });

      expect(response?.error).toBeUndefined();
      expect(runQuery).toHaveBeenCalledWith(
        internal.organizations.core.getByIdInternal,
        {
          id: "org_123",
        }
      );
      expect(
        runQuery.mock.calls.some(
          ([query]) => getFunctionName(query) === "projects:listAccessible"
        )
      ).toBe(false);
      expect(parseToolContentJson(response)).toEqual({
        taskId: "task_new_id",
        refId: "OS-542",
        taskPath: "/o/contoso/OS?task=OS-542",
        taskUrl: "https://app.convoy.build/o/contoso/OS?task=OS-542",
      });
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_APP_URL;
      } else {
        process.env.NEXT_PUBLIC_APP_URL = previousBaseUrl;
      }
    }
  });

  test("create_task trims trailing slash from NEXT_PUBLIC_APP_URL", async () => {
    const previousBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
    try {
      process.env.NEXT_PUBLIC_APP_URL = "https://app.convoy.build/";

      const runMutation = vi.fn().mockResolvedValue({
        taskId: "task_new_id",
        projectId: "project_123",
        organizationId: "org_123",
        projectAlias: "OS",
        refNumber: 542,
        refId: "OS-542",
      });
      const runQuery = vi.fn().mockResolvedValueOnce({
        _id: "org_123",
        slug: "contoso",
      });
      const ctx = { runQuery, runMutation } as unknown as ActionCtx;

      const response = await handleMcpRequest(ctx, "sk_user_test", {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            projectId: "project_123",
            name: "New task",
          },
        },
      });

      expect(response?.error).toBeUndefined();
      expect(runQuery).toHaveBeenCalledWith(
        internal.organizations.core.getByIdInternal,
        {
          id: "org_123",
        }
      );
      expect(parseToolContentJson(response)).toEqual({
        taskId: "task_new_id",
        refId: "OS-542",
        taskPath: "/o/contoso/OS?task=OS-542",
        taskUrl: "https://app.convoy.build/o/contoso/OS?task=OS-542",
      });
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_APP_URL;
      } else {
        process.env.NEXT_PUBLIC_APP_URL = previousBaseUrl;
      }
    }
  });

  test("create_task treats missing organization metadata as an invariant failure", async () => {
    const previousBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
    try {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const runMutation = vi.fn().mockResolvedValue({
        taskId: "task_new_id",
        projectId: "project_123",
        organizationId: "org_123",
        projectAlias: "OS",
        refNumber: 542,
        refId: "OS-542",
      });
      const runQuery = vi.fn().mockResolvedValueOnce(null);
      const ctx = { runQuery, runMutation } as unknown as ActionCtx;

      const response = await handleMcpRequest(ctx, "sk_user_test", {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            projectId: "project_123",
            name: "New task",
          },
        },
      });

      expect(runQuery).toHaveBeenCalledWith(
        internal.organizations.core.getByIdInternal,
        {
          id: "org_123",
        }
      );
      expect(response?.error?.code).toBe(-32603);
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_APP_URL;
      } else {
        process.env.NEXT_PUBLIC_APP_URL = previousBaseUrl;
      }
    }
  });

  test("normalizes markdown description for create_task", async () => {
    const mockResult = { _id: "task_new" };
    const { ctx, runMutation } = createActionCtx(mockResult);
    const markdown = "# Summary\n\n- first\n- second";

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: {
          projectId: "project_123",
          name: "New task",
          description: markdown,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const createArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(createArgs).toMatchObject({
      projectId: "project_123",
      name: "New task",
      apiKey: "sk_user_test",
    });
    expect(typeof createArgs.description).toBe("string");

    const parsed = JSON.parse(String(createArgs.description)) as {
      type?: string;
      content?: Array<{ type?: string }>;
    };
    expect(parsed.type).toBe("doc");
    expect(parsed.content?.[0]?.type).toBe("heading");
  });

  test("passes through proseMirror JSON description for create_task", async () => {
    const mockResult = { _id: "task_new" };
    const { ctx, runMutation } = createActionCtx(mockResult);
    const proseMirrorJson = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Already normalized" }] }],
    });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: {
          projectId: "project_123",
          name: "New task",
          description: proseMirrorJson,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const createArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(createArgs.description).toBe(proseMirrorJson);
  });

  test("resolves create_task parentId refs before mutation", async () => {
    const runMutation = vi.fn().mockResolvedValue({
      taskId: "task_new_id",
      projectId: "url_project_456",
      organizationId: "org_123",
      projectAlias: "ABC",
      refNumber: 6,
      refId: "ABC-6",
    });
    const runQuery = vi.fn().mockResolvedValue([]);
    runQuery
      .mockResolvedValueOnce({
        results: [
          {
            ref: "ABC-5",
            task: { _id: "task_parent_123", refId: "ABC-5" },
          },
        ],
      })
      .mockResolvedValueOnce({
        _id: "org_123",
        slug: "contoso",
      });
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 22.5,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            name: "New subtask",
            parentId: "ABC-5",
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.objectContaining({
        projectId: "url_project_456",
        parentId: "task_parent_123",
      })
    );
  });

  test("passes create_task listId directly to mutation", async () => {
    const runMutation = vi.fn().mockResolvedValue({
      taskId: "task_new_id",
      projectId: "project_123",
      organizationId: "org_123",
      projectAlias: "OS",
      refNumber: 542,
      refId: "OS-542",
    });
    const runQuery = vi.fn().mockResolvedValueOnce({
      _id: "org_123",
      slug: "contoso",
    });
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 22.75,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: {
          projectId: "project_123",
          name: "New task",
          listId: "SPRINT-1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      api.tasks.core.create,
      expect.objectContaining({
        projectId: "project_123",
        name: "New task",
        listId: "SPRINT-1",
        apiKey: "sk_user_test",
      })
    );
  });

  test("rejects the removed create_task assignee param", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 22.8,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: {
          projectId: "project_123",
          name: "New task",
          assignee: { type: "user", userId: "user_123" },
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain(
      "assignee is no longer supported; use assigneeId (user) and/or delegatedToAgentId (agent)"
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("normalizes markdown description for update_task", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(null);
    runQuery.mockResolvedValueOnce(DEFAULT_TASK);
    const markdown = "## Notes\n\n**bold** text";

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "update_task",
        arguments: {
          taskId: "task_123",
          description: markdown,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const updateArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateArgs).toMatchObject({
      id: "task_123",
      apiKey: "sk_user_test",
    });
    expect(typeof updateArgs.description).toBe("string");

    const parsed = JSON.parse(String(updateArgs.description)) as {
      type?: string;
      content?: Array<{ type?: string }>;
    };
    expect(parsed.type).toBe("doc");
    expect(parsed.content?.[0]?.type).toBe("heading");
  });

  test("passes through proseMirror JSON description for update_task", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(null);
    runQuery.mockResolvedValueOnce(DEFAULT_TASK);
    const proseMirrorJson = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Already normalized" }] }],
    });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "update_task",
        arguments: {
          taskId: "task_123",
          description: proseMirrorJson,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const updateArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateArgs.description).toBe(proseMirrorJson);
  });

  test("passes null through for update_task description clear", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(null);
    runQuery.mockResolvedValueOnce(DEFAULT_TASK);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "update_task",
        arguments: {
          taskId: "task_123",
          description: null,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const updateArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateArgs.description).toBeNull();
  });

  test("rejects the removed update_task assignee param", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(null);
    runQuery.mockResolvedValueOnce(DEFAULT_TASK);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 32.2,
      method: "tools/call",
      params: {
        name: "update_task",
        arguments: {
          taskId: "task_123",
          assignee: null,
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain(
      "assignee is no longer supported; use assigneeId (user) and/or delegatedToAgentId (agent)"
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("passes update_task split assignment params through", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(null);
    runQuery.mockResolvedValueOnce(DEFAULT_TASK);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 32.3,
      method: "tools/call",
      params: {
        name: "update_task",
        arguments: {
          taskId: "task_123",
          assigneeId: null,
          delegatedToAgentId: "agent_789",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      api.tasks.core.update,
      expect.objectContaining({
        assigneeId: null,
        delegatedToAgentId: "agent_789",
      })
    );
  });

  test("resolves update_task taskId refs before update", async () => {
    const runQuery = vi.fn().mockResolvedValue(DEFAULT_TASK);
    runQuery.mockResolvedValueOnce({
      results: [
        {
          ref: "ABC-5",
          task: { _id: "task_123", refId: "ABC-5" },
        },
      ],
    });
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 32.5,
        method: "tools/call",
        params: {
          name: "update_task",
          arguments: {
            taskId: "ABC-5",
            name: "Updated",
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      api.tasks.core.update,
      expect.objectContaining({
        id: "task_123",
        name: "Updated",
      })
    );
  });

  test("move_task passes raw ids through without rank", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "move_task",
        arguments: {
          taskId: "task_123",
          parentId: "task_parent_456",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.move.toParent, {
      id: "task_123",
      parentId: "task_parent_456",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      taskId: "task_123",
      parentId: "task_parent_456",
    });
  });

  test("move_task resolves bare refs using scoped project context", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            ref: "OS-667",
            task: { _id: "task_123", refId: "OS-667" },
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            ref: "OS-100",
            task: { _id: "task_parent_456", refId: "OS-100" },
          },
        ],
      });
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 34,
        method: "tools/call",
        params: {
          name: "move_task",
          arguments: {
            taskId: "OS-667",
            parentId: "OS-100",
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenNthCalledWith(1, api.tasks.core.getByRefs, {
      refs: ["OS-667"],
      projectId: "url_project_456",
      apiKey: "sk_user_test",
    });
    expect(runQuery).toHaveBeenNthCalledWith(2, api.tasks.core.getByRefs, {
      refs: ["OS-100"],
      projectId: "url_project_456",
      apiKey: "sk_user_test",
    });
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.move.toParent, {
      id: "task_123",
      parentId: "task_parent_456",
      apiKey: "sk_user_test",
    });
  });

  test("move_task resolves scoped ref with project context and supports top-level moves", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            ref: "OS-667",
            task: { _id: "task_123", refId: "OS-667" },
          },
        ],
      });
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 35,
      method: "tools/call",
      params: {
        name: "move_task",
        arguments: {
          taskId: "contoso/OS-667",
          parentId: null,
          projectId: "project_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery.mock.calls.map(([query]) => getFunctionName(query))).toEqual([
      "tasks/core:getByRefs",
    ]);
    expect(runQuery.mock.calls[0]?.[1]).toEqual({
      refs: ["OS-667"],
      projectId: "project_123",
      apiKey: "sk_user_test",
    });
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.move.toParent, {
      id: "task_123",
      parentId: null,
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      taskId: "task_123",
      parentId: null,
    });
  });

  test("move_tasks_to_list resolves task refs and passes List identifiers", async () => {
    const runQuery = vi.fn().mockImplementation(async (query) => {
      const queryName = getFunctionName(query);
      if (queryName === "tasks/core:getByRefs") {
        return {
          results: [
            {
              ref: "OS-667",
              task: { _id: "task_123", refId: "OS-667" },
            },
            {
              ref: "OS-668",
              task: { _id: "task_456", refId: "OS-668" },
            },
          ],
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue({
      taskIds: ["task_123", "task_456"],
      list: {
        id: "list_1",
        ref: "SPRINT-1",
        name: "Sprint 1",
        isDefault: false,
      },
    });
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 35.5,
      method: "tools/call",
      params: {
        name: "move_tasks_to_list",
        arguments: {
          projectId: "project_123",
          taskIds: ["OS-667", "OS-668"],
          listId: "SPRINT-1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.getByRefs, {
      refs: ["OS-667", "OS-668"],
      projectId: "project_123",
      apiKey: "sk_user_test",
    });
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.move.toList, {
      rootIds: ["task_123", "task_456"],
      listId: "SPRINT-1",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      taskIds: ["task_123", "task_456"],
      list: {
        id: "list_1",
        ref: "SPRINT-1",
        name: "Sprint 1",
        isDefault: false,
      },
    });
  });

  test("rejects scoped List refs in task operations", async () => {
    // List-identifier grammar is validated by the tasks domain
    // (resolveOptionalProjectTaskList); the router maps the ConvexError to
    // JSON-RPC invalid params.
    const runQuery = vi.fn().mockResolvedValue({
      results: [
        {
          ref: "OS-667",
          task: { _id: "task_123", refId: "OS-667", name: "Fix login" },
        },
      ],
    });
    const runMutation = vi
      .fn()
      .mockRejectedValue(new ConvexError("listId must be a raw List ID or bare List ref"));
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 35.75,
      method: "tools/call",
      params: {
        name: "move_tasks_to_list",
        arguments: {
          projectId: "project_123",
          taskIds: ["OS-667"],
          listId: "OTHER/SPRINT-1",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("bare List ref");
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.move.toList, {
      rootIds: ["task_123"],
      listId: "OTHER/SPRINT-1",
      apiKey: "sk_user_test",
    });
  });

  test("move_task errors when bare refs lack project context", async () => {
    const { ctx, runQuery } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 36,
      method: "tools/call",
      params: {
        name: "move_task",
        arguments: {
          taskId: "OS-667",
          parentId: null,
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("move_task errors when refs are unknown", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce({
      results: [
        {
          ref: "OS-667",
          task: null,
        },
      ],
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 37,
        method: "tools/call",
        params: {
          name: "move_task",
          arguments: {
            taskId: "OS-667",
            parentId: null,
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("OS-667");
  });

  test("move_task errors on malformed scoped identifiers", async () => {
    const { ctx, runQuery } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 38,
      method: "tools/call",
      params: {
        name: "move_task",
        arguments: {
          taskId: "bad/ref/extra",
          parentId: null,
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("uses URL project when tool arg omitted (search_tasks)", async () => {
    const mockResult = EMPTY_PAGE;
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "search_tasks",
          arguments: { query: "auth" },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(
      api.tasks.core.search.byProject,
      expect.objectContaining({ projectId: "url_project_456" })
    );
  });

  test("uses URL project when tool arg omitted (get_tasks)", async () => {
    const mockResult = { results: [{ ref: "ABC-5", task: null }] };
    const runQuery = vi.fn().mockImplementation(async (query, args) => {
      const queryName = getFunctionName(query);

      if (queryName === "tasks/core:getByRefs") {
        expect(args).toEqual({
          refs: ["ABC-5"],
          projectId: "url_project_456",
          apiKey: "sk_user_test",
        });
        return mockResult;
      }

      return null;
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "get_tasks",
          arguments: { identifiers: ["ABC-5"] },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
  });

  test("explicit tool arg overrides URL default", async () => {
    const mockResult = [{ _id: "task_1", name: "Task 1" }];
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: { projectId: "explicit_project_789" },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(
      api.tasks.core.listByProject,
      expect.objectContaining({ projectId: "explicit_project_789" })
    );
  });

  test("errors when neither tool arg nor URL provides projectId", async () => {
    const { ctx, runQuery } = createActionCtx(null);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {},
        },
      },
      BASE_URL
    );

    expect(response?.error?.code).toBe(-32602);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("uses raw Convex ID directly when project param has no slash", async () => {
    const mockResult = [{ _id: "task_1", name: "Task 1" }];
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {},
        },
      },
      `${BASE_URL}?project=j97b0k1mhcjfpzr11s7gnd2s5h72gk0k`
    );

    expect(response?.error).toBeUndefined();
    // Should NOT call getBySlug or getByAlias — raw ID used directly
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(
      api.tasks.core.listByProject,
      expect.objectContaining({ projectId: "j97b0k1mhcjfpzr11s7gnd2s5h72gk0k" })
    );
  });

  test("resolves org-slug/ALIAS format to project ID", async () => {
    const mockTaskResult = [{ _id: "task_1", name: "Task 1" }];
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "org_123", slug: "acme" }) // getBySlug
      .mockResolvedValueOnce({ _id: "resolved_project_id", alias: "WEB" }) // getByAlias
      .mockResolvedValueOnce(mockTaskResult); // listByProject
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {},
        },
      },
      `${BASE_URL}?project=acme/WEB`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.organizations.core.getBySlug, { slug: "acme", apiKey: "sk_user_test" });
    expect(runQuery).toHaveBeenCalledWith(api.projects.core.getByAlias, {
      organizationId: "org_123",
      alias: "WEB",
      apiKey: "sk_user_test",
    });
    expect(runQuery).toHaveBeenCalledWith(
      api.tasks.core.listByProject,
      expect.objectContaining({ projectId: "resolved_project_id" })
    );
  });

  test("errors when org slug is not found in org-slug/ALIAS format", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null); // getBySlug returns null
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {},
        },
      },
      `${BASE_URL}?project=bad-org/WEB`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("bad-org");
  });

  test("errors when project alias is not found in org-slug/ALIAS format", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ _id: "org_123", slug: "acme" }) // getBySlug
      .mockResolvedValueOnce(null); // getByAlias returns null
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {},
        },
      },
      `${BASE_URL}?project=acme/BAD`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("BAD");
    expect(response?.error?.message).toContain("acme");
  });

  test("explicit tool arg overrides org-slug/ALIAS URL default", async () => {
    const mockResult = [{ _id: "task_1", name: "Task 1" }];
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: { projectId: "explicit_project_789" },
        },
      },
      `${BASE_URL}?project=acme/WEB`
    );

    expect(response?.error).toBeUndefined();
    // Should only call listByProject — no org/alias resolution needed
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(
      api.tasks.core.listByProject,
      expect.objectContaining({ projectId: "explicit_project_789" })
    );
  });

  test("returns invalidParams when raw project ID causes a Convex ID error", async () => {
    const runQuery = vi
      .fn()
      .mockRejectedValueOnce(new Error('is not a valid ID for table "projects"'));
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {},
        },
      },
      `${BASE_URL}?project=not-a-valid-convex-id`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("not a valid ID");
  });

  test("create_task does not pass rank to mutation (server generates it)", async () => {
    const mockResult = { _id: "task_new" };
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: { name: "New task", projectId: "project_123" },
        },
      }
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    const callArgs = runMutation.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("rank");
  });
});

describe("handleMcpRequest artifact tools", () => {
  test("list_task_artifacts calls listTaskArtifactsByTask with apiKey", async () => {
    const mockResult = [{ _id: "artifact_1", name: "Plan" }];
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "list_task_artifacts",
        arguments: {
          taskId: "task_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.artifacts.listTaskArtifactsByTask, {
      taskId: "task_123",
      apiKey: "sk_user_test",
    });
  });

  test("list_task_artifacts resolves task refs before querying artifacts", async () => {
    const runQuery = vi.fn().mockResolvedValue([{ _id: "artifact_1", name: "Plan" }]);
    runQuery.mockResolvedValueOnce({
      results: [
        {
          ref: "ABC-5",
          task: { _id: "task_123", refId: "ABC-5" },
        },
      ],
    });
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 20.5,
        method: "tools/call",
        params: {
          name: "list_task_artifacts",
          arguments: {
            taskId: "ABC-5",
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenNthCalledWith(2, api.tasks.artifacts.listTaskArtifactsByTask, {
      taskId: "task_123",
      apiKey: "sk_user_test",
    });
  });

  test("get_task_artifact calls getTaskArtifact with apiKey", async () => {
    const mockResult = { _id: "artifact_1", name: "Plan", content: "# Plan" };
    const { ctx, runQuery } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "get_task_artifact",
        arguments: {
          artifactId: "artifact_1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.artifacts.getTaskArtifact, {
      artifactId: "artifact_1",
      apiKey: "sk_user_test",
    });
  });

  test("create_task_artifact calls createTaskArtifact with optional fields", async () => {
    const mockResult = "artifact_new";
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "create_task_artifact",
        arguments: {
          taskId: "task_123",
          name: "Implementation Plan",
          content: "# Plan",
          runId: "run_123",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.createTaskArtifact, {
      taskId: "task_123",
      name: "Implementation Plan",
      content: "# Plan",
      runId: "run_123",
      apiKey: "sk_user_test",
    });
  });

  test("create_task_artifact passes contentType through to the mutation", async () => {
    const mockResult = "artifact_new";
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 22.1,
      method: "tools/call",
      params: {
        name: "create_task_artifact",
        arguments: {
          taskId: "task_123",
          name: "Dashboard Preview",
          content: "<!doctype html><html><body>Hi</body></html>",
          contentType: "html",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.createTaskArtifact, {
      taskId: "task_123",
      name: "Dashboard Preview",
      content: "<!doctype html><html><body>Hi</body></html>",
      contentType: "html",
      apiKey: "sk_user_test",
    });
  });

  test("create_task_artifact rejects unknown contentType values", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 22.2,
      method: "tools/call",
      params: {
        name: "create_task_artifact",
        arguments: {
          taskId: "task_123",
          name: "Bad Type",
          contentType: "pdf",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("create_task_artifact resolves task refs before mutation", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    runQuery.mockResolvedValueOnce({
      results: [
        {
          ref: "ABC-5",
          task: { _id: "task_123", refId: "ABC-5" },
        },
      ],
    });
    const runMutation = vi.fn().mockResolvedValue("artifact_new");
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 22.5,
        method: "tools/call",
        params: {
          name: "create_task_artifact",
          arguments: {
            taskId: "ABC-5",
            name: "Implementation Plan",
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.createTaskArtifact, {
      taskId: "task_123",
      name: "Implementation Plan",
      apiKey: "sk_user_test",
    });
  });

  test("update_task_artifact calls updateTaskArtifact with apiKey", async () => {
    const mockResult = null;
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "update_task_artifact",
        arguments: {
          artifactId: "artifact_1",
          name: "Updated Name",
          content: "Updated",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.updateTaskArtifact, {
      artifactId: "artifact_1",
      name: "Updated Name",
      content: "Updated",
      apiKey: "sk_user_test",
    });
  });

  test("update_task_artifact allows runId null to clear provenance", async () => {
    const mockResult = null;
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "update_task_artifact",
        arguments: {
          artifactId: "artifact_1",
          runId: null,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.updateTaskArtifact, {
      artifactId: "artifact_1",
      runId: null,
      apiKey: "sk_user_test",
    });
  });

  test("replace_in_task_artifact calls replaceInTaskArtifact with replaceAll default false", async () => {
    const mockResult = { ok: true };
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 23.25,
      method: "tools/call",
      params: {
        name: "replace_in_task_artifact",
        arguments: {
          artifactId: "artifact_1",
          oldString: "old",
          newString: "new",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.replaceInTaskArtifact, {
      artifactId: "artifact_1",
      oldString: "old",
      newString: "new",
      replaceAll: false,
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({ ok: true });
  });

  test("replace_in_task_artifact forwards replaceAll true", async () => {
    const mockResult = { ok: true };
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 23.5,
      method: "tools/call",
      params: {
        name: "replace_in_task_artifact",
        arguments: {
          artifactId: "artifact_1",
          oldString: "old",
          newString: "",
          replaceAll: true,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.replaceInTaskArtifact, {
      artifactId: "artifact_1",
      oldString: "old",
      newString: "",
      replaceAll: true,
      apiKey: "sk_user_test",
    });
  });

  test("replace_in_task_artifact returns MCP tool error for expected content failures", async () => {
    const mockResult = {
      ok: false,
      code: "multiple_matches",
      message:
        "oldString matches multiple locations; pass replaceAll to replace every occurrence",
    };
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 23.6,
      method: "tools/call",
      params: {
        name: "replace_in_task_artifact",
        arguments: {
          artifactId: "artifact_1",
          oldString: "old",
          newString: "new",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(response?.result).toMatchObject({ isError: true });
    expect(parseToolContentJson(response)).toEqual(mockResult);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  test("replace_in_task_artifact rejects invalid artifact ID shapes before mutation", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 23.65,
      method: "tools/call",
      params: {
        name: "replace_in_task_artifact",
        arguments: {
          artifactId: "not an artifact id!",
          oldString: "old",
          newString: "new",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("replace_in_task_artifact rejects missing or empty oldString", async () => {
    const invalidArgs = [
      {
        artifactId: "artifact_1",
        newString: "new",
      },
      {
        artifactId: "artifact_1",
        oldString: "",
        newString: "new",
      },
    ];

    for (const args of invalidArgs) {
      const { ctx, runMutation } = createActionCtx(null);

      const response = await handleMcpRequest(ctx, "sk_user_test", {
        jsonrpc: "2.0",
        id: 23.75,
        method: "tools/call",
        params: {
          name: "replace_in_task_artifact",
          arguments: args,
        },
      });

      expect(response?.error?.code).toBe(-32602);
      expect(runMutation).not.toHaveBeenCalled();
    }
  });

  test("move_task_artifact resolves the target task ref before mutation", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    runQuery.mockResolvedValueOnce({
      results: [
        {
          ref: "ABC-9",
          task: { _id: "task_target", refId: "ABC-9" },
        },
      ],
    });
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 23.85,
        method: "tools/call",
        params: {
          name: "move_task_artifact",
          arguments: {
            artifactId: "artifact_1",
            taskId: "ABC-9",
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.moveTaskArtifact, {
      artifactId: "artifact_1",
      taskId: "task_target",
      apiKey: "sk_user_test",
    });
  });

  test("move_task_artifact resolves a ref via an explicit projectId with no URL default", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    runQuery.mockResolvedValueOnce({
      results: [{ ref: "ABC-9", task: { _id: "task_target", refId: "ABC-9" } }],
    });
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 23.86,
      method: "tools/call",
      params: {
        name: "move_task_artifact",
        arguments: {
          artifactId: "artifact_1",
          taskId: "ABC-9",
          projectId: "project_explicit",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.getByRefs, {
      refs: ["ABC-9"],
      projectId: "project_explicit",
      apiKey: "sk_user_test",
    });
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.moveTaskArtifact, {
      artifactId: "artifact_1",
      taskId: "task_target",
      apiKey: "sk_user_test",
    });
  });

  test("move_task_artifact rejects invalid artifact ID shapes before mutation", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 23.95,
      method: "tools/call",
      params: {
        name: "move_task_artifact",
        arguments: {
          artifactId: "not an artifact id!",
          taskId: "task_target",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("delete_task_artifact calls deleteTaskArtifact with apiKey", async () => {
    const mockResult = null;
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "delete_task_artifact",
        arguments: {
          artifactId: "artifact_1",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifacts.deleteTaskArtifact, {
      artifactId: "artifact_1",
      apiKey: "sk_user_test",
    });
  });

  test("returns invalid params when create_task_artifact is missing name", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: "create_task_artifact",
        arguments: {
          taskId: "task_123",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest create_task_comment", () => {
  test("calls taskComments.create with apiKey", async () => {
    const mockResult = "comment_new";
    const { ctx, runMutation } = createActionCtx(mockResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "create_task_comment",
        arguments: {
          taskId: "task_123",
          content: "  Looks good  ",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.comments.create, {
      taskId: "task_123",
      content: "Looks good",
      apiKey: "sk_user_test",
    });
  });

  test("resolves create_task_comment taskId refs before mutation", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    runQuery.mockResolvedValueOnce({
      results: [
        {
          ref: "ABC-5",
          task: { _id: "task_123", refId: "ABC-5" },
        },
      ],
    });
    const runMutation = vi.fn().mockResolvedValue("comment_new");
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: 40.5,
        method: "tools/call",
        params: {
          name: "create_task_comment",
          arguments: {
            taskId: "ABC-5",
            content: "Hello",
          },
        },
      },
      `${BASE_URL}?project=url_project_456`
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.comments.create, {
      taskId: "task_123",
      content: "Hello",
      apiKey: "sk_user_test",
    });
  });

  test("returns invalid params when taskId is missing", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: {
        name: "create_task_comment",
        arguments: {
          content: "Hello",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns invalid params when content is missing", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: {
        name: "create_task_comment",
        arguments: {
          taskId: "task_123",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns invalid params when content is whitespace-only", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: {
        name: "create_task_comment",
        arguments: {
          taskId: "task_123",
          content: "   ",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest update_task_link", () => {
  test("upsert passes the narrowed link payload to the mutation", async () => {
    const mutationResult = {
      taskId: "task_123",
      externalLinks: [
        {
          id: "github-pr-acme-app-12",
          kind: "pull_request",
          url: "https://github.com/acme/app/pull/12",
          title: "Add links",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const { ctx, runMutation } = createActionCtx(mutationResult);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: {
        name: "update_task_link",
        arguments: {
          taskId: "task_123",
          op: "upsert",
          id: "github-pr-acme-app-12",
          link: {
            kind: "pull_request",
            url: "https://github.com/acme/app/pull/12",
            title: "Add links",
          },
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.updateExternalLink, {
      taskId: "task_123",
      op: "upsert",
      id: "github-pr-acme-app-12",
      link: {
        kind: "pull_request",
        url: "https://github.com/acme/app/pull/12",
        title: "Add links",
      },
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual(mutationResult);
  });

  test("delete omits the link payload", async () => {
    const { ctx, runMutation } = createActionCtx({ taskId: "task_123", externalLinks: [] });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 51,
      method: "tools/call",
      params: {
        name: "update_task_link",
        arguments: {
          taskId: "task_123",
          op: "delete",
          id: "github-pr-acme-app-12",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.updateExternalLink, {
      taskId: "task_123",
      op: "delete",
      id: "github-pr-acme-app-12",
      apiKey: "sk_user_test",
    });
  });

  test("returns invalid params for an unknown op", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 52,
      method: "tools/call",
      params: {
        name: "update_task_link",
        arguments: {
          taskId: "task_123",
          op: "patch",
          id: "github-pr-acme-app-12",
          link: { kind: "url", url: "https://example.com" },
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns invalid params when op is missing", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 53,
      method: "tools/call",
      params: {
        name: "update_task_link",
        arguments: {
          taskId: "task_123",
          id: "github-pr-acme-app-12",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns invalid params for an unknown link kind", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 54,
      method: "tools/call",
      params: {
        name: "update_task_link",
        arguments: {
          taskId: "task_123",
          op: "upsert",
          id: "issue-1",
          link: { kind: "issue", url: "https://example.com" },
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns invalid params when a per-kind required field is missing", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 55,
      method: "tools/call",
      params: {
        name: "update_task_link",
        arguments: {
          taskId: "task_123",
          op: "upsert",
          id: "commit-1",
          link: { kind: "commit", title: "No sha" },
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest list_closed_tasks", () => {
  function callListClosed(ctx: ActionCtx, args: Record<string, unknown>) {
    return handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "closed",
      method: "tools/call",
      params: { name: "list_closed_tasks", arguments: { projectId: "project_123", ...args } },
    });
  }

  test("parses ISO bounds and returns summaries with closedAt", async () => {
    const { ctx, runQuery } = createActionCtx([
      { _id: "task_1", refId: "ABC-1", name: "Shipped", status: "Done", closedAt: 1793491200000, rank: "0|a:" },
    ]);

    const response = await callListClosed(ctx, {
      status: "Canceled",
      limit: 10,
      since: "2026-11-01",
      until: "2026-11-15T12:00:00Z",
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.core.listClosed, {
      projectId: "project_123",
      status: "Canceled",
      limit: 10,
      since: Date.UTC(2026, 10, 1),
      until: Date.UTC(2026, 10, 15, 12),
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual([
      { _id: "task_1", refId: "ABC-1", name: "Shipped", status: "Done", closedAt: 1793491200000 },
    ]);
  });

  test.each([
    [{ since: "last week" }, "since"],
    [{ status: "To Do" }, "status"],
    [{ limit: 500 }, "limit"],
  ])("rejects %o as invalid params", async (args, key) => {
    const { ctx, runQuery } = createActionCtx([]);

    const response = await callListClosed(ctx, args);

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain(key);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest list_tasks externalLinks", () => {
  const TASK_WITH_LINKS = {
    _id: "task_1",
    refId: "ABC-5",
    parentId: null,
    name: "Fix login",
    status: "To Do",
    priority: "High",
    dueDate: null,
    assignee: null,
    tags: [],
    taskType: { key: "task", name: "Task" },
    externalLinks: [
      {
        id: "commit-abcdef1",
        kind: "commit",
        sha: "abcdef1234",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };

  test("omits externalLinks from summaries by default", async () => {
    const { ctx } = createActionCtx([TASK_WITH_LINKS]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 56,
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: { projectId: "project_123" },
      },
    });

    expect(response?.error).toBeUndefined();
    const payload = parseToolContentJson(response) as Array<Record<string, unknown>>;
    expect(payload[0]).not.toHaveProperty("externalLinks");
  });

  test("includes externalLinks when includeLinks is true", async () => {
    const { ctx } = createActionCtx([TASK_WITH_LINKS]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 57,
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: { projectId: "project_123", includeLinks: true },
      },
    });

    expect(response?.error).toBeUndefined();
    const payload = parseToolContentJson(response) as Array<Record<string, unknown>>;
    expect(payload[0].externalLinks).toEqual(TASK_WITH_LINKS.externalLinks);
  });
});

describe("handleMcpRequest artifact comments", () => {
  const ROOT_COMMENT = {
    _id: "comment_root",
    _creationTime: 1,
    artifactId: "artifact_123",
    taskId: "task_123",
    authorId: "user_1",
    content: "Why before?",
    anchor: { text: "before launch", prefix: "p", suffix: "s", startOffset: 5, endOffset: 18 },
    status: "open",
    createdAt: 100,
    updatedAt: 100,
    isEdited: false,
    authorName: "Robin",
    authorAvatarUrl: null,
    canEdit: true,
    canDelete: true,
  };
  const REPLY_COMMENT = {
    ...ROOT_COMMENT,
    _id: "comment_reply",
    parentId: "comment_root",
    anchor: undefined,
    status: undefined,
    content: "Agreed",
    createdAt: 200,
  };

  test("tools/list advertises the artifact comment tools", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "artifact-comment-tools",
      method: "tools/list",
    });

    const result = response?.result;
    const tools = Array.isArray((result as Record<string, unknown>).tools)
      ? ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>)
      : [];
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_artifact_comments",
        "create_artifact_comment",
        "reply_to_artifact_comment",
        "set_artifact_comment_status",
      ])
    );
    expect(getToolSchemaProperty(tools, "get_task_artifact", "includeComments")).toMatchObject({
      type: "boolean",
    });
  });

  test("list_artifact_comments groups replies under their root", async () => {
    const { ctx, runQuery } = createActionCtx([ROOT_COMMENT, REPLY_COMMENT]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-artifact-comments",
      method: "tools/call",
      params: {
        name: "list_artifact_comments",
        arguments: { artifactId: "artifact_123", status: "open" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.artifactComments.listByArtifact, {
      artifactId: "artifact_123",
      status: "open",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      threads: [
        {
          commentId: "comment_root",
          status: "open",
          anchorText: "before launch",
          authorName: "Robin",
          content: "Why before?",
          createdAt: 100,
          isEdited: false,
          replies: [
            {
              commentId: "comment_reply",
              authorName: "Robin",
              content: "Agreed",
              createdAt: 200,
              isEdited: false,
            },
          ],
        },
      ],
    });
  });

  test("get_task_artifact merges comment threads when includeComments is true", async () => {
    const { ctx, runQuery } = createActionCtx(null);
    runQuery
      .mockResolvedValueOnce({ _id: "artifact_123", name: "Plan", content: "body" })
      .mockResolvedValueOnce([ROOT_COMMENT]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "get-artifact-with-comments",
      method: "tools/call",
      params: {
        name: "get_task_artifact",
        arguments: { artifactId: "artifact_123", includeComments: true, commentsStatus: "open" },
      },
    });

    expect(response?.error).toBeUndefined();
    const payload = parseToolContentJson(response) as Record<string, unknown>;
    expect(payload.name).toBe("Plan");
    expect(Array.isArray(payload.comments)).toBe(true);
    expect((payload.comments as Array<Record<string, unknown>>)[0].commentId).toBe("comment_root");
  });

  test("create_artifact_comment passes anchorText and occurrence through", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce("comment_new");

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-artifact-comment",
      method: "tools/call",
      params: {
        name: "create_artifact_comment",
        arguments: {
          artifactId: "artifact_123",
          content: "Needs work",
          anchorText: "rollout",
          occurrence: 2,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ commentId: "comment_new" });
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifactComments.create, {
      artifactId: "artifact_123",
      content: "Needs work",
      anchorText: "rollout",
      anchorOccurrence: 2,
      apiKey: "sk_user_test",
    });
  });

  test("reply_to_artifact_comment maps commentId to parentId", async () => {
    const { ctx, runMutation } = createActionCtx(null);
    runMutation.mockResolvedValueOnce("comment_reply_new");

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "reply-artifact-comment",
      method: "tools/call",
      params: {
        name: "reply_to_artifact_comment",
        arguments: { commentId: "comment_root", content: "On it" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ commentId: "comment_reply_new" });
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifactComments.reply, {
      parentId: "comment_root",
      content: "On it",
      apiKey: "sk_user_test",
    });
  });

  test("set_artifact_comment_status passes the batch through and validates status", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "resolve-artifact-comments",
      method: "tools/call",
      params: {
        name: "set_artifact_comment_status",
        arguments: { commentIds: ["comment_a", "comment_b"], status: "resolved" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.artifactComments.setStatus, {
      commentIds: ["comment_a", "comment_b"],
      status: "resolved",
      apiKey: "sk_user_test",
    });

    const invalid = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "invalid-status",
      method: "tools/call",
      params: {
        name: "set_artifact_comment_status",
        arguments: { commentIds: ["comment_a"], status: "done" },
      },
    });
    expect(invalid?.error).toMatchObject({ code: -32602 });
  });
});

describe("handleMcpRequest task labels", () => {
  const LABELS = [
    {
      _id: "label_bug",
      _creationTime: 1,
      projectId: "project_123",
      name: "Bug",
      color: "#ef4444",
      rank: "0|hzzzzz:",
    },
    {
      _id: "label_chore",
      _creationTime: 2,
      projectId: "project_123",
      name: "Chore fix",
      color: "#3b82f6",
      rank: "0|i00007:",
    },
  ];

  test("list_task_labels projects id, name, and color", async () => {
    const { ctx, runQuery } = createActionCtx(LABELS);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 80,
      method: "tools/call",
      params: {
        name: "list_task_labels",
        arguments: { projectId: "project_123" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.labels.list, {
      projectId: "project_123",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      labels: [
        { _id: "label_bug", name: "Bug", color: "#ef4444" },
        { _id: "label_chore", name: "Chore fix", color: "#3b82f6" },
      ],
    });
  });

  test("create_task_label passes name, color, and apiKey through", async () => {
    const { ctx, runMutation } = createActionCtx("label_new");

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 81,
      method: "tools/call",
      params: {
        name: "create_task_label",
        arguments: { projectId: "project_123", name: "Design", color: "#ef4444" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.labels.create, {
      projectId: "project_123",
      name: "Design",
      color: "#ef4444",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({ labelId: "label_new" });
  });

  test("update_task_label resolves the label by case-insensitive name", async () => {
    const { ctx, runMutation } = createActionCtx(LABELS);
    runMutation.mockResolvedValue(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 82,
      method: "tools/call",
      params: {
        name: "update_task_label",
        arguments: { projectId: "project_123", labelId: "chore  FIX", name: "Chores" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.labels.update, {
      labelId: "label_chore",
      name: "Chores",
      apiKey: "sk_user_test",
    });
  });

  test("delete_task_label defaults to clear and resolves the reassign target by name", async () => {
    const { ctx, runMutation } = createActionCtx(LABELS);
    runMutation.mockResolvedValue({ affectedTaskIds: [] });

    const cleared = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 83,
      method: "tools/call",
      params: {
        name: "delete_task_label",
        arguments: { projectId: "project_123", labelId: "label_bug" },
      },
    });
    expect(cleared?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.labels.remove, {
      labelId: "label_bug",
      resolution: "clear",
      apiKey: "sk_user_test",
    });

    const reassigned = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 84,
      method: "tools/call",
      params: {
        name: "delete_task_label",
        arguments: {
          projectId: "project_123",
          labelId: "Bug",
          resolution: "reassign",
          reassignTo: "chore fix",
        },
      },
    });
    expect(reassigned?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.labels.remove, {
      labelId: "label_bug",
      resolution: "reassign",
      reassignToLabelId: "label_chore",
      apiKey: "sk_user_test",
    });
  });

  test("delete_task_label rejects an unknown label identifier", async () => {
    const { ctx, runMutation } = createActionCtx(LABELS);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 85,
      method: "tools/call",
      params: {
        name: "delete_task_label",
        arguments: { projectId: "project_123", labelId: "Nope" },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("create_task resolves the label name to labelId", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(LABELS);
    runQuery.mockImplementation(async (fn) =>
      getFunctionName(fn) === getFunctionName(internal.organizations.core.getByIdInternal)
        ? { slug: "acme" }
        : LABELS
    );
    runMutation.mockResolvedValue({
      taskId: "task_1",
      organizationId: "org_1",
      projectAlias: "ABC",
      refId: "ABC-1",
    });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 86,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: { projectId: "project_123", name: "New task", label: "bug" },
      },
    });

    expect(response?.error).toBeUndefined();
    const createArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(createArgs.labelId).toBe("label_bug");
  });

  test("update_task resolves the label name and passes null through to clear", async () => {
    const TASK = { _id: "task_123", projectId: "project_123" };
    const { ctx, runQuery, runMutation } = createActionCtx(null);
    runQuery.mockImplementation(async (fn) =>
      getFunctionName(fn) === getFunctionName(api.tasks.labels.list) ? LABELS : TASK
    );

    const set = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 87,
      method: "tools/call",
      params: {
        name: "update_task",
        arguments: { taskId: "task_123", label: "Chore fix" },
      },
    });
    expect(set?.error).toBeUndefined();
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      id: "task_123",
      labelId: "label_chore",
    });

    const cleared = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 88,
      method: "tools/call",
      params: {
        name: "update_task",
        arguments: { taskId: "task_123", label: null },
      },
    });
    expect(cleared?.error).toBeUndefined();
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      id: "task_123",
      labelId: null,
    });
  });
});

describe("handleMcpRequest checks and checklists", () => {
  const CHECKS = [{ _id: "check_tests", key: "tests", label: "All tests pass", instruction: "Run the suite" }];
  const CHECKLISTS = [{ _id: "checklist_feature", name: "Bug  fix", checkKeys: ["tests"], taskTypeKeys: ["bug"] }];
  const call = (ctx: ActionCtx, name: string, args: Record<string, unknown>) =>
    handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: name,
      method: "tools/call",
      params: { name, arguments: { projectId: "project_123", ...args } },
    });
  const byName = (fn: unknown) =>
    getFunctionName(fn as never) === getFunctionName(api.checks.definitions.list) ? CHECKS : CHECKLISTS;

  test("list_checks and list_checklists return the catalog", async () => {
    const { ctx, runQuery } = createActionCtx(byName);

    expect(parseToolContentJson(await call(ctx, "list_checks", {}))).toEqual({ checks: CHECKS });
    expect(runQuery).toHaveBeenCalledWith(api.checks.definitions.list, { projectId: "project_123", apiKey: "sk_user_test" });
    expect(parseToolContentJson(await call(ctx, "list_checklists", {}))).toEqual({ checklists: CHECKLISTS });
  });

  test("create_check defaults the instruction to empty", async () => {
    const { ctx, runMutation } = createActionCtx("check_new");

    const response = await call(ctx, "create_check", { key: "ui", label: "UI verified" });
    expect(runMutation).toHaveBeenCalledWith(api.checks.definitions.create, {
      projectId: "project_123",
      key: "ui",
      label: "UI verified",
      instruction: "",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({ checkId: "check_new" });
  });

  test("update_check and delete_check resolve the check by key", async () => {
    const { ctx, runMutation } = createActionCtx(byName);
    runMutation.mockResolvedValue(null);

    await call(ctx, "update_check", { checkId: "tests", instruction: "Attach the output" });
    expect(runMutation).toHaveBeenCalledWith(api.checks.definitions.update, {
      checkId: "check_tests",
      instruction: "Attach the output",
      apiKey: "sk_user_test",
    });

    await call(ctx, "delete_check", { checkId: "check_tests" });
    expect(runMutation).toHaveBeenCalledWith(api.checks.definitions.remove, { checkId: "check_tests", apiKey: "sk_user_test" });

    const unknown = await call(ctx, "delete_check", { checkId: "nope" });
    expect(unknown?.error).toMatchObject({ code: -32602 });
  });

  test("update_check rejects a key change instead of dropping it", async () => {
    const { ctx, runMutation } = createActionCtx(byName);

    const response = await call(ctx, "update_check", { checkId: "tests", key: "qa-changed" });
    expect(response?.error).toMatchObject({ code: -32602, message: expect.stringContaining("key cannot change") });
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("create_checklist defaults keys and types to empty", async () => {
    const { ctx, runMutation } = createActionCtx("checklist_new");

    const response = await call(ctx, "create_checklist", { name: "Feature" });
    expect(runMutation).toHaveBeenCalledWith(api.checks.checklists.create, {
      projectId: "project_123",
      name: "Feature",
      checkKeys: [],
      taskTypeKeys: [],
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({ checklistId: "checklist_new" });
  });

  test("update_checklist and delete_checklist resolve the checklist by name", async () => {
    const { ctx, runMutation } = createActionCtx(byName);
    runMutation.mockResolvedValue(null);

    await call(ctx, "update_checklist", { checklistId: "bug fix", taskTypeKeys: ["bug", "chore"] });
    expect(runMutation).toHaveBeenCalledWith(api.checks.checklists.update, {
      checklistId: "checklist_feature",
      taskTypeKeys: ["bug", "chore"],
      apiKey: "sk_user_test",
    });

    await call(ctx, "delete_checklist", { checklistId: "Bug fix" });
    expect(runMutation).toHaveBeenCalledWith(api.checks.checklists.remove, {
      checklistId: "checklist_feature",
      apiKey: "sk_user_test",
    });
  });

  test("update_task sets the checklist by name, or null for no checks", async () => {
    const TASK = { _id: "task_123", projectId: "project_123" };
    const { ctx, runQuery, runMutation } = createActionCtx(null);
    runQuery.mockImplementation(async (fn) =>
      getFunctionName(fn) === getFunctionName(api.checks.checklists.list) ? CHECKLISTS : TASK
    );

    expect((await call(ctx, "update_task", { taskId: "task_123", checklist: "Bug fix" }))?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.setChecklist, {
      taskId: "task_123",
      checklistId: "checklist_feature",
      apiKey: "sk_user_test",
    });

    runMutation.mockClear();
    await call(ctx, "update_task", { taskId: "task_123", checklist: null });
    expect(runMutation).toHaveBeenCalledWith(api.tasks.core.setChecklist, {
      taskId: "task_123",
      checklistId: null,
      apiKey: "sk_user_test",
    });

    runMutation.mockClear();
    await call(ctx, "update_task", { taskId: "task_123", name: "Renamed" });
    expect(runMutation.mock.calls.map(([fn]) => getFunctionName(fn))).not.toContain(getFunctionName(api.tasks.core.setChecklist));
  });

  test("get_task shows the checklist in effect instead of the raw checklistId", async () => {
    const TASK = { _id: "task_1", refId: "ABC-5", name: "Fix login", checklistId: null };
    const { ctx } = createActionCtx((fn: unknown) => {
      const name = getFunctionName(fn as never);
      if (name === getFunctionName(api.tasks.core.getById)) return TASK;
      if (name === getFunctionName(api.tasks.comments.listByTask)) return EMPTY_PAGE;
      if (name === getFunctionName(api.checks.checklists.getForTask)) {
        return {
          checklists: [{ _id: "checklist_feature", name: "Feature", isDefault: true }],
          checklistId: "checklist_feature",
          checks: [
            { key: "tests", label: "All tests pass", instruction: "", added: false, results: [] },
            {
              key: "mobile",
              label: "Mobile layout",
              instruction: "",
              added: true,
              results: [{ status: "failed", note: "Overflows", reportedAt: 5 }, { status: "passed", reportedAt: 1 }],
            },
          ],
        };
      }
      return [];
    });

    const task = parseToolContentJson(await call(ctx, "get_task", { taskId: "task_1" })) as Record<string, unknown>;
    expect(task.checklistId).toBeUndefined();
    expect(task.checklist).toEqual({ _id: "checklist_feature", name: "Feature" });
    expect(task.checks).toEqual([
      { key: "tests", label: "All tests pass", status: "pending" },
      { key: "mobile", label: "Mobile layout", status: "failed", note: "Overflows", reportedAt: 5, added: true },
    ]);
  });

  test("get_task omits checks when the project has no checklists", async () => {
    const { ctx } = createActionCtx((fn: unknown) => {
      const name = getFunctionName(fn as never);
      if (name === getFunctionName(api.tasks.core.getById)) return { _id: "task_1", refId: "ABC-5", name: "Fix login" };
      if (name === getFunctionName(api.tasks.comments.listByTask)) return EMPTY_PAGE;
      if (name === getFunctionName(api.checks.checklists.getForTask)) return { checklists: [], checklistId: null, checks: [] };
      return [];
    });

    const task = parseToolContentJson(await call(ctx, "get_task", { taskId: "task_1" })) as Record<string, unknown>;
    expect("checklist" in task).toBe(false);
    expect("checks" in task).toBe(false);
  });

  const TASK_CHECKS = {
    checklists: [{ _id: "checklist_feature", name: "Feature", isDefault: true }],
    checklistId: "checklist_feature",
    checks: [
      { key: "tests", label: "All tests pass", instruction: "Run the suite", added: false, results: [] },
      {
        key: "mobile",
        label: "Mobile layout",
        instruction: "",
        added: true,
        results: [{ status: "warning", note: "Tight", value: "+3", artifactId: "artifact_1", artifactName: "Plan", reportedAt: 5 }],
      },
    ],
  };

  test("get_checks by thread lists its task's checks with instructions", async () => {
    const { ctx, runQuery } = createActionCtx((fn: unknown) => {
      const name = getFunctionName(fn as never);
      if (name === getFunctionName(api.cli.threads.summaries.getSummary)) return { _id: "thread_1", associatedTaskId: "task_1" };
      if (name === getFunctionName(api.checks.checklists.getForThread)) return TASK_CHECKS;
      return null;
    });

    const result = parseToolContentJson(await call(ctx, "get_checks", { threadId: "thread_1" }));
    expect(runQuery).toHaveBeenCalledWith(api.checks.checklists.getForThread, { threadId: "thread_1", apiKey: "sk_user_test" });
    expect(result).toEqual({
      taskId: "task_1",
      checklist: { _id: "checklist_feature", name: "Feature" },
      checks: [
        { key: "tests", label: "All tests pass", instruction: "Run the suite", status: "pending" },
        { key: "mobile", label: "Mobile layout", status: "warning", note: "Tight", value: "+3", artifactId: "artifact_1", reportedAt: 5, added: true },
      ],
    });
  });

  test("get_checks by task, and its errors", async () => {
    const { ctx } = createActionCtx((fn: unknown) => {
      const name = getFunctionName(fn as never);
      if (name === getFunctionName(api.cli.threads.summaries.getSummary)) return { _id: "thread_2" };
      if (name === getFunctionName(api.checks.checklists.getForTask)) return TASK_CHECKS;
      if (name === getFunctionName(api.checks.checklists.getForThread)) return TASK_CHECKS;
      return null;
    });

    expect(parseToolContentJson(await call(ctx, "get_checks", { taskId: "task_1" }))).toMatchObject({ taskId: "task_1" });
    expect((await call(ctx, "get_checks", {}))?.error).toMatchObject({ code: -32602, message: expect.stringContaining("exactly one") });
    expect((await call(ctx, "get_checks", { taskId: "task_1", threadId: "thread_2" }))?.error).toMatchObject({ code: -32602 });
    // A thread with no task returns its own Checks (OS-2293).
    expect(parseToolContentJson(await call(ctx, "get_checks", { threadId: "thread_2" }))).toMatchObject({ taskId: null, checks: expect.any(Array) });
  });
});

describe("handleMcpRequest task List management", () => {
  const RESOLVED_LIST = {
    type: "list",
    _id: "list_sprint",
    _creationTime: 10,
    projectId: "project_123",
    name: "Sprint 1",
    ref: "SPRINT-1",
    isArchived: false,
    isDefault: false,
    isPinned: false,
    createdBy: "user_1",
    updatedBy: "user_1",
    createdAt: 20,
    updatedAt: 30,
  };

  test("create_task_list passes name, ref, color, and apiKey through", async () => {
    const { ctx, runMutation } = createActionCtx("list_new");

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 90,
      method: "tools/call",
      params: {
        name: "create_task_list",
        arguments: {
          projectId: "project_123",
          name: "Sprint 1",
          ref: "SPRINT-1",
          color: "#ef4444",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.lists.create, {
      projectId: "project_123",
      name: "Sprint 1",
      ref: "SPRINT-1",
      color: "#ef4444",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({ listId: "list_new" });
  });

  test("create_task_list requires a name", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 91,
      method: "tools/call",
      params: {
        name: "create_task_list",
        arguments: { projectId: "project_123" },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("update_task_list resolves the List and forwards only the provided fields", async () => {
    const { ctx, runQuery, runMutation } = createActionCtx(RESOLVED_LIST);
    runMutation.mockResolvedValue(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 92,
      method: "tools/call",
      params: {
        name: "update_task_list",
        arguments: {
          projectId: "project_123",
          listId: "SPRINT-1",
          color: null,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.tasks.lists.resolve, {
      projectId: "project_123",
      identifier: "SPRINT-1",
      apiKey: "sk_user_test",
    });
    // Name is omitted, so the mutation keeps the stored name — no fallback here.
    expect(runMutation).toHaveBeenCalledWith(api.tasks.lists.update, {
      id: "list_sprint",
      color: null,
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({ listId: "list_sprint" });
  });

  test("update_task_list rejects calls without any updates", async () => {
    const { ctx, runMutation } = createActionCtx(RESOLVED_LIST);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 93,
      method: "tools/call",
      params: {
        name: "update_task_list",
        arguments: { projectId: "project_123", listId: "SPRINT-1" },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test.each([
    { defaultListGroupBy: "owner" },
    { name: "Renamed", defaultListGroupBy: "owner" },
    { defaultViewMode: "board", defaultListGroupBy: "owner" },
    { name: "Renamed", defaultBoardGroupBy: "label" },
  ])("update_task_list rejects incompatible grouping arguments %j", async fields => {
    const { ctx, runMutation } = createActionCtx(RESOLVED_LIST);
    runMutation.mockRejectedValue(new ConvexError("defaultListGroupBy requires defaultViewMode: list in the same call"));
    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0", id: 96, method: "tools/call",
      params: { name: "update_task_list", arguments: { projectId: "project_123", listId: "SPRINT-1", ...fields } },
    });
    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("requires defaultViewMode");
    expect(runMutation).toHaveBeenCalledWith(api.tasks.lists.update, expect.objectContaining(fields));
  });

  test("update_task_list sends the default view in the same mutation", async () => {
    const { ctx, runMutation } = createActionCtx(RESOLVED_LIST);
    runMutation.mockResolvedValue(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 96,
      method: "tools/call",
      params: {
        name: "update_task_list",
        arguments: {
          projectId: "project_123",
          listId: "SPRINT-1",
          defaultViewMode: "board",
          defaultBoardGroupBy: "label",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    // One transaction, so a rename can't land without its view change.
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(api.tasks.lists.update, {
      id: "list_sprint",
      defaultViewMode: "board",
      defaultBoardGroupBy: "label",
      apiKey: "sk_user_test",
    });
  });

  test("update_task_list clears the default view with null", async () => {
    const { ctx, runMutation } = createActionCtx(RESOLVED_LIST);
    runMutation.mockResolvedValue(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 97,
      method: "tools/call",
      params: {
        name: "update_task_list",
        arguments: {
          projectId: "project_123",
          listId: "SPRINT-1",
          defaultViewMode: null,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.tasks.lists.update, {
      id: "list_sprint",
      defaultViewMode: null,
      apiKey: "sk_user_test",
    });
  });

  test("update_task_list rejects an invalid default view mode", async () => {
    const { ctx, runMutation } = createActionCtx(RESOLVED_LIST);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 98,
      method: "tools/call",
      params: {
        name: "update_task_list",
        arguments: {
          projectId: "project_123",
          listId: "SPRINT-1",
          defaultViewMode: "gantt",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("update_task_list rejects unknown List identifiers", async () => {
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 94,
      method: "tools/call",
      params: {
        name: "update_task_list",
        arguments: { projectId: "project_123", listId: "NOPE-1", name: "New" },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("update_task_list rejects scoped List refs (resolve returns null)", async () => {
    // The resolve query rejects scoped refs (rejectScoped), surfacing as a null
    // resolution the handler turns into an invalid-params error.
    const { ctx, runMutation } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: 95,
      method: "tools/call",
      params: {
        name: "update_task_list",
        arguments: {
          projectId: "project_123",
          listId: "OTHER/SPRINT-1",
          name: "New",
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

// First of the CLI thread tools (OS-1162). It wraps `listByProject` with no new
// query, so these tests are about the handler seam: the tool is discoverable,
// `apiKey` reaches the query, the payload is renamed to the argument names the
// write tools take, and the key's project scope is enforced by the query rather
// than re-implemented here.
describe("handleMcpRequest list_cli_profiles", () => {
  const PROFILE_ROW = {
    _id: "profile_123",
    name: "Laptop",
    profileKey: "laptop-abc",
    hostname: "laptop.local",
    paths: [
      {
        id: "path_1",
        path: "/Users/dev/contoso",
        label: "contoso",
        gitRemoteUrl: "git@github.com:packtrain/convoy.git",
      },
      {
        id: "path_2",
        path: "/Users/dev/contoso-feature",
        label: "feature",
        kind: "worktree" as const,
        parentPathId: "path_1",
        branch: "feature/os-1624",
      },
    ],
    createdAt: 1,
    lastConnectedAt: 2,
    isOnline: true,
    sessionStartedAt: 3,
    // The hot rows carry runtimes only; catalogs come from their own query (OS-1721).
    availableClis: [
      { type: "claude-code" as const, version: "2.0.0" },
      { type: "opencode" as const, version: "1.17.13" },
    ],
    appVersion: "0.42.0",
  };

  const CATALOG_ROWS = [
    {
      profileId: "profile_123",
      projectId: "project_123",
      userId: "user_123",
      cliType: "opencode" as const,
      models: [
        { slug: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", variants: ["low", "high"] },
        { slug: "openai/gpt-5.5", name: "GPT-5.5" },
      ],
    },
  ];

  // Function references from the generated `api` proxy are deep-equal, not
  // identical, so dispatch on the call order instead: profiles, then catalogs.
  const answerQuery = (() => {
    let call = 0;
    return () => (call++ === 0 ? [PROFILE_ROW] : CATALOG_ROWS);
  })();

  test("tools/list advertises the tool with only projectId", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "cli-profile-tools",
      method: "tools/list",
    });

    expect(response?.error).toBeUndefined();
    const result = response?.result;
    expect(isRecord(result)).toBe(true);
    const tools = Array.isArray((result as Record<string, unknown>).tools)
      ? ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>)
      : [];
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_cli_profiles"])
    );
    expect(getToolSchemaProperty(tools, "list_cli_profiles", "projectId")).toMatchObject({
      type: "string",
    });
  });

  test("returns the caller's profiles with online state and spawn-target ids", async () => {
    const { ctx, runQuery } = createActionCtx(answerQuery);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-cli-profiles",
        method: "tools/call",
        params: { name: "list_cli_profiles", arguments: {} },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.cli.profiles.listByProject, {
      projectId: "project_123",
      apiKey: "sk_user_test",
    });
    expect(runQuery).toHaveBeenCalledWith(api.cli.profiles.listRuntimeCatalogs, {
      projectId: "project_123",
      apiKey: "sk_user_test",
    });
    // Ids are renamed to what create_thread/send_thread_message will ask for,
    // and CLI-only bookkeeping (profileKey, createdAt, sessionStartedAt) is
    // dropped rather than handed to an agent. Runtimes are summarized: a full
    // opencode catalog is tens of KB of context an agent cannot act on (OS-1721).
    expect(parseToolContentJson(response)).toEqual([
      {
        profileId: "profile_123",
        name: "Laptop",
        hostname: "laptop.local",
        isOnline: true,
        lastConnectedAt: 2,
        appVersion: "0.42.0",
        availableClis: [
          { type: "claude-code", version: "2.0.0" },
          {
            type: "opencode",
            version: "1.17.13",
            // The `cliModel` values create_thread accepts on this machine, each with
            // its `cliEffort` values — opencode efforts are per-model variants, so
            // they are only discoverable here. Display labels are not agent-facing.
            cliModels: [
              { model: "anthropic/claude-sonnet-5", efforts: ["low", "high"] },
              { model: "openai/gpt-5.5" },
            ],
          },
        ],
        paths: [
          {
            pathId: "path_1",
            path: "/Users/dev/contoso",
            label: "contoso",
            gitRemoteUrl: "git@github.com:packtrain/convoy.git",
          },
          {
            pathId: "path_2",
            path: "/Users/dev/contoso-feature",
            label: "feature",
            kind: "worktree",
            parentPathId: "path_1",
            branch: "feature/os-1624",
          },
        ],
      },
    ]);
  });

  test("an explicit projectId overrides the URL default", async () => {
    const { ctx, runQuery } = createActionCtx([]);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-cli-profiles-explicit",
        method: "tools/call",
        params: {
          name: "list_cli_profiles",
          arguments: { projectId: "project_other" },
        },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.cli.profiles.listByProject, {
      projectId: "project_other",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual([]);
  });

  test("a key scoped to another organization is denied, not given an empty list", async () => {
    // The scope boundary lives in `listByProject` (it passes `principal` to
    // `requireAuthorizedProject`); the handler must surface that denial rather
    // than swallow it into an empty list.
    const runQuery = vi.fn().mockRejectedValue(new ConvexError("Permission denied"));
    const ctx = { runQuery, runMutation: vi.fn() } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-cli-profiles-scoped-out",
      method: "tools/call",
      params: {
        name: "list_cli_profiles",
        arguments: { projectId: "project_123" },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("Permission denied");
  });

  test("names projectId when there is no project context at all", async () => {
    const { ctx, runQuery } = createActionCtx([]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-cli-profiles-no-project",
      method: "tools/call",
      params: { name: "list_cli_profiles", arguments: {} },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("projectId");
    expect(runQuery).not.toHaveBeenCalled();
  });
});

/**
 * Second of the CLI thread tools (OS-1162). `getSummary` shapes the payload, so
 * these tests cover the handler seam: the tool is discoverable and takes only a
 * thread id, `apiKey` reaches the query, the payload passes through unshaped, and
 * a null — which the query returns for both "no such thread" and "not yours" —
 * becomes one actionable error instead of an empty success.
 */
describe("handleMcpRequest get_thread", () => {
  const THREAD_ROW = {
    threadId: "thread_123",
    title: "Implement OS-1625",
    status: "streaming" as const,
    isDone: false,
    createdAt: 1,
    lastActivityAt: 2,
    profileId: "profile_123",
    pathId: "path_1",
    path: "/Users/dev/contoso",
    cliType: "claude-code" as const,
    processingState: "streaming" as const,
    hasPendingUserMessages: false,
    hasPendingInteraction: false,
    profileName: "Laptop",
    targetOnline: true,
    lastHeartbeatAt: 3,
  };

  test("tools/list advertises the tool with threadId required", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "thread-tools",
      method: "tools/list",
    });

    expect(response?.error).toBeUndefined();
    const result = response?.result;
    expect(isRecord(result)).toBe(true);
    const tools = Array.isArray((result as Record<string, unknown>).tools)
      ? ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>)
      : [];
    const getThread = tools.find((tool) => tool.name === "get_thread");
    expect(getThread).toBeDefined();
    expect(getToolSchemaProperty(tools, "get_thread", "threadId")).toMatchObject({
      type: "string",
    });
    // No projectId: a thread id is globally unique and the query authorizes
    // through the thread's own project, so a second scope argument could only
    // ever disagree with it.
    expect(getToolSchemaProperty(tools, "get_thread", "projectId")).toBeUndefined();
    expect(
      isRecord(getThread?.inputSchema) ? getThread.inputSchema.required : undefined
    ).toEqual(["threadId"]);
  });

  test("returns the thread with its spawn target, passing the api key through", async () => {
    const { ctx, runQuery } = createActionCtx(THREAD_ROW);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "get-thread",
        method: "tools/call",
        params: { name: "get_thread", arguments: { threadId: "thread_123" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.cli.threads.summaries.getSummary, {
      threadId: "thread_123",
      apiKey: "sk_user_test",
    });
    // Passed through unshaped: the query's validator is already the agent-facing
    // contract, so a second projection here would be a place for it to drift.
    expect(parseToolContentJson(response)).toEqual(THREAD_ROW);
  });

  test("a container comes back as metadata with no target and no children", async () => {
    // No `status`: the query omits it on a container, where it is a stored
    // `"completed"` constant, leaving `aggregateStatus` as the only status.
    const containerRow = {
      threadId: "container_123",
      title: "Group title",
      isDone: false,
      createdAt: 1,
      lastActivityAt: 2,
      kind: "group" as const,
      childCount: 2,
      aggregateStatus: "idle" as const,
      originThreadId: "thread_123",
    };
    const { ctx } = createActionCtx(containerRow);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "get-thread-container",
      method: "tools/call",
      params: { name: "get_thread", arguments: { threadId: "container_123" } },
    });

    expect(response?.error).toBeUndefined();
    // `aggregateStatus: "idle"` survives to the agent — the sidebar's
    // idle → "completed" projection must not reach this surface. Membership is
    // list_threads(containerId)'s answer, so there is no `children` here.
    expect(parseToolContentJson(response)).toEqual(containerRow);
  });

  test("a thread the caller cannot see is an error, not an empty result", async () => {
    // `getSummary` returns null for a missing thread and for another user's
    // thread alike. An agent can act on neither, and a silent success would read
    // as "the thread exists and is blank".
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "get-thread-missing",
      method: "tools/call",
      params: { name: "get_thread", arguments: { threadId: "thread_missing" } },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("Thread not found");
  });

  test("names threadId when it is missing", async () => {
    const { ctx, runQuery } = createActionCtx(THREAD_ROW);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "get-thread-no-id",
      method: "tools/call",
      params: { name: "get_thread", arguments: {} },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("threadId");
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("rejects a malformed thread id before reaching the query", async () => {
    const { ctx, runQuery } = createActionCtx(THREAD_ROW);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "get-thread-bad-id",
      method: "tools/call",
      params: { name: "get_thread", arguments: { threadId: "not a convex id!" } },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("valid Convex ID");
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("handleMcpRequest list_threads", () => {
  const PAGE = {
    page: [
      {
        threadId: "thread_123",
        title: "Implement OS-1626",
        status: "streaming" as const,
        isDone: false,
        createdAt: 1,
        lastActivityAt: 2,
        profileId: "profile_123",
        pathId: "path_1",
        path: "/Users/dev/contoso",
        cliType: "claude-code" as const,
        processingState: "streaming" as const,
        hasPendingUserMessages: false,
        hasPendingInteraction: false,
        profileName: "Laptop",
        targetOnline: true,
        lastHeartbeatAt: 3,
      },
    ],
    isDone: false,
    continueCursor: "cursor_2",
  };
  /** What `listGroupSummaries` returns: a bare array, no envelope. */
  const MEMBERS = PAGE.page;

  test("tools/list advertises the tool with nothing required", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-threads-tools",
      method: "tools/list",
    });

    const tools = isRecord(response?.result) ? response.result.tools : undefined;
    if (!Array.isArray(tools)) {
      throw new Error("Expected tools array");
    }
    const listThreads = tools.find((tool) => isRecord(tool) && tool.name === "list_threads");
    if (!isRecord(listThreads)) {
      throw new Error("Expected list_threads to be advertised");
    }

    expect(isRecord(listThreads.inputSchema) ? listThreads.inputSchema.required : "missing").toBeUndefined();
    expect(getToolSchemaProperty(tools, "list_threads", "threadId")).toMatchObject({ type: "string" });
    // The drill-down argument keeps the thread-tool name, not the schema field's.
    expect(getToolSchemaProperty(tools, "list_threads", "parentThreadId")).toBeUndefined();
  });

  test("lists the project's threads with the default page size", async () => {
    const { ctx, runQuery } = createActionCtx(PAGE);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-threads",
        method: "tools/call",
        params: { name: "list_threads", arguments: {} },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.cli.threads.summaries.listSummaries, {
      projectId: "project_123",
      includeDone: false,
      paginationOpts: { numItems: 20, cursor: null },
      apiKey: "sk_user_test",
    });
    // Passed through unshaped, page envelope included — the query's validator is
    // already the agent-facing contract.
    expect(parseToolContentJson(response)).toEqual(PAGE);
  });

  /**
   * `threadId` selects the other query entirely — not the same one with an extra
   * argument. `limit` and `cursor` are accepted and dropped: the drill-down reads
   * a capped group in one scan, so there is nothing to page. That is the tool
   * contract documented on `limit`, and this is the only layer that sees it.
   */
  test("routes threadId to listGroupSummaries and drops limit and cursor", async () => {
    const { ctx, runQuery } = createActionCtx(MEMBERS);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-threads-group",
        method: "tools/call",
        params: {
          name: "list_threads",
          arguments: { threadId: "container_123", includeDone: true, limit: 50, cursor: "cursor_1" },
        },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: "container_123",
      includeDone: true,
      apiKey: "sk_user_test",
    });
    // The other query is not consulted at all, so no `projectId` is ever needed.
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  /**
   * The array comes back as a page so a caller never branches its response
   * handling on which argument it sent — the whole reason the two queries are one
   * tool. `isDone` is always true: there is no next page to ask for.
   */
  test("wraps the group's members in a page envelope", async () => {
    const { ctx } = createActionCtx(MEMBERS);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-threads-envelope",
        method: "tools/call",
        params: { name: "list_threads", arguments: { threadId: "container_123" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ page: MEMBERS, isDone: true, continueCursor: "" });
  });

  /**
   * A container id plus the credential fully determine access, so the drill-down
   * asks for no project — and must therefore work where none is configured. The
   * flat list still requires one (see the last test in this block).
   */
  test("drills into a group without a configured project", async () => {
    const { ctx, runQuery } = createActionCtx(MEMBERS);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-threads-no-project",
      method: "tools/call",
      params: { name: "list_threads", arguments: { threadId: "container_123" } },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: "container_123",
      includeDone: false,
      apiKey: "sk_user_test",
    });
  });

  test("an unreadable id is an empty page, not an error", async () => {
    // Unlike `get_thread`, which throws on a null. "This group has no live
    // members" and "that id is not a group you can read" are both "nothing to
    // list", and an agent racing a delete should not get an error for it.
    const { ctx } = createActionCtx([]);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-threads-empty",
        method: "tools/call",
        params: { name: "list_threads", arguments: { threadId: "thread_gone" } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual({ page: [], isDone: true, continueCursor: "" });
  });

  test("rejects a malformed threadId before reaching the query", async () => {
    const { ctx, runQuery } = createActionCtx(PAGE);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-threads-bad-id",
        method: "tools/call",
        params: { name: "list_threads", arguments: { threadId: "not a convex id!" } },
      },
      `${BASE_URL}?project=project_123`
    );

    // An optional id still gets `beId`'s shape check. Without it this reached the
    // query, which cannot resolve it and answers with an empty page — read by an
    // agent as "that group is empty" rather than "your id is wrong".
    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("valid Convex ID");
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("rejects a non-boolean includeDone", async () => {
    const { ctx, runQuery } = createActionCtx(PAGE);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-threads-bad-flag",
        method: "tools/call",
        params: { name: "list_threads", arguments: { includeDone: "true" } },
      },
      `${BASE_URL}?project=project_123`
    );

    // `"true"` against a boolean schema is a common model slip. Coercing it to
    // `false` would silently omit the done threads the caller asked for.
    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("includeDone");
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("rejects a limit outside 1..50", async () => {
    const { ctx, runQuery } = createActionCtx(PAGE);

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "list-threads-bad-limit",
        method: "tools/call",
        params: { name: "list_threads", arguments: { limit: 500 } },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("limit");
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("requires a project when the connection has no default", async () => {
    const { ctx, runQuery } = createActionCtx(PAGE);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-threads-no-project",
      method: "tools/call",
      params: { name: "list_threads", arguments: {} },
    });

    // A project is the only thing this tool can start from — the opposite of
    // `get_thread`, where a thread id is globally unique.
    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("projectId");
    expect(runQuery).not.toHaveBeenCalled();
  });
});

/**
 * `list_thread_messages` (OS-1628). `listRecentSummaries` composes the text and
 * owns the caps (tested in `cli/messages.test.ts`), so the seam is all that is
 * left here: argument shaping, the api key reaching the query, and the array
 * passing through unshaped. `runQuery` is mocked, so nothing below says anything
 * about what the query decides.
 */
describe("handleMcpRequest list_thread_messages", () => {
  const MESSAGES = [
    {
      messageId: "message_1",
      role: "user" as const,
      status: "completed" as const,
      createdAt: 1,
      text: "Please review the diff",
    },
    {
      messageId: "message_2",
      role: "assistant" as const,
      status: "streaming" as const,
      createdAt: 2,
      text: "Reading the changed files",
      truncated: true,
    },
  ];

  test("tools/list advertises the tool with threadId required", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "thread-message-tools",
      method: "tools/list",
    });

    expect(response?.error).toBeUndefined();
    const result = response?.result;
    const tools = isRecord(result) && Array.isArray(result.tools)
      ? (result.tools as Array<Record<string, unknown>>)
      : [];
    const listMessages = tools.find((tool) => tool.name === "list_thread_messages");
    expect(listMessages).toBeDefined();
    expect(getToolSchemaProperty(tools, "list_thread_messages", "threadId")).toMatchObject({
      type: "string",
    });
    expect(getToolSchemaProperty(tools, "list_thread_messages", "projectId")).toBeUndefined();
    expect(
      isRecord(listMessages?.inputSchema) ? listMessages.inputSchema.required : undefined
    ).toEqual(["threadId"]);
  });

  test("returns the messages oldest-first, passing the api key through", async () => {
    const { ctx, runQuery } = createActionCtx(MESSAGES);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-thread-messages",
      method: "tools/call",
      params: { name: "list_thread_messages", arguments: { threadId: "thread_123" } },
    });

    expect(response?.error).toBeUndefined();
    // No `limit`: absent means the query's own default (10), not a number this
    // handler picked, so the CLI and MCP cannot default differently.
    expect(runQuery).toHaveBeenCalledWith(api.cli.messages.listRecentSummaries, {
      threadId: "thread_123",
      apiKey: "sk_user_test",
    });
    // Unshaped, including `truncated` on the second row: the query's validator is
    // already the agent-facing contract.
    expect(parseToolContentJson(response)).toEqual(MESSAGES);
  });

  test("forwards a limit inside the range", async () => {
    const { ctx, runQuery } = createActionCtx(MESSAGES);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-thread-messages-limit",
      method: "tools/call",
      params: { name: "list_thread_messages", arguments: { threadId: "thread_123", limit: 20 } },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.cli.messages.listRecentSummaries, {
      threadId: "thread_123",
      limit: 20,
      apiKey: "sk_user_test",
    });
  });

  test("rejects a limit above the window instead of silently narrowing it", async () => {
    const { ctx, runQuery } = createActionCtx(MESSAGES);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-thread-messages-bad-limit",
      method: "tools/call",
      params: { name: "list_thread_messages", arguments: { threadId: "thread_123", limit: 50 } },
    });

    // The query clamps rather than throws — its callers include the CLI. At this
    // boundary an error is better: a caller that asked for 50 and got 20 rows
    // would read them as the whole thread.
    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("limit");
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("an empty thread is an empty array, not an error", async () => {
    // Also what an unreadable id returns: `listRecentSummaries` answers `[]` for
    // missing, another user's, and another table's ids alike.
    const { ctx } = createActionCtx([]);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-thread-messages-empty",
      method: "tools/call",
      params: { name: "list_thread_messages", arguments: { threadId: "thread_other" } },
    });

    expect(response?.error).toBeUndefined();
    expect(parseToolContentJson(response)).toEqual([]);
  });

  test("rejects a malformed thread id before reaching the query", async () => {
    const { ctx, runQuery } = createActionCtx(MESSAGES);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "list-thread-messages-bad-id",
      method: "tools/call",
      params: { name: "list_thread_messages", arguments: { threadId: "not a convex id!" } },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("valid Convex ID");
    expect(runQuery).not.toHaveBeenCalled();
  });
});

/**
 * `create_thread` (OS-1629). Inheritance and container resolution are tested in
 * `mcp/lib/threads/resolution.test.ts`; the seam here is which mutation runs, with
 * what arguments, and that the response is a read-back summary.
 */
describe("handleMcpRequest create_thread", () => {
  const SOURCE = {
    threadId: "thread_source",
    title: "Implement OS-1629",
    isDone: false,
    createdAt: 1,
    lastActivityAt: 2,
    status: "completed" as const,
    profileId: "profile_a",
    pathId: "path_a",
    path: "/Users/dev/contoso",
    cliType: "claude-code" as const,
    profileName: "Laptop",
    targetOnline: true,
  };
  const CREATED = {
    ...SOURCE,
    threadId: "thread_new",
    status: "pending" as const,
    title: "Review the diff",
  };

  /** `getSummary` answers twice, so the mock keys on the id asked for. */
  function createThreadCtx(
    options: {
      created?: unknown;
      members?: unknown;
      sourceSummary?: unknown;
    } = {}
  ) {
    const runQuery = vi.fn().mockImplementation(async (query, args) => {
      const name = getFunctionName(query);
      if (name === getFunctionName(api.cli.threads.summaries.listGroupSummaries)) {
        return options.members ?? [];
      }
      if (name !== getFunctionName(api.cli.threads.summaries.getSummary)) {
        throw new Error(`Unexpected query: ${name}`);
      }
      return args.threadId === "thread_new"
        ? (options.created ?? CREATED)
        : (options.sourceSummary ?? SOURCE);
    });
    const runMutation = vi.fn().mockImplementation(async (mutation) =>
      getFunctionName(mutation) === getFunctionName(api.cli.threads.groups.addThreadToGroup)
        ? { containerId: "container_new", threadId: "thread_new" }
        : "thread_new"
    );
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    return { ctx, runQuery, runMutation };
  }

  test("tools/list advertises the tool with only content required", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-tools",
      method: "tools/list",
    });

    expect(response?.error).toBeUndefined();
    const tools = isRecord(response?.result) && Array.isArray(response.result.tools)
      ? (response.result.tools as Array<Record<string, unknown>>)
      : [];
    const createThread = tools.find((tool) => tool.name === "create_thread");
    expect(createThread).toBeDefined();
    // The tuple is conditionally required, which JSON Schema cannot express.
    expect(
      isRecord(createThread?.inputSchema) ? createThread.inputSchema.required : undefined
    ).toEqual(["content"]);
    expect(getToolSchemaProperty(tools, "create_thread", "sourceThreadId")).toMatchObject({
      type: "string",
    });
    // `parentThreadId` would collide with the schema field.
    expect(getToolSchemaProperty(tools, "create_thread", "parentThreadId")).toBeUndefined();
    // No attachments over MCP: the upload flow needs a direct POST.
    expect(getToolSchemaProperty(tools, "create_thread", "attachments")).toBeUndefined();
    // Declared, unlike the read tools: a bare `taskId` ref needs a project.
    expect(getToolSchemaProperty(tools, "create_thread", "projectId")).toMatchObject({
      type: "string",
    });
    expect(getToolSchemaProperty(tools, "create_thread", "runtimeCommand")).toMatchObject({
      type: "boolean",
    });
  });

  test("forwards runtimeCommand so the thread opens on the target's own command", async () => {
    const { ctx, runMutation } = createThreadCtx();

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-runtime-command",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: {
          profileId: "profile_a",
          pathId: "path_a",
          cliType: "claude-code",
          content: "/security-review",
          runtimeCommand: true,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.cli.threads.core.create, {
      profileId: "profile_a",
      pathId: "path_a",
      cliType: "claude-code",
      content: "/security-review",
      runtimeCommand: true,
      apiKey: "sk_user_test",
    });
  });

  // Same failure mode as `send_thread_message`: the mutation drops the flag for prose,
  // which would read back as a command that ran.
  test("rejects runtimeCommand on prose rather than silently sending text", async () => {
    const { ctx, runMutation } = createThreadCtx();

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-runtime-command-prose",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: {
          profileId: "profile_a",
          pathId: "path_a",
          cliType: "claude-code",
          content: "please run the security review",
          runtimeCommand: true,
        },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("runtimeCommand");
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("an explicit tuple with no source creates a plain thread", async () => {
    const { ctx, runMutation } = createThreadCtx();

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-plain",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: {
          profileId: "profile_a",
          pathId: "path_a",
          cliType: "claude-code",
          content: "  Review the diff  ",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    // `create`: nothing to group with, so no container and no reparent.
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(api.cli.threads.core.create, {
      profileId: "profile_a",
      pathId: "path_a",
      cliType: "claude-code",
      content: "Review the diff",
      apiKey: "sk_user_test",
    });
  });

  test("a source spawns a Group child, inheriting the target and carrying both ids", async () => {
    const { ctx, runMutation } = createThreadCtx();

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-Group child",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: { sourceThreadId: "thread_source", content: "Review the diff" },
      },
    });

    expect(response?.error).toBeUndefined();
    // No `expectedContainerId`: a plain source has no membership to re-check.
    expect(runMutation).toHaveBeenCalledWith(api.cli.threads.groups.addThreadToGroup, {
      profileId: "profile_a",
      pathId: "path_a",
      cliType: "claude-code",
      content: "Review the diff",
      sourceThreadId: "thread_source",
      spawnedByThreadId: "thread_source",
      apiKey: "sk_user_test",
    });
  });

  test("a container source reaches addThreadToGroup as a member, lineage on the container", async () => {
    const { ctx, runMutation } = createThreadCtx({
      sourceSummary: {
        threadId: "container_1",
        title: "Group title",
        isDone: false,
        createdAt: 1,
        lastActivityAt: 2,
        kind: "group" as const,
        childCount: 1,
        aggregateStatus: "idle" as const,
        originThreadId: "thread_origin",
      },
      members: [{ ...SOURCE, threadId: "thread_origin" }],
    });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-container",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: { sourceThreadId: "container_1", content: "Review the diff" },
      },
    });

    expect(response?.error).toBeUndefined();
    // The mutation rejects a container source, so this must already be a member.
    expect(runMutation).toHaveBeenCalledWith(
      api.cli.threads.groups.addThreadToGroup,
      expect.objectContaining({
        sourceThreadId: "thread_origin",
        spawnedByThreadId: "container_1",
        // Re-checked in the mutation; the member was resolved a transaction ago.
        expectedContainerId: "container_1",
      })
    );
  });

  test("returns the created thread as get_thread would, not a bare id", async () => {
    const { ctx, runQuery } = createThreadCtx();

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-readback",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: { sourceThreadId: "thread_source", content: "Review the diff" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runQuery).toHaveBeenCalledWith(api.cli.threads.summaries.getSummary, {
      threadId: "thread_new",
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual(CREATED);
  });

  test("an offline target still creates the thread and reports targetOnline: false", async () => {
    // Offline is informational: the thread queues, and this field says so.
    const { ctx, runMutation } = createThreadCtx({
      created: { ...CREATED, targetOnline: false },
    });

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-offline",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: { sourceThreadId: "thread_source", content: "Review the diff" },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalled();
    expect(parseToolContentJson(response)).toMatchObject({
      threadId: "thread_new",
      status: "pending",
      targetOnline: false,
    });
  });

  test("forwards the optional title and runtime selection", async () => {
    const { ctx, runMutation } = createThreadCtx();

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-options",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: {
          sourceThreadId: "thread_source",
          content: "Review the diff",
          title: "  Review  ",
          cliModel: "opus",
          cliEffort: "high",
          cliMode: "plan",
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      api.cli.threads.groups.addThreadToGroup,
      expect.objectContaining({
        title: "Review",
        cliModel: "opus",
        cliEffort: "high",
        cliMode: "plan",
      })
    );
  });

  test("resolves a bare task ref against the project", async () => {
    const runQuery = vi.fn().mockImplementation(async (query, args) => {
      const name = getFunctionName(query);
      if (name === getFunctionName(api.tasks.core.getByRefs)) {
        return { results: [{ ref: "OS-1629", task: { _id: "task_123", refId: "OS-1629" } }] };
      }
      if (name === getFunctionName(api.cli.threads.summaries.getSummary)) {
        return args.threadId === "thread_new" ? CREATED : SOURCE;
      }
      throw new Error(`Unexpected query: ${name}`);
    });
    const runMutation = vi.fn().mockResolvedValue({
      containerId: "container_new",
      threadId: "thread_new",
    });
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      {
        jsonrpc: "2.0",
        id: "create-thread-task-ref",
        method: "tools/call",
        params: {
          name: "create_thread",
          arguments: {
            sourceThreadId: "thread_source",
            content: "Review the diff",
            taskId: "OS-1629",
          },
        },
      },
      `${BASE_URL}?project=project_123`
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      api.cli.threads.groups.addThreadToGroup,
      expect.objectContaining({ taskId: "task_123" })
    );
  });

  test("a group at the cap surfaces the domain's own message", async () => {
    // The cap counts deleted rows, so the message must say so.
    const runQuery = vi.fn().mockResolvedValue(SOURCE);
    const runMutation = vi
      .fn()
      .mockRejectedValue(new ConvexError("A thread group can contain at most 100 threads"));
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-full-group",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: { sourceThreadId: "thread_source", content: "Review the diff" },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("at most 100 threads");
  });

  test("names content when it is missing, before any write", async () => {
    const { ctx, runMutation } = createThreadCtx();

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-no-content",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: { sourceThreadId: "thread_source" },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("content");
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("names the tuple when there is no source to inherit it from", async () => {
    const { ctx, runMutation } = createThreadCtx();

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "create-thread-no-target",
      method: "tools/call",
      params: {
        name: "create_thread",
        arguments: { content: "Review the diff" },
      },
    });

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("profileId");
    expect(response?.error?.message).toContain("sourceThreadId");
    expect(runMutation).not.toHaveBeenCalled();
  });

  /**
   * Worktree spec and agent binding (OS-1222). Both are pass-through: the mutations
   * already accept and validate them, so the seam here is only that they survive
   * the handler — and reach `addThreadToGroup` too, which one shared object is what
   * guarantees.
   */
  describe("worktree and agent binding", () => {
    const WORKTREE = {
      parentPathId: "path_a",
      branch: "feat/os-1222",
      baseRef: "main",
      startFromOrigin: true,
    };

    const call = (args: Record<string, unknown>) => ({
      jsonrpc: "2.0" as const,
      id: "create-thread-worktree",
      method: "tools/call",
      params: { name: "create_thread", arguments: args },
    });

    test("forwards both to create on the standalone path", async () => {
      const { ctx, runMutation } = createThreadCtx();

      const response = await handleMcpRequest(
        ctx,
        "sk_user_test",
        call({
          profileId: "profile_a",
          pathId: "path_a",
          cliType: "claude-code",
          content: "Fix the login bug",
          worktree: WORKTREE,
          projectAgentId: "agent_1",
        })
      );

      expect(response?.error).toBeUndefined();
      expect(runMutation).toHaveBeenCalledWith(api.cli.threads.core.create, {
        profileId: "profile_a",
        pathId: "path_a",
        cliType: "claude-code",
        content: "Fix the login bug",
        worktree: WORKTREE,
        projectAgentId: "agent_1",
        apiKey: "sk_user_test",
      });
    });

    test("forwards both to addThreadToGroup too, so spawn has parity", async () => {
      const { ctx, runMutation } = createThreadCtx();

      const response = await handleMcpRequest(
        ctx,
        "sk_user_test",
        call({
          sourceThreadId: "thread_source",
          content: "Fix the login bug",
          worktree: { parentPathId: "path_a", branch: "feat/os-1222" },
          projectAgentId: "agent_1",
        })
      );

      expect(response?.error).toBeUndefined();
      expect(runMutation).toHaveBeenCalledWith(
        api.cli.threads.groups.addThreadToGroup,
        expect.objectContaining({
          worktree: { parentPathId: "path_a", branch: "feat/os-1222" },
          projectAgentId: "agent_1",
        })
      );
    });

    test("omits both keys when absent, rather than sending undefined", async () => {
      const { ctx, runMutation } = createThreadCtx();

      await handleMcpRequest(
        ctx,
        "sk_user_test",
        call({ sourceThreadId: "thread_source", content: "Review the diff" })
      );

      const args = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(args).not.toHaveProperty("worktree");
      expect(args).not.toHaveProperty("projectAgentId");
    });

    test("rejects a non-object worktree before any write", async () => {
      const { ctx, runMutation } = createThreadCtx();

      const response = await handleMcpRequest(
        ctx,
        "sk_user_test",
        call({ sourceThreadId: "thread_source", content: "Go", worktree: "feat/os-1222" })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("worktree");
      expect(runMutation).not.toHaveBeenCalled();
    });

    test("names the missing field of an incomplete worktree spec", async () => {
      const { ctx, runMutation } = createThreadCtx();

      const response = await handleMcpRequest(
        ctx,
        "sk_user_test",
        call({
          sourceThreadId: "thread_source",
          content: "Go",
          worktree: { branch: "feat/os-1222" },
        })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("parentPathId");
      expect(runMutation).not.toHaveBeenCalled();
    });

    test("rejects a malformed projectAgentId before any write", async () => {
      const { ctx, runMutation } = createThreadCtx();

      const response = await handleMcpRequest(
        ctx,
        "sk_user_test",
        call({
          sourceThreadId: "thread_source",
          content: "Go",
          projectAgentId: "not a convex id!",
        })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("valid Convex ID");
      expect(runMutation).not.toHaveBeenCalled();
    });
  });

  /**
   * Against the real mutations, for the reason the `send_thread_message` block below
   * has one: a `vi.fn()` cannot see an argument-validator mismatch, and every rule
   * these two fields obey lives in `createThreadCore`, not here.
   */
  describe("worktree and agent binding against the real mutation", () => {
    async function realCtx() {
      const testCtx = createTestContext();
      const { user, project, asUser, t } = await testCtx.setupProject();
      const repoPath = buildPathEntry({ path: "/home/dev/repo" });
      const worktreePath = buildPathEntry({
        path: "/home/dev/repo-worktrees/feat-x",
        kind: "worktree",
        parentPathId: repoPath.id,
        branch: "feat/x",
      });
      const profile = await testCtx.cliProfile(user._id, project._id, {
        paths: [repoPath, worktreePath],
      });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "MCP create",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const ctx = {
        runQuery: (ref: Parameters<typeof t.query>[0], args: Parameters<typeof t.query>[1]) => t.query(ref, args),
        runMutation: (ref: Parameters<typeof t.mutation>[0], args: Parameters<typeof t.mutation>[1]) =>
          t.mutation(ref, args),
      } as unknown as ActionCtx;

      return { testCtx, user, project, asUser, profile, repoPath, worktreePath, key, ctx, t };
    }

    const call = (args: Record<string, unknown>) => ({
      jsonrpc: "2.0" as const,
      id: "create-thread-real",
      method: "tools/call",
      params: { name: "create_thread", arguments: args },
    });

    test("stores a pending spec, leaving pathId on the parent repo", async () => {
      const { profile, repoPath, key, ctx, t } = await realCtx();

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: repoPath.id,
          cliType: "claude-code",
          content: "Fix the login bug",
          worktree: { parentPathId: repoPath.id, branch: "feat/os-1222", baseRef: "main" },
        })
      );

      expect(response?.error).toBeUndefined();
      await t.run(async (runCtx) => {
        const threads = await runCtx.db.query("cliThreads").collect();
        expect(threads).toHaveLength(1);
        // The CLI repoints this on claim; until then the thread runs nowhere else.
        expect(threads[0]?.pathId).toBe(repoPath.id);
        expect(threads[0]?.git?.worktree).toMatchObject({
          parentPathId: repoPath.id,
          branch: "feat/os-1222",
          baseRef: "main",
          status: "pending",
        });
      });
    });

    test("rejects a parent that is not the selected path", async () => {
      const { profile, repoPath, worktreePath, key, ctx } = await realCtx();

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: repoPath.id,
          cliType: "claude-code",
          content: "Go",
          worktree: { parentPathId: worktreePath.id, branch: "feat/os-1222" },
        })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("Worktree parent must match the selected path");
    });

    // The case an agent spawning from a thread already in a worktree walks into: it
    // must send the parent repo's `pathId` rather than inherit the worktree's.
    test("rejects a worktree as the parent", async () => {
      const { profile, worktreePath, key, ctx } = await realCtx();

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: worktreePath.id,
          cliType: "claude-code",
          content: "Go",
          worktree: { parentPathId: worktreePath.id, branch: "feat/os-1222" },
        })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("Worktrees can only be created from a repository path");
    });

    test("rejects an illegal branch name", async () => {
      const { profile, repoPath, key, ctx } = await realCtx();

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: repoPath.id,
          cliType: "claude-code",
          content: "Go",
          worktree: { parentPathId: repoPath.id, branch: "bad..branch" },
        })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("Invalid worktree branch name");
    });

    test("binds a real agent and snapshots its prompt", async () => {
      const { project, asUser, profile, repoPath, key, ctx, t } = await realCtx();
      const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        name: "Reviewer",
        prompt: "You are a meticulous reviewer.",
        appearance: { color: "#22c55e" },
      });

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: repoPath.id,
          cliType: "claude-code",
          content: "Review this",
          projectAgentId,
        })
      );

      expect(response?.error).toBeUndefined();
      await t.run(async (runCtx) => {
        const threads = await runCtx.db.query("cliThreads").collect();
        expect(threads[0]?.projectAgentId).toBe(projectAgentId);
        expect(threads[0]?.agentPromptSnapshot).toBe("You are a meticulous reviewer.");
      });
    });

    test("rejects an agent from another project", async () => {
      const { testCtx, profile, repoPath, key, ctx } = await realCtx();
      const other = await testCtx.setupProject();
      const projectAgentId = await other.asUser.mutation(api.agents.projectAgents.create, {
        projectId: other.project._id,
        name: "Outsider",
        appearance: { color: "#22c55e" },
      });

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: repoPath.id,
          cliType: "claude-code",
          content: "Review this",
          projectAgentId,
        })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("Project agent must belong to the thread's project");
    });

    test("rejects a deleted agent", async () => {
      const { project, asUser, profile, repoPath, key, ctx } = await realCtx();
      const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        name: "Retired",
        appearance: { color: "#22c55e" },
      });
      await asUser.mutation(api.agents.projectAgents.deleteProjectAgent, { projectAgentId });

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: repoPath.id,
          cliType: "claude-code",
          content: "Review this",
          projectAgentId,
        })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("Project agent not found");
    });

    // `v.id("projectAgents")` rejects a foreign-table id in the *argument validator*,
    // whose message `isConvexIdError` must match or the agent gets -32603 and a raw
    // validator blob. Same failure mode pinned for `threadId` below.
    test("answers -32602 for a foreign-table id as the agent", async () => {
      const { project, profile, repoPath, key, ctx } = await realCtx();

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: repoPath.id,
          cliType: "claude-code",
          content: "Review this",
          projectAgentId: project._id,
        })
      );

      expect(response?.error?.code).toBe(-32602);
    });

    // The runtime gate lives in `createThreadCore`, so this pins that its domain error
    // reaches the agent as -32602 with the reason rather than an opaque -32603.
    test("answers -32602 when the target runtime cannot open on a command", async () => {
      const { profile, repoPath, key, ctx } = await realCtx();

      const response = await handleMcpRequest(
        ctx,
        key,
        call({
          profileId: profile._id,
          pathId: repoPath.id,
          cliType: "cursor",
          content: "/security-review",
          runtimeCommand: true,
        })
      );

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toMatch(/cannot start a thread/i);
    });
  });
});

describe("handleMcpRequest send_thread_message", () => {
  function sendCtx(mutation?: () => Promise<unknown>) {
    const runMutation = mutation
      ? vi.fn().mockImplementation(mutation)
      : vi.fn().mockResolvedValue("message_1");
    const ctx = { runMutation } as unknown as ActionCtx;
    return { ctx, runMutation };
  }

  const call = (args: Record<string, unknown>) => ({
    jsonrpc: "2.0" as const,
    id: "send-thread-message",
    method: "tools/call",
    params: { name: "send_thread_message", arguments: args },
  });

  test("tools/list advertises the tool, requiring only the target and the text", async () => {
    const { ctx } = createActionCtx(null);

    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0",
      id: "send-thread-message-tools",
      method: "tools/list",
    });

    const tools = isRecord(response?.result) && Array.isArray(response.result.tools)
      ? (response.result.tools as Array<Record<string, unknown>>)
      : [];
    const tool = tools.find((entry) => entry.name === "send_thread_message");
    expect(tool).toBeDefined();
    expect(isRecord(tool?.inputSchema) ? tool.inputSchema.required : undefined).toEqual([
      "threadId",
      "content",
    ]);
    // `sourceThreadId`, matching create_thread — never `sentBy`, a schema field.
    expect(getToolSchemaProperty(tools, "send_thread_message", "sourceThreadId")).toMatchObject({
      type: "string",
    });
    expect(getToolSchemaProperty(tools, "send_thread_message", "sentBy")).toBeUndefined();
    // No attachments here either: the upload flow needs a direct POST.
    expect(getToolSchemaProperty(tools, "send_thread_message", "attachments")).toBeUndefined();
    expect(getToolSchemaProperty(tools, "send_thread_message", "runtimeCommand")).toMatchObject({
      type: "boolean",
    });
    expect(getToolSchemaProperty(tools, "send_thread_message", "steer")).toMatchObject({
      type: "boolean",
    });
  });

  test("queues the message and attributes it to the calling thread", async () => {
    const { ctx, runMutation } = sendCtx();

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "thread_1", content: "  Review is done  ", sourceThreadId: "thread_2" })
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.cli.messages.send, {
      threadId: "thread_1",
      content: "Review is done",
      sentBy: { kind: "thread", threadId: "thread_2" },
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      messageId: "message_1",
      threadId: "thread_1",
    });
  });

  test("omits sentBy without a source, keeping absence as 'a human sent it'", async () => {
    const { ctx, runMutation } = sendCtx();

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "thread_1", content: "Hello" })
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.cli.messages.send, {
      threadId: "thread_1",
      content: "Hello",
      apiKey: "sk_user_test",
    });
  });

  test("surfaces the domain's container rejection", async () => {
    // A container has a real runtime target, so a queued message would run on it.
    const { ctx } = sendCtx(() => {
      throw new ConvexError("Groups and workflow runs cannot receive messages");
    });

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "container_1", content: "Hello?" })
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("cannot receive messages");
  });

  test("surfaces the domain's rejection of another user's thread", async () => {
    const { ctx } = sendCtx(() => {
      throw new ConvexError("Not authorized");
    });

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "their_thread", content: "Hello?" })
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("Not authorized");
  });

  test("names empty content before any write", async () => {
    const { ctx, runMutation } = sendCtx();

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "thread_1", content: "   " })
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("content");
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("forwards a runtime command for the target's runtime to interpret", async () => {
    const { ctx, runMutation } = sendCtx();

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "thread_1", content: "/compact", runtimeCommand: true })
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.cli.messages.send, {
      threadId: "thread_1",
      content: "/compact",
      runtimeCommand: true,
      apiKey: "sk_user_test",
    });
  });

  /**
   * `send` drops the flag for non-slash content, so this would queue as prose and the
   * agent would narrate a compaction that never happened — the OS-1582 failure mode.
   */
  test("rejects runtimeCommand on prose rather than silently sending text", async () => {
    const { ctx, runMutation } = sendCtx();

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "thread_1", content: "please compact", runtimeCommand: true })
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("runtimeCommand");
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("omits the flag when absent, so text stays text", async () => {
    const { ctx, runMutation } = sendCtx();

    await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "thread_1", content: "/not-a-command-just-text" })
    );

    expect(runMutation).toHaveBeenCalledWith(api.cli.messages.send, {
      threadId: "thread_1",
      content: "/not-a-command-just-text",
      apiKey: "sk_user_test",
    });
  });

  test("forwards steer so the send itself requests the injection (OS-1873)", async () => {
    const { ctx, runMutation } = sendCtx();

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "thread_1", content: "Look at this first", steer: true })
    );

    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.cli.messages.send, {
      threadId: "thread_1",
      content: "Look at this first",
      steer: true,
      apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({
      messageId: "message_1",
      threadId: "thread_1",
    });
  });

  /**
   * Runtime commands are never steered (`send` would drop the flag), so accepting the
   * pair would imply an injected command that cannot happen — fail visibly instead.
   */
  test("rejects steer on a runtime command", async () => {
    const { ctx, runMutation } = sendCtx();

    const response = await handleMcpRequest(
      ctx,
      "sk_user_test",
      call({ threadId: "thread_1", content: "/compact", runtimeCommand: true, steer: true })
    );

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("steer");
    expect(runMutation).not.toHaveBeenCalled();
  });

  /**
   * Against the real mutation, not a mock. The tests above hand-write the domain's
   * error strings into `vi.fn()`, so they cannot see an argument-validator mismatch
   * or a missing guard — the two defects this describe block exists to pin.
   */
  describe("against the real mutation", () => {
    async function realCtx() {
      const testCtx = createTestContext();
      const { user, project, asUser, t } = await testCtx.setupProject();
      const profile = await testCtx.cliProfile(user._id, project._id);
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "MCP send",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      // Delegates to the real functions, so argument validators and domain guards
      // run — the two things a `vi.fn()` mock cannot see.
      const ctx = {
        runQuery: (ref: Parameters<typeof t.query>[0], args: Parameters<typeof t.query>[1]) => t.query(ref, args),
        runMutation: (ref: Parameters<typeof t.mutation>[0], args: Parameters<typeof t.mutation>[1]) => t.mutation(ref, args),
      } as unknown as ActionCtx;

      return { testCtx, user, project, profile, key, ctx, t };
    }

    test("queues the message and attributes it, end to end", async () => {
      const { testCtx, user, project, profile, key, ctx, t } = await realCtx();
      const target = await testCtx.cliThread(user._id, project._id, profile._id);
      const sender = await testCtx.cliThread(user._id, project._id, profile._id);

      const response = await handleMcpRequest(ctx, key, {
        ...call({ threadId: target._id, content: "Review is done", sourceThreadId: sender._id }),
      });

      expect(response?.error).toBeUndefined();
      await t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", target._id);
        // An idle target flips; `hasPendingUserMessages` is the receipt either way.
        expect(thread?.status).toBe("pending");
        expect(thread?.hasPendingUserMessages).toBe(true);
        const messages = await runCtx.db
          .query("cliMessages")
          .filter((q) => q.eq(q.field("threadId"), target._id))
          .collect();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.sentBy).toEqual({ kind: "thread", threadId: sender._id });
      });
    });

    // A shape-valid id from another table: `v.id("cliThreads")` rejects it in the
    // *argument validator*, whose message `isConvexIdError` must match or the agent
    // gets -32603 and a raw validator blob. `projectId` is the realistic mistake.
    test("answers -32602 for a foreign-table id as the target", async () => {
      const { testCtx, user, project, profile, key, ctx } = await realCtx();
      await testCtx.cliThread(user._id, project._id, profile._id);

      const response = await handleMcpRequest(ctx, key, {
        ...call({ threadId: project._id, content: "Hello" }),
      });

      expect(response?.error?.code).toBe(-32602);
    });

    test("answers -32602 for a foreign-table id as the source", async () => {
      const { testCtx, user, project, profile, key, ctx } = await realCtx();
      const target = await testCtx.cliThread(user._id, project._id, profile._id);

      const response = await handleMcpRequest(ctx, key, {
        ...call({ threadId: target._id, content: "Hello", sourceThreadId: project._id }),
      });

      expect(response?.error?.code).toBe(-32602);
    });

    test("rejects a container as the target, naming the group rule", async () => {
      const { testCtx, user, project, profile, key, ctx } = await realCtx();
      const container = await testCtx.cliThread(user._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
      });

      const response = await handleMcpRequest(ctx, key, {
        ...call({ threadId: container._id, content: "Hello?" }),
      });

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("cannot receive messages");
    });

    test("rejects a container as the source, distinctly from the target", async () => {
      const { testCtx, user, project, profile, key, ctx } = await realCtx();
      const target = await testCtx.cliThread(user._id, project._id, profile._id);
      const container = await testCtx.cliThread(user._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
      });

      const response = await handleMcpRequest(ctx, key, {
        ...call({ threadId: target._id, content: "Hi", sourceThreadId: container._id }),
      });

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("cannot send messages");
    });

    // The stored flag is what makes the CLI slice a solo run and deliver the text
    // raw; without it the runtime reads "/compact" as prose.
    test("stores runtimeCommand on the queued message", async () => {
      const { testCtx, user, project, profile, key, ctx, t } = await realCtx();
      const target = await testCtx.cliThread(user._id, project._id, profile._id);

      const response = await handleMcpRequest(ctx, key, {
        ...call({ threadId: target._id, content: "/compact", runtimeCommand: true }),
      });

      expect(response?.error).toBeUndefined();
      await t.run(async (runCtx) => {
        const messages = await runCtx.db
          .query("cliMessages")
          .filter((q) => q.eq(q.field("threadId"), target._id))
          .collect();
        expect(messages[0]?.runtimeCommand).toBe(true);
      });
    });

    // Both ids are arguments, so one shared message would leave an agent unable to
    // tell which of the two it got wrong.
    test("names the source, not the target, when the source is unusable", async () => {
      const { testCtx, user, project, profile, key, ctx } = await realCtx();
      const target = await testCtx.cliThread(user._id, project._id, profile._id);
      const other = await testCtx.user();
      const theirs = await testCtx.cliThread(other._id, project._id, profile._id);

      const response = await handleMcpRequest(ctx, key, {
        ...call({ threadId: target._id, content: "Hi", sourceThreadId: theirs._id }),
      });

      expect(response?.error?.message).toBe("Source thread not found");
    });
  });
});

describe("mark_thread_done", () => {
  test("routes the thread ID and API key without a default project", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runMutation } as unknown as ActionCtx;
    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0", id: "done", method: "tools/call",
      params: { name: "mark_thread_done", arguments: { threadId: "thread_1" } },
    });
    expect(response?.error).toBeUndefined();
    expect(runMutation.mock.calls.map(([fn, args]) => [getFunctionName(fn), args]))
      .toEqual([["cli/threads/core:markDone", { threadId: "thread_1", apiKey: "sk_user_test" }]]);
    expect(parseToolContentJson(response)).toEqual({ threadId: "thread_1" });
  });

  test("routes done: false to markNotDone (OS-2176)", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const response = await handleMcpRequest({ runMutation } as unknown as ActionCtx, "sk_user_test", {
      jsonrpc: "2.0", id: "done", method: "tools/call",
      params: { name: "mark_thread_done", arguments: { threadId: "thread_1", done: false } },
    });
    expect(response?.error).toBeUndefined();
    expect(runMutation.mock.calls.map(([fn, args]) => [getFunctionName(fn), args]))
      .toEqual([["cli/threads/core:markNotDone", { threadId: "thread_1", apiKey: "sk_user_test" }]]);
  });

  test("rejects a non-boolean done before mutation", async () => {
    const runMutation = vi.fn();
    const response = await handleMcpRequest({ runMutation } as unknown as ActionCtx, "sk_user_test", {
      jsonrpc: "2.0", id: "done", method: "tools/call",
      params: { name: "mark_thread_done", arguments: { threadId: "thread_1", done: "no" } },
    });
    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("rejects a missing thread ID before mutation", async () => {
    const runMutation = vi.fn();
    const response = await handleMcpRequest({ runMutation } as unknown as ActionCtx, "sk_user_test", {
      jsonrpc: "2.0", id: "done", method: "tools/call",
      params: { name: "mark_thread_done", arguments: {} },
    });
    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("attach_task_to_thread (OS-1713)", () => {
  test("routes a raw task ID and returns the thread summary", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const runQuery = vi.fn().mockResolvedValue({ _id: "thread_1", associatedTaskId: "task_1" });
    const ctx = { runMutation, runQuery } as unknown as ActionCtx;
    const response = await handleMcpRequest(ctx, "sk_user_test", {
      jsonrpc: "2.0", id: "attach", method: "tools/call",
      params: { name: "attach_task_to_thread", arguments: { threadId: "thread_1", taskId: "task_1" } },
    });
    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.cli.threads.core.attachTask, {
      threadId: "thread_1", taskId: "task_1", apiKey: "sk_user_test",
    });
    expect(runQuery).toHaveBeenCalledWith(api.cli.threads.summaries.getSummary, { threadId: "thread_1", apiKey: "sk_user_test" });
    expect(parseToolContentJson(response)).toEqual({ _id: "thread_1", associatedTaskId: "task_1" });
  });

  test("resolves a bare ref in the thread's own project", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const runQuery = vi.fn().mockImplementation(async (query, args) => {
      if (getFunctionName(query) === "tasks/core:getByRefs") {
        expect(args.projectId).toBe("project_thread");
        return { results: [{ ref: "OS-5", task: { _id: "task_5", refId: "OS-5" } }] };
      }
      return { _id: "thread_1", projectId: "project_thread" };
    });
    const response = await handleMcpRequest({ runMutation, runQuery } as unknown as ActionCtx, "sk_user_test", {
      jsonrpc: "2.0", id: "attach", method: "tools/call",
      params: { name: "attach_task_to_thread", arguments: { threadId: "thread_1", taskId: "OS-5" } },
    });
    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.cli.threads.core.attachTask, {
      threadId: "thread_1", taskId: "task_5", apiKey: "sk_user_test",
    });
  });

  test("rejects an unreadable thread before mutation", async () => {
    const runMutation = vi.fn();
    const response = await handleMcpRequest({ runMutation, runQuery: vi.fn().mockResolvedValue(null) } as unknown as ActionCtx, "sk_user_test", {
      jsonrpc: "2.0", id: "attach", method: "tools/call",
      params: { name: "attach_task_to_thread", arguments: { threadId: "thread_1", taskId: "OS-5" } },
    });
    expect(response?.error?.code).toBe(-32602);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("attach_pull_request_to_thread", () => {
  test("routes the PR and returns the thread summary", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const runQuery = vi.fn().mockResolvedValue({ _id: "thread_1" });
    const response = await handleMcpRequest({ runMutation, runQuery } as unknown as ActionCtx, "sk_user_test", {
      jsonrpc: "2.0", id: "attach-pr", method: "tools/call",
      params: { name: "attach_pull_request_to_thread", arguments: { threadId: "thread_1", pullRequest: " contoso/convoy#482 " } },
    });
    expect(response?.error).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(api.cli.threads.core.attachPullRequest, {
      threadId: "thread_1", pullRequest: "contoso/convoy#482", apiKey: "sk_user_test",
    });
    expect(parseToolContentJson(response)).toEqual({ _id: "thread_1" });
  });
});
