import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

const validSlashCommandInput = {
  key: "review",
  description: "Review a contract",
  category: "Legal",
  content: "# Contract Review\n\nReview this contract.",
};

describe("slashCommands", () => {
  test("project members can create project prompts and viewers can only read them", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();
    const member = await ctx.user();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    const slashCommandId = await ctx.asUser(member).mutation(api.slashCommands.core.createInProject, {
      projectId: project._id,
      ...validSlashCommandInput,
    });

    const commands = await ctx.asUser(viewer).query(api.slashCommands.core.listByProject, {
      projectId: project._id,
    });
    expect(commands).toMatchObject([
      {
        _id: slashCommandId,
        scope: "project",
        organizationId: org._id,
        projectId: project._id,
      },
    ]);
    expect(
      await ctx.asUser(viewer).query(api.slashCommands.core.listComposerCatalog, {
        organizationId: org._id,
        projectId: project._id,
      })
    ).toHaveLength(1);

    await expect(
      ctx.asUser(viewer).mutation(api.slashCommands.core.createInProject, {
        projectId: project._id,
        ...validSlashCommandInput,
        key: "viewer-prompt",
      })
    ).rejects.toThrow("Permission denied");
    await expect(
      ctx.asUser(viewer).mutation(api.slashCommands.core.update, {
        slashCommandId,
        key: "viewer-update",
      })
    ).rejects.toThrow("Permission denied");
  });

  test("a project prompt reads as absent outside its project instead of throwing", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, { alias: "P02" });
    const orgAdmin = await ctx.user();
    await ctx.orgMember(org._id, orgAdmin._id, "admin");
    const otherProjectMember = await ctx.user();
    await ctx.orgMember(org._id, otherProjectMember._id, "member");
    await ctx.projectMember(otherProject._id, otherProjectMember._id, "member");

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInProject, {
      projectId: project._id,
      ...validSlashCommandInput,
    });

    // An unreachable Prompt reads as missing, so the editor shows its not-found
    // card instead of the route error boundary.
    expect(await ctx.asUser(orgAdmin).query(api.slashCommands.core.get, { slashCommandId })).toBeNull();
    expect(await ctx.asUser(otherProjectMember).query(api.slashCommands.core.get, { slashCommandId })).toBeNull();
    // Asking for a project's list is still a denial: that page needs the project.
    await expect(ctx.asUser(orgAdmin).query(api.slashCommands.core.listByProject, { projectId: project._id })).rejects.toThrow(
      "Not a member of this project"
    );
  });

  test("project keys are unique per project and may collide with organization keys", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, { alias: "P02" });

    await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "review",
    });
    await asUser.mutation(api.slashCommands.core.createInProject, {
      projectId: project._id,
      ...validSlashCommandInput,
      key: "review",
    });
    await asUser.mutation(api.slashCommands.core.createInProject, {
      projectId: otherProject._id,
      ...validSlashCommandInput,
      key: "review",
    });

    await expect(
      asUser.mutation(api.slashCommands.core.createInProject, {
        projectId: project._id,
        ...validSlashCommandInput,
        key: "/REVIEW",
      })
    ).rejects.toThrow("already exists");
  });

  test("project composer catalog returns project commands before organization commands", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const organizationId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "review",
    });
    const projectId = await asUser.mutation(api.slashCommands.core.createInProject, {
      projectId: project._id,
      ...validSlashCommandInput,
      key: "review",
    });

    const catalog = await asUser.query(api.slashCommands.core.listComposerCatalog, {
      organizationId: org._id,
      projectId: project._id,
    });

    expect(catalog.map(({ id, scope, canonicalKey }) => ({ id, scope, canonicalKey }))).toEqual([
      { id: projectId, scope: "project", canonicalKey: "project:review" },
      { id: organizationId, scope: "organization", canonicalKey: "org:review" },
    ]);
  });

  test("owner can create an organization slash command", async () => {
    const ctx = createTestContext();
    const { org, user, asUser, t } = await ctx.setupOrg();

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      autoExpand: true,
      autoSubmit: true,
    });

    await t.run(async (runCtx) => {
      const slashCommand = await runCtx.db.get("slashCommands", slashCommandId);
      expect(slashCommand?.organizationId).toBe(org._id);
      expect(slashCommand?.scope).toBe("organization");
      expect(slashCommand?.createdBy).toBe(user._id);
      expect(slashCommand?.updatedBy).toBe(user._id);
      expect(slashCommand?.autoExpand).toBe(true);
      expect(slashCommand?.autoSubmit).toBe(true);
      expect(slashCommand?.isDeleted).toBe(false);
    });
  });

  test("owner can create uncategorized markdown command and list full content", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const content = "# Contract Review\n\nAnalyze the contract terms.";

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      key: "review",
      content,
    });

    const list = await asUser.query(api.slashCommands.core.listByOrganization, {
      organizationId: org._id,
    });

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      _id: slashCommandId,
      key: "review",
      content,
      autoExpand: false,
      autoSubmit: false,
    });
    expect(list[0].description).toBeUndefined();
    expect(list[0].category).toBeUndefined();
  });

  test("admin can create an organization slash command", async () => {
    const ctx = createTestContext();
    const { org } = await ctx.setupOrg();
    const admin = await ctx.user();
    await ctx.orgMember(org._id, admin._id, "admin");

    const slashCommandId = await ctx.asUser(admin).mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
    });

    expect(slashCommandId).toBeDefined();
  });

  test("member cannot create, update, or delete organization slash commands", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    const asMember = ctx.asUser(member);

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
    });

    await expect(
      asMember.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        key: "member-key",
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      asMember.mutation(api.slashCommands.core.update, {
        slashCommandId,
        key: "updated",
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      asMember.mutation(api.slashCommands.core.deleteSlashCommand, {
        slashCommandId,
      })
    ).rejects.toThrow("Permission denied");
  });

  test("member can list and get active organization slash commands", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    const asMember = ctx.asUser(member);

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
    });

    const list = await asMember.query(api.slashCommands.core.listByOrganization, {
      organizationId: org._id,
    });
    const fetched = await asMember.query(api.slashCommands.core.get, { slashCommandId });

    expect(list).toHaveLength(1);
    expect(list[0].content).toBe(validSlashCommandInput.content);
    expect(fetched?._id).toBe(slashCommandId);
  });

  test("listComposerCatalog returns scoped canonical command items", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      key: "client-summary",
      description: "Summarize client facts",
      content: "Summarize the client context.",
      autoExpand: false,
      autoSubmit: true,
    });

    const catalog = await asUser.query(api.slashCommands.core.listComposerCatalog, {
      organizationId: org._id,
    });

    expect(catalog).toEqual([
      {
        id: slashCommandId,
        scope: "organization",
        key: "client-summary",
        canonicalKey: "org:client-summary",
        displayLabel: "/client-summary",
        description: "Summarize client facts",
        content: "Summarize the client context.",
        autoExpand: false,
        autoSubmit: true,
      },
    ]);
  });

  test("outsider cannot list or get organization slash commands", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
    });

    await expect(
      asOutsider.query(api.slashCommands.core.listByOrganization, {
        organizationId: org._id,
      })
    ).rejects.toThrow("Not a member of this organization");

    await expect(asOutsider.query(api.slashCommands.core.get, { slashCommandId })).rejects.toThrow("Not a member of this organization");
  });

  test("autoExpand defaults to false", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
    });

    const fetched = await asUser.query(api.slashCommands.core.get, { slashCommandId });
    expect(fetched?.autoExpand).toBe(false);
    expect(fetched?.autoSubmit).toBe(false);
  });

  test("owner can update autoSubmit", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
    });

    await asUser.mutation(api.slashCommands.core.update, {
      slashCommandId,
      autoSubmit: true,
    });

    const fetched = await asUser.query(api.slashCommands.core.get, { slashCommandId });
    expect(fetched?.autoSubmit).toBe(true);
  });

  test("normalizes key and optional strings", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      key: "  /Case:Summary-2  ",
      description: "   ",
      category: "   ",
      content: "  Draft the summary.  ",
    });

    const fetched = await asUser.query(api.slashCommands.core.get, { slashCommandId });

    expect(fetched?.key).toBe("case:summary-2");
    expect(fetched?.description).toBeUndefined();
    expect(fetched?.category).toBeUndefined();
    expect(fetched?.content).toBe("Draft the summary.");
  });

  test("rejects duplicate normalized active keys on create and update", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "review",
    });
    const secondId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "research",
    });

    await expect(
      asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        key: " /REVIEW ",
      })
    ).rejects.toThrow("already exists");

    await expect(
      asUser.mutation(api.slashCommands.core.update, {
        slashCommandId: secondId,
        key: "/review",
      })
    ).rejects.toThrow("already exists");
  });

  test("soft delete hides commands and allows key reuse", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    const deletedId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "reuse",
    });

    await asUser.mutation(api.slashCommands.core.deleteSlashCommand, { slashCommandId: deletedId });

    const listAfterDelete = await asUser.query(api.slashCommands.core.listByOrganization, {
      organizationId: org._id,
    });
    const fetchedAfterDelete = await asUser.query(api.slashCommands.core.get, {
      slashCommandId: deletedId,
    });
    const reusedId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "reuse",
    });

    expect(listAfterDelete).toHaveLength(0);
    expect(fetchedAfterDelete).toBeNull();
    expect(reusedId).not.toBe(deletedId);
  });

  test("rejects invalid keys", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    await expect(
      asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        key: "a",
      })
    ).rejects.toThrow("between 2 and 40");

    await expect(
      asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        key: "a".repeat(41),
      })
    ).rejects.toThrow("between 2 and 40");

    await expect(
      asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        key: "has space",
      })
    ).rejects.toThrow("can only contain");

    await expect(
      asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        key: "has_underscore",
      })
    ).rejects.toThrow("can only contain");
  });

  test("allows uppercase input after normalization and reserved-looking prefixes", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    const orgPrefixedId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "ORG:Client-Summary",
    });
    const proPrefixedId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "pro:client-summary",
    });
    const updateTargetId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      key: "review-2",
    });

    await asUser.mutation(api.slashCommands.core.update, {
      slashCommandId: updateTargetId,
      key: "ORG:Review",
    });

    const orgPrefixed = await asUser.query(api.slashCommands.core.get, {
      slashCommandId: orgPrefixedId,
    });
    const proPrefixed = await asUser.query(api.slashCommands.core.get, {
      slashCommandId: proPrefixedId,
    });
    const updateTarget = await asUser.query(api.slashCommands.core.get, {
      slashCommandId: updateTargetId,
    });

    expect(orgPrefixed?.key).toBe("org:client-summary");
    expect(proPrefixed?.key).toBe("pro:client-summary");
    expect(updateTarget?.key).toBe("org:review");
  });

  test("API keys can manage prompts within their scope only", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const { key: orgKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Org key",
      expiresAt,
      scope: { organizationId: org._id, projectIds: [] },
    });
    const { key: otherOrgKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Other org key",
      expiresAt,
      scope: { organizationId: otherOrg._id, projectIds: [] },
    });

    const organizationPromptId = await t.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      ...validSlashCommandInput,
      apiKey: orgKey,
    });
    const projectPromptId = await t.mutation(api.slashCommands.core.createInProject, {
      projectId: project._id,
      ...validSlashCommandInput,
      key: "project-review",
      apiKey: orgKey,
    });

    await t.mutation(api.slashCommands.core.update, {
      slashCommandId: organizationPromptId,
      description: "Updated through an API key",
      apiKey: orgKey,
    });

    const organizationPrompts = await t.query(api.slashCommands.core.listByOrganization, {
      organizationId: org._id,
      apiKey: orgKey,
    });
    const projectPrompts = await t.query(api.slashCommands.core.listByProject, {
      projectId: project._id,
      apiKey: orgKey,
    });
    expect(organizationPrompts).toMatchObject([
      { _id: organizationPromptId, description: "Updated through an API key" },
    ]);
    expect(projectPrompts).toMatchObject([{ _id: projectPromptId, key: "project-review" }]);

    // A key scoped to another organization must not reach this organization's
    // prompts even though its owner is a member of both.
    await expect(
      t.query(api.slashCommands.core.listByOrganization, {
        organizationId: org._id,
        apiKey: otherOrgKey,
      })
    ).rejects.toThrow("API key is not scoped to this organization");

    await expect(
      t.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        key: "out-of-scope",
        apiKey: otherOrgKey,
      })
    ).rejects.toThrow("API key is not scoped to this organization");

    await expect(
      t.mutation(api.slashCommands.core.update, {
        slashCommandId: organizationPromptId,
        key: "out-of-scope",
        apiKey: otherOrgKey,
      })
    ).rejects.toThrow("API key is not scoped to this organization");
  });

  test("project-scoped API keys cannot manage organization prompts", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, {
      name: "Other Project",
      alias: "OTHR",
    });

    const { key: projectKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Project key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: { organizationId: org._id, projectIds: [project._id] },
    });

    await expect(
      t.query(api.slashCommands.core.listByProject, {
        projectId: otherProject._id,
        apiKey: projectKey,
      })
    ).rejects.toThrow();

    // Organization prompts show up in every project of the organization, so a
    // key narrowed to one project cannot write them...
    await expect(
      t.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        apiKey: projectKey,
      })
    ).rejects.toThrow("API key is scoped to specific projects");

    // ...or read them.
    await expect(
      t.query(api.slashCommands.core.listByOrganization, {
        organizationId: org._id,
        apiKey: projectKey,
      })
    ).rejects.toThrow("API key is scoped to specific projects");
  });

  test("requires content", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    await expect(
      asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        ...validSlashCommandInput,
        content: "   ",
      })
    ).rejects.toThrow("content is required");
  });
});
