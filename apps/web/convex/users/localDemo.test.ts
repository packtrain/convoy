/// <reference types="vite/client" />
import { afterEach, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { LOCAL_DEMO_TOKEN_IDENTIFIER } from "../lib/access/localDemo";

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;

function enableLocalDemo() {
  process.env.AUTH_MODE = "local-demo";
}

afterEach(() => {
  if (ORIGINAL_AUTH_MODE === undefined) {
    delete process.env.AUTH_MODE;
  } else {
    process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
  }
});

describe("local demo mode (OS-1230)", () => {
  describe("onboardLocalDemo", () => {
    test("throws when local demo mode is not enabled", async () => {
      const ctx = createTestContext();

      await expect(ctx.t.mutation(api.users.core.onboardLocalDemo, {})).rejects.toThrow(
        "Local demo mode is not enabled"
      );
    });

    test("creates demo user, workspace, starter project, and owner membership", async () => {
      enableLocalDemo();
      const ctx = createTestContext();

      const result = await ctx.t.mutation(api.users.core.onboardLocalDemo, {});

      expect(result.isNewUser).toBe(true);

      await ctx.t.run(async (runCtx) => {
        const user = await runCtx.db
          .query("users")
          .withIndex("by_token", (q) => q.eq("tokenIdentifier", LOCAL_DEMO_TOKEN_IDENTIFIER))
          .unique();
        expect(user).toBeDefined();

        const membership = await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", result.organizationId).eq("userId", user!._id)
          )
          .unique();
        expect(membership?.role).toBe("owner");

        const projects = await runCtx.db
          .query("projects")
          .withIndex("by_organization_and_isDeleted", (q) =>
            q.eq("organizationId", result.organizationId).eq("isDeleted", false)
          )
          .collect();
        expect(projects).toHaveLength(1);
        expect(projects[0].defaultListId).toBeDefined();
      });
    });

    test("is idempotent: re-running returns the same organization", async () => {
      enableLocalDemo();
      const ctx = createTestContext();

      const first = await ctx.t.mutation(api.users.core.onboardLocalDemo, {});
      const second = await ctx.t.mutation(api.users.core.onboardLocalDemo, {});

      expect(second.isNewUser).toBe(false);
      expect(second.organizationId).toBe(first.organizationId);
      expect(second.organizationSlug).toBe(first.organizationSlug);
    });
  });

  describe("anonymous auth fallback", () => {
    test("anonymous callers resolve to the demo user after onboarding", async () => {
      enableLocalDemo();
      const ctx = createTestContext();

      await ctx.t.mutation(api.users.core.onboardLocalDemo, {});

      const currentUser = await ctx.t.query(api.users.core.current, {});
      expect(currentUser?.tokenIdentifier).toBe(LOCAL_DEMO_TOKEN_IDENTIFIER);
    });

    test("anonymous callers see the demo workspace through normal permissions", async () => {
      enableLocalDemo();
      const ctx = createTestContext();

      const { organizationId } = await ctx.t.mutation(api.users.core.onboardLocalDemo, {});

      const organizations = await ctx.t.query(api.organizations.core.listForUser, {});
      expect(organizations.map((org) => org._id)).toContain(organizationId);
    });

    test("anonymous callers stay unauthenticated before the demo user exists", async () => {
      enableLocalDemo();
      const ctx = createTestContext();

      const currentUser = await ctx.t.query(api.users.core.current, {});
      expect(currentUser).toBeNull();
    });

    test("anonymous callers stay unauthenticated when the flag is off", async () => {
      const ctx = createTestContext();

      const currentUser = await ctx.t.query(api.users.core.current, {});
      expect(currentUser).toBeNull();
    });

    test("authenticated identities still resolve to their own user in local demo", async () => {
      enableLocalDemo();
      const ctx = createTestContext();
      const { user, asUser } = await ctx.setupUser();

      await ctx.t.mutation(api.users.core.onboardLocalDemo, {});

      const currentUser = await asUser.query(api.users.core.current, {});
      expect(currentUser?._id).toBe(user._id);
      expect(currentUser?.tokenIdentifier).not.toBe(LOCAL_DEMO_TOKEN_IDENTIFIER);
    });
  });

  describe("syncProfile in local demo", () => {
    test("updates the demo user's name anonymously", async () => {
      enableLocalDemo();
      const ctx = createTestContext();

      await ctx.t.mutation(api.users.core.onboardLocalDemo, {});
      await ctx.t.mutation(api.users.core.syncProfile, { name: "Renamed Demo" });

      const currentUser = await ctx.t.query(api.users.core.current, {});
      expect(currentUser?.name).toBe("Renamed Demo");
    });
  });
});
