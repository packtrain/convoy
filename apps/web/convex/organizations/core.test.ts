/// <reference types="vite/client" />
import { expect, test, describe } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

describe("organizations", () => {
  describe("create", () => {
    test("should create org with membership", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      const orgId = await asUser.mutation(api.organizations.core.create, {
        name: "Test Org",
        slug: "test-org",
      });

      expect(orgId).toBeDefined();

      // Verify org was created
      await t.run(async (runCtx) => {
        const org = await runCtx.db.get("organizations", orgId);
        expect(org).toBeDefined();
        expect(org?.name).toBe("Test Org");
        expect(org?.slug).toBe("test-org");
        expect(org?.createdBy).toBe(user._id);
        expect(org?.isDeleted).toBe(false);

        // Verify membership was created
        const membership = await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) => q.eq("organizationId", orgId).eq("userId", user._id))
          .unique();
        expect(membership).toBeDefined();
        expect(membership?.role).toBe("owner");
      });
    });

    test("should reject duplicate slug", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      // Create first org
      await asUser.mutation(api.organizations.core.create, {
        name: "First Org",
        slug: "same-slug",
      });

      // Try to create second org with same slug
      await expect(
        asUser.mutation(api.organizations.core.create, {
          name: "Second Org",
          slug: "same-slug",
        })
      ).rejects.toThrow("Organization slug already taken");
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();

      await expect(
        ctx.t.mutation(api.organizations.core.create, {
          name: "Test Org",
          slug: "test-org",
        })
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("listForUser", () => {
    test("should list user's organizations with role", async () => {
      const ctx = createTestContext();
      const { user, org, asUser } = await ctx.setupOrg();

      const orgs = await asUser.query(api.organizations.core.listForUser, {});

      expect(orgs).toHaveLength(1);
      expect(orgs[0]._id).toBe(org._id);
      expect(orgs[0].name).toBe(org.name);
      expect(orgs[0].role).toBe("owner");
    });

    test("should exclude deleted orgs", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      // Soft delete the org
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", org._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      const orgs = await asUser.query(api.organizations.core.listForUser, {});

      expect(orgs).toHaveLength(0);
    });

    test("should return empty if unauthenticated", async () => {
      const ctx = createTestContext();

      const orgs = await ctx.t.query(api.organizations.core.listForUser, {});

      expect(orgs).toEqual([]);
    });

    test("should list multiple organizations", async () => {
      const ctx = createTestContext();
      const { user, asUser } = await ctx.setupUser();

      // Create multiple orgs
      const org1 = await ctx.organization(user._id, { name: "Org 1", slug: "org-1" });
      const org2 = await ctx.organization(user._id, { name: "Org 2", slug: "org-2" });

      const orgs = await asUser.query(api.organizations.core.listForUser, {});

      expect(orgs).toHaveLength(2);
      expect(orgs.map((o) => o._id).sort()).toEqual([org1._id, org2._id].sort());
    });

    test("lists memberships for an API key, narrowed by key scope", async () => {
      const ctx = createTestContext();
      const { user, org, asUser, t } = await ctx.setupOrg();
      const otherOrg = await ctx.organization(user._id, { name: "Other", slug: "other-list-org" });
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const { key: unscopedKey } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Unscoped",
        expiresAt,
      });
      const { key: scopedKey } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt,
        scope: { organizationId: org._id, projectIds: [] },
      });

      const all = await t.query(api.organizations.core.listForUser, { apiKey: unscopedKey });
      const scoped = await t.query(api.organizations.core.listForUser, { apiKey: scopedKey });

      expect(all.map((o) => o._id).sort()).toEqual([org._id, otherOrg._id].sort());
      expect(scoped.map((o) => o._id)).toEqual([org._id]);
    });
  });

  describe("getById", () => {
    test("should get org by ID", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const result = await asUser.query(api.organizations.core.getById, { id: org._id });

      expect(result).toBeDefined();
      expect(result?._id).toBe(org._id);
      expect(result?.name).toBe(org.name);
    });

    test("should return null if not member", async () => {
      const ctx = createTestContext();
      const { user: user1 } = await ctx.setupUser();
      const org = await ctx.organization(user1._id, { name: "Other Org" });

      // Create a different user who is not a member
      const { asUser: asUser2 } = await ctx.setupUser();

      const result = await asUser2.query(api.organizations.core.getById, { id: org._id });

      expect(result).toBeNull();
    });

    test("should return null if deleted", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      // Soft delete the org
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", org._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      const result = await asUser.query(api.organizations.core.getById, { id: org._id });

      expect(result).toBeNull();
    });

    test("should return null for invalid ID", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupOrg();

      const result = await asUser.query(api.organizations.core.getById, { id: "invalid-id" });

      expect(result).toBeNull();
    });

    test("should return null if unauthenticated", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const result = await ctx.t.query(api.organizations.core.getById, { id: org._id });

      expect(result).toBeNull();
    });
  });

  describe("getByIdInternal", () => {
    test("returns active organization by ID", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      const result = await t.query(internal.organizations.core.getByIdInternal, {
        id: org._id,
      });

      expect(result?._id).toBe(org._id);
      expect(result?.slug).toBe(org.slug);
    });

    test("returns null for invalid organization ID", async () => {
      const ctx = createTestContext();

      const result = await ctx.t.query(internal.organizations.core.getByIdInternal, {
        id: "invalid-id",
      });

      expect(result).toBeNull();
    });

    test("returns null for deleted organization", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", org._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      const result = await t.query(internal.organizations.core.getByIdInternal, {
        id: org._id,
      });

      expect(result).toBeNull();
    });
  });

  describe("getBySlug", () => {
    test("should get org by slug", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const result = await asUser.query(api.organizations.core.getBySlug, { slug: org.slug });

      expect(result).toBeDefined();
      expect(result?._id).toBe(org._id);
      expect(result?.slug).toBe(org.slug);
    });

    test("should return null if not member", async () => {
      const ctx = createTestContext();
      const { user: user1 } = await ctx.setupUser();
      const org = await ctx.organization(user1._id, { name: "Other Org", slug: "other-org" });

      // Create a different user who is not a member
      const { asUser: asUser2 } = await ctx.setupUser();

      const result = await asUser2.query(api.organizations.core.getBySlug, { slug: org.slug });

      expect(result).toBeNull();
    });

    test("should return null if deleted", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      // Soft delete the org
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", org._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      const result = await asUser.query(api.organizations.core.getBySlug, { slug: org.slug });

      expect(result).toBeNull();
    });

    test("should return null for non-existent slug", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupOrg();

      const result = await asUser.query(api.organizations.core.getBySlug, { slug: "non-existent-slug" });

      expect(result).toBeNull();
    });

    test("should get org by slug via API key (no Clerk auth)", async () => {
      const ctx = createTestContext();
      const { asUser, org, t } = await ctx.setupOrg();
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Test",
        expiresAt,
      });

      const result = await t.query(api.organizations.core.getBySlug, {
        slug: org.slug,
        apiKey: key,
      });

      expect(result).toBeDefined();
      expect(result?._id).toBe(org._id);
      expect(result?.slug).toBe(org.slug);
    });

    test("returns null via API key scoped to another organization", async () => {
      const ctx = createTestContext();
      const { user, org, asUser, t } = await ctx.setupOrg();
      const otherOrg = await ctx.organization(user._id, {
        name: "Other Org",
        slug: "other-scoped-org",
      });
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt,
        scope: {
          organizationId: org._id,
          projectIds: [],
        },
      });

      const result = await t.query(api.organizations.core.getBySlug, {
        slug: otherOrg.slug,
        apiKey: key,
      });

      expect(result).toBeNull();
    });

    test("should return null for invalid API key", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      const result = await t.query(api.organizations.core.getBySlug, {
        slug: org.slug,
        apiKey: "sk_user_invalid_key_12345",
      });

      expect(result).toBeNull();
    });
  });

  describe("getByRef", () => {
    test("resolves either a slug or a raw ID for an API key", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Ref",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      const bySlug = await t.query(api.organizations.core.getByRef, { ref: org.slug, apiKey: key });
      const byId = await t.query(api.organizations.core.getByRef, { ref: org._id, apiKey: key });

      expect(bySlug?._id).toBe(org._id);
      expect(byId?._id).toBe(org._id);
    });

    test("returns null for an unknown ref, a non-member, and another organization's key", async () => {
      const ctx = createTestContext();
      const { user, org, asUser, t } = await ctx.setupOrg();
      const otherOrg = await ctx.organization(user._id, { name: "Other", slug: "other-ref-org" });
      const { asUser: asStranger } = await ctx.setupUser();
      const { key: scopedKey } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: { organizationId: org._id, projectIds: [] },
      });

      expect(await asUser.query(api.organizations.core.getByRef, { ref: "ghost" })).toBeNull();
      expect(await asStranger.query(api.organizations.core.getByRef, { ref: org.slug })).toBeNull();
      expect(
        await t.query(api.organizations.core.getByRef, { ref: otherOrg._id, apiKey: scopedKey })
      ).toBeNull();
    });
  });

  describe("checkSlugAvailability", () => {
    test("should return available: true for unused slug", async () => {
      const ctx = createTestContext();

      const result = await ctx.t.query(api.organizations.core.checkSlugAvailability, {
        slug: "unused-slug",
      });

      expect(result.available).toBe(true);
    });

    test("should return available: false for taken slug", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      const result = await ctx.t.query(api.organizations.core.checkSlugAvailability, {
        slug: org.slug,
      });

      expect(result.available).toBe(false);
    });
  });

  describe("update", () => {
    test("should update organization name", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        name: "New Name",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.name).toBe("New Name");
    });

    test("should update organization slug", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        slug: "new-slug",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.slug).toBe("new-slug");
    });

    test("should update multiple fields at once", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        name: "New Name",
        slug: "new-slug",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.name).toBe("New Name");
      expect(updated?.slug).toBe("new-slug");
    });

    test("should update updatedAt timestamp", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const before = Date.now();

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        name: "New Name",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.updatedAt).toBeGreaterThanOrEqual(before);
    });

    test("should fail if slug is already taken", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();

      // Create another org with a specific slug
      await ctx.organization(user._id, { slug: "taken-slug" });

      await expect(
        asUser.mutation(api.organizations.core.update, {
          id: org._id,
          slug: "taken-slug",
        })
      ).rejects.toThrow("already taken");
    });

    test("should allow slug held only by a deleted organization", async () => {
      const ctx = createTestContext();
      const { org, user, asUser, t } = await ctx.setupOrg();

      const deletedOrg = await ctx.organization(user._id, {
        slug: "deleted-slug",
      });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", deletedOrg._id, {
          isDeleted: true,
        });
      });

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        slug: "deleted-slug",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.slug).toBe("deleted-slug");
    });

    test("should fail if slug format is invalid", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      await expect(
        asUser.mutation(api.organizations.core.update, {
          id: org._id,
          slug: "Invalid Slug!",
        })
      ).rejects.toThrow();
    });

    test("should fail if name is too short", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      await expect(
        asUser.mutation(api.organizations.core.update, {
          id: org._id,
          name: "A",
        })
      ).rejects.toThrow("at least 2 characters");
    });

    test("should fail if user lacks permission", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      // Create a member (not admin/owner)
      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      const asMember = ctx.asUser(member);

      await expect(
        asMember.mutation(api.organizations.core.update, {
          id: org._id,
          name: "New Name",
        })
      ).rejects.toThrow();
    });

    test("should fail if organization is deleted", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      // Soft delete the org
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", org._id, { isDeleted: true });
      });

      await expect(
        asUser.mutation(api.organizations.core.update, {
          id: org._id,
          name: "New Name",
        })
      ).rejects.toThrow("deleted");
    });

    test("should fail if not authenticated", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      await expect(
        t.mutation(api.organizations.core.update, {
          id: org._id,
          name: "New Name",
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("should allow same slug (no-op)", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      // Should not throw even though slug "exists"
      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        slug: org.slug, // Same slug
      });
    });

    test("admin can update organization", async () => {
      const ctx = createTestContext();
      const { org, t } = await ctx.setupOrg();

      const admin = await ctx.user();
      await ctx.orgMember(org._id, admin._id, "admin");
      const asAdmin = ctx.asUser(admin);

      await asAdmin.mutation(api.organizations.core.update, {
        id: org._id,
        name: "Admin Updated",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.name).toBe("Admin Updated");
    });

    test("should update avatar URL", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        avatarUrl: "https://example.com/avatar.png",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.avatarUrl).toBe("https://example.com/avatar.png");
    });

    test("should fail if slug starts with hyphen", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      await expect(
        asUser.mutation(api.organizations.core.update, {
          id: org._id,
          slug: "-invalid",
        })
      ).rejects.toThrow();
    });

    test("should fail if slug ends with hyphen", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      await expect(
        asUser.mutation(api.organizations.core.update, {
          id: org._id,
          slug: "invalid-",
        })
      ).rejects.toThrow();
    });

    test("should fail if slug is too long", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      await expect(
        asUser.mutation(api.organizations.core.update, {
          id: org._id,
          slug: "a".repeat(51), // 51 characters
        })
      ).rejects.toThrow("between 2 and 50 characters");
    });

    test("should normalize slug to lowercase", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        slug: "MySlug",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.slug).toBe("myslug");
    });

    test("should trim name whitespace", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        name: "  Trimmed Name  ",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.name).toBe("Trimmed Name");
    });

    test("should update organization color", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        color: "#ef4444",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.color).toBe("#ef4444");
    });

    test("should clear organization color with null", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      // First set a color
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", org._id, { color: "#3b82f6" });
      });

      // Then clear it with null
      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        color: null,
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      // Color should be cleared when passed null
      expect(updated?.color).toBeUndefined();
    });

    test("should preserve color when not provided in update", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      // Set initial color
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", org._id, { color: "#22c55e" });
      });

      // Update only name, not color
      await asUser.mutation(api.organizations.core.update, {
        id: org._id,
        name: "New Name",
      });

      const updated = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizations", org._id);
      });

      expect(updated?.name).toBe("New Name");
      expect(updated?.color).toBe("#22c55e"); // Should be preserved
    });
  });

  describe("create with color", () => {
    test("should create org with color", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const orgId = await asUser.mutation(api.organizations.core.create, {
        name: "Colorful Org",
        slug: "colorful-org",
        color: "#8b5cf6",
      });

      expect(orgId).toBeDefined();

      await t.run(async (runCtx) => {
        const org = await runCtx.db.get("organizations", orgId);
        expect(org?.color).toBe("#8b5cf6");
      });
    });

    test("should create org without color", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const orgId = await asUser.mutation(api.organizations.core.create, {
        name: "No Color Org",
        slug: "no-color-org",
      });

      await t.run(async (runCtx) => {
        const org = await runCtx.db.get("organizations", orgId);
        expect(org?.color).toBeUndefined();
      });
    });
  });

  describe("listForUser with color", () => {
    test("should include color in listed organizations", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      // Create org with color
      const org = await ctx.organization(user._id, {
        name: "Colored Org",
        slug: "colored-org",
      });

      // Set color directly
      await t.run(async (runCtx) => {
        await runCtx.db.patch("organizations", org._id, { color: "#ec4899" });
      });

      const orgs = await asUser.query(api.organizations.core.listForUser, {});

      expect(orgs).toHaveLength(1);
      expect(orgs[0].color).toBe("#ec4899");
    });
  });
});
