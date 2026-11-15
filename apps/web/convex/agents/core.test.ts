import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

const validAppearance = { color: "#3b82f6" };
const extendedPaletteAppearance = { color: "#fca5a5" };

const validAgentInput = {
  name: "Code Reviewer",
  description: "Reviews code changes",
  prompt: "Review the latest code changes.",
  category: "Engineering",
  appearance: validAppearance,
};

const validProjectAgentInput = {
  name: "Release Planner",
  description: "Plans releases",
  prompt: "Plan the next release.",
  category: "Delivery",
  appearance: { color: "#22c55e" },
};

describe("agents", () => {
  test("owner can create an organization Agent with normalized fields and audit data", async () => {
    const ctx = createTestContext();
    const { org, user, asUser, t } = await ctx.setupOrg();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      name: "  Code   Reviewer  ",
      description: "   ",
      prompt: "  Review the latest code changes.  ",
      category: "  Engineering  ",
      appearance: validAppearance,
    });

    await t.run(async (runCtx) => {
      const agent = await runCtx.db.get("agents", agentId);
      expect(agent).toMatchObject({
        organizationId: org._id,
        name: "Code Reviewer",
        normalizedName: "code reviewer",
        prompt: "Review the latest code changes.",
        category: "Engineering",
        appearance: validAppearance,
        createdBy: user._id,
        updatedBy: user._id,
        isDeleted: false,
      });
      expect(agent?.description).toBeUndefined();
      expect(agent?.createdAt).toEqual(expect.any(Number));
      expect(agent?.updatedAt).toEqual(expect.any(Number));
    });
  });

  test("admin can manage organization Agents, member can only list and get them", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const admin = await ctx.user();
    const member = await ctx.user();
    await ctx.orgMember(org._id, admin._id, "admin");
    await ctx.orgMember(org._id, member._id, "member");
    const asAdmin = ctx.asUser(admin);
    const asMember = ctx.asUser(member);

    const agentId = await asAdmin.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });

    const list = await asMember.query(api.agents.core.listByOrganization, {
      organizationId: org._id,
    });
    const fetched = await asMember.query(api.agents.core.get, { agentId });

    expect(list.map((agent) => agent._id)).toEqual([agentId]);
    expect(fetched?._id).toBe(agentId);
    expect("normalizedName" in list[0]).toBe(false);
    expect(fetched && "normalizedName" in fetched).toBe(false);

    await expect(
      asMember.mutation(api.agents.core.create, {
        organizationId: org._id,
        ...validAgentInput,
        name: "Member Agent",
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      asMember.mutation(api.agents.core.update, {
        agentId,
        name: "Updated by Member",
      })
    ).rejects.toThrow("Permission denied");

    await expect(asMember.mutation(api.agents.core.deleteAgent, { agentId })).rejects.toThrow("Permission denied");

    await asUser.mutation(api.agents.core.update, {
      agentId,
      name: "Owner Updated",
    });
  });

  test("outsider cannot list, get, or mutate organization Agents", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });

    await expect(
      asOutsider.query(api.agents.core.listByOrganization, {
        organizationId: org._id,
      })
    ).resolves.toEqual([]);
    await expect(asOutsider.query(api.agents.core.get, { agentId })).resolves.toBeNull();
    await expect(
      asOutsider.mutation(api.agents.core.create, {
        organizationId: org._id,
        ...validAgentInput,
        name: "Outsider Agent",
      })
    ).rejects.toThrow("Not a member of this organization");
  });

  test("organization Agent names are unique among active templates and reusable after delete", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    const firstId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
      name: "Code Reviewer",
    });
    const secondId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
      name: "Release Planner",
    });

    await expect(
      asUser.mutation(api.agents.core.create, {
        organizationId: org._id,
        ...validAgentInput,
        name: "  CODE   REVIEWER  ",
      })
    ).rejects.toThrow(`An agent named "Code Reviewer" already exists`);

    await expect(
      asUser.mutation(api.agents.core.update, {
        agentId: secondId,
        name: " code reviewer ",
      })
    ).rejects.toThrow("already exists");

    await asUser.mutation(api.agents.core.deleteAgent, { agentId: firstId });
    const fetchedAfterDelete = await asUser.query(api.agents.core.get, {
      agentId: firstId,
    });
    const listAfterDelete = await asUser.query(api.agents.core.listByOrganization, {
      organizationId: org._id,
    });
    const reusedId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
      name: "Code Reviewer",
    });

    expect(fetchedAfterDelete).toBeNull();
    expect(listAfterDelete.map((agent) => agent._id)).toEqual([secondId]);
    expect(reusedId).not.toBe(firstId);
  });

  test("organization Agent validation rejects blank name and unsupported colors while allowing blank prompt", async () => {
    const ctx = createTestContext();
    const { org, asUser, t } = await ctx.setupOrg();

    await expect(
      asUser.mutation(api.agents.core.create, {
        organizationId: org._id,
        ...validAgentInput,
        name: "   ",
      })
    ).rejects.toThrow("Agent name is required");

    const blankPromptAgentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
      name: "Promptless Agent",
      prompt: "   ",
    });
    await t.run(async (runCtx) => {
      const agent = await runCtx.db.get("agents", blankPromptAgentId);
      expect(agent?.prompt).toBeUndefined();
    });

    const extendedColorAgentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
      name: "Extended Palette Agent",
      appearance: extendedPaletteAppearance,
    });
    await t.run(async (runCtx) => {
      const agent = await runCtx.db.get("agents", extendedColorAgentId);
      expect(agent?.appearance).toEqual(extendedPaletteAppearance);
    });

    await expect(
      asUser.mutation(api.agents.core.create, {
        organizationId: org._id,
        ...validAgentInput,
        appearance: { color: "#000000" },
      })
    ).rejects.toThrow("supported palette colors");
  });

  test("project member, project admin, and org admin can manage Project agents while viewer can only read", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const projectMember = await ctx.user();
    const projectViewer = await ctx.user();
    const orgAdmin = await ctx.user();
    await ctx.orgMember(org._id, projectMember._id, "member");
    await ctx.projectMember(project._id, projectMember._id, "member");
    await ctx.orgMember(org._id, projectViewer._id, "member");
    await ctx.projectMember(project._id, projectViewer._id, "viewer");
    await ctx.orgMember(org._id, orgAdmin._id, "admin");
    // An org admin manages through their own project row, not their org role (OS-1536).
    await ctx.projectMember(project._id, orgAdmin._id, "project-admin");

    const asProjectMember = ctx.asUser(projectMember);
    const asProjectViewer = ctx.asUser(projectViewer);
    const asOrgAdmin = ctx.asUser(orgAdmin);

    const memberAgentId = await asProjectMember.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });
    await asOrgAdmin.mutation(api.agents.projectAgents.update, {
      projectAgentId: memberAgentId,
      description: "Updated by org admin",
    });

    const list = await asProjectViewer.query(api.agents.projectAgents.listByProject, {
      projectId: project._id,
    });
    const fetched = await asProjectViewer.query(api.agents.projectAgents.get, {
      projectAgentId: memberAgentId,
    });

    expect(list.map((agent) => agent._id)).toEqual([memberAgentId]);
    expect(fetched?.description).toBe("Updated by org admin");

    await expect(
      asProjectViewer.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        ...validProjectAgentInput,
        name: "Viewer Agent",
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      asProjectViewer.mutation(api.agents.projectAgents.update, {
        projectAgentId: memberAgentId,
        name: "Viewer Updated",
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      asProjectViewer.mutation(api.agents.projectAgents.deleteProjectAgent, {
        projectAgentId: memberAgentId,
      })
    ).rejects.toThrow("Permission denied");

    const ownerAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "Owner Agent",
    });
    expect(ownerAgentId).toBeDefined();
  });

  test("API keys can create and update Project agents only with manage access and project scope", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const projectViewer = await ctx.user();
    await ctx.orgMember(org._id, projectViewer._id, "member");
    await ctx.projectMember(project._id, projectViewer._id, "viewer");
    const asProjectViewer = ctx.asUser(projectViewer);
    const otherProject = await ctx.project(org._id, user._id, {
      name: "Other Project",
      alias: "OTHR",
    });

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const { key: managerKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Project manager key",
      expiresAt,
      scope: {
        organizationId: org._id,
        projectIds: [project._id],
      },
    });
    const { key: viewerKey } = await asProjectViewer.mutation(api.apiKeys.core.create, {
      name: "Viewer key",
      expiresAt,
      scope: {
        organizationId: org._id,
        projectIds: [project._id],
      },
    });
    const { key: outOfScopeKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Out-of-scope key",
      expiresAt,
      scope: {
        organizationId: org._id,
        projectIds: [otherProject._id],
      },
    });

    const projectAgentId = await t.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "API Managed Agent",
      apiKey: managerKey,
    });

    await t.mutation(api.agents.projectAgents.update, {
      projectAgentId,
      description: "Updated through MCP",
      prompt: null,
      category: null,
      apiKey: managerKey,
    });

    const fetched = await asUser.query(api.agents.projectAgents.get, {
      projectAgentId,
    });
    expect(fetched?.description).toBe("Updated through MCP");
    expect(fetched?.prompt).toBeUndefined();
    expect(fetched?.category).toBeUndefined();

    await expect(
      t.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        ...validProjectAgentInput,
        name: "Viewer API Agent",
        apiKey: viewerKey,
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      t.mutation(api.agents.projectAgents.update, {
        projectAgentId,
        name: "Out of Scope Update",
        apiKey: outOfScopeKey,
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      t.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        ...validProjectAgentInput,
        name: "Invalid Color API Agent",
        appearance: { color: "#000000" },
        apiKey: managerKey,
      })
    ).rejects.toThrow("supported palette colors");
  });

  test("outsider receives empty Project-agent reads and cannot mutate", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);

    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });

    await expect(
      asOutsider.query(api.agents.projectAgents.listByProject, {
        projectId: project._id,
      })
    ).resolves.toEqual([]);
    await expect(asOutsider.query(api.agents.projectAgents.get, { projectAgentId })).resolves.toBeNull();
    await expect(
      asOutsider.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        ...validProjectAgentInput,
        name: "Outsider Agent",
      })
    ).rejects.toThrow("Not a member of this organization");
  });

  test("direct Project-agent create stores project-local fields without a source Agent", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "  Release   Planner  ",
      description: "   ",
      prompt: "  Plan the next release.  ",
      category: "  Delivery  ",
      appearance: validProjectAgentInput.appearance,
    });

    await t.run(async (runCtx) => {
      const projectAgent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(projectAgent).toMatchObject({
        projectId: project._id,
        name: "Release Planner",
        normalizedName: "release planner",
        prompt: "Plan the next release.",
        category: "Delivery",
        appearance: validProjectAgentInput.appearance,
        createdBy: user._id,
        updatedBy: user._id,
        isDeleted: false,
      });
      expect(projectAgent?.sourceAgentId).toBeUndefined();
      expect(projectAgent?.description).toBeUndefined();
    });
  });

  test("copying an Agent snapshots fields and survives later source edits and deletion", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.copyFromAgent, {
      projectId: project._id,
      agentId,
    });

    await asUser.mutation(api.agents.core.update, {
      agentId,
      name: "Updated Template",
      description: "Updated description",
      prompt: "Updated prompt",
      category: "Updated category",
      appearance: { color: "#8b5cf6" },
    });
    await asUser.mutation(api.agents.core.deleteAgent, { agentId });

    const projectAgent = await asUser.query(api.agents.projectAgents.get, {
      projectAgentId,
    });

    expect(projectAgent).toMatchObject({
      sourceAgentId: agentId,
      name: validAgentInput.name,
      description: validAgentInput.description,
      prompt: validAgentInput.prompt,
      category: validAgentInput.category,
      appearance: validAgentInput.appearance,
    });
    expect(projectAgent && "normalizedName" in projectAgent).toBe(false);

    await t.run(async (runCtx) => {
      const source = await runCtx.db.get("agents", agentId);
      expect(source?.isDeleted).toBe(true);
    });
  });

  test("Project-agent names are unique among active agents and reusable after delete", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const firstId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "Release Planner",
    });
    const secondId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "Support Triage",
    });

    await expect(
      asUser.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        ...validProjectAgentInput,
        name: "  RELEASE   PLANNER  ",
      })
    ).rejects.toThrow("already exists");

    await expect(
      asUser.mutation(api.agents.projectAgents.update, {
        projectAgentId: secondId,
        name: "release planner",
      })
    ).rejects.toThrow("already exists");

    await asUser.mutation(api.agents.projectAgents.deleteProjectAgent, {
      projectAgentId: firstId,
    });
    const fetchedAfterDelete = await asUser.query(api.agents.projectAgents.get, {
      projectAgentId: firstId,
    });
    const listAfterDelete = await asUser.query(api.agents.projectAgents.listByProject, {
      projectId: project._id,
    });
    const reusedId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "Release Planner",
    });

    expect(fetchedAfterDelete).toBeNull();
    expect(listAfterDelete.map((agent) => agent._id)).toEqual([secondId]);
    expect(reusedId).not.toBe(firstId);
  });

  test("copying from a template rejects duplicate project names and cross-organization sources", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();
    const { org: otherOrg, asUser: asOtherUser } = await ctx.setupOrg();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: validAgentInput.name,
    });

    await expect(
      asUser.mutation(api.agents.projectAgents.copyFromAgent, {
        projectId: project._id,
        agentId,
      })
    ).rejects.toThrow(`An agent named "${validAgentInput.name}" already exists`);

    const renamedProjectAgentId = await asUser.mutation(
      api.agents.projectAgents.copyFromAgent,
      {
        projectId: project._id,
        agentId,
        name: `${validAgentInput.name} 20260701-202216`,
      }
    );

    await t.run(async (runCtx) => {
      const renamedProjectAgent = await runCtx.db.get(
        "projectAgents",
        renamedProjectAgentId
      );
      expect(renamedProjectAgent).toMatchObject({
        sourceAgentId: agentId,
        name: `${validAgentInput.name} 20260701-202216`,
        normalizedName: `${validAgentInput.name.toLowerCase()} 20260701-202216`,
      });
    });

    const otherAgentId = await asOtherUser.mutation(api.agents.core.create, {
      organizationId: otherOrg._id,
      ...validAgentInput,
      name: "Other Org Agent",
    });

    await expect(
      asUser.mutation(api.agents.projectAgents.copyFromAgent, {
        projectId: project._id,
        agentId: otherAgentId,
      })
    ).rejects.toThrow("same organization");
  });

  test("copying from another project's agent snapshots fields without template provenance and enforces name uniqueness", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const sourceProject = await ctx.project(org._id, user._id);

    const sourceProjectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: sourceProject._id,
      ...validProjectAgentInput,
    });

    const importedId = await asUser.mutation(api.agents.projectAgents.copyFromProjectAgent, {
      projectId: project._id,
      sourceProjectAgentId,
    });

    await t.run(async (runCtx) => {
      const imported = await runCtx.db.get("projectAgents", importedId);
      expect(imported).toMatchObject({
        projectId: project._id,
        name: validProjectAgentInput.name,
        normalizedName: validProjectAgentInput.name.toLowerCase(),
        description: validProjectAgentInput.description,
        prompt: validProjectAgentInput.prompt,
        category: validProjectAgentInput.category,
        appearance: validProjectAgentInput.appearance,
        createdBy: user._id,
        isDeleted: false,
      });
      expect(imported?.sourceAgentId).toBeUndefined();
    });

    await expect(
      asUser.mutation(api.agents.projectAgents.copyFromProjectAgent, {
        projectId: project._id,
        sourceProjectAgentId,
      })
    ).rejects.toThrow(`An agent named "${validProjectAgentInput.name}" already exists`);

    const renamedId = await asUser.mutation(api.agents.projectAgents.copyFromProjectAgent, {
      projectId: project._id,
      sourceProjectAgentId,
      name: `${validProjectAgentInput.name} 20260703-101500`,
    });

    await t.run(async (runCtx) => {
      const renamed = await runCtx.db.get("projectAgents", renamedId);
      expect(renamed?.name).toBe(`${validProjectAgentInput.name} 20260703-101500`);
    });
  });

  test("copying from another project's agent requires source access, manage permission, and an active source", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();

    // Source in a foreign org the importing user cannot access
    const outsider = await ctx.user();
    const outsiderOrg = await ctx.organization(outsider._id);
    const outsiderProject = await ctx.project(outsiderOrg._id, outsider._id);
    const foreignAgentId = await ctx.asUser(outsider).mutation(api.agents.projectAgents.create, {
      projectId: outsiderProject._id,
      ...validProjectAgentInput,
      name: "Foreign Agent",
    });

    await expect(
      asUser.mutation(api.agents.projectAgents.copyFromProjectAgent, {
        projectId: project._id,
        sourceProjectAgentId: foreignAgentId,
      })
    ).rejects.toThrow("Not a member of this organization");

    // Viewer on the target project cannot import into it
    const sourceProject = await ctx.project(org._id, user._id);
    const sourceProjectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: sourceProject._id,
      ...validProjectAgentInput,
    });
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    await ctx.projectMember(sourceProject._id, viewer._id, "viewer");

    await expect(
      ctx.asUser(viewer).mutation(api.agents.projectAgents.copyFromProjectAgent, {
        projectId: project._id,
        sourceProjectAgentId,
      })
    ).rejects.toThrow("Permission denied");

    // Deleted source agent cannot be imported
    await asUser.mutation(api.agents.projectAgents.deleteProjectAgent, {
      projectAgentId: sourceProjectAgentId,
    });
    await expect(
      asUser.mutation(api.agents.projectAgents.copyFromProjectAgent, {
        projectId: project._id,
        sourceProjectAgentId,
      })
    ).rejects.toThrow("Project agent not found");
  });

  test("a target-project manager with viewer access to the source project can import its agents", async () => {
    const ctx = createTestContext();
    const { org, project: sourceProject, user: owner, asUser: asOwner } = await ctx.setupProject();

    const sourceProjectAgentId = await asOwner.mutation(api.agents.projectAgents.create, {
      projectId: sourceProject._id,
      ...validProjectAgentInput,
    });

    const importer = await ctx.user();
    await ctx.orgMember(org._id, importer._id, "member");
    const targetProject = await ctx.project(org._id, owner._id);
    await ctx.projectMember(targetProject._id, importer._id, "member");
    await ctx.projectMember(sourceProject._id, importer._id, "viewer");

    const importedId = await ctx.asUser(importer).mutation(api.agents.projectAgents.copyFromProjectAgent, {
      projectId: targetProject._id,
      sourceProjectAgentId,
    });

    const imported = await ctx.asUser(importer).query(api.agents.projectAgents.get, {
      projectAgentId: importedId,
    });
    expect(imported).toMatchObject({
      projectId: targetProject._id,
      name: validProjectAgentInput.name,
    });
  });

  test("replacing from a template updates an existing Project agent from the source Agent", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const { org: otherOrg, asUser: asOtherUser } = await ctx.setupOrg();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
      name: "Code Reviewer",
      description: "Template description",
      prompt: "Template prompt",
      category: "Template category",
      appearance: extendedPaletteAppearance,
    });
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "Existing Local Agent",
      description: "Local description",
      prompt: "Local prompt",
      category: "Local category",
      appearance: validAppearance,
    });

    // A project-created agent holds only local content, so replacing it needs intent.
    await asUser.mutation(api.agents.projectAgents.replaceFromAgent, {
      projectAgentId,
      agentId,
      overwriteLocalEdits: true,
    });

    await t.run(async (runCtx) => {
      const projectAgent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(projectAgent).toMatchObject({
        sourceAgentId: agentId,
        name: "Code Reviewer",
        normalizedName: "code reviewer",
        description: "Template description",
        prompt: "Template prompt",
        category: "Template category",
        appearance: extendedPaletteAppearance,
        updatedBy: user._id,
      });
    });

    const otherAgentId = await asOtherUser.mutation(api.agents.core.create, {
      organizationId: otherOrg._id,
      ...validAgentInput,
      name: "Other Org Agent",
    });

    await expect(
      asUser.mutation(api.agents.projectAgents.replaceFromAgent, {
        projectAgentId,
        agentId: otherAgentId,
      })
    ).rejects.toThrow("same organization");
  });

  test("Project-agent validation rejects blank name, clears optional fields, allows blank prompt, and rejects unsupported colors", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        ...validProjectAgentInput,
        name: "   ",
      })
    ).rejects.toThrow("Agent name is required");

    const blankPromptProjectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "Promptless Project Agent",
      prompt: "   ",
    });
    await t.run(async (runCtx) => {
      const projectAgent = await runCtx.db.get("projectAgents", blankPromptProjectAgentId);
      expect(projectAgent?.prompt).toBeUndefined();
    });

    const extendedColorProjectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "Extended Palette Project Agent",
      appearance: extendedPaletteAppearance,
    });
    await t.run(async (runCtx) => {
      const projectAgent = await runCtx.db.get("projectAgents", extendedColorProjectAgentId);
      expect(projectAgent?.appearance).toEqual(extendedPaletteAppearance);
    });

    await expect(
      asUser.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        ...validProjectAgentInput,
        appearance: { color: "#000000" },
      })
    ).rejects.toThrow("supported palette colors");

    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });
    await asUser.mutation(api.agents.projectAgents.update, {
      projectAgentId,
      description: "   ",
      prompt: "   ",
      category: null,
    });

    const fetched = await asUser.query(api.agents.projectAgents.get, {
      projectAgentId,
    });
    expect(fetched?.description).toBeUndefined();
    expect(fetched?.prompt).toBeUndefined();
    expect(fetched?.category).toBeUndefined();
  });
});

