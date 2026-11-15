import { describe, expect, test } from "vitest";
import { createTestContext } from "../../../convex-testing";
import { OrgPermission, ProjectPermission } from "../../../lib/authz/permissions";
import {
  authorizeProjectAccess,
  filterProjectsByAccess,
  hasAuthorizedProjectPermission,
  hasOrgPermission,
  hasProjectAccess,
  requireAuthorizedProject,
} from "./permissions";
import { getOrgMembership } from "../accessRepo";

describe("organization authorization helpers", () => {
  test("returns boolean organization permission checks", async () => {
    const ctx = createTestContext();
    const { org, user, t } = await ctx.setupOrg();
    const admin = await ctx.user();
    const member = await ctx.user();
    const outsider = await ctx.user();

    await ctx.orgMember(org._id, admin._id, "admin");
    await ctx.orgMember(org._id, member._id, "member");

    await t.run(async (runCtx) => {
      await expect(hasOrgPermission(runCtx, user._id, org._id, OrgPermission.MEMBERS_INVITE)).resolves.toBe(true);

      await expect(hasOrgPermission(runCtx, admin._id, org._id, OrgPermission.MEMBERS_INVITE)).resolves.toBe(true);

      await expect(hasOrgPermission(runCtx, member._id, org._id, OrgPermission.MEMBERS_INVITE)).resolves.toBe(false);

      await expect(hasOrgPermission(runCtx, outsider._id, org._id, OrgPermission.MEMBERS_INVITE)).resolves.toBe(false);
    });
  });
});

