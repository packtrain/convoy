/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from "../lib/contracts/notifications";
import { errors } from "./errors";

describe("notification preferences API", () => {
  test("list returns the full matrix with defaults: toast on, email off, in-app on except agent runs", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupUser();

    const entries = await asUser.query(api.notifications.preferences.list, {});

    expect(entries).toHaveLength(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length);
    for (const entry of entries) {
      const expected =
        entry.channel === "email" ? false : entry.channel === "inApp" ? !entry.type.startsWith("thread.") : true;
      expect(entry.enabled, `${entry.type}/${entry.channel}`).toBe(expected);
    }
  });

  test("set stores overrides, batches, and deletes rows back at default", async () => {
    const ctx = createTestContext();
    const { user, asUser, t } = await ctx.setupUser();

    // Group-style batch: two task types off in one call.
    await asUser.mutation(api.notifications.preferences.set, {
      entries: [
        { type: "task.created", channel: "inApp", enabled: false },
        { type: "task.deleted", channel: "inApp", enabled: false },
      ],
    });
    let entries = await asUser.query(api.notifications.preferences.list, {});
    const enabledOf = (type: string) =>
      entries.find((e) => e.type === type && e.channel === "inApp")?.enabled;
    expect(enabledOf("task.created")).toBe(false);
    expect(enabledOf("task.deleted")).toBe(false);
    expect(enabledOf("task.completed")).toBe(true);

    // Back to default → sparse storage drops the rows entirely.
    await asUser.mutation(api.notifications.preferences.set, {
      entries: [
        { type: "task.created", channel: "inApp", enabled: true },
        { type: "task.deleted", channel: "inApp", enabled: true },
      ],
    });
    entries = await asUser.query(api.notifications.preferences.list, {});
    expect(enabledOf("task.created")).toBe(true);
    const rows = await t.run(async (runCtx) =>
      runCtx.db
        .query("notificationPreferences")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()
    );
    expect(rows).toHaveLength(0);
  });

  test("set rejects an empty entry list and an oversized one", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupUser();

    await expect(asUser.mutation(api.notifications.preferences.set, { entries: [] })).rejects.toThrow(
      expect.objectContaining({ data: errors.PREFERENCE_ENTRIES_INVALID }) as ConvexError<string>
    );

    const oversized = Array.from(
      { length: NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length + 1 },
      () => ({ type: "task.created" as const, channel: "inApp" as const, enabled: false })
    );
    await expect(asUser.mutation(api.notifications.preferences.set, { entries: oversized })).rejects.toThrow(
      expect.objectContaining({ data: errors.PREFERENCE_ENTRIES_INVALID }) as ConvexError<string>
    );
  });

  test("duplicate (type, channel) entries in one call: last write wins", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupUser();

    await asUser.mutation(api.notifications.preferences.set, {
      entries: [
        { type: "task.created", channel: "inApp", enabled: false },
        { type: "task.created", channel: "inApp", enabled: true },
        { type: "task.deleted", channel: "inApp", enabled: true },
        { type: "task.deleted", channel: "inApp", enabled: false },
      ],
    });

    const entries = await asUser.query(api.notifications.preferences.list, {});
    const enabledOf = (type: string) =>
      entries.find((e) => e.type === type && e.channel === "inApp")?.enabled;
    expect(enabledOf("task.created")).toBe(true);
    expect(enabledOf("task.deleted")).toBe(false);
  });
});