describe("project agent template versions (OS-1759)", () => {
  test("template saves bump the version, copies record it, and refresh catches the copy up", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.copyFromAgent, {
      projectId: project._id,
      agentId,
    });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("agents", agentId))?.version).toBe(1);
      const projectAgent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(projectAgent?.installedVersion).toBe(1);
      expect(projectAgent?.locallyEdited).toBeUndefined();
    });

    await asUser.mutation(api.agents.core.update, { agentId, prompt: "Updated template prompt" });
    await asUser.mutation(api.agents.projectAgents.update, { projectAgentId, prompt: "Local tweak" });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("agents", agentId))?.version).toBe(2);
      const projectAgent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(projectAgent?.installedVersion).toBe(1);
      expect(projectAgent?.locallyEdited).toBe(true);
    });

    await asUser.mutation(api.agents.projectAgents.replaceFromAgent, { projectAgentId, agentId, overwriteLocalEdits: true });

    await t.run(async (runCtx) => {
      const projectAgent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(projectAgent?.installedVersion).toBe(2);
      expect(projectAgent?.prompt).toBe("Updated template prompt");
      expect(projectAgent?.locallyEdited).toBeUndefined();
    });

    const listed = await asUser.query(api.agents.projectAgents.listByProject, { projectId: project._id });
    expect(listed[0]).toMatchObject({ installedVersion: 2 });
  });

  test("saving a template without changing anything leaves the version alone", async () => {
    const ctx = createTestContext();
    const { org, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });

    // What the org agent editor sends on every save: all template fields, unchanged.
    await asUser.mutation(api.agents.core.update, { agentId, ...validAgentInput });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("agents", agentId))?.version).toBe(1);
    });
  });

  test("only template-owned field edits mark a copy as locally edited", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    const copiedId = await asUser.mutation(api.agents.projectAgents.copyFromAgent, {
      projectId: project._id,
      agentId,
    });

    // What the project agent editor sends when only the automation switch moved:
    // every template field at its current value, plus the new automation.
    await asUser.mutation(api.agents.projectAgents.update, {
      projectAgentId: copiedId,
      ...validAgentInput,
      automation: { enabled: true, prompt: { displayContent: "Kick off" } },
    });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("projectAgents", copiedId))?.locallyEdited).toBeUndefined();
    });

    const localId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });
    await asUser.mutation(api.agents.projectAgents.update, { projectAgentId: localId, prompt: "Local only" });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("projectAgents", localId))?.locallyEdited).toBeUndefined();
    });
  });

  test("refresh refuses to overwrite local edits unless the caller says so", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.copyFromAgent, {
      projectId: project._id,
      agentId,
    });
    await asUser.mutation(api.agents.projectAgents.update, { projectAgentId, prompt: "Local tweak" });

    await expect(asUser.mutation(api.agents.projectAgents.replaceFromAgent, { projectAgentId, agentId })).rejects.toThrow(
      "has local changes"
    );

    await asUser.mutation(api.agents.projectAgents.replaceFromAgent, { projectAgentId, agentId, overwriteLocalEdits: true });

    await t.run(async (runCtx) => {
      const projectAgent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(projectAgent?.prompt).toBe(validAgentInput.prompt);
      expect(projectAgent?.locallyEdited).toBeUndefined();
    });
  });

  test("refresh treats a copy installed before versioning as possibly edited", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.copyFromAgent, {
      projectId: project._id,
      agentId,
    });
    // A copy written before OS-1759: no provenance, so divergence is unknowable.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("projectAgents", projectAgentId, { installedVersion: undefined });
    });

    await expect(asUser.mutation(api.agents.projectAgents.replaceFromAgent, { projectAgentId, agentId })).rejects.toThrow(
      "has local changes"
    );
  });

  test("a copy renamed at install time counts as locally edited", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    const renamedId = await asUser.mutation(api.agents.projectAgents.copyFromAgent, {
      projectId: project._id,
      agentId,
      name: "Code Reviewer 20260817-120000",
    });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("projectAgents", renamedId))?.locallyEdited).toBe(true);
    });
  });

  test("templates written before versioning bump to 2 on their first real save, and deleting never bumps", async () => {
    const ctx = createTestContext();
    const { org, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("agents", agentId, { version: undefined });
    });

    await asUser.mutation(api.agents.core.update, { agentId, prompt: "Rewritten prompt" });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("agents", agentId))?.version).toBe(2);
    });

    await asUser.mutation(api.agents.core.deleteAgent, { agentId });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("agents", agentId))?.version).toBe(2);
    });
  });

  test("a copy installed before versioning still reports its template version to clients", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const agentId = await asUser.mutation(api.agents.core.create, {
      organizationId: org._id,
      ...validAgentInput,
    });
    await asUser.mutation(api.agents.projectAgents.copyFromAgent, { projectId: project._id, agentId });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("agents", agentId, { version: undefined });
    });

    const listed = await asUser.query(api.agents.core.listByOrganization, { organizationId: org._id });
    expect(listed[0]?.version).toBe(1);
  });
});