describe("project authorization helpers", () => {
  test("returns the authorized project and membership metadata", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    await t.run(async (runCtx) => {
      const access = await authorizeProjectAccess(runCtx, user._id, project._id, ProjectPermission.PROJECT_VIEW);

      expect(access?.project._id).toBe(project._id);
      expect(access?.orgMembership.userId).toBe(user._id);
      expect(access?.orgMembership.role).toBe("owner");
      expect(access?.projectMembership?.role).toBe("project-admin");
    });
  });

  test("returns boolean access checks", async () => {
    const ctx = createTestContext();
    const { project, org, user, t } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");

    await t.run(async (runCtx) => {
      await expect(hasProjectAccess(runCtx, user._id, project._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(true);

      await expect(hasProjectAccess(runCtx, member._id, project._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(false);
    });
  });

  test("accepts a loaded project document", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    await t.run(async (runCtx) => {
      const loadedProject = await runCtx.db.get("projects", project._id);
      expect(loadedProject).not.toBeNull();
      if (!loadedProject) return;

      const access = await requireAuthorizedProject(runCtx, user._id, loadedProject, ProjectPermission.PROJECT_UPDATE);

      expect(access.project._id).toBe(project._id);
      expect(access.orgMembership.role).toBe("owner");
    });
  });

  test("denies org owners and admins without project membership (OS-1536)", async () => {
    const ctx = createTestContext();
    const { project, org, t } = await ctx.setupProject();
    const owner = await ctx.user();
    const admin = await ctx.user();
    await ctx.orgMember(org._id, owner._id, "owner");
    await ctx.orgMember(org._id, admin._id, "admin");

    await t.run(async (runCtx) => {
      await expect(hasProjectAccess(runCtx, owner._id, project._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(false);
      await expect(hasProjectAccess(runCtx, admin._id, project._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(false);

      expect(await authorizeProjectAccess(runCtx, admin._id, project._id, ProjectPermission.PROJECT_VIEW)).toBeNull();
      await expect(
        requireAuthorizedProject(runCtx, admin._id, project._id, ProjectPermission.PROJECT_UPDATE)
      ).rejects.toThrow("Not a member of this project");
    });
  });

  test("allows org admins through their explicit project membership", async () => {
    const ctx = createTestContext();
    const { project, org, t } = await ctx.setupProject();
    const admin = await ctx.user();
    await ctx.orgMember(org._id, admin._id, "admin");
    await ctx.projectMember(project._id, admin._id, "project-admin");

    await t.run(async (runCtx) => {
      const access = await requireAuthorizedProject(runCtx, admin._id, project._id, ProjectPermission.PROJECT_UPDATE);

      expect(access.project._id).toBe(project._id);
      expect(access.orgMembership.role).toBe("admin");
      expect(access.projectMembership?.role).toBe("project-admin");
    });
  });

  test("returns null or throws for denied project access", async () => {
    const ctx = createTestContext();
    const { project, org, t } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");

    await t.run(async (runCtx) => {
      const access = await authorizeProjectAccess(runCtx, member._id, project._id, ProjectPermission.PROJECT_VIEW);

      expect(access).toBeNull();
      await expect(requireAuthorizedProject(runCtx, member._id, project._id, ProjectPermission.PROJECT_VIEW)).rejects.toThrow(
        "Not a member of this project"
      );
    });
  });

  test("can mask denied required access with a user-facing ConvexError", async () => {
    const ctx = createTestContext();
    const { project, org, t } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");

    await t.run(async (runCtx) => {
      await expect(
        requireAuthorizedProject(runCtx, member._id, project._id, ProjectPermission.PROJECT_VIEW, { convexErrorMessage: "Task not found" })
      ).rejects.toMatchObject({
        data: "Task not found",
      });
    });
  });

  test("can mask deleted projects with a user-facing ConvexError", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", project._id, { isDeleted: true });

      await expect(
        requireAuthorizedProject(runCtx, user._id, project._id, ProjectPermission.PROJECT_VIEW, { convexErrorMessage: "Task not found" })
      ).rejects.toMatchObject({
        data: "Task not found",
      });
    });
  });

  test("can mask missing org membership with a user-facing ConvexError", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();
    const outsider = await ctx.user();

    await t.run(async (runCtx) => {
      await expect(
        requireAuthorizedProject(runCtx, outsider._id, project._id, ProjectPermission.PROJECT_VIEW, {
          convexErrorMessage: "Task not found",
        })
      ).rejects.toMatchObject({
        data: "Task not found",
      });
    });
  });

  test("can mask permission denied with a user-facing ConvexError", async () => {
    const ctx = createTestContext();
    const { project, org, t } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    await t.run(async (runCtx) => {
      await expect(
        requireAuthorizedProject(runCtx, viewer._id, project._id, ProjectPermission.COMMENT_DELETE_ANY, {
          convexErrorMessage: "Task not found",
        })
      ).rejects.toMatchObject({
        data: "Task not found",
      });
    });
  });

  test("returns null or throws for deleted projects", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", project._id, { isDeleted: true });

      const access = await authorizeProjectAccess(runCtx, user._id, project._id, ProjectPermission.PROJECT_VIEW);

      expect(access).toBeNull();
      await expect(requireAuthorizedProject(runCtx, user._id, project._id, ProjectPermission.PROJECT_VIEW)).rejects.toThrow(
        "Project not found"
      );
    });
  });

  test("checks additional permissions from existing authorized access", async () => {
    const ctx = createTestContext();
    const { project, org, t } = await ctx.setupProject();
    const owner = await ctx.user();
    const admin = await ctx.user();
    const projectAdmin = await ctx.user();
    const member = await ctx.user();
    const viewer = await ctx.user();

    await ctx.orgMember(org._id, owner._id, "owner");
    await ctx.orgMember(org._id, admin._id, "admin");
    await ctx.orgMember(org._id, projectAdmin._id, "member");
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, projectAdmin._id, "project-admin");
    await ctx.projectMember(project._id, member._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    // An org leader's project row is now their only project role, so they are
    // seeded as `viewer` here to prove the org role adds nothing (OS-1536).
    await ctx.projectMember(project._id, owner._id, "viewer");
    await ctx.projectMember(project._id, admin._id, "viewer");

    await t.run(async (runCtx) => {
      const ownerAccess = await authorizeProjectAccess(runCtx, owner._id, project._id, ProjectPermission.PROJECT_VIEW);
      const adminAccess = await authorizeProjectAccess(runCtx, admin._id, project._id, ProjectPermission.PROJECT_VIEW);
      const projectAdminAccess = await authorizeProjectAccess(runCtx, projectAdmin._id, project._id, ProjectPermission.PROJECT_VIEW);
      const memberAccess = await authorizeProjectAccess(runCtx, member._id, project._id, ProjectPermission.PROJECT_VIEW);
      const viewerAccess = await authorizeProjectAccess(runCtx, viewer._id, project._id, ProjectPermission.PROJECT_VIEW);

      expect(ownerAccess).not.toBeNull();
      expect(adminAccess).not.toBeNull();
      expect(projectAdminAccess).not.toBeNull();
      expect(memberAccess).not.toBeNull();
      expect(viewerAccess).not.toBeNull();
      if (!ownerAccess || !adminAccess || !projectAdminAccess || !memberAccess || !viewerAccess) {
        return;
      }

      expect(hasAuthorizedProjectPermission(ownerAccess, ProjectPermission.COMMENT_DELETE_ANY)).toBe(false);
      expect(hasAuthorizedProjectPermission(adminAccess, ProjectPermission.COMMENT_DELETE_ANY)).toBe(false);
      expect(hasAuthorizedProjectPermission(projectAdminAccess, ProjectPermission.COMMENT_DELETE_ANY)).toBe(true);
      expect(hasAuthorizedProjectPermission(memberAccess, ProjectPermission.COMMENT_DELETE_ANY)).toBe(false);
      expect(hasAuthorizedProjectPermission(memberAccess, ProjectPermission.AGENTS_MANAGE)).toBe(true);
      expect(hasAuthorizedProjectPermission(viewerAccess, ProjectPermission.TASK_VIEW)).toBe(true);
      expect(hasAuthorizedProjectPermission(viewerAccess, ProjectPermission.AGENTS_MANAGE)).toBe(false);
    });
  });

  test("accepts an authenticated access principal with unscoped API key access", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    await t.run(async (runCtx) => {
      const access = await authorizeProjectAccess(
        runCtx,
        { userId: user._id, apiKeyScope: { kind: "unscoped" } },
        project._id,
        ProjectPermission.PROJECT_VIEW
      );

      expect(access?.project._id).toBe(project._id);
    });
  });

  test("limits authenticated access principal to scoped organization projects", async () => {
    const ctx = createTestContext();
    const { project, org, user, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, {
      name: "Other",
      alias: "OTHR",
    });
    const outsideOrg = await ctx.organization(user._id);
    const outsideProject = await ctx.project(outsideOrg._id, user._id, {
      name: "Outside",
      alias: "OUT",
    });

    await t.run(async (runCtx) => {
      const accessPrincipal = {
        userId: user._id,
        apiKeyScope: {
          kind: "organization" as const,
          organizationId: org._id,
          projectIds: [],
        },
      };

      await expect(hasProjectAccess(runCtx, accessPrincipal, project._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(true);
      await expect(hasProjectAccess(runCtx, accessPrincipal, otherProject._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(true);
      await expect(hasProjectAccess(runCtx, accessPrincipal, outsideProject._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(false);
    });
  });

  test("limits authenticated access principal to scoped project allowlist", async () => {
    const ctx = createTestContext();
    const { project, org, user, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, {
      name: "Other",
      alias: "OTHR",
    });

    await t.run(async (runCtx) => {
      const accessPrincipal = {
        userId: user._id,
        apiKeyScope: {
          kind: "organization" as const,
          organizationId: org._id,
          projectIds: [project._id],
        },
      };

      await expect(hasProjectAccess(runCtx, accessPrincipal, project._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(true);
      await expect(hasProjectAccess(runCtx, accessPrincipal, otherProject._id, ProjectPermission.PROJECT_VIEW)).resolves.toBe(false);
    });
  });

  test("filters an org leader down to the projects they explicitly belong to (OS-1536)", async () => {
    const ctx = createTestContext();
    const { project, org, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, project.createdBy, {
      name: "Other",
      alias: "OTHR",
    });
    const admin = await ctx.user();
    await ctx.orgMember(org._id, admin._id, "admin");
    await ctx.projectMember(project._id, admin._id, "member");

    await t.run(async (runCtx) => {
      const orgMembership = await getOrgMembership(runCtx, admin._id, org._id);
      expect(orgMembership).not.toBeNull();
      if (!orgMembership) return;

      const accessible = await filterProjectsByAccess(
        runCtx,
        admin._id,
        orgMembership,
        [project, otherProject],
        ProjectPermission.PROJECT_VIEW
      );

      expect(accessible.map((candidate) => candidate._id)).toEqual([project._id]);
    });
  });
});
