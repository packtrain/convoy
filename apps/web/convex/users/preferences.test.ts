import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

describe("userPreferences", () => {
  describe("get", () => {
    test("returns defaults when no record exists", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const prefs = await asUser.query(api.users.preferences.get, {});

      expect(prefs).toEqual({
        threadSortBy: "lastActivity",
        threadCompactLayout: true,
        threadGroupDone: true,
        pullRequestCompactLayout: false,
        cliFavoriteCombos: [],
        sectionHeaderStyle: "compact",
        sectionColorStyle: "tint",
      });
    });

    test("returns stored preferences", async () => {
      const ctx = createTestContext();
      const { user, asUser } = await ctx.setupUser();

      await ctx.userPreferences(user._id, {
        threadSortBy: "created",
        threadCompactLayout: true,
      });

      const prefs = await asUser.query(api.users.preferences.get, {});

      expect(prefs).toEqual({
        threadSortBy: "created",
        threadCompactLayout: true,
        threadGroupDone: true,
        pullRequestCompactLayout: false,
        cliFavoriteCombos: [],
        sectionHeaderStyle: "compact",
        sectionColorStyle: "tint",
      });
    });

    test("returns defaults for unauthenticated user", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      const prefs = await t.query(api.users.preferences.get, {});

      expect(prefs).toEqual({
        threadSortBy: "lastActivity",
        threadCompactLayout: true,
        threadGroupDone: true,
        pullRequestCompactLayout: false,
        cliFavoriteCombos: [],
        sectionHeaderStyle: "compact",
        sectionColorStyle: "tint",
      });
    });

    test("fills in defaults for missing optional fields", async () => {
      const ctx = createTestContext();
      const { user, asUser } = await ctx.setupUser();

      // Create record with only threadSortBy set
      await ctx.userPreferences(user._id, {
        threadSortBy: "created",
      });

      const prefs = await asUser.query(api.users.preferences.get, {});

      expect(prefs).toEqual({
        threadSortBy: "created",
        threadCompactLayout: true,
        threadGroupDone: true,
        pullRequestCompactLayout: false,
        cliFavoriteCombos: [],
        sectionHeaderStyle: "compact",
        sectionColorStyle: "tint",
      });
    });
  });

  describe("upsert", () => {
    test("creates new record when none exists", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      await asUser.mutation(api.users.preferences.upsert, {
        threadSortBy: "created",
        threadCompactLayout: true,
      });

      await t.run(async (runCtx) => {
        const prefs = await runCtx.db
          .query("userPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique();

        expect(prefs).not.toBeNull();
        expect(prefs?.threadSortBy).toBe("created");
        expect(prefs?.threadCompactLayout).toBe(true);
      });
    });

    test("updates existing record", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      await ctx.userPreferences(user._id, {
        threadSortBy: "lastActivity",
        threadCompactLayout: false,
      });

      await asUser.mutation(api.users.preferences.upsert, {
        threadSortBy: "created",
        threadCompactLayout: true,
      });

      await t.run(async (runCtx) => {
        const prefs = await runCtx.db
          .query("userPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique();

        expect(prefs?.threadSortBy).toBe("created");
        expect(prefs?.threadCompactLayout).toBe(true);
      });
    });

    test("partial update only changes provided fields", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      await ctx.userPreferences(user._id, {
        threadSortBy: "lastActivity",
        threadCompactLayout: true,
      });

      await asUser.mutation(api.users.preferences.upsert, {
        threadSortBy: "created",
      });

      await t.run(async (runCtx) => {
        const prefs = await runCtx.db
          .query("userPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique();

        expect(prefs?.threadSortBy).toBe("created");
        expect(prefs?.threadCompactLayout).toBe(true);
      });
    });

    test("creates with defaults for omitted fields", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      await asUser.mutation(api.users.preferences.upsert, {
        threadCompactLayout: true,
      });

      await t.run(async (runCtx) => {
        const prefs = await runCtx.db
          .query("userPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique();

        expect(prefs?.threadSortBy).toBe("lastActivity");
        expect(prefs?.threadCompactLayout).toBe(true);
      });
    });

    test("defaults compact layout when creating from another preference", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      await asUser.mutation(api.users.preferences.upsert, {
        threadGroupDone: false,
      });

      await t.run(async (runCtx) => {
        const prefs = await runCtx.db
          .query("userPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique();

        expect(prefs?.threadCompactLayout).toBe(true);
      });
    });

    test("defaults section appearance to compact + tint and stores changes (OS-2137)", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      await asUser.mutation(api.users.preferences.upsert, { threadGroupDone: true });
      expect(await asUser.query(api.users.preferences.get, {})).toMatchObject({
        sectionHeaderStyle: "compact",
        sectionColorStyle: "tint",
      });

      await asUser.mutation(api.users.preferences.upsert, { sectionHeaderStyle: "spacious", sectionColorStyle: "stripe" });
      expect(await asUser.query(api.users.preferences.get, {})).toMatchObject({
        sectionHeaderStyle: "spacious",
        sectionColorStyle: "stripe",
        threadGroupDone: true,
      });
    });

    test("stores the PR list's compact layout apart from the thread list's", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      await asUser.mutation(api.users.preferences.upsert, { pullRequestCompactLayout: true });
      expect(await asUser.query(api.users.preferences.get, {})).toMatchObject({ pullRequestCompactLayout: true, threadCompactLayout: true });
      await asUser.mutation(api.users.preferences.upsert, { pullRequestCompactLayout: false });
      expect(await asUser.query(api.users.preferences.get, {})).toMatchObject({ pullRequestCompactLayout: false });
    });

    test("stores the done-grouping preference (OS-1394)", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      await asUser.mutation(api.users.preferences.upsert, {
        threadGroupDone: true,
      });

      const prefs = await asUser.query(api.users.preferences.get, {});
      expect(prefs.threadGroupDone).toBe(true);
    });

    test("stores and returns favorite cli combos", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const combos = [
        { cliType: "claude-code" as const, cliModel: "opus", cliEffort: "high" },
        { cliType: "codex" as const, cliModel: "gpt-5.5-codex" },
      ];
      await asUser.mutation(api.users.preferences.upsert, {
        cliFavoriteCombos: combos,
      });

      const prefs = await asUser.query(api.users.preferences.get, {});
      expect(prefs.cliFavoriteCombos).toEqual(combos);
    });

    test("updating other preferences keeps favorite cli combos", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const combos = [{ cliType: "claude-code" as const, cliModel: "opus" }];
      await asUser.mutation(api.users.preferences.upsert, {
        cliFavoriteCombos: combos,
      });
      await asUser.mutation(api.users.preferences.upsert, {
        threadCompactLayout: true,
      });

      const prefs = await asUser.query(api.users.preferences.get, {});
      expect(prefs.cliFavoriteCombos).toEqual(combos);
      expect(prefs.threadCompactLayout).toBe(true);
    });

    test("rejects more favorites than the cap", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupUser();

      const combos = Array.from({ length: 21 }, (_, index) => ({
        cliType: "claude-code" as const,
        cliModel: `model-${index}`,
      }));

      await expect(
        asUser.mutation(api.users.preferences.upsert, {
          cliFavoriteCombos: combos,
        })
      ).rejects.toThrow(/favorites/i);
    });

    test("throws for unauthenticated user", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      await expect(
        t.mutation(api.users.preferences.upsert, {
          threadSortBy: "created",
        })
      ).rejects.toThrow("Not authenticated");
    });
  });
});
