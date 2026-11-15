import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { MAX_SKILL_FILE_BYTES, MAX_SKILL_FILES, MAX_SKILL_TOTAL_BYTES } from "./lib/normalize";

const validSkillInput = {
  name: "pdf-tools",
  description: "Fill and read PDFs",
  category: "Docs",
  content: "# PDF tools\n\nUse these steps.",
};

describe("skills", () => {
  test("owner creates a skill whose SKILL.md is stored exactly as written", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    const skills = await asUser.query(api.skills.core.listByOrganization, { organizationId: org._id });
    expect(skills).toMatchObject([
      {
        _id: skillId,
        scope: "organization",
        organizationId: org._id,
        name: "pdf-tools",
        normalizedName: "pdf-tools",
        description: "Fill and read PDFs",
        category: "Docs",
        version: 1,
      },
    ]);

    const skill = await asUser.query(api.skills.core.get, { skillId });
    expect(skill?.skillMd).toBe(validSkillInput.content);
    expect(skill?.files).toEqual([]);
  });

  test("create writes the additional files in the same call, before the skill exists", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [
        { path: "references/fields.md", content: "# Fields" },
        { path: "assets/form.json", content: "{}" },
      ],
    });

    const skill = await asUser.query(api.skills.core.get, { skillId });
    // Sorted by path, and the entry point is never a member of the set.
    expect(skill?.files).toEqual([
      { path: "assets/form.json", content: "{}" },
      { path: "references/fields.md", content: "# Fields" },
    ]);
    expect(skill?.skillMd).toBe(validSkillInput.content);
    expect(skill?.version).toBe(1);
  });

  test("SKILL.md keeps its boundary whitespace on create and update", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const content = "  # PDF tools\n\nUse these steps.\n";

    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      name: "pdf-tools",
      content,
    });
    expect((await asUser.query(api.skills.core.get, { skillId }))?.skillMd).toBe(content);

    await asUser.mutation(api.skills.core.update, { skillId, content: "\n# PDF tools\n" });
    expect((await asUser.query(api.skills.core.get, { skillId }))?.skillMd).toBe("\n# PDF tools\n");
  });

  test("the total-size cap covers the whole set a save writes, SKILL.md included", async () => {
    const ctx = createTestContext();
    const { org, asUser, t } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    // Seed the whole budget directly, in files that each stay inside the
    // per-file cap, so only the total cap can reject the SKILL.md write.
    await t.run(async (runCtx) => {
      for (let index = 0; index < MAX_SKILL_TOTAL_BYTES / MAX_SKILL_FILE_BYTES; index++) {
        await runCtx.db.insert("skillFiles", { skillId, path: `big-${index}.md`, content: "x".repeat(MAX_SKILL_FILE_BYTES) });
      }
    });

    await expect(asUser.mutation(api.skills.core.update, { skillId, content: "x".repeat(2_000) })).rejects.toThrow("1 MB or less");
  });

  test("a description-only update leaves the normalized name alone", async () => {
    const ctx = createTestContext();
    const { org, asUser, t } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    // A Git-installed Skill may carry a display name that is not its own
    // normalized form (docs/specs/skills.md).
    await t.run(async (runCtx) => {
      await runCtx.db.patch("skills", skillId, { name: "PDF Tools" });
    });

    await asUser.mutation(api.skills.core.update, { skillId, description: "Only forms" });

    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({
      name: "PDF Tools",
      normalizedName: "pdf-tools",
      description: "Only forms",
    });
  });

  test("frontmatter in the body is left alone and never feeds the columns", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const content = ["---", "name: from-the-body", "description: From the body", "license: MIT", "---", "", "# body"].join("\n");

    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      name: "pdf-tools",
      content,
    });

    const created = await asUser.query(api.skills.core.get, { skillId });
    expect(created?.name).toBe("pdf-tools");
    expect(created?.description).toBeUndefined();
    expect(created?.skillMd).toBe(content);

    // Renaming touches the columns only — the body stays byte-identical, so a
    // rich-text round trip cannot duplicate or mangle the block.
    await asUser.mutation(api.skills.core.update, { skillId, name: "pdf-forms", description: "Only forms" });

    const renamed = await asUser.query(api.skills.core.get, { skillId });
    expect(renamed).toMatchObject({ name: "pdf-forms", normalizedName: "pdf-forms", description: "Only forms", version: 2 });
    expect(renamed?.skillMd).toBe(content);
  });

  test("saving without changes does not bump the version", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        name: "pdf-tools",
        description: "Fill and read PDFs",
        category: "Docs",
        content: validSkillInput.content,
      })
    ).resolves.toEqual({ ok: true, version: 1 });

    expect((await asUser.query(api.skills.core.get, { skillId }))?.version).toBe(1);
  });

  test("editing only the body bumps the version and leaves the columns alone", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    await asUser.mutation(api.skills.core.update, { skillId, content: "# PDF tools\n\nNew steps." });

    const updated = await asUser.query(api.skills.core.get, { skillId });
    expect(updated).toMatchObject({ name: "pdf-tools", description: "Fill and read PDFs", version: 2 });
    expect(updated?.skillMd).toBe("# PDF tools\n\nNew steps.");
  });

  test("clearing the description removes it from the column", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    await asUser.mutation(api.skills.core.update, { skillId, description: null });

    const skill = await asUser.query(api.skills.core.get, { skillId });
    expect(skill?.description).toBeUndefined();
    expect(skill?.skillMd).toBe(validSkillInput.content);
  });

  test("names are unique among active skills and freed by deletion", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    await expect(
      asUser.mutation(api.skills.core.createInOrganization, {
        organizationId: org._id,
        ...validSkillInput,
        name: "PDF-Tools",
      })
    ).rejects.toThrow("already exists");

    await asUser.mutation(api.skills.core.deleteSkill, { skillId });

    await expect(asUser.query(api.skills.core.listByOrganization, { organizationId: org._id })).resolves.toEqual([]);
    await expect(
      asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput })
    ).resolves.toBeDefined();
  });

  test("project members author project skills and viewers only read them", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();
    const member = await ctx.user();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    const skillId = await ctx.asUser(member).mutation(api.skills.core.createInProject, {
      projectId: project._id,
      ...validSkillInput,
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });

    expect(await ctx.asUser(viewer).query(api.skills.core.listByProject, { projectId: project._id })).toMatchObject([
      { _id: skillId, scope: "project", organizationId: org._id, projectId: project._id, version: 1 },
    ]);
    // Read is per-file for a viewer too: the whole bundle, controls disabled.
    expect(await ctx.asUser(viewer).query(api.skills.core.get, { skillId })).toMatchObject({
      skillMd: validSkillInput.content,
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });

    // A project Skill never shows up in the organization list.
    expect(await ctx.asUser(member).query(api.skills.core.listByOrganization, { organizationId: org._id })).toEqual([]);

    await expect(
      ctx.asUser(viewer).mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput, name: "viewer-skill" })
    ).rejects.toThrow("Permission denied");
    await expect(ctx.asUser(viewer).mutation(api.skills.core.update, { skillId, name: "viewer-edit" })).rejects.toThrow(
      "Permission denied"
    );
    await expect(ctx.asUser(viewer).mutation(api.skills.core.deleteSkill, { skillId })).rejects.toThrow("Permission denied");
  });

  test("a project skill is saved and deleted through the shared file-set path", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const skillId = await asUser.mutation(api.skills.core.createInProject, {
      projectId: project._id,
      ...validSkillInput,
      files: [{ path: "notes.md", content: "draft" }],
    });

    const saved = await asUser.mutation(api.skills.core.update, {
      skillId,
      description: "Project copy",
      edits: [
        { op: "move", path: "notes.md", newPath: "references/notes.md" },
        { op: "replace", path: "references/notes.md", oldString: "draft", newString: "final" },
      ],
    });

    expect(saved).toEqual({ ok: true, version: 2 });
    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({
      description: "Project copy",
      files: [{ path: "references/notes.md", content: "final" }],
    });

    await asUser.mutation(api.skills.core.deleteSkill, { skillId });
    expect(await asUser.query(api.skills.core.listByProject, { projectId: project._id })).toEqual([]);
  });

  test("project skill names are unique per project and may collide with organization names", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, { name: "Other Project", alias: "OTHR" });

    await asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput });
    await asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput, name: "org-only" });
    const skillId = await asUser.mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput });
    await asUser.mutation(api.skills.core.createInProject, { projectId: otherProject._id, ...validSkillInput });

    await expect(
      asUser.mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput, name: "PDF-Tools" })
    ).rejects.toThrow("already exists");
    // Renaming onto a name only the organization uses is fine, and it is a real
    // rename, so it bumps the version.
    await expect(asUser.mutation(api.skills.core.update, { skillId, name: "org-only" })).resolves.toEqual({ ok: true, version: 2 });
  });

  test("a project skill reads as absent outside its project instead of throwing", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, { name: "Other Project", alias: "OTHR" });
    const orgAdmin = await ctx.user();
    await ctx.orgMember(org._id, orgAdmin._id, "admin");
    const otherProjectMember = await ctx.user();
    await ctx.orgMember(org._id, otherProjectMember._id, "member");
    await ctx.projectMember(otherProject._id, otherProjectMember._id, "member");

    const skillId = await asUser.mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput });

    // An unreachable Skill reads as missing, so the editor shows its not-found
    // card instead of the route error boundary.
    expect(await ctx.asUser(orgAdmin).query(api.skills.core.get, { skillId })).toBeNull();
    expect(await ctx.asUser(otherProjectMember).query(api.skills.core.get, { skillId })).toBeNull();
    // Asking for a project's list is still a denial: that page needs the project.
    await expect(ctx.asUser(orgAdmin).query(api.skills.core.listByProject, { projectId: project._id })).rejects.toThrow(
      "Not a member of this project"
    );
  });

  test("an agent loads a project skill by name and reads one file at a time", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    await asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput, name: "org-only" });
    await asUser.mutation(api.skills.core.createInProject, {
      projectId: project._id,
      ...validSkillInput,
      files: [
        { path: "references/fields.md", content: "# Fields" },
        { path: "assets/form.json", content: "{}" },
      ],
    });

    // The entry point plus the paths to read next, never the bundle.
    expect(await asUser.query(api.skills.core.loadByName, { projectId: project._id, name: "PDF-Tools" })).toEqual({
      name: "pdf-tools",
      description: validSkillInput.description,
      skillMd: validSkillInput.content,
      paths: ["assets/form.json", "references/fields.md"],
    });
    expect(
      await asUser.query(api.skills.core.readFileByName, { projectId: project._id, name: "pdf-tools", path: "references/fields.md" })
    ).toEqual({ path: "references/fields.md", content: "# Fields" });

    // A name that is not in the project, a path that is not in the Skill, and an
    // organization template all read as missing rather than throwing.
    expect(await asUser.query(api.skills.core.loadByName, { projectId: project._id, name: "org-only" })).toBeNull();
    expect(
      await asUser.query(api.skills.core.readFileByName, { projectId: project._id, name: "pdf-tools", path: "references/gone.md" })
    ).toBeNull();
    expect(
      await asUser.query(api.skills.core.readFileByName, { projectId: project._id, name: "org-only", path: "references/fields.md" })
    ).toBeNull();
  });

  test("a name or path no Skill could hold reads as missing, not as an error", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    await asUser.mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput });

    // An agent guesses a name off a prose catalog line, or joins a path itself.
    // Both are questions about something absent, so they answer, not throw.
    expect(await asUser.query(api.skills.core.loadByName, { projectId: project._id, name: "PDF Tools" })).toBeNull();
    expect(await asUser.query(api.skills.core.loadByName, { projectId: project._id, name: "x" })).toBeNull();
    expect(
      await asUser.query(api.skills.core.readFileByName, { projectId: project._id, name: "pdf-tools", path: "../secrets.md" })
    ).toBeNull();
    expect(
      await asUser.query(api.skills.core.readFileByName, { projectId: project._id, name: "pdf-tools", path: "/etc/passwd" })
    ).toBeNull();
  });

  test("the agent read surface takes project view, and denies a non-member", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const orgAdmin = await ctx.user();
    await ctx.orgMember(org._id, orgAdmin._id, "admin");

    await asUser.mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput });

    expect(await ctx.asUser(viewer).query(api.skills.core.loadByName, { projectId: project._id, name: "pdf-tools" })).toMatchObject({
      skillMd: validSkillInput.content,
    });
    // The project is named by the connection here, not by a stale URL, so a
    // denial is a denial.
    await expect(
      ctx.asUser(orgAdmin).query(api.skills.core.loadByName, { projectId: project._id, name: "pdf-tools" })
    ).rejects.toThrow("Not a member of this project");
    await expect(
      ctx.asUser(orgAdmin).query(api.skills.core.readFileByName, { projectId: project._id, name: "pdf-tools", path: "a.md" })
    ).rejects.toThrow("Not a member of this project");
  });

  test("a project-scoped API key manages its own project's skills only", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, { name: "Other Project", alias: "OTHR" });

    const { key: projectKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Project key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: { organizationId: org._id, projectIds: [project._id] },
    });

    const skillId = await t.mutation(api.skills.core.createInProject, {
      projectId: project._id,
      ...validSkillInput,
      apiKey: projectKey,
    });
    await expect(t.query(api.skills.core.listByProject, { projectId: project._id, apiKey: projectKey })).resolves.toHaveLength(1);
    await expect(t.mutation(api.skills.core.update, { skillId, description: "Keyed", apiKey: projectKey })).resolves.toEqual({
      ok: true,
      version: 2,
    });

    await expect(
      t.mutation(api.skills.core.createInProject, { projectId: otherProject._id, ...validSkillInput, apiKey: projectKey })
    ).rejects.toThrow();
    await expect(t.query(api.skills.core.listByProject, { projectId: otherProject._id, apiKey: projectKey })).rejects.toThrow();
  });

  test("organization members read skills but cannot manage them, and non-members see nothing", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const member = await ctx.user();
    const outsider = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");

    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    await expect(ctx.asUser(member).query(api.skills.core.listByOrganization, { organizationId: org._id })).resolves.toHaveLength(1);
    await expect(ctx.asUser(member).mutation(api.skills.core.update, { skillId, name: "member-edit" })).rejects.toThrow(
      "Permission denied"
    );
    await expect(
      ctx.asUser(member).mutation(api.skills.core.update, { skillId, files: [{ path: "a.md", content: "x" }] })
    ).rejects.toThrow("Permission denied");
    await expect(ctx.asUser(outsider).query(api.skills.core.get, { skillId })).rejects.toThrow("Not a member of this organization");
  });

  test("project-scoped API keys cannot reach organization skills", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const { key: projectKey } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Project key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: { organizationId: org._id, projectIds: [project._id] },
    });

    await expect(
      t.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput, apiKey: projectKey })
    ).rejects.toThrow("API key is scoped to specific projects");
    await expect(
      t.query(api.skills.core.listByOrganization, { organizationId: org._id, apiKey: projectKey })
    ).rejects.toThrow("API key is scoped to specific projects");
  });

  test("an organization-scoped API key manages skills in its own organization only", async () => {
    const ctx = createTestContext();
    const { org, user, asUser, t } = await ctx.setupOrg();
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

    const skillId = await t.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      apiKey: orgKey,
    });
    await expect(t.query(api.skills.core.listByOrganization, { organizationId: org._id, apiKey: orgKey })).resolves.toHaveLength(1);

    await expect(
      t.mutation(api.skills.core.update, { skillId, description: "cross-org", apiKey: otherOrgKey })
    ).rejects.toThrow("API key is not scoped to this organization");

    // Every callable takes the key, not just list and create.
    await t.mutation(api.skills.core.update, { skillId, files: [{ path: "a.md", content: "a" }], apiKey: orgKey });
    await expect(t.query(api.skills.core.get, { skillId, apiKey: orgKey })).resolves.toMatchObject({
      name: "pdf-tools",
      files: [{ path: "a.md", content: "a" }],
    });
    await t.mutation(api.skills.core.deleteSkill, { skillId, apiKey: orgKey });
  });

  test("one save adds, renames, edits, and deletes files, and bumps the version once", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [
        { path: "references/fields.md", content: "# Fields" },
        { path: "notes.md", content: "keep" },
      ],
    });

    // Renames are a path change inside the set, so this one call renames the
    // first file, edits its content, drops the second, and adds a third.
    await asUser.mutation(api.skills.core.update, {
      skillId,
      files: [
        { path: "references/forms.md", content: "# Forms" },
        { path: "assets/form.json", content: "{}" },
      ],
    });

    const saved = await asUser.query(api.skills.core.get, { skillId });
    expect(saved?.files).toEqual([
      { path: "assets/form.json", content: "{}" },
      { path: "references/forms.md", content: "# Forms" },
    ]);
    expect(saved?.version).toBe(2);
    expect(saved?.skillMd).toBe(validSkillInput.content);

    await asUser.mutation(api.skills.core.update, { skillId, files: [] });
    const emptied = await asUser.query(api.skills.core.get, { skillId });
    expect(emptied?.files).toEqual([]);
    expect(emptied?.version).toBe(3);
  });

  test("an omitted file set leaves the stored files alone, and an unchanged set does not bump", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const files = [{ path: "references/fields.md", content: "# Fields" }];
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files,
    });

    // A caller that only renames the Skill must not wipe its files.
    await asUser.mutation(api.skills.core.update, { skillId, name: "pdf-forms" });
    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({ name: "pdf-forms", files, version: 2 });

    await asUser.mutation(api.skills.core.update, { skillId, content: validSkillInput.content, files });
    expect((await asUser.query(api.skills.core.get, { skillId }))?.version).toBe(2);
  });

  test("file paths in a set are validated, unique, and never SKILL.md", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    await expect(
      asUser.mutation(api.skills.core.update, { skillId, files: [{ path: "../escape.md", content: "x" }] })
    ).rejects.toThrow("relative path");
    await expect(
      asUser.mutation(api.skills.core.update, { skillId, files: [{ path: "SKILL.md", content: "x" }] })
    ).rejects.toThrow("SKILL.md cannot be created, renamed, or deleted");
    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        files: [
          { path: "a.md", content: "a" },
          { path: " a.md ", content: "b" },
        ],
      })
    ).rejects.toThrow("already exists");

    // A rejected set is written as a whole or not at all.
    expect((await asUser.query(api.skills.core.get, { skillId }))?.files).toEqual([]);
  });

  test("caps bound the file count and the total size of a saved set", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    const files = Array.from({ length: MAX_SKILL_FILES }, (_, index) => ({ path: `file-${index}.md`, content: "x" }));
    // MAX_SKILL_FILES additional files is one too many: SKILL.md is in the set.
    await expect(asUser.mutation(api.skills.core.update, { skillId, files })).rejects.toThrow("at most 50 files");

    // Each file is inside the per-file cap, and together they fill the total.
    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        files: Array.from({ length: MAX_SKILL_TOTAL_BYTES / MAX_SKILL_FILE_BYTES }, (_, index) => ({
          path: `big-${index}.md`,
          content: "x".repeat(MAX_SKILL_FILE_BYTES),
        })),
      })
    ).rejects.toThrow("1 MB or less");
  });

  test("one batch of edits adds, edits, renames, and deletes files, and bumps the version once", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [
        { path: "references/fields.md", content: "# Fields" },
        { path: "notes.md", content: "drop me" },
      ],
    });

    // Edits apply in order to one in-memory set, so the rename below sees the
    // content the first edit wrote, and the whole batch is one save.
    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        edits: [
          { op: "write", path: " references/fields.md ", content: "# Fields v2" },
          { op: "move", path: "references/fields.md", newPath: "references/forms.md" },
          { op: "write", path: "assets/form.json", content: "{}" },
          { op: "delete", path: "notes.md" },
        ],
      })
    ).resolves.toEqual({ ok: true, version: 2 });

    const skill = await asUser.query(api.skills.core.get, { skillId });
    expect(skill?.files).toEqual([
      { path: "assets/form.json", content: "{}" },
      { path: "references/forms.md", content: "# Fields v2" },
    ]);
    expect(skill?.skillMd).toBe(validSkillInput.content);
  });

  test("one call changes the columns, SKILL.md, and a file, and still bumps once", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "notes.md", content: "one two" }],
    });

    // `content` lands first and edits apply on top of it, so a partial edit of
    // the body in the same call as a full rewrite sees the new text.
    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        name: "pdf-forms",
        content: "# PDF forms\n\nUse pdftk.",
        edits: [
          { op: "replace", path: "SKILL.md", oldString: "pdftk", newString: "qpdf" },
          { op: "replace", path: "notes.md", oldString: "one", newString: "1" },
        ],
      })
    ).resolves.toEqual({ ok: true, version: 2 });

    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({
      name: "pdf-forms",
      skillMd: "# PDF forms\n\nUse qpdf.",
      files: [{ path: "notes.md", content: "1 two" }],
    });
  });

  test("a write creates a missing file and overwrites an existing one", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "notes.md", content: "one two" }],
    });

    // An upsert, not a create: an agent holding get_skill output does not need
    // the distinction, and a create/update split only adds a way to fail.
    await asUser.mutation(api.skills.core.update, {
      skillId,
      edits: [
        { op: "write", path: "notes.md", content: "clobbered" },
        { op: "write", path: "assets/form.json", content: "{}" },
      ],
    });

    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({
      version: 2,
      files: [
        { path: "assets/form.json", content: "{}" },
        { path: "notes.md", content: "clobbered" },
      ],
    });
  });

  test("a failing edit writes nothing, columns and earlier edits included", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "notes.md", content: "one two" }],
    });

    // The batch is one mutation, so a reported failure rolls back the rename and
    // the write that preceded it, and names the edit that stopped it.
    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        name: "pdf-forms",
        edits: [
          { op: "write", path: "notes.md", content: "changed" },
          { op: "replace", path: "notes.md", oldString: "missing", newString: "x" },
        ],
      })
    ).resolves.toEqual({
      ok: false,
      index: 1,
      code: "old_string_not_found",
      message: "oldString was not found in notes.md",
      occurrences: 0,
    });

    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({
      name: "pdf-tools",
      version: 1,
      files: [{ path: "notes.md", content: "one two" }],
    });
  });

  test("SKILL.md is written by an edit but never renamed or deleted", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "notes.md", content: "keep" }],
    });

    await asUser.mutation(api.skills.core.update, {
      skillId,
      edits: [{ op: "write", path: "SKILL.md", content: "# Rewritten" }],
    });

    const written = await asUser.query(api.skills.core.get, { skillId });
    expect(written?.skillMd).toBe("# Rewritten");
    // The body is a column-free write: name and description are untouched.
    expect(written).toMatchObject({ name: "pdf-tools", description: "Fill and read PDFs" });

    await expect(
      asUser.mutation(api.skills.core.update, { skillId, edits: [{ op: "move", path: "SKILL.md", newPath: "body.md" }] })
    ).rejects.toThrow("SKILL.md cannot be created, renamed, or deleted");
    await expect(
      asUser.mutation(api.skills.core.update, { skillId, edits: [{ op: "delete", path: "SKILL.md" }] })
    ).rejects.toThrow("SKILL.md cannot be created, renamed, or deleted");
    await expect(
      asUser.mutation(api.skills.core.update, { skillId, edits: [{ op: "move", path: "notes.md", newPath: "SKILL.md" }] })
    ).rejects.toThrow("SKILL.md cannot be created, renamed, or deleted");

    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({
      skillMd: "# Rewritten",
      files: [{ path: "notes.md", content: "keep" }],
    });
  });

  test("edits are validated against the whole set, and a missing file is rejected", async () => {
    const ctx = createTestContext();
    const { org, asUser, t } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [
        { path: "notes.md", content: "keep" },
        { path: "other.md", content: "also keep" },
      ],
    });

    await expect(
      asUser.mutation(api.skills.core.update, { skillId, edits: [{ op: "write", path: "../escape.md", content: "x" }] })
    ).rejects.toThrow("relative path");
    await expect(
      asUser.mutation(api.skills.core.update, { skillId, edits: [{ op: "replace", path: "missing.md", oldString: "a", newString: "b" }] })
    ).rejects.toThrow("Skill file not found");
    await expect(
      asUser.mutation(api.skills.core.update, { skillId, edits: [{ op: "delete", path: "missing.md" }] })
    ).rejects.toThrow("Skill file not found");
    // A rename onto a live path collides in the committed set — a write would
    // have overwritten it, but a move must not silently drop a file.
    await expect(
      asUser.mutation(api.skills.core.update, { skillId, edits: [{ op: "move", path: "notes.md", newPath: "other.md" }] })
    ).rejects.toThrow("already exists");

    // Fill the Skill to its byte budget, then push one file over it: the cap
    // binds the whole set, so an edit cannot slip past it.
    await t.run(async (runCtx) => {
      for (let index = 0; index < MAX_SKILL_TOTAL_BYTES / MAX_SKILL_FILE_BYTES - 1; index++) {
        await runCtx.db.insert("skillFiles", { skillId, path: `big-${index}.md`, content: "x".repeat(MAX_SKILL_FILE_BYTES) });
      }
    });

    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        edits: [{ op: "write", path: "last.md", content: "x".repeat(MAX_SKILL_FILE_BYTES) }],
      })
    ).rejects.toThrow("1 MB or less");
    // Nothing above changed the set: three seeded files plus the original two.
    const untouched = await asUser.query(api.skills.core.get, { skillId });
    expect(untouched?.version).toBe(1);
    expect(untouched?.files).toHaveLength(5);
  });

  test("a partial edit replaces one match and reports a miss instead of throwing", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      content: "# PDF tools\n\nUse pdftk. pdftk is installed.",
    });

    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        edits: [{ op: "replace", path: "SKILL.md", oldString: "qpdf", newString: "pdftk" }],
      })
    ).resolves.toEqual({
      ok: false,
      index: 0,
      code: "old_string_not_found",
      message: "oldString was not found in SKILL.md",
      occurrences: 0,
    });

    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        edits: [{ op: "replace", path: "SKILL.md", oldString: "pdftk", newString: "qpdf" }],
      })
    ).resolves.toMatchObject({ ok: false, index: 0, code: "multiple_matches", occurrences: 2 });

    // A reported failure writes nothing, so the version does not move.
    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({ version: 1 });

    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        edits: [{ op: "replace", path: "SKILL.md", oldString: "pdftk", newString: "qpdf", replaceAll: true }],
      })
    ).resolves.toEqual({ ok: true, version: 2 });

    const replaced = await asUser.query(api.skills.core.get, { skillId });
    expect(replaced?.skillMd).toBe("# PDF tools\n\nUse qpdf. qpdf is installed.");
    expect(replaced).toMatchObject({ name: "pdf-tools", description: "Fill and read PDFs", version: 2 });

    await asUser.mutation(api.skills.core.update, {
      skillId,
      edits: [
        { op: "write", path: "notes.md", content: "one two" },
        { op: "replace", path: "notes.md", oldString: "two", newString: "three" },
      ],
    });
    expect((await asUser.query(api.skills.core.get, { skillId }))?.files).toEqual([{ path: "notes.md", content: "one three" }]);
  });

  test("an edit that changes nothing succeeds without bumping the version", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "notes.md", content: "one two" }],
    });

    // `version` is the drift signal installed copies key "update available" off,
    // so a batch that stored nothing must not advertise one.
    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        edits: [
          { op: "write", path: "notes.md", content: "one two" },
          { op: "move", path: "notes.md", newPath: " notes.md " },
          { op: "replace", path: "notes.md", oldString: "two", newString: "two" },
        ],
      })
    ).resolves.toEqual({ ok: true, version: 1 });

    expect(await asUser.query(api.skills.core.get, { skillId })).toMatchObject({
      version: 1,
      files: [{ path: "notes.md", content: "one two" }],
    });
  });

  test("a partial edit that breaks a cap fails with the cap error and writes nothing", async () => {
    const ctx = createTestContext();
    const { org, asUser, t } = await ctx.setupOrg();
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "notes.md", content: "x".repeat(1_000) }],
    });

    // Growth is occurrence count times `newString`, so a small file and a small
    // replacement still blow the per-file cap.
    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        edits: [{ op: "replace", path: "notes.md", oldString: "x", newString: "y".repeat(1_024), replaceAll: true }],
      })
    ).rejects.toThrow("256 KB or less");

    // Now leave ~50 KB of the Skill's budget free, so a growth that stays well
    // inside the per-file cap can only be rejected by the total cap.
    const headroom = 50_000;
    await t.run(async (runCtx) => {
      for (let index = 0; index < MAX_SKILL_TOTAL_BYTES / MAX_SKILL_FILE_BYTES - 1; index++) {
        await runCtx.db.insert("skillFiles", { skillId, path: `big-${index}.md`, content: "x".repeat(MAX_SKILL_FILE_BYTES) });
      }
      const filler = MAX_SKILL_TOTAL_BYTES - 3 * MAX_SKILL_FILE_BYTES - headroom - 1_000;
      await runCtx.db.insert("skillFiles", { skillId, path: "filler.md", content: "x".repeat(filler) });
    });

    await expect(
      asUser.mutation(api.skills.core.update, {
        skillId,
        edits: [{ op: "replace", path: "notes.md", oldString: "x", newString: "y".repeat(200), replaceAll: true }],
      })
    ).rejects.toThrow("1 MB or less");

    const untouched = await asUser.query(api.skills.core.get, { skillId });
    expect(untouched?.version).toBe(1);
    expect(untouched?.files.find((file) => file.path === "notes.md")?.content).toBe("x".repeat(1_000));
  });

  test("edits need the same manage permission as a whole-set save", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });

    await expect(
      ctx.asUser(member).mutation(api.skills.core.update, { skillId, edits: [{ op: "write", path: "a.md", content: "x" }] })
    ).rejects.toThrow("Permission denied");
    await expect(
      ctx.asUser(member).mutation(api.skills.core.update, {
        skillId,
        edits: [{ op: "replace", path: "SKILL.md", oldString: "steps", newString: "instructions" }],
      })
    ).rejects.toThrow("Permission denied");
  });

  test("SKILL.md content is required and skills are not found once deleted", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();

    await expect(
      asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput, content: "  " })
    ).rejects.toThrow("SKILL.md content is required");

    const skillId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });
    await asUser.mutation(api.skills.core.deleteSkill, { skillId });

    expect(await asUser.query(api.skills.core.get, { skillId })).toBeNull();
    await expect(asUser.mutation(api.skills.core.update, { skillId, name: "gone" })).rejects.toThrow("Skill not found");
  });

  test("records where a skill was copied from, and carries that provenance to installed copies", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const source = {
      repoUrl: "https://github.com/anthropics/skills",
      ref: "main",
      commitSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12",
      subpath: "document-skills/pdf",
    };
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      source,
    });

    expect(await asUser.query(api.skills.core.get, { skillId: sourceId })).toMatchObject({ version: 1, source });

    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });
    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({ source });

    // Re-saving the same provenance stores nothing: `version` is the drift signal
    // installed copies key "update available" off.
    await asUser.mutation(api.skills.core.update, { skillId: copyId, source });
    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({ version: 1 });

    // A new upstream commit is a save like any other, and clearing is the way back.
    const moved = { ...source, commitSha: "aaaabbbbccccddddeeeeffff0000111122223333" };
    await asUser.mutation(api.skills.core.update, { skillId: sourceId, source: moved });
    expect(await asUser.query(api.skills.core.get, { skillId: sourceId })).toMatchObject({ version: 2, source: moved });

    // Provenance is template-owned, so a refresh overwrites the copy's with the
    // template's — a clear included.
    await asUser.mutation(api.skills.core.update, { skillId: sourceId, source: null });
    expect((await asUser.query(api.skills.core.get, { skillId: sourceId }))?.source).toBeUndefined();
    await asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId });
    expect((await asUser.query(api.skills.core.get, { skillId: copyId }))?.source).toBeUndefined();

    await expect(
      asUser.mutation(api.skills.core.update, { skillId: sourceId, source: { ...source, commitSha: "main" } })
    ).rejects.toThrow("commit");
  });

  test("installing an organization skill copies its columns and files, and the copy is then independent", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });

    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });

    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({
      scope: "project",
      organizationId: org._id,
      projectId: project._id,
      name: "pdf-tools",
      description: "Fill and read PDFs",
      category: "Docs",
      version: 1,
      sourceSkillId: sourceId,
      installedVersion: 1,
      skillMd: validSkillInput.content,
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });
    expect((await asUser.query(api.skills.core.get, { skillId: copyId }))?.locallyEdited).toBeUndefined();

    // Neither side reaches the other: the copy is a copy, not a link.
    await asUser.mutation(api.skills.core.update, { skillId: copyId, content: "# Local", edits: [{ op: "delete", path: "references/fields.md" }] });
    await asUser.mutation(api.skills.core.update, { skillId: sourceId, description: "Template moved on" });

    expect(await asUser.query(api.skills.core.get, { skillId: sourceId })).toMatchObject({
      description: "Template moved on",
      skillMd: validSkillInput.content,
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });
    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({
      description: "Fill and read PDFs",
      skillMd: "# Local",
      files: [],
    });
  });

  test("editing a copy marks it locally edited, through the columns and through a partial edit", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });
    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });

    // A save that stores nothing is not an edit, so it must not report drift.
    await asUser.mutation(api.skills.core.update, { skillId: copyId, description: validSkillInput.description });
    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({ version: 1 });
    expect((await asUser.query(api.skills.core.get, { skillId: copyId }))?.locallyEdited).toBeUndefined();

    await asUser.mutation(api.skills.core.update, { skillId: copyId, category: "Local" });
    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({ version: 2, locallyEdited: true });

    // The partial-edit path is the one that silently regresses: it never touches
    // the columns, so it needs the same hook.
    const freshCopyId = await asUser.mutation(api.skills.core.copyFromSkill, {
      projectId: project._id,
      skillId: await asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput, name: "other-tools" }),
    });
    await asUser.mutation(api.skills.core.update, {
      skillId: freshCopyId,
      edits: [{ op: "replace", path: "SKILL.md", oldString: "steps", newString: "instructions" }],
    });
    expect(await asUser.query(api.skills.core.get, { skillId: freshCopyId })).toMatchObject({ version: 2, locallyEdited: true });

    // A project skill that was never installed has nothing to diverge from.
    const ownSkillId = await asUser.mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput, name: "home-grown" });
    await asUser.mutation(api.skills.core.update, { skillId: ownSkillId, category: "Local" });
    expect((await asUser.query(api.skills.core.get, { skillId: ownSkillId }))?.locallyEdited).toBeUndefined();
  });

  test("refreshing a clean copy overwrites its file set from the template", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "old.md", content: "old" }],
    });
    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });

    await asUser.mutation(api.skills.core.update, {
      skillId: sourceId,
      description: "Newer",
      content: "# v2",
      edits: [
        { op: "write", path: "new.md", content: "new" },
        { op: "delete", path: "old.md" },
      ],
    });

    await asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId });

    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({
      description: "Newer",
      installedVersion: 2,
      skillMd: "# v2",
      // A refresh replaces the whole set, so a file the template dropped is gone.
      files: [{ path: "new.md", content: "new" }],
    });
    expect((await asUser.query(api.skills.core.get, { skillId: copyId }))?.locallyEdited).toBeUndefined();
  });

  test("refreshing a copy that already matches its template writes nothing at all", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });
    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });
    const installed = await asUser.query(api.skills.core.get, { skillId: copyId });

    await asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId });
    await asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId });

    // A refresh with nothing to write is a no-op save: no phantom revision, and
    // no audit trail claiming somebody changed the Skill.
    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({
      version: installed?.version,
      updatedAt: installed?.updatedAt,
      installedVersion: 1,
    });
  });

  test("refreshing re-checks that the source is still a template in the copy's organization", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const otherOrg = await ctx.organization(user._id);
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput });
    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });
    const foreignId = await asUser.mutation(api.skills.core.createInOrganization, { organizationId: otherOrg._id, ...validSkillInput });
    const projectSkillId = await asUser.mutation(api.skills.core.createInProject, {
      projectId: project._id,
      ...validSkillInput,
      name: "home-grown",
    });

    // Install checks tenancy, but the guard must not rely on `sourceSkillId`
    // staying unwritable — a later feature could repoint it.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("skills", copyId, { sourceSkillId: foreignId });
    });
    await expect(asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId })).rejects.toThrow("same organization");

    await t.run(async (runCtx) => {
      await runCtx.db.patch("skills", copyId, { sourceSkillId: projectSkillId });
    });
    await expect(asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId })).rejects.toThrow("Only organization skills");
  });

  test("refreshing onto a name another project skill took is rejected", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });
    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });
    await asUser.mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput, name: "pdf-tools-v2" });

    // A refresh renames the copy after the template, so it can collide with a
    // Skill the project authored in the meantime.
    await asUser.mutation(api.skills.core.update, { skillId: sourceId, name: "pdf-tools-v2" });

    await expect(asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId })).rejects.toThrow("already exists");
    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({ name: "pdf-tools", installedVersion: 1 });
  });

  test("refreshing a locally edited copy needs explicit consent, and then discards the edits", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
    });
    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });
    await asUser.mutation(api.skills.core.update, { skillId: copyId, content: "# Local notes" });

    await expect(asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId })).rejects.toThrow("local changes");

    await asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId, overwriteLocalEdits: true });

    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({
      skillMd: validSkillInput.content,
      installedVersion: 1,
    });
    expect((await asUser.query(api.skills.core.get, { skillId: copyId }))?.locallyEdited).toBeUndefined();
  });

  test("deleting the organization template leaves its copies in place, and refresh says the source is gone", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, {
      organizationId: org._id,
      ...validSkillInput,
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });
    const copyId = await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });

    await asUser.mutation(api.skills.core.deleteSkill, { skillId: sourceId });

    expect(await asUser.query(api.skills.core.get, { skillId: copyId })).toMatchObject({
      name: "pdf-tools",
      skillMd: validSkillInput.content,
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });
    expect(await asUser.query(api.skills.core.listByProject, { projectId: project._id })).toHaveLength(1);
    await expect(asUser.mutation(api.skills.core.replaceFromSkill, { skillId: copyId })).rejects.toThrow("no longer exists");
  });

  test("installing takes project manage, an organization template, and the project's own organization", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const otherOrg = await ctx.organization(user._id);

    const sourceId = await asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput });
    const foreignId = await asUser.mutation(api.skills.core.createInOrganization, { organizationId: otherOrg._id, ...validSkillInput });
    const projectSkillId = await asUser.mutation(api.skills.core.createInProject, {
      projectId: project._id,
      ...validSkillInput,
      name: "home-grown",
    });

    await expect(
      ctx.asUser(viewer).mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId })
    ).rejects.toThrow("Permission denied");
    await expect(asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: foreignId })).rejects.toThrow(
      "same organization"
    );
    await expect(asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: projectSkillId })).rejects.toThrow(
      "Only organization skills"
    );

    await asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId });
    // A second install would collide with the copy's name.
    await expect(asUser.mutation(api.skills.core.copyFromSkill, { projectId: project._id, skillId: sourceId })).rejects.toThrow(
      "already exists"
    );
    await expect(
      ctx.asUser(viewer).mutation(api.skills.core.replaceFromSkill, { skillId: projectSkillId })
    ).rejects.toThrow("Permission denied");
  });

  test("list paginates in name order and continues from the cursor", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    for (const name of ["charlie", "alpha", "bravo"]) {
      await asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput, name });
    }

    const firstPage = await asUser.query(api.skills.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page.map((skill) => skill.name)).toEqual(["alpha", "bravo"]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await asUser.query(api.skills.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page.map((skill) => skill.name)).toEqual(["charlie"]);
    expect(secondPage.isDone).toBe(true);
  });

  test("list filters by category through the index, null meaning uncategorized", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const create = (name: string, category?: string) =>
      asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput, name, category });
    await create("fill-pdf", "Docs");
    await create("read-pdf", "Docs");
    await create("parse-invoice", "Finance");
    await create("loose-end");

    const list = (category?: string | null) =>
      asUser.query(api.skills.core.list, { organizationId: org._id, category, paginationOpts: { numItems: 10, cursor: null } });

    expect((await list("Docs")).page.map((skill) => skill.name)).toEqual(["fill-pdf", "read-pdf"]);
    expect((await list(null)).page.map((skill) => skill.name)).toEqual(["loose-end"]);
    expect((await list()).page).toHaveLength(4);
  });

  test("list scopes to the project when projectId is given, and neither scope leaks the other", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    await asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput });
    await asUser.mutation(api.skills.core.createInProject, { projectId: project._id, ...validSkillInput, name: "home-grown" });

    const organizationPage = await asUser.query(api.skills.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(organizationPage.page.map((skill) => skill.name)).toEqual(["pdf-tools"]);

    const projectPage = await asUser.query(api.skills.core.list, {
      organizationId: org._id,
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(projectPage.page.map((skill) => skill.name)).toEqual(["home-grown"]);
  });

  test("list rejects a project from another organization and a non-member caller", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const otherOrg = await ctx.organization(user._id);
    const outsider = await ctx.user();

    await expect(
      asUser.query(api.skills.core.list, {
        organizationId: otherOrg._id,
        projectId: project._id,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toThrow("same organization");
    await expect(
      ctx.asUser(outsider).query(api.skills.core.list, { organizationId: org._id, paginationOpts: { numItems: 10, cursor: null } })
    ).rejects.toThrow("Not a member of this organization");
  });

  test("listCategories counts active skills per category, uncategorized included", async () => {
    const ctx = createTestContext();
    const { org, asUser } = await ctx.setupOrg();
    const create = (name: string, category?: string) =>
      asUser.mutation(api.skills.core.createInOrganization, { organizationId: org._id, ...validSkillInput, name, category });
    await create("fill-pdf", "Docs");
    await create("read-pdf", "Docs");
    await create("loose-end");
    const deletedId = await create("gone", "Docs");
    await asUser.mutation(api.skills.core.deleteSkill, { skillId: deletedId });

    const categories = await asUser.query(api.skills.core.listCategories, { organizationId: org._id });
    expect(categories).toEqual(
      expect.arrayContaining([
        { category: "Docs", count: 2 },
        { count: 1 },
      ])
    );
    expect(categories).toHaveLength(2);
  });
});
