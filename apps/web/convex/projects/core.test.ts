/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { errors } from "./errors";

describe("projects", () => {
  describe("create", () => {
    test("allows reusing an alias held only by soft-deleted projects", async () => {
      const ctx = createTestContext();
      const { org, user, asUser, t } = await ctx.setupOrg();

      // Two prior soft-deleted projects share the alias, so the alias index
      // resolves to multiple rows. create must look for an active homonym
      // instead of throwing under `.unique()`.
      await t.run(async (runCtx) => {
        const now = Date.now();
        for (const name of ["Old A", "Old B"]) {
          await runCtx.db.insert("projects", {
            organizationId: org._id,
            name,
            alias: "REUSE",
            isArchived: false,
            createdBy: user._id,
            createdAt: now,
            updatedAt: now,
            isDeleted: true,
            deletedAt: now,
          });
        }
      });

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "New Reuse",
        alias: "REUSE",
      });
      expect(projectId).toBeDefined();
    });

    test("should create project with alias validation", async () => {
      const ctx = createTestContext();
      const { user, org, asUser, t } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Test Project",
        alias: "TEST",
        description: "A test project",
      });

      expect(projectId).toBeDefined();

      // Verify project was created
      await t.run(async (runCtx) => {
        const project = await runCtx.db.get("projects", projectId);
        expect(project).toBeDefined();
        expect(project?.name).toBe("Test Project");
        expect(project?.alias).toBe("TEST");
        expect(project?.description).toBe("A test project");
        expect(project?.isDeleted).toBe(false);
        expect(project?.createdBy).toBe(user._id);
      });
    });

    test("should add creator as project admin", async () => {
      const ctx = createTestContext();
      const { user, org, asUser, t } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Test Project",
        alias: "TEST",
      });

      // Verify project membership
      await t.run(async (runCtx) => {
        const membership = await runCtx.db
          .query("projectMembers")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .unique();
        expect(membership).toBeDefined();
        expect(membership?.userId).toBe(user._id);
        expect(membership?.role).toBe("project-admin");
      });
    });

    test("should reject invalid alias format", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      // Too short
      await expect(
        asUser.mutation(api.projects.core.create, {
          organizationId: org._id,
          name: "Test",
          alias: "A",
        })
      ).rejects.toThrow("Alias must be 2-5 characters");

      // Too long
      await expect(
        asUser.mutation(api.projects.core.create, {
          organizationId: org._id,
          name: "Test",
          alias: "TOOLONG",
        })
      ).rejects.toThrow("Alias must be 2-5 characters");

      // Starts with number
      await expect(
        asUser.mutation(api.projects.core.create, {
          organizationId: org._id,
          name: "Test",
          alias: "1ABC",
        })
      ).rejects.toThrow("Alias must be 2-5 characters");

      // Contains lowercase (should be uppercased automatically)
      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Test",
        alias: "test",
      });

      // Verify alias was uppercased
      await ctx.t.run(async (runCtx) => {
        const project = await runCtx.db.get("projects", projectId);
        expect(project?.alias).toBe("TEST");
      });
    });

    test("should reject duplicate alias in org", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      // Create first project
      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "First Project",
        alias: "SAME",
      });

      // Try to create second project with same alias
      await expect(
        asUser.mutation(api.projects.core.create, {
          organizationId: org._id,
          name: "Second Project",
          alias: "SAME",
        })
      ).rejects.toThrow("A project with this alias already exists");
    });

    test("should throw when not org member", async () => {
      const ctx = createTestContext();
      const { user: user1 } = await ctx.setupUser();
      const org = await ctx.organization(user1._id, { name: "Other Org" });

      // Create a different user who is not a member
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.projects.core.create, {
          organizationId: org._id,
          name: "Test",
          alias: "TEST",
        })
      ).rejects.toThrow("Not a member of this organization");
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      await expect(
        ctx.t.mutation(api.projects.core.create, {
          organizationId: org._id,
          name: "Test",
          alias: "TEST",
        })
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("listByOrganization", () => {
    test("should list projects with member count", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      // Create project via mutation (which creates project member)
      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Test Project",
        alias: "TP",
      });

      const projects = await asUser.query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0]._id).toBe(projectId);
    });

    test("should sort projects by natural case-insensitive name order", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Project 10",
        alias: "P10",
      });
      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "project 2",
        alias: "P2",
      });
      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Alpha",
        alias: "ALP",
      });

      const projects = await asUser.query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });

      expect(projects.map((project) => project.name)).toEqual([
        "Alpha",
        "project 2",
        "Project 10",
      ]);
    });

    test("should use alias as tie-breaker when names are equal case-insensitively", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "alpha",
        alias: "B2",
      });
      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Alpha",
        alias: "A2",
      });

      const projects = await asUser.query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });

      expect(projects.map((project) => project.alias)).toEqual(["A2", "B2"]);
    });

    test("should keep sorted order after permission filtering", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const alphaProjectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Alpha",
        alias: "A1",
      });
      const project10Id = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Project 10",
        alias: "P10",
      });
      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Project 2",
        alias: "P2",
      });

      const user2 = await ctx.user();
      await ctx.orgMember(org._id, user2._id, "member");
      await ctx.projectMember(alphaProjectId, user2._id, "member");
      await ctx.projectMember(project10Id, user2._id, "member");

      const asUser2 = ctx.asUser(user2);
      const projects = await asUser2.query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });

      expect(projects.map((project) => project.name)).toEqual(["Alpha", "Project 10"]);
    });

    test("carries the caller's project role on each row", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const editableId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Editable",
        alias: "ED",
      });
      const viewOnlyId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "View only",
        alias: "VO",
      });

      const user2 = await ctx.user();
      await ctx.orgMember(org._id, user2._id, "member");
      await ctx.projectMember(editableId, user2._id, "member");
      await ctx.projectMember(viewOnlyId, user2._id, "viewer");

      const projects = await ctx.asUser(user2).query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });

      expect(projects.map(({ alias, myRole }) => ({ alias, myRole }))).toEqual([
        { alias: "ED", myRole: "member" },
        { alias: "VO", myRole: "viewer" },
      ]);
    });

    test("should exclude deleted projects", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject();

      // Soft delete the project
      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      const projects = await asUser.query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });

      expect(projects).toHaveLength(0);
    });

    test("should return empty if not org member", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupProject();

      // Create a different user who is not a member
      const { asUser: asUser2 } = await ctx.setupUser();

      const projects = await asUser2.query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });

      expect(projects).toEqual([]);
    });

    test("should return empty if unauthenticated", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupProject();

      const projects = await ctx.t.query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });

      expect(projects).toEqual([]);
    });
  });

  describe("listAllForOrganization", () => {
    test("owner sees projects they are not a member of", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      // Created by someone else, so the owner has no projectMembers row on it.
      const other = await ctx.user();
      await ctx.orgMember(org._id, other._id, "member");
      const outside = await ctx.project(org._id, other._id, { name: "Outside", alias: "OUT" });

      const mine = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Mine",
        alias: "MINE",
      });

      const projects = await asUser.query(api.projects.core.listAllForOrganization, {
        organizationId: org._id,
      });

      expect(projects.map((project) => project._id).sort()).toEqual([mine, outside._id].sort());
      expect(projects.find((project) => project._id === outside._id)?.creator?._id).toBe(other._id);
    });

    test("admin sees every project in the org", async () => {
      const ctx = createTestContext();
      const { org, project } = await ctx.setupProject();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");

      const projects = await ctx
        .asUser(admin)
        .query(api.projects.core.listAllForOrganization, { organizationId: org._id });

      expect(projects.map((row) => row._id)).toEqual([project._id]);
    });

    test("returns metadata only", async () => {
      const ctx = createTestContext();
      const { org, project, asUser } = await ctx.setupProject({
        project: { description: "Ships the thing", color: "#ef4444" },
      });

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      await ctx.projectMember(project._id, member._id, "member");

      const projects = await asUser.query(api.projects.core.listAllForOrganization, {
        organizationId: org._id,
      });

      expect(projects).toHaveLength(1);
      // Never task/list/settings data, and no member count — a per-project
      // membership read for every row is not worth the header line.
      expect(Object.keys(projects[0]).sort()).toEqual(
        ["_id", "alias", "color", "createdAt", "creator", "description", "isArchived", "name"].sort()
      );
    });

    test("excludes soft-deleted projects", async () => {
      const ctx = createTestContext();
      const { org, project, asUser, user, t } = await ctx.setupProject();

      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      const projects = await asUser.query(api.projects.core.listAllForOrganization, {
        organizationId: org._id,
      });

      expect(projects).toEqual([]);
    });

    test("plain org member is denied", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");

      const projects = await ctx
        .asUser(member)
        .query(api.projects.core.listAllForOrganization, { organizationId: org._id });

      expect(projects).toEqual([]);
    });

    test("non-org member and unauthenticated callers are denied", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupProject();

      const outsider = await ctx.user();

      expect(
        await ctx
          .asUser(outsider)
          .query(api.projects.core.listAllForOrganization, { organizationId: org._id })
      ).toEqual([]);
      expect(
        await ctx.t.query(api.projects.core.listAllForOrganization, { organizationId: org._id })
      ).toEqual([]);
    });

    test("sorted by name like the nav list", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      for (const [name, alias] of [
        ["Project 10", "P10"],
        ["project 2", "P2"],
        ["Alpha", "ALP"],
      ]) {
        await asUser.mutation(api.projects.core.create, {
          organizationId: org._id,
          name,
          alias,
        });
      }

      const projects = await asUser.query(api.projects.core.listAllForOrganization, {
        organizationId: org._id,
      });

      expect(projects.map((project) => project.name)).toEqual(["Alpha", "project 2", "Project 10"]);
    });
  });

  describe("getForOrganizationManagement", () => {
    test("admin can open a project they are not a member of", async () => {
      const ctx = createTestContext();
      const { org, project, user } = await ctx.setupProject({
        project: { description: "Ships the thing", color: "#ef4444" },
      });

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");

      const result = await ctx
        .asUser(admin)
        .query(api.projects.core.getForOrganizationManagement, { projectId: project._id });

      expect(result?._id).toBe(project._id);
      expect(result?.creator?._id).toBe(user._id);
      expect(Object.keys(result!).sort()).toEqual(
        ["_id", "alias", "color", "createdAt", "creator", "description", "isArchived", "name"].sort()
      );
    });

    test("denies plain org members, non-members, and unauthenticated callers", async () => {
      const ctx = createTestContext();
      const { org, project } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      const outsider = await ctx.user();

      for (const client of [ctx.asUser(member), ctx.asUser(outsider), ctx.t]) {
        expect(
          await client.query(api.projects.core.getForOrganizationManagement, {
            projectId: project._id,
          })
        ).toBeNull();
      }
    });

    test("returns null for a soft-deleted project", async () => {
      const ctx = createTestContext();
      const { project, asUser, user, t } = await ctx.setupProject();

      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: user._id,
        });
      });

      expect(
        await asUser.query(api.projects.core.getForOrganizationManagement, {
          projectId: project._id,
        })
      ).toBeNull();
    });
  });

  describe("getById", () => {
    test("should get project by ID", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      const result = await asUser.query(api.projects.core.getById, { id: project._id });

      expect(result).toBeDefined();
      expect(result?._id).toBe(project._id);
      expect(result?.name).toBe(project.name);
    });

    test("should return null if not org member", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();

      // Create a different user who is not a member
      const { asUser: asUser2 } = await ctx.setupUser();

      const result = await asUser2.query(api.projects.core.getById, { id: project._id });

      expect(result).toBeNull();
    });

    test("should return null if deleted", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      // Soft delete the project
      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      const result = await asUser.query(api.projects.core.getById, { id: project._id });

      expect(result).toBeNull();
    });

    test("should return null for invalid ID", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupProject();

      const result = await asUser.query(api.projects.core.getById, { id: "invalid-id" });

      expect(result).toBeNull();
    });

    test("returns null via API key scoped away from the project", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const result = await t.query(api.projects.core.getById, {
        id: otherProject._id,
        apiKey: key,
      });

      expect(result).toBeNull();
    });
  });

  describe("getByAlias", () => {
    test("should get by alias (case insensitive)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject({ project: { alias: "TEST" } });

      // Test with same case
      let result = await asUser.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: "TEST",
      });
      expect(result?._id).toBe(project._id);

      // Test with lowercase (should be uppercased)
      result = await asUser.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: "test",
      });
      expect(result?._id).toBe(project._id);
    });

    test("should return null if not member", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject({ project: { alias: "TEST" } });

      // Create a different user who is not a member
      const { asUser: asUser2 } = await ctx.setupUser();

      const result = await asUser2.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: "TEST",
      });

      expect(result).toBeNull();
    });

    test("should return null if deleted", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject({ project: { alias: "TEST" } });

      // Soft delete the project
      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      const result = await asUser.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: "TEST",
      });

      expect(result).toBeNull();
    });

    test("should return null for non-existent alias", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupProject();

      const result = await asUser.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: "NONE",
      });

      expect(result).toBeNull();
    });

    test("returns the active project when a soft-deleted homonym shares the alias", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser, t } = await ctx.setupProject({
        project: { alias: "DUP" },
      });

      // A previously soft-deleted project keeps its alias row, so the alias
      // index resolves to more than one document. getByAlias must return the
      // active one instead of throwing under `.unique()`.
      await t.run(async (runCtx) => {
        const now = Date.now();
        await runCtx.db.insert("projects", {
          organizationId: org._id,
          name: "Old DUP",
          alias: "DUP",
          isArchived: false,
          createdBy: user._id,
          createdAt: now,
          updatedAt: now,
          isDeleted: true,
          deletedAt: now,
        });
      });

      const result = await asUser.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: "DUP",
      });

      expect(result?._id).toBe(project._id);
    });

    test("should get by alias via API key (no Clerk auth)", async () => {
      const ctx = createTestContext();
      const { asUser, project, org, t } = await ctx.setupProject({ project: { alias: "TEST" } });
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      const result = await t.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: "TEST",
        apiKey: key,
      });

      expect(result).toBeDefined();
      expect(result?._id).toBe(project._id);
      expect(result?.alias).toBe("TEST");
    });

    test("should return null for invalid API key", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupProject({ project: { alias: "TEST" } });

      const result = await t.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: "TEST",
        apiKey: "sk_user_invalid_key_12345",
      });

      expect(result).toBeNull();
    });

    test("returns null via API key scoped away from the project alias", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject({
        project: { alias: "TEST" },
      });
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const result = await t.query(api.projects.core.getByAlias, {
        organizationId: org._id,
        alias: otherProject.alias,
        apiKey: key,
      });

      expect(result).toBeNull();
    });
  });

  /**
   * The org-settings project edit page reaches `update`/`updateAlias` for
   * projects the caller is not a member of — which, since OS-1536, is the only
   * way an org admin reaches them at all.
   */
  describe("org-level authority on project edits (OS-1534)", () => {
    async function setupOutsideAdmin() {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");

      return { ctx, project, asAdmin: ctx.asUser(admin) };
    }

    test("org admin who is not a project member can update the project", async () => {
      const { ctx, project, asAdmin } = await setupOutsideAdmin();

      await asAdmin.mutation(api.projects.core.update, {
        id: project._id,
        name: "Renamed By Admin",
      });

      await ctx.t.run(async (runCtx) => {
        expect((await runCtx.db.get("projects", project._id))?.name).toBe("Renamed By Admin");
      });
    });

    test("org admin who is not a project member can update the alias", async () => {
      const { ctx, project, asAdmin } = await setupOutsideAdmin();

      await asAdmin.mutation(api.projects.core.updateAlias, {
        id: project._id,
        alias: "NEWK",
      });

      await ctx.t.run(async (runCtx) => {
        expect((await runCtx.db.get("projects", project._id))?.alias).toBe("NEWK");
      });
    });

    test("plain org member with no project membership still cannot edit", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const outsider = await ctx.user();
      await ctx.orgMember(org._id, outsider._id, "member");
      const asOutsider = ctx.asUser(outsider);

      await expect(
        asOutsider.mutation(api.projects.core.update, { id: project._id, name: "Nope" })
      ).rejects.toThrow();
      await expect(
        asOutsider.mutation(api.projects.core.updateAlias, { id: project._id, alias: "NOPE" })
      ).rejects.toThrow();
    });
  });

  describe("update", () => {
    test("should update project name", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        name: "New Name",
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.name).toBe("New Name");
      });
    });

    test("should update project description", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        description: "New description",
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.description).toBe("New description");
      });
    });

    test("should update project color", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        color: "#ef4444",
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.color).toBe("#ef4444");
      });
    });

    test("should update the default view mode and board grouping", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        defaultViewMode: "board",
        defaultBoardGroupBy: "assignee",
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.defaultViewMode).toBe("board");
        expect(updatedProject?.defaultBoardGroupBy).toBe("assignee");
      });

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        defaultBoardGroupBy: "label",
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.defaultBoardGroupBy).toBe("label");
      });

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        defaultViewMode: "list",
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.defaultViewMode).toBe("list");
      });
    });

    test("should update showArtifactsCount", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        showArtifactsCount: false,
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.showArtifactsCount).toBe(false);
      });

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        showArtifactsCount: true,
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.showArtifactsCount).toBe(true);
      });
    });

    test("should reject project colors outside the selected palette", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      await expect(
        asUser.mutation(api.projects.core.update, {
          id: project._id,
          color: "#ffffff",
        })
      ).rejects.toThrow("Project color must be one of the supported palette colors");
    });

    test("should clear project color with null", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      // First set a color
      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        color: "#ef4444",
      });

      // Then clear it with null
      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        color: null,
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.color).toBeUndefined();
      });
    });

    test("should update multiple fields at once", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        name: "Updated Name",
        description: "Updated description",
        color: "#3b82f6",
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.name).toBe("Updated Name");
        expect(updatedProject?.description).toBe("Updated description");
        expect(updatedProject?.color).toBe("#3b82f6");
      });
    });

    test("should persist disabledStatuses in canonical order", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        disabledStatuses: ["Canceled", "Triage", "Canceled"],
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.disabledStatuses).toEqual(["Triage", "Canceled"]);
      });
    });

    test("should persist hiddenTaskTableColumns in canonical order", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        hiddenTaskTableColumns: ["tags", "priority", "tags"],
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.hiddenTaskTableColumns).toEqual([
          "priority",
          "tags",
        ]);
      });
    });

    // Regression (OS-1004): the validator lagged the client column list, so
    // toggling the Label column failed server-side.
    test("should accept the label column in hiddenTaskTableColumns", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        hiddenTaskTableColumns: ["label"],
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.hiddenTaskTableColumns).toEqual(["label"]);
      });
    });

    test("should reject required statuses in disabledStatuses", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      await expect(
        asUser.mutation(api.projects.core.update, {
          id: project._id,
          disabledStatuses: ["To Do", "Blocked"],
        })
      ).rejects.toThrow("Required statuses cannot be disabled");
    });

    test("should update updatedAt timestamp", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      const beforeUpdate = project.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await asUser.mutation(api.projects.core.update, {
        id: project._id,
        name: "New Name",
      });

      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.updatedAt).toBeGreaterThan(beforeUpdate);
      });
    });

    test("should reject if not org member", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();

      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.projects.core.update, {
          id: project._id,
          name: "New Name",
        })
      ).rejects.toThrow("Not a member of this organization");
    });

    test("should reject if project is deleted", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      await expect(
        asUser.mutation(api.projects.core.update, {
          id: project._id,
          name: "New Name",
        })
      ).rejects.toThrow("Project not found");
    });

    test("should reject if not authenticated", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();

      await expect(
        ctx.t.mutation(api.projects.core.update, {
          id: project._id,
          name: "New Name",
        })
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("updateAlias", () => {
    test("should update alias", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject({ project: { alias: "OLD" } });

      await asUser.mutation(api.projects.core.updateAlias, {
        id: project._id,
        alias: "NEW",
      });

      // Verify alias was updated
      await t.run(async (runCtx) => {
        const updatedProject = await runCtx.db.get("projects", project._id);
        expect(updatedProject?.alias).toBe("NEW");
      });
    });

    test("should validate format", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      await expect(
        asUser.mutation(api.projects.core.updateAlias, {
          id: project._id,
          alias: "X", // Too short
        })
      ).rejects.toThrow("Alias must be 2-5 characters");
    });

    test("allows moving to an alias held only by soft-deleted projects", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser, t } = await ctx.setupProject({
        project: { alias: "AAAA" },
      });

      // Two soft-deleted homonyms share the target alias, so the alias index
      // resolves to multiple rows. updateAlias must look for an active homonym
      // instead of throwing under `.unique()`.
      await t.run(async (runCtx) => {
        const now = Date.now();
        for (const name of ["Old A", "Old B"]) {
          await runCtx.db.insert("projects", {
            organizationId: org._id,
            name,
            alias: "MOVE",
            isArchived: false,
            createdBy: user._id,
            createdAt: now,
            updatedAt: now,
            isDeleted: true,
            deletedAt: now,
          });
        }
      });

      await asUser.mutation(api.projects.core.updateAlias, {
        id: project._id,
        alias: "MOVE",
      });

      await t.run(async (runCtx) => {
        const updated = await runCtx.db.get("projects", project._id);
        expect(updated?.alias).toBe("MOVE");
      });
    });

    test("should reject duplicate", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser } = await ctx.setupProject({ project: { alias: "P01" } });

      // Create another project with different alias
      await ctx.project(org._id, user._id, { alias: "P02" });

      // Try to update first project to use second's alias
      await expect(
        asUser.mutation(api.projects.core.updateAlias, {
          id: project._id,
          alias: "P02",
        })
      ).rejects.toThrow("A project with this alias already exists");
    });

    test("should allow same alias (no-op)", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject({ project: { alias: "TEST" } });

      // This should not throw
      await asUser.mutation(api.projects.core.updateAlias, {
        id: project._id,
        alias: "TEST",
      });
    });
  });

  describe("listAccessible", () => {
    test("should return accessible projects sorted by natural case-insensitive name", async () => {
      const ctx = createTestContext();
      const { user, org, asUser } = await ctx.setupOrg();

      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Project 10",
        alias: "P10",
      });
      await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "project 2",
        alias: "P02",
      });

      const secondOrg = await ctx.organization(user._id, { name: "Second Org" });
      await ctx.project(secondOrg._id, user._id, {
        name: "Alpha",
        alias: "ALP",
      });

      const projects = await asUser.query(api.projects.core.listAccessible, {});

      expect(projects.map((project) => project.name)).toEqual([
        "Alpha",
        "project 2",
        "Project 10",
      ]);
    });

    test("keeps archived projects, flagged, so callers can resolve them", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      await asUser.mutation(api.projects.core.setArchived, { id: project._id, isArchived: true });

      const projects = await asUser.query(api.projects.core.listAccessible, {});

      expect(projects.map(({ _id, isArchived }) => ({ _id, isArchived }))).toEqual([
        { _id: project._id, isArchived: true },
      ]);
    });

    test("should return empty when unauthenticated", async () => {
      const ctx = createTestContext();

      const projects = await ctx.t.query(api.projects.core.listAccessible, {});

      expect(projects).toEqual([]);
    });

    test("org-scoped API key returns all accessible projects in that organization", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject({
        project: { name: "Main", alias: "MAIN" },
      });
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const otherOrg = await ctx.organization(user._id, {
        name: "Second Org",
      });
      // Outside the key's org scope, so it must not appear.
      await ctx.project(otherOrg._id, user._id, {
        name: "Outside Org",
        alias: "OUT",
      });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Org scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [],
        },
      });

      const projects = await t.query(api.projects.core.listAccessible, {
        apiKey: key,
      });

      expect(projects.map((item) => item._id)).toEqual([
        project._id,
        otherProject._id,
      ]);
    });

    test("project-allowlist API key returns only selected projects", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject({
        project: { name: "Main", alias: "MAIN" },
      });
      // Accessible but not in the key's allowlist.
      await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Project scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const projects = await t.query(api.projects.core.listAccessible, {
        apiKey: key,
      });

      expect(projects.map((item) => item._id)).toEqual([project._id]);
    });

    test("omits projects an org leader is not a member of, and reports their project role (OS-1536)", async () => {
      const ctx = createTestContext();
      const { project, org, user } = await ctx.setupProject();
      await ctx.project(org._id, user._id, { name: "Unjoined", alias: "UNJ" });

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");
      await ctx.projectMember(project._id, admin._id, "member");

      const projects = await ctx.asUser(admin).query(api.projects.core.listAccessible, {});

      expect(projects.map((item) => item._id)).toEqual([project._id]);
      expect(projects[0].role).toEqual({
        name: "member",
        permissions: ["TASK_CREATE", "TASK_UPDATE", "TASK_DELETE"],
      });
    });
  });

  describe("access revocation for org leaders (OS-1536)", () => {
    test("an org admin with no project row is denied the project, its nav row, and its tasks", async () => {
      const ctx = createTestContext();
      const { project, org, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");
      const asAdmin = ctx.asUser(admin);

      expect(await asAdmin.query(api.projects.core.getById, { id: project._id })).toBeNull();
      expect(
        await asAdmin.query(api.projects.core.getByAlias, {
          organizationId: org._id,
          alias: project.alias,
        })
      ).toBeNull();
      expect(await asAdmin.query(api.projects.core.listByOrganization, { organizationId: org._id })).toEqual([]);
      expect(await asAdmin.query(api.projects.core.listAccessible, {})).toEqual([]);
      expect(await asAdmin.query(api.tasks.core.listByProject, { projectId: project._id })).toEqual([]);
      expect(await asAdmin.query(api.tasks.core.getById, { id: task._id })).toBeNull();
    });

    test("the org-settings recovery path still reaches a project the admin cannot open", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");
      const asAdmin = ctx.asUser(admin);

      const managed = await asAdmin.query(api.projects.core.listAllForOrganization, {
        organizationId: org._id,
      });

      expect(managed.map((item) => item._id)).toContain(project._id);
      expect(await asAdmin.query(api.projects.core.getById, { id: project._id })).toBeNull();
    });

    test("an org admin who is not a project member can still delete the project", async () => {
      const ctx = createTestContext();
      const { project, org, t } = await ctx.setupProject();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");

      await ctx.asUser(admin).mutation(api.projects.core.remove, { id: project._id });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("projects", project._id))?.isDeleted).toBe(true);
      });
    });
  });

  describe("setArchived", () => {
    test("flags an archived project in listByOrganization and keeps it reachable", async () => {
      const ctx = createTestContext();
      const { org, project, asUser } = await ctx.setupProject({ project: { alias: "ARC" } });

      await asUser.mutation(api.projects.core.setArchived, { id: project._id, isArchived: true });

      // Callers resolve the current or selected project from this list, so it
      // keeps archived rows and each navigation caller drops them.
      const rows = await asUser.query(api.projects.core.listByOrganization, { organizationId: org._id });
      expect(rows.find((row) => row._id === project._id)?.isArchived).toBe(true);
      const byAlias = await asUser.query(api.projects.core.getByAlias, { organizationId: org._id, alias: "ARC" });
      expect(byAlias?.isArchived).toBe(true);

      await asUser.mutation(api.projects.core.setArchived, { id: project._id, isArchived: false });

      const rowsAfter = await asUser.query(api.projects.core.listByOrganization, { organizationId: org._id });
      expect(rowsAfter.find((row) => row._id === project._id)?.isArchived).toBe(false);
    });

    test("hides an archived project's pinned Lists from the sidebar", async () => {
      const ctx = createTestContext();
      const { org, project, user, asUser, t } = await ctx.setupProject();
      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, {
          pinnedSystemLists: [{ key: "backlog", pinnedAt: 1, pinnedBy: user._id }],
        });
      });
      const before = await asUser.query(api.tasks.lists.listPinnedForOrganization, { organizationId: org._id });
      expect(before.map((entry) => entry.projectId)).toContain(project._id);

      await asUser.mutation(api.projects.core.setArchived, { id: project._id, isArchived: true });

      const pinned = await asUser.query(api.tasks.lists.listPinnedForOrganization, { organizationId: org._id });
      expect(pinned.map((entry) => entry.projectId)).not.toContain(project._id);
    });

    test("is idempotent", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.setArchived, { id: project._id, isArchived: true });
      await asUser.mutation(api.projects.core.setArchived, { id: project._id, isArchived: true });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("projects", project._id))?.isArchived).toBe(true);
      });
    });

    test("an org admin who is not a project member can archive", async () => {
      const ctx = createTestContext();
      const { org, project, t } = await ctx.setupProject();
      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");

      await ctx.asUser(admin).mutation(api.projects.core.setArchived, { id: project._id, isArchived: true });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("projects", project._id))?.isArchived).toBe(true);
      });
    });

    test("archives and unarchives with an API key scoped to the project", async () => {
      const ctx = createTestContext();
      const { org, project, asUser, t } = await ctx.setupProject();
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI",
        expiresAt: Date.now() + 86_400_000,
        scope: { organizationId: org._id, projectIds: [project._id] },
      });

      await t.mutation(api.projects.core.setArchived, { apiKey: key, id: project._id, isArchived: true });
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("projects", project._id))?.isArchived).toBe(true);
      });

      await t.mutation(api.projects.core.setArchived, { apiKey: key, id: project._id, isArchived: false });
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("projects", project._id))?.isArchived).toBe(false);
      });
    });

    test("rejects an API key scoped to another project, even for an org owner", async () => {
      const ctx = createTestContext();
      const { org, user, project, asUser, t } = await ctx.setupProject();
      const other = await ctx.project(org._id, user._id, { name: "Other", alias: "OTHR" });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Other only",
        expiresAt: Date.now() + 86_400_000,
        scope: { organizationId: org._id, projectIds: [other._id] },
      });

      const error = await t
        .mutation(api.projects.core.setArchived, { apiKey: key, id: project._id, isArchived: true })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConvexError);
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("projects", project._id))?.isArchived).toBe(false);
      });
    });

    test("rejects a project member without project:archive", async () => {
      const ctx = createTestContext();
      const { org, project } = await ctx.setupProject();
      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      await ctx.projectMember(project._id, member._id, "member");

      const error = await ctx
        .asUser(member)
        .mutation(api.projects.core.setArchived, { id: project._id, isArchived: true })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConvexError);
    });
  });

  describe("remove", () => {
    test("should soft delete project", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.core.remove, { id: project._id });

      // Verify project was soft deleted
      await t.run(async (runCtx) => {
        const deletedProject = await runCtx.db.get("projects", project._id);
        expect(deletedProject?.isDeleted).toBe(true);
        expect(deletedProject?.deletedAt).toBeDefined();
        expect(deletedProject?.deletedBy).toBe(user._id);
      });
    });

    test("should be idempotent on deleted", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      // First delete
      await asUser.mutation(api.projects.core.remove, { id: project._id });

      // Second delete should not throw
      const result = await asUser.mutation(api.projects.core.remove, { id: project._id });
      expect(result).toBeNull();
    });

    test("should reject if not member", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();

      // Create a different user who is not a member
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.projects.core.remove, { id: project._id })
      ).rejects.toThrow("Not a member of this organization");
    });

    test("rejects an org member without project:delete with a user-facing ConvexError", async () => {
      const ctx = createTestContext();
      const { org, project } = await ctx.setupProject();
      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");

      const error = await ctx
        .asUser(member)
        .mutation(api.projects.core.remove, { id: project._id })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<string>).data).toBe(errors.PROJECT_DELETE_FORBIDDEN);
    });
  });
});

