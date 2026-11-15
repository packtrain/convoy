/// <reference types="vite/client" />
import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext, gen } from "../../convex-testing";

describe("users", () => {
  describe("store", () => {
    test("should create new user from auth identity", async () => {
      const ctx = createTestContext();

      const tokenIdentifier = gen.tokenIdentifier();
      const email = gen.email();
      const name = "Test User";

      const asUser = ctx.t.withIdentity({
        tokenIdentifier,
        email,
        name,
        pictureUrl: "https://example.com/avatar.png",
      });

      const userId = await asUser.mutation(api.users.core.store, {});

      // Verify user was created
      expect(userId).toBeDefined();

      // Check user data in DB
      await ctx.t.run(async (runCtx) => {
        const user = await runCtx.db.get("users", userId);
        expect(user).toBeDefined();
        expect(user?.tokenIdentifier).toBe(tokenIdentifier);
        expect(user?.email).toBe(email);
        expect(user?.name).toBe(name);
        expect(user?.avatarUrl).toBe("https://example.com/avatar.png");
      });
    });

    test("should return existing user ID if unchanged", async () => {
      const ctx = createTestContext();
      const { user, asUser } = await ctx.setupUser();

      // Call store again with same identity
      const userId = await asUser.mutation(api.users.core.store, {});

      expect(userId).toBe(user._id);
    });

    test("should update existing user on changed info", async () => {
      const ctx = createTestContext();
      const { user, t } = await ctx.setupUser();

      // Create identity with updated info
      const updatedName = "Updated Name";
      const updatedEmail = "updated@test.com";

      const asUpdatedUser = t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: updatedEmail,
        name: updatedName,
        pictureUrl: "https://example.com/new-avatar.png",
      });

      const userId = await asUpdatedUser.mutation(api.users.core.store, {});

      expect(userId).toBe(user._id);

      // Verify user data was updated
      await t.run(async (runCtx) => {
        const updatedUser = await runCtx.db.get("users", userId);
        expect(updatedUser?.name).toBe(updatedName);
        expect(updatedUser?.email).toBe(updatedEmail);
        expect(updatedUser?.avatarUrl).toBe("https://example.com/new-avatar.png");
      });
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();

      await expect(ctx.t.mutation(api.users.core.store, {})).rejects.toMatchObject({
        data: {
          code: "AUTH_NOT_AUTHENTICATED",
          message: "Not authenticated",
        },
      });
    });
  });

  describe("onboard", () => {
    test("should create new user + default org + first project", async () => {
      const ctx = createTestContext();

      const tokenIdentifier = gen.tokenIdentifier();
      const email = gen.email();
      const name = "New User";

      const asUser = ctx.t.withIdentity({
        tokenIdentifier,
        email,
        name,
      });

      const result = await asUser.mutation(api.users.core.onboard, {});

      expect(result.isNewUser).toBe(true);
      expect(result.organizationId).toBeDefined();
      expect(result.organizationSlug).toBeDefined();

      // Verify user, org, and project were created
      await ctx.t.run(async (runCtx) => {
        // Check user
        const user = await runCtx.db
          .query("users")
          .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
          .unique();
        expect(user).toBeDefined();

        // Check org
        const org = await runCtx.db.get("organizations", result.organizationId);
        expect(org).toBeDefined();
        expect(org?.name).toBe(`${name}'s Workspace`);

        // Check membership
        const membership = await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) => q.eq("organizationId", result.organizationId).eq("userId", user!._id))
          .unique();
        expect(membership).toBeDefined();
        expect(membership?.role).toBe("owner");

        // Check project was created
        const projects = await runCtx.db
          .query("projects")
          .withIndex("by_organization_and_isDeleted", (q) => q.eq("organizationId", result.organizationId).eq("isDeleted", false))
          .collect();
        expect(projects).toHaveLength(1);
        expect(projects[0].name).toBe("My First Project");
        expect(projects[0].alias).toBe("MFP");
      });
    });

    test("creates the Inbox List as the starter project's default List", async () => {
      const ctx = createTestContext();

      const asUser = ctx.t.withIdentity({
        tokenIdentifier: gen.tokenIdentifier(),
        email: gen.email(),
        name: "New User",
      });

      const result = await asUser.mutation(api.users.core.onboard, {});

      await ctx.t.run(async (runCtx) => {
        const projects = await runCtx.db
          .query("projects")
          .withIndex("by_organization_and_isDeleted", (q) => q.eq("organizationId", result.organizationId).eq("isDeleted", false))
          .collect();
        expect(projects).toHaveLength(1);

        // Spec (task-lists.md): new projects create an Inbox List and set it
        // as projects.defaultListId.
        const project = projects[0];
        expect(project.defaultListId).toBeDefined();

        const inboxList = await runCtx.db.get("taskLists", project.defaultListId!);
        expect(inboxList?.name).toBe("Inbox");
        expect(inboxList?.projectId).toBe(project._id);
        // Spec (project-sidebar-pinned-lists.md): Inbox and Backlog start pinned.
        expect(inboxList?.isPinned).toBe(true);
        expect(project.pinnedSystemLists?.map((pin) => pin.key)).toEqual(["backlog"]);
      });
    });

    test("should return existing org for existing user", async () => {
      const ctx = createTestContext();
      const { user, org, asUser } = await ctx.setupOrg();

      const result = await asUser.mutation(api.users.core.onboard, {});

      expect(result.isNewUser).toBe(false);
      expect(result.organizationId).toBe(org._id);
      expect(result.organizationSlug).toBe(org.slug);
    });

    test("should update user info on re-onboard", async () => {
      const ctx = createTestContext();
      const { user, t } = await ctx.setupOrg();

      const updatedName = "Re-onboarded User";

      const asUpdatedUser = t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: "updated@test.com",
        name: updatedName,
      });

      await asUpdatedUser.mutation(api.users.core.onboard, {});

      // Verify user data was updated
      await t.run(async (runCtx) => {
        const updatedUser = await runCtx.db.get("users", user._id);
        expect(updatedUser?.name).toBe(updatedName);
        expect(updatedUser?.email).toBe("updated@test.com");
      });
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();

      await expect(ctx.t.mutation(api.users.core.onboard, {})).rejects.toMatchObject({
        data: {
          code: "AUTH_NOT_AUTHENTICATED",
          message: "Not authenticated",
        },
      });
    });
  });

  describe("current", () => {
    test("should return current user", async () => {
      const ctx = createTestContext();
      const { user, asUser } = await ctx.setupUser();

      const currentUser = await asUser.query(api.users.core.current, {});

      expect(currentUser).toBeDefined();
      expect(currentUser?._id).toBe(user._id);
      expect(currentUser?.email).toBe(user.email);
      expect(currentUser?.name).toBe(user.name);
    });

    test("should return null if unauthenticated", async () => {
      const ctx = createTestContext();

      const currentUser = await ctx.t.query(api.users.core.current, {});

      expect(currentUser).toBeNull();
    });

    test("should return null if user not in DB", async () => {
      const ctx = createTestContext();

      // Create identity without corresponding DB user
      const asUser = ctx.t.withIdentity({
        tokenIdentifier: gen.tokenIdentifier(),
        email: gen.email(),
      });

      const currentUser = await asUser.query(api.users.core.current, {});

      expect(currentUser).toBeNull();
    });
  });

  describe("syncProfile", () => {
    test("should update user with explicit name argument", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      const newName = "Updated Full Name";

      await asUser.mutation(api.users.core.syncProfile, { name: newName });

      // Verify name was updated in DB
      await t.run(async (runCtx) => {
        const updatedUser = await runCtx.db.get("users", user._id);
        expect(updatedUser?.name).toBe(newName);
      });
    });

    test("should use identity for email and avatar even when name is passed", async () => {
      const ctx = createTestContext();
      const { user, t } = await ctx.setupUser();

      const identityEmail = "identity-email@example.com";
      const identityAvatar = "https://example.com/identity-avatar.png";

      const asUserWithDifferentIdentity = t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: identityEmail,
        name: "Identity Name",
        pictureUrl: identityAvatar,
      });

      const explicitName = "Explicit Name";

      await asUserWithDifferentIdentity.mutation(api.users.core.syncProfile, {
        name: explicitName,
      });

      await t.run(async (runCtx) => {
        const updatedUser = await runCtx.db.get("users", user._id);
        expect(updatedUser?.name).toBe(explicitName);
        expect(updatedUser?.email).toBe(identityEmail);
        expect(updatedUser?.avatarUrl).toBe(identityAvatar);
      });
    });

    test("should fall back to identity when no args provided", async () => {
      const ctx = createTestContext();
      const { user, t } = await ctx.setupUser();

      const identityName = "Identity Fallback Name";
      const identityEmail = "identity-fallback@example.com";
      const identityAvatar = "https://example.com/identity-fallback.png";

      const asUserWithIdentity = t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: identityEmail,
        name: identityName,
        pictureUrl: identityAvatar,
      });

      // Call without explicit args - should use identity data
      await asUserWithIdentity.mutation(api.users.core.syncProfile, {});

      await t.run(async (runCtx) => {
        const updatedUser = await runCtx.db.get("users", user._id);
        expect(updatedUser?.name).toBe(identityName);
        expect(updatedUser?.email).toBe(identityEmail);
        expect(updatedUser?.avatarUrl).toBe(identityAvatar);
      });
    });

    test("should reject spoofed email/avatar fields in args", async () => {
      const ctx = createTestContext();
      const { user, t } = await ctx.setupUser();

      const asUser = t.withIdentity({
        tokenIdentifier: user.tokenIdentifier,
        email: "identity-only@example.com",
        name: "Identity Name",
        pictureUrl: "https://example.com/identity-only.png",
      });

      const spoofedArgs = {
        name: "New Name",
        email: "spoofed@example.com",
        avatarUrl: "https://example.com/spoofed.png",
      } as unknown as { name?: string };

      await expect(asUser.mutation(api.users.core.syncProfile, spoofedArgs)).rejects.toThrow();

      await t.run(async (runCtx) => {
        const unchangedUser = await runCtx.db.get("users", user._id);
        expect(unchangedUser?.email).toBe(user.email);
      });
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();

      await expect(ctx.t.mutation(api.users.core.syncProfile, {})).rejects.toThrow("Not authenticated");
    });

    test("should throw when user not found in DB", async () => {
      const ctx = createTestContext();

      // Create identity without corresponding DB user
      const asUser = ctx.t.withIdentity({
        tokenIdentifier: gen.tokenIdentifier(),
        email: gen.email(),
      });

      await expect(asUser.mutation(api.users.core.syncProfile, { name: "Test" })).rejects.toThrow("Not authenticated");
    });
  });
});
