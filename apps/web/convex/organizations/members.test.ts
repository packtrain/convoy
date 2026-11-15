import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { OrgRole } from "../../lib/authz/roles";

describe("organizations.members", () => {
  describe("list", () => {
    test("should list all members with roles", async () => {
      const ctx = createTestContext();
      const { user, org, asUser } = await ctx.setupOrg();

      const members = await asUser.query(api.organizations.members.list, {
        organizationId: org._id,
      });

      expect(members).toHaveLength(1);
      expect(members[0]._id).toBe(user._id);
      expect(members[0].name).toBe(user.name);
      expect(members[0].email).toBe(user.email);
      expect(members[0].role).toBe("owner");
    });

    test("should return empty if not member", async () => {
      const ctx = createTestContext();
      const { user: user1 } = await ctx.setupUser();
      const org = await ctx.organization(user1._id, { name: "Other Org" });

      // Create a different user who is not a member
      const { asUser: asUser2 } = await ctx.setupUser();

      const members = await asUser2.query(api.organizations.members.list, {
        organizationId: org._id,
      });

      expect(members).toEqual([]);
    });

    test("should return empty if unauthenticated", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const members = await ctx.t.query(api.organizations.members.list, {
        organizationId: org._id,
      });

      expect(members).toEqual([]);
    });
  });

  describe("updateRole", () => {
    test("owner can change member to admin", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await asUser.mutation(api.organizations.members.updateRole, {
        organizationId: org._id,
        userId: member._id,
        newRole: "admin",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("admin");
    });

    test("owner can promote member to owner", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await asUser.mutation(api.organizations.members.updateRole, {
        organizationId: org._id,
        userId: member._id,
        newRole: "owner",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("owner");
    });

    test("admin can change member to admin", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await asAdmin.mutation(api.organizations.members.updateRole, {
        organizationId: org._id,
        userId: member._id,
        newRole: "admin",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("admin");
    });

    test("admin cannot promote to owner", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await expect(
        asAdmin.mutation(api.organizations.members.updateRole, {
          organizationId: org._id,
          userId: member._id,
          newRole: "owner",
        })
      ).rejects.toThrow("Only owners can promote to owner");
    });

    test("admin cannot change owner role", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      await expect(
        asAdmin.mutation(api.organizations.members.updateRole, {
          organizationId: org._id,
          userId: user._id,
          newRole: "member",
        })
      ).rejects.toThrow("Only owners can change another owner's role");
    });

    test("owner cannot demote self if only owner", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();

      await expect(
        asUser.mutation(api.organizations.members.updateRole, {
          organizationId: org._id,
          userId: user._id,
          newRole: "admin",
        })
      ).rejects.toThrow("only owner");
    });

    test("owner can demote self if another owner exists", async () => {
      const ctx = createTestContext();
      const { org, user, asUser, t } = await ctx.setupOrg();

      // Add another owner
      const owner2 = await ctx.user();
      await ctx.orgMember(org._id, owner2._id, OrgRole.OWNER);

      await asUser.mutation(api.organizations.members.updateRole, {
        organizationId: org._id,
        userId: user._id,
        newRole: "admin",
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", user._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("admin");
    });

    test("member cannot change roles", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(member);

      const otherMember = await ctx.user();
      await ctx.orgMember(org._id, otherMember._id, OrgRole.MEMBER);

      await expect(
        asMember.mutation(api.organizations.members.updateRole, {
          organizationId: org._id,
          userId: otherMember._id,
          newRole: "admin",
        })
      ).rejects.toThrow();
    });

    test("cannot update role for non-member", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const nonMember = await ctx.user();

      await expect(
        asUser.mutation(api.organizations.members.updateRole, {
          organizationId: org._id,
          userId: nonMember._id,
          newRole: "admin",
        })
      ).rejects.toThrow("not a member");
    });
  });

  describe("remove", () => {
    test("owner can remove member", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await asUser.mutation(api.organizations.members.remove, {
        organizationId: org._id,
        userId: member._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("owner can remove admin", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);

      await asUser.mutation(api.organizations.members.remove, {
        organizationId: org._id,
        userId: admin._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", admin._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("owner can remove another owner", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const owner2 = await ctx.user();
      await ctx.orgMember(org._id, owner2._id, OrgRole.OWNER);

      await asUser.mutation(api.organizations.members.remove, {
        organizationId: org._id,
        userId: owner2._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", owner2._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("admin can remove member", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await asAdmin.mutation(api.organizations.members.remove, {
        organizationId: org._id,
        userId: member._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("cannot remove self", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();

      await expect(
        asUser.mutation(api.organizations.members.remove, {
          organizationId: org._id,
          userId: user._id,
        })
      ).rejects.toThrow("Cannot remove yourself");
    });

    test("admin cannot remove owner", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      await expect(
        asAdmin.mutation(api.organizations.members.remove, {
          organizationId: org._id,
          userId: user._id,
        })
      ).rejects.toThrow("Only owners can remove other owners");
    });

    test("member cannot remove anyone", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(member);

      const otherMember = await ctx.user();
      await ctx.orgMember(org._id, otherMember._id, OrgRole.MEMBER);

      await expect(
        asMember.mutation(api.organizations.members.remove, {
          organizationId: org._id,
          userId: otherMember._id,
        })
      ).rejects.toThrow();
    });

    test("removing member cascades to project memberships", async () => {
      const ctx = createTestContext();
      const { org, user, asUser, t } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      // Create a project and add member to it
      const project = await ctx.project(org._id, user._id);
      await ctx.projectMember(project._id, member._id, "member");

      // Verify project membership exists
      const beforeRemoval = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });
      expect(beforeRemoval).not.toBeNull();

      // Remove from organization
      await asUser.mutation(api.organizations.members.remove, {
        organizationId: org._id,
        userId: member._id,
      });

      // Verify cascaded removal from project
      const afterRemoval = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(afterRemoval).toBeNull();
    });

    test("cannot remove non-member", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const nonMember = await ctx.user();

      await expect(
        asUser.mutation(api.organizations.members.remove, {
          organizationId: org._id,
          userId: nonMember._id,
        })
      ).rejects.toThrow("not a member");
    });
  });

  describe("leave", () => {
    test("member can leave organization", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(member);

      await asMember.mutation(api.organizations.members.leave, {
        organizationId: org._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("admin can leave organization", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      await asAdmin.mutation(api.organizations.members.leave, {
        organizationId: org._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", admin._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("only owner cannot leave", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      await expect(
        asUser.mutation(api.organizations.members.leave, {
          organizationId: org._id,
        })
      ).rejects.toThrow("Cannot leave as the only owner");
    });

    test("owner can leave if another owner exists", async () => {
      const ctx = createTestContext();
      const { org, user, asUser, t } = await ctx.setupOrg();

      // Add another owner
      const owner2 = await ctx.user();
      await ctx.orgMember(org._id, owner2._id, OrgRole.OWNER);

      await asUser.mutation(api.organizations.members.leave, {
        organizationId: org._id,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", user._id)
          )
          .unique();
      });

      expect(membership).toBeNull();
    });

    test("leaving cascades to project memberships", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(member);

      // Create a project and add member to it
      const project = await ctx.project(org._id, user._id);
      await ctx.projectMember(project._id, member._id, "member");

      // Leave the organization
      await asMember.mutation(api.organizations.members.leave, {
        organizationId: org._id,
      });

      // Verify cascaded removal from project
      const projectMembership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", project._id).eq("userId", member._id)
          )
          .unique();
      });

      expect(projectMembership).toBeNull();
    });

    test("non-member cannot leave", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const nonMember = await ctx.user();
      const asNonMember = ctx.asUser(nonMember);

      await expect(
        asNonMember.mutation(api.organizations.members.leave, {
          organizationId: org._id,
        })
      ).rejects.toThrow("not a member");
    });
  });

  describe("getMyRole", () => {
    test("returns owner role", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const role = await asUser.query(api.organizations.members.getMyRole, {
        organizationId: org._id,
      });

      expect(role).toBe("owner");
    });

    test("returns admin role", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, OrgRole.ADMIN);
      const asAdmin = ctx.asUser(admin);

      const role = await asAdmin.query(api.organizations.members.getMyRole, {
        organizationId: org._id,
      });

      expect(role).toBe("admin");
    });

    test("returns member role", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(member);

      const role = await asMember.query(api.organizations.members.getMyRole, {
        organizationId: org._id,
      });

      expect(role).toBe("member");
    });

    test("returns null for non-member", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const nonMember = await ctx.user();
      const asNonMember = ctx.asUser(nonMember);

      const role = await asNonMember.query(api.organizations.members.getMyRole, {
        organizationId: org._id,
      });

      expect(role).toBeNull();
    });

    test("returns null for unauthenticated user", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      const role = await t.query(api.organizations.members.getMyRole, {
        organizationId: org._id,
      });

      expect(role).toBeNull();
    });
  });
});