describe("API-key project creation", () => {
  test.each([false, true])("creates with organization-wide=%s and retains membership/Inbox", async (scoped) => {
    const { org, user, asUser, t } = await createTestContext().setupOrg();
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "creation",
      expiresAt: Date.now() + 86400000,
      ...(scoped ? { scope: { organizationId: org._id, projectIds: [] } } : {}),
    });
    const id = await t.mutation(api.projects.core.create, {
      apiKey: key,
      organizationId: org._id,
      name: "First",
      alias: "FIRST",
    });
    await t.run(async (c) => {
      const project = await c.db.get("projects", id);
      expect(project?.createdBy).toBe(user._id);
      expect(project?.defaultListId).toBeDefined();
      expect(await c.db.get("taskLists", project!.defaultListId!)).toMatchObject({
        name: "Inbox",
        isPinned: true,
        pinnedBy: user._id,
      });
      expect(project?.pinnedSystemLists).toEqual([expect.objectContaining({ key: "backlog", pinnedBy: user._id })]);
      expect(
        await c.db
          .query("projectMembers")
          .withIndex("by_project", (q) => q.eq("projectId", id))
          .unique()
      ).toMatchObject({ userId: user._id, role: "project-admin" });
    });
  });

  test("rejects project-restricted, wrong-organization, expired and unauthorized keys", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const other = await ctx.organization(user._id, { name: "Other", slug: "create-other" });
    for (const scope of [
      { organizationId: org._id, projectIds: [project._id] },
      { organizationId: other._id, projectIds: [] },
    ]) {
      const { key } = await asUser.mutation(api.apiKeys.core.create, { name: "restricted", expiresAt: Date.now() + 86400000, scope });
      await expect(
        t.mutation(api.projects.core.create, { apiKey: key, organizationId: org._id, name: "Denied", alias: "DENY" })
      ).rejects.toThrow();
    }
    const expired = await asUser.mutation(api.apiKeys.core.create, { name: "expired", expiresAt: Date.now() + 86400000 });
    await t.run((c) => c.db.patch("apiKeys", expired.id, { expiresAt: Date.now() - 1 }));
    await expect(
      t.mutation(api.projects.core.create, { apiKey: expired.key, organizationId: org._id, name: "Denied", alias: "DENY" })
    ).rejects.toThrow("Not authenticated");
    const outsider = await ctx.user();
    const outsiderKey = await ctx
      .asUser(outsider)
      .mutation(api.apiKeys.core.create, { name: "outsider", expiresAt: Date.now() + 86400000 });
    await expect(
      t.mutation(api.projects.core.create, { apiKey: outsiderKey.key, organizationId: org._id, name: "Denied", alias: "DENY" })
    ).rejects.toThrow();
  });

  test("API-key creation retains alias checks and rejects deleted organizations", async () => {
    const { org, project, asUser, t } = await createTestContext().setupProject();
    const { key } = await asUser.mutation(api.apiKeys.core.create, { name: "setup", expiresAt: Date.now() + 86400000 });
    await expect(
      t.mutation(api.projects.core.create, { apiKey: key, organizationId: org._id, name: "Invalid", alias: "!" })
    ).rejects.toThrow("Alias must");
    await expect(
      t.mutation(api.projects.core.create, { apiKey: key, organizationId: org._id, name: "Duplicate", alias: project.alias })
    ).rejects.toThrow("already exists");
    await t.run((c) => c.db.patch("organizations", org._id, { isDeleted: true }));
    await expect(
      t.mutation(api.projects.core.create, { apiKey: key, organizationId: org._id, name: "Deleted", alias: "DELET" })
    ).rejects.toThrow("Organization not found");
  });
});

test("project list grouping defaults persist with existing project permissions", async () => {
  const ctx = createTestContext();
  const { org, project, asUser, t } = await ctx.setupProject();
  await asUser.mutation(api.projects.core.update, { id: project._id, defaultViewMode: "list", defaultListGroupBy: "owner" });
  expect((await t.run(runCtx => runCtx.db.get("projects", project._id)))?.defaultListGroupBy).toBe("owner");
  const viewer = await ctx.user();
  await ctx.orgMember(org._id, viewer._id, "member");
  await ctx.projectMember(project._id, viewer._id, "viewer");
  await expect(ctx.asUser(viewer).mutation(api.projects.core.update, { id: project._id, defaultListGroupBy: "label" })).rejects.toThrow();
});

test("project board row defaults persist", async () => {
  const ctx = createTestContext();
  const { project, asUser, t } = await ctx.setupProject();
  await asUser.mutation(api.projects.core.update, {
    id: project._id, defaultViewMode: "board", defaultBoardGroupBy: "status", defaultBoardRowGroupBy: "section",
  });
  expect((await t.run(runCtx => runCtx.db.get("projects", project._id)))?.defaultBoardRowGroupBy).toBe("section");
});