describe("project agent automation (OS-1094)", () => {
  test("create stores automation with composer prompt refs preserved unexpanded", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();
    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      key: "task-kickoff",
      content: "Read the attached task and start working on it.",
    });

    const composerDocument = {
      version: 1 as const,
      refs: [
        {
          type: "slash-command" as const,
          id: slashCommandId,
          scope: "organization" as const,
          key: "task-kickoff",
          canonicalKey: "org:task-kickoff",
          displayLabel: "/task-kickoff",
        },
      ],
    };

    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Automation Agent",
      appearance: { color: "#22c55e" },
      automation: {
        enabled: true,
        prompt: {
          displayContent: "[/task-kickoff](convoy://command/org:task-kickoff) please",
          composerDocument,
        },
        cliType: "claude-code",
        cliModel: "opus",
        cliEffort: "high",
        mode: "plan",
        workspace: "worktree",
      },
    });

    await t.run(async (runCtx) => {
      const agent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(agent?.automation).toEqual({
        enabled: true,
        prompt: {
          displayContent: "[/task-kickoff](convoy://command/org:task-kickoff) please",
          composerDocument,
        },
        cliType: "claude-code",
        cliModel: "opus",
        cliEffort: "high",
        mode: "plan",
        workspace: "worktree",
      });
    });

    const list = await asUser.query(api.agents.projectAgents.listByProject, { projectId: project._id });
    expect(list[0]?.automation?.prompt?.composerDocument?.refs).toHaveLength(1);
  });

  test("update replaces automation and null clears it", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Toggled Agent",
      appearance: { color: "#22c55e" },
      automation: { enabled: true, prompt: { displayContent: "Do the thing" }, cliType: "codex" },
    });

    await asUser.mutation(api.agents.projectAgents.update, {
      projectAgentId,
      automation: { enabled: false, prompt: { displayContent: "Updated prompt" } },
    });

    await t.run(async (runCtx) => {
      const agent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(agent?.automation).toEqual({ enabled: false, prompt: { displayContent: "Updated prompt" } });
    });

    await asUser.mutation(api.agents.projectAgents.update, {
      projectAgentId,
      automation: null,
    });

    await t.run(async (runCtx) => {
      const agent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(agent?.automation).toBeUndefined();
    });
  });

  test("empty automation prompt is normalized away and no profile fields are accepted", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Sparse Agent",
      appearance: { color: "#22c55e" },
      automation: { enabled: true, prompt: { displayContent: "   " } },
    });

    await t.run(async (runCtx) => {
      const agent = await runCtx.db.get("projectAgents", projectAgentId);
      expect(agent?.automation).toEqual({ enabled: true });
    });

    // Automation deliberately stores no user-specific CLI profile/path; the
    // validator must reject any attempt to store one.
    await expect(
      asUser.mutation(api.agents.projectAgents.update, {
        projectAgentId,
        automation: {
          enabled: true,
          profileId: "some-profile",
        } as unknown as { enabled: boolean },
      })
    ).rejects.toThrow();
  });

  test("copying a project agent copies its automation config", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const sourceId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Source Agent",
      appearance: { color: "#22c55e" },
      automation: { enabled: true, prompt: { displayContent: "Copied prompt" }, cliType: "claude-code" },
    });

    const copyId = await asUser.mutation(api.agents.projectAgents.copyFromProjectAgent, {
      projectId: project._id,
      sourceProjectAgentId: sourceId,
      name: "Copied Agent",
    });

    await t.run(async (runCtx) => {
      const copy = await runCtx.db.get("projectAgents", copyId);
      expect(copy?.automation).toEqual({
        enabled: true,
        prompt: { displayContent: "Copied prompt" },
        cliType: "claude-code",
      });
    });
  });
});
