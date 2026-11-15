import { afterEach, describe, expect, test, vi } from "vitest";

const { sendTransactionalEmailMock } = vi.hoisted(() => ({
  sendTransactionalEmailMock: vi.fn(async () => null),
}));

vi.mock("../lib/notifications/email", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/notifications/email")>();

  return {
    ...actual,
    sendTransactionalEmail: sendTransactionalEmailMock,
  };
});

import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { OrgRole, ProjectRole } from "../../lib/authz/roles";

describe("projectMembers", () => {
  afterEach(() => {
    sendTransactionalEmailMock.mockClear();
  });

  describe("listByProject", () => {
    test("returns empty array if user has no access", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();

      // Create another user with no access
      const otherUser = await ctx.user();
      const asOther = ctx.asUser(otherUser);

      const members = await asOther.query(api.projects.members.list, {
        projectId: project._id,
      });

      expect(members).toEqual([]);
    });

    test("returns empty array for unauthenticated user", async () => {
      const ctx = createTestContext();
      const { project, t } = await ctx.setupProject();

      const members = await t.query(api.projects.members.list, {
        projectId: project._id,
      });

      expect(members).toEqual([]);
    });

    test("returns members if user has access (as project member)", async () => {
      const ctx = createTestContext();
      const { project, user, org } = await ctx.setupProject();

      // Create regular org member and add to project
      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);
      const asMember = ctx.asUser(member);

      const members = await asMember.query(api.projects.members.list, {
        projectId: project._id,
      });

      // Should see both members (owner who created project as project admin, and self)
      expect(members).toHaveLength(2);
      expect(members[0].role).toBe("project-admin"); // Project admin comes first
      expect(members[0].userId).toBe(user._id);
    });

    test("org owner can access any project members list", async () => {
      const ctx = createTestContext();
      const { project, asUser, user } = await ctx.setupProject();

      const members = await asUser.query(api.projects.members.list, {
        projectId: project._id,
      });

      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(user._id);
      expect(members[0].role).toBe("project-admin");
    });

    test("org admin reads any project's members via org authority, not membership", async () => {
      const ctx = createTestContext();
      const { project, org, user } = await ctx.setupProject();

      // No project row: this passes on `projects:manage_all` alone (OS-1536).
      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      const members = await asAdmin.query(api.projects.members.list, {
        projectId: project._id,
      });

      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(user._id);
    });

    test("returns members sorted by role then name", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject({
        user: { name: "Zara" }, // Name that comes after others alphabetically
      });

      // Create members with different roles
      const alice = await ctx.user({ name: "Alice" });
      await ctx.orgMember(org._id, alice._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, alice._id, ProjectRole.VIEWER);

      const bob = await ctx.user({ name: "Bob" });
      await ctx.orgMember(org._id, bob._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, bob._id, ProjectRole.MEMBER);

      const charlie = await ctx.user({ name: "Charlie" });
      await ctx.orgMember(org._id, charlie._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, charlie._id, ProjectRole.PROJECT_ADMIN);

      const members = await asUser.query(api.projects.members.list, {
        projectId: project._id,
      });

      expect(members).toHaveLength(4);
      // Leads first, sorted alphabetically (Charlie then Zara)
      expect(members[0].role).toBe("project-admin");
      expect(members[0].name).toBe("Charlie");
      expect(members[1].role).toBe("project-admin");
      expect(members[1].name).toBe("Zara");
      // Then members (Bob)
      expect(members[2].role).toBe("member");
      expect(members[2].name).toBe("Bob");
      // Then viewers (Alice)
      expect(members[3].role).toBe("viewer");
      expect(members[3].name).toBe("Alice");
    });

    test("includes user details (name, email, avatarUrl)", async () => {
      const ctx = createTestContext();
      const { project, asUser, user } = await ctx.setupProject();

      const members = await asUser.query(api.projects.members.list, {
        projectId: project._id,
      });

      expect(members).toHaveLength(1);
      expect(members[0].name).toBe(user.name);
      expect(members[0].email).toBe(user.email);
    });

    test("regular org member without project membership cannot access", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(member);

      const members = await asMember.query(api.projects.members.list, {
        projectId: project._id,
      });

      expect(members).toEqual([]);
    });
  });

  describe("getMyRole", () => {
    test("returns the project row's role for an org owner, not a synthetic one (OS-1536)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      // The creator is a real `project-admin`; a second owner with a `viewer`
      // row must read back as `viewer`, and one with no row at all as null.
      const coOwner = await ctx.user();
      await ctx.orgMember(org._id, coOwner._id, OrgRole.OWNER);
      await ctx.projectMember(project._id, coOwner._id, ProjectRole.VIEWER);

      const outsideOwner = await ctx.user();
      await ctx.orgMember(org._id, outsideOwner._id, OrgRole.OWNER);

      expect(await asUser.query(api.projects.members.getMyRole, { projectId: project._id })).toBe("project-admin");
      expect(
        await ctx.asUser(coOwner).query(api.projects.members.getMyRole, { projectId: project._id })
      ).toBe("viewer");
      expect(
        await ctx.asUser(outsideOwner).query(api.projects.members.getMyRole, { projectId: project._id })
      ).toBeNull();
    });

    test("returns null for an org admin with no project membership (OS-1536)", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      const role = await asAdmin.query(api.projects.members.getMyRole, {
        projectId: project._id,
      });

      expect(role).toBeNull();
    });

    test("returns actual role for explicit members", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.VIEWER);
      const asMember = ctx.asUser(member);

      const role = await asMember.query(api.projects.members.getMyRole, {
        projectId: project._id,
      });

      expect(role).toBe("viewer");
    });

    test("returns null for non-members", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      // Org member but NOT project member
      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(member);

      const role = await asMember.query(api.projects.members.getMyRole, {
        projectId: project._id,
      });

      expect(role).toBeNull();
    });

    test("returns null for unauthenticated user", async () => {
      const ctx = createTestContext();
      const { project, t } = await ctx.setupProject();

      const role = await t.query(api.projects.members.getMyRole, {
        projectId: project._id,
      });

      expect(role).toBeNull();
    });

    test("returns null for non-org member", async () => {
      const ctx = createTestContext();
      const { project } = await ctx.setupProject();

      const outsider = await ctx.user();
      const asOutsider = ctx.asUser(outsider);

      const role = await asOutsider.query(api.projects.members.getMyRole, {
        projectId: project._id,
      });

      expect(role).toBeNull();
    });
  });

  describe("listAssignable", () => {
    test("includes explicit project members", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const member = await ctx.user({ name: "Team Member" });
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      const assignable = await asUser.query(api.projects.members.listAssignable, {
        projectId: project._id,
      });

      const memberEntry = assignable.find((u) => u._id === member._id);
      expect(memberEntry).toBeDefined();
      expect(memberEntry?.role).toBe("member");
    });

    test("omits org owners/admins who are not project members (OS-1536)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const admin = await ctx.user({ name: "Admin User" });
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);

      const assignable = await asUser.query(api.projects.members.listAssignable, {
        projectId: project._id,
      });

      expect(assignable.map((u) => u._id)).not.toContain(admin._id);
    });

    test("lists an org admin once, by their project role (OS-1536)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const admin = await ctx.user({ name: "Admin Member" });
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      await ctx.projectMember(project._id, admin._id, ProjectRole.PROJECT_ADMIN);

      const assignable = await asUser.query(api.projects.members.listAssignable, {
        projectId: project._id,
      });

      const adminEntries = assignable.filter((u) => u._id === admin._id);
      expect(adminEntries).toHaveLength(1);
      expect(adminEntries[0].role).toBe("project-admin");
    });

    test("returns current user first", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser } = await ctx.setupProject();

      // Add some other members
      const member = await ctx.user({ name: "Other Member" });
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      const assignable = await asUser.query(api.projects.members.listAssignable, {
        projectId: project._id,
      });

      expect(assignable[0]._id).toBe(user._id);
    });

    test("returns empty if no access", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(member);

      const assignable = await asMember.query(api.projects.members.listAssignable, {
        projectId: project._id,
      });

      expect(assignable).toEqual([]);
    });

    test("returns a self-added org admin once, as an explicit member (OS-1534)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const admin = await ctx.user({ name: "Org Admin" });
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);

      await asUser.mutation(api.projects.members.add, {
        projectId: project._id,
        userId: admin._id,
        role: "member",
      });

      const assignable = await asUser.query(api.projects.members.listAssignable, {
        projectId: project._id,
      });

      const entries = assignable.filter((entry) => entry._id === admin._id);
      expect(entries).toHaveLength(1);
      expect(entries[0].role).toBe("member");
    });
  });

  describe("listEligibleToAdd", () => {
    test("returns org members not in project", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const member = await ctx.user({ name: "Available Member" });
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      const eligible = await asUser.query(api.projects.members.listEligibleToAdd, {
        projectId: project._id,
      });

      expect(eligible).toHaveLength(1);
      expect(eligible[0]._id).toBe(member._id);
      expect(eligible[0].orgRole).toBe("member");
    });

    test("excludes users already in project", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const member = await ctx.user({ name: "Existing Member" });
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      const eligible = await asUser.query(api.projects.members.listEligibleToAdd, {
        projectId: project._id,
      });

      expect(eligible.find((u) => u._id === member._id)).toBeUndefined();
    });

    test("includes org owners/admins who are not project members (OS-1534)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const admin = await ctx.user({ name: "Org Admin" });
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);

      const owner2 = await ctx.user({ name: "Org Owner 2" });
      await ctx.orgMember(org._id, owner2._id, OrgRole.OWNER);

      const eligible = await asUser.query(api.projects.members.listEligibleToAdd, {
        projectId: project._id,
      });

      expect(eligible.find((u) => u._id === admin._id)?.orgRole).toBe("admin");
      expect(eligible.find((u) => u._id === owner2._id)?.orgRole).toBe("owner");
    });

    test("still excludes an org admin who is already a project member", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const admin = await ctx.user({ name: "Org Admin" });
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      await ctx.projectMember(project._id, admin._id, ProjectRole.MEMBER);

      const eligible = await asUser.query(api.projects.members.listEligibleToAdd, {
        projectId: project._id,
      });

      expect(eligible.find((u) => u._id === admin._id)).toBeUndefined();
    });

    test("org admin who is not a project member can list eligible users", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const admin = await ctx.user({ name: "Outside Admin" });
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);

      const eligible = await ctx
        .asUser(admin)
        .query(api.projects.members.listEligibleToAdd, { projectId: project._id });

      expect(eligible.find((u) => u._id === admin._id)?.orgRole).toBe("admin");
    });

    test("hides org owners/admins from a project admin without org authority", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const projectAdmin = await ctx.user({ name: "Subordinate" });
      await ctx.orgMember(org._id, projectAdmin._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, projectAdmin._id, ProjectRole.PROJECT_ADMIN);

      const owner = await ctx.user({ name: "Org Owner" });
      await ctx.orgMember(org._id, owner._id, OrgRole.OWNER);

      const plainMember = await ctx.user({ name: "Plain Member" });
      await ctx.orgMember(org._id, plainMember._id, OrgRole.MEMBER);

      const eligible = await ctx
        .asUser(projectAdmin)
        .query(api.projects.members.listEligibleToAdd, { projectId: project._id });

      expect(eligible.map((u) => u._id)).toEqual([plainMember._id]);
    });

    test("returns empty if no permission to add members", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      // Viewer can't add members
      const viewer = await ctx.user();
      await ctx.orgMember(org._id, viewer._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, viewer._id, ProjectRole.VIEWER);
      const asViewer = ctx.asUser(viewer);

      const eligible = await asViewer.query(api.projects.members.listEligibleToAdd, {
        projectId: project._id,
      });

      expect(eligible).toEqual([]);
    });

    test("sorted by name", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const zara = await ctx.user({ name: "Zara" });
      await ctx.orgMember(org._id, zara._id, OrgRole.MEMBER);

      const alice = await ctx.user({ name: "Alice" });
      await ctx.orgMember(org._id, alice._id, OrgRole.MEMBER);

      const eligible = await asUser.query(api.projects.members.listEligibleToAdd, {
        projectId: project._id,
      });

      expect(eligible[0].name).toBe("Alice");
      expect(eligible[1].name).toBe("Zara");
    });
  });

  describe("add", () => {
    test("project admin can add org member", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await asUser.mutation(api.projects.members.add, {
        projectId: project._id,
        userId: member._id,
        role: "member",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership).not.toBeNull();
      expect(membership?.role).toBe("member");
      expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
      expect(sendTransactionalEmailMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          to: member.email,
          template: expect.objectContaining({
            id: "project-invitation",
            action: expect.objectContaining({
              url: `https://app.convoy.build/o/${org.slug}/${project.alias}`,
            }),
          }),
        }),
      );
    });

    test("org admin can add org member to project", async () => {
      const ctx = createTestContext();
      const { project, org, t } = await ctx.setupProject();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await asAdmin.mutation(api.projects.members.add, {
        projectId: project._id,
        userId: member._id,
        role: "viewer",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("viewer");
    });

    test("cannot add non-org member", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      const nonOrgMember = await ctx.user();

      await expect(
        asUser.mutation(api.projects.members.add, {
          projectId: project._id,
          userId: nonOrgMember._id,
          role: "member",
        })
      ).rejects.toThrow("not a member of this organization");

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });

    test("can add an org owner as an explicit project member (OS-1534)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject();

      const owner2 = await ctx.user();
      await ctx.orgMember(org._id, owner2._id, OrgRole.OWNER);

      await asUser.mutation(api.projects.members.add, {
        projectId: project._id,
        userId: owner2._id,
        role: "member",
      });

      const membership = await t.run(async (runCtx) =>
        runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id).eq("userId", owner2._id))
          .unique()
      );

      expect(membership?.role).toBe("member");
    });

    test("can add an org admin as an explicit project member (OS-1534)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);

      await asUser.mutation(api.projects.members.add, {
        projectId: project._id,
        userId: admin._id,
        role: "project-admin",
      });

      const membership = await t.run(async (runCtx) =>
        runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id).eq("userId", admin._id))
          .unique()
      );

      expect(membership?.role).toBe("project-admin");
    });

    test("cannot add duplicate member", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      await expect(
        asUser.mutation(api.projects.members.add, {
          projectId: project._id,
          userId: member._id,
          role: "viewer",
        })
      ).rejects.toThrow("already a member of this project");

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });

    test("viewer cannot add members", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const viewer = await ctx.user();
      await ctx.orgMember(org._id, viewer._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, viewer._id, ProjectRole.VIEWER);
      const asViewer = ctx.asUser(viewer);

      const newMember = await ctx.user();
      await ctx.orgMember(org._id, newMember._id, OrgRole.MEMBER);

      await expect(
        asViewer.mutation(api.projects.members.add, {
          projectId: project._id,
          userId: newMember._id,
          role: "member",
        })
      ).rejects.toThrow();

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });

    test("project member (non-admin) cannot add members", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const projectMember = await ctx.user();
      await ctx.orgMember(org._id, projectMember._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, projectMember._id, ProjectRole.MEMBER);
      const asMember = ctx.asUser(projectMember);

      const newMember = await ctx.user();
      await ctx.orgMember(org._id, newMember._id, OrgRole.MEMBER);

      await expect(
        asMember.mutation(api.projects.members.add, {
          projectId: project._id,
          userId: newMember._id,
          role: "member",
        })
      ).rejects.toThrow();

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });

    test("a project admin without org authority cannot add an org owner", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const projectAdmin = await ctx.user({ name: "Subordinate" });
      await ctx.orgMember(org._id, projectAdmin._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, projectAdmin._id, ProjectRole.PROJECT_ADMIN);

      const owner = await ctx.user({ name: "Org Owner" });
      await ctx.orgMember(org._id, owner._id, OrgRole.OWNER);

      await expect(
        ctx.asUser(projectAdmin).mutation(api.projects.members.add, {
          projectId: project._id,
          userId: owner._id,
          role: "viewer",
        })
      ).rejects.toThrow("organization owners and admins");

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });
  });

  describe("updateRole", () => {
    test("project admin can change member role", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      await asUser.mutation(api.projects.members.updateRole, {
        projectId: project._id,
        userId: member._id,
        role: "viewer",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("viewer");
    });

    test("can promote member to project admin", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      await asUser.mutation(api.projects.members.updateRole, {
        projectId: project._id,
        userId: member._id,
        role: "project-admin",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("project-admin");
    });

    test("can demote last explicit project admin", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.members.updateRole, {
        projectId: project._id,
        userId: user._id,
        role: "member",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", user._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("member");
    });

    test("can demote project admin if another admin exists", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser, t } = await ctx.setupProject();

      // Add another project admin
      const admin2 = await ctx.user();
      await ctx.orgMember(org._id, admin2._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, admin2._id, ProjectRole.PROJECT_ADMIN);

      await asUser.mutation(api.projects.members.updateRole, {
        projectId: project._id,
        userId: user._id,
        role: "member",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", user._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("member");
    });

    test("cannot update role for non-member", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      // NOT added to project

      await expect(
        asUser.mutation(api.projects.members.updateRole, {
          projectId: project._id,
          userId: member._id,
          role: "viewer",
        })
      ).rejects.toThrow("not a member of this project");
    });

    test("a project admin without org authority cannot demote an org owner", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const projectAdmin = await ctx.user({ name: "Subordinate" });
      await ctx.orgMember(org._id, projectAdmin._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, projectAdmin._id, ProjectRole.PROJECT_ADMIN);

      const owner = await ctx.user({ name: "Org Owner" });
      await ctx.orgMember(org._id, owner._id, OrgRole.OWNER);
      await ctx.projectMember(project._id, owner._id, ProjectRole.PROJECT_ADMIN);

      await expect(
        ctx.asUser(projectAdmin).mutation(api.projects.members.updateRole, {
          projectId: project._id,
          userId: owner._id,
          role: "viewer",
        })
      ).rejects.toThrow("organization owners and admins");
    });
  });

  describe("remove", () => {
    test("project admin can remove member", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      await asUser.mutation(api.projects.members.remove, {
        projectId: project._id,
        userId: member._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("org admin can remove project member", async () => {
      const ctx = createTestContext();
      const { project, org, t } = await ctx.setupProject();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      await asAdmin.mutation(api.projects.members.remove, {
        projectId: project._id,
        userId: member._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("can remove last explicit project admin", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      await asUser.mutation(api.projects.members.remove, {
        projectId: project._id,
        userId: user._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", user._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("can remove project admin if another admin exists", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser, t } = await ctx.setupProject();

      // Add another project admin
      const admin2 = await ctx.user();
      await ctx.orgMember(org._id, admin2._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, admin2._id, ProjectRole.PROJECT_ADMIN);

      await asUser.mutation(api.projects.members.remove, {
        projectId: project._id,
        userId: user._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", user._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("cannot remove non-member", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      // NOT added to project

      await expect(
        asUser.mutation(api.projects.members.remove, {
          projectId: project._id,
          userId: member._id,
        })
      ).rejects.toThrow("not a member of this project");
    });

    test("viewer cannot remove members", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const viewer = await ctx.user();
      await ctx.orgMember(org._id, viewer._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, viewer._id, ProjectRole.VIEWER);
      const asViewer = ctx.asUser(viewer);

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      await expect(
        asViewer.mutation(api.projects.members.remove, {
          projectId: project._id,
          userId: member._id,
        })
      ).rejects.toThrow();
    });

    test("a project admin without org authority cannot remove an org owner", async () => {
      const ctx = createTestContext();
      const { project, org } = await ctx.setupProject();

      const projectAdmin = await ctx.user({ name: "Subordinate" });
      await ctx.orgMember(org._id, projectAdmin._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, projectAdmin._id, ProjectRole.PROJECT_ADMIN);

      const owner = await ctx.user({ name: "Org Owner" });
      await ctx.orgMember(org._id, owner._id, OrgRole.OWNER);
      await ctx.projectMember(project._id, owner._id, ProjectRole.PROJECT_ADMIN);

      await expect(
        ctx.asUser(projectAdmin).mutation(api.projects.members.remove, {
          projectId: project._id,
          userId: owner._id,
        })
      ).rejects.toThrow("organization owners and admins");
    });
  });

  /**
   * Member management accepts org-level `PROJECTS_MANAGE_ALL` as an explicit
   * alternative to the project permission — the only thing that keeps the
   * surface working for a leader with no `projectMembers` row (OS-1536).
   */
  describe("org-level authority (OS-1534)", () => {
    async function setupOutsideAdmin() {
      const ctx = createTestContext();
      const { project, org, user } = await ctx.setupProject();

      const admin = await ctx.user({ name: "Outside Admin" });
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);

      return { ctx, project, org, projectAdmin: user, asAdmin: ctx.asUser(admin) };
    }

    test("org admin who is not a project member can list members", async () => {
      const { project, projectAdmin, asAdmin } = await setupOutsideAdmin();

      const members = await asAdmin.query(api.projects.members.list, {
        projectId: project._id,
      });

      expect(members.map((m) => m.userId)).toEqual([projectAdmin._id]);
    });

    test("org admin who is not a project member can add a member", async () => {
      const { ctx, project, org, asAdmin } = await setupOutsideAdmin();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await asAdmin.mutation(api.projects.members.add, {
        projectId: project._id,
        userId: member._id,
        role: "member",
      });

      const membership = await ctx.t.run(async (runCtx) =>
        runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id).eq("userId", member._id))
          .unique()
      );

      expect(membership?.role).toBe("member");
    });

    test("org admin who is not a project member can update a role", async () => {
      const { ctx, project, org, asAdmin } = await setupOutsideAdmin();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      await asAdmin.mutation(api.projects.members.updateRole, {
        projectId: project._id,
        userId: member._id,
        role: "viewer",
      });

      const membership = await ctx.t.run(async (runCtx) =>
        runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id).eq("userId", member._id))
          .unique()
      );

      expect(membership?.role).toBe("viewer");
    });

    test("org admin who is not a project member can remove a member", async () => {
      const { ctx, project, org, asAdmin } = await setupOutsideAdmin();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      await ctx.projectMember(project._id, member._id, ProjectRole.MEMBER);

      await asAdmin.mutation(api.projects.members.remove, {
        projectId: project._id,
        userId: member._id,
      });

      const membership = await ctx.t.run(async (runCtx) =>
        runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id).eq("userId", member._id))
          .unique()
      );

      expect(membership).toBeNull();
    });

    test("org admin who is not a project member can list assignable users", async () => {
      const { project, projectAdmin, asAdmin } = await setupOutsideAdmin();

      const assignable = await asAdmin.query(api.projects.members.listAssignable, {
        projectId: project._id,
      });

      expect(assignable.map((u) => u._id)).toContain(projectAdmin._id);
    });

    test("plain org member with no project membership is denied on every entry point", async () => {
      const ctx = createTestContext();
      const { project, org, user } = await ctx.setupProject();

      const outsider = await ctx.user();
      await ctx.orgMember(org._id, outsider._id, OrgRole.MEMBER);
      const asOutsider = ctx.asUser(outsider);

      expect(await asOutsider.query(api.projects.members.list, { projectId: project._id })).toEqual([]);
      expect(
        await asOutsider.query(api.projects.members.listEligibleToAdd, { projectId: project._id })
      ).toEqual([]);

      await expect(
        asOutsider.mutation(api.projects.members.add, {
          projectId: project._id,
          userId: outsider._id,
          role: "member",
        })
      ).rejects.toThrow();

      await expect(
        asOutsider.mutation(api.projects.members.updateRole, {
          projectId: project._id,
          userId: user._id,
          role: "viewer",
        })
      ).rejects.toThrow();

      await expect(
        asOutsider.mutation(api.projects.members.remove, {
          projectId: project._id,
          userId: user._id,
        })
      ).rejects.toThrow();
    });

  });
});
