/// <reference types="vite/client" />
import { describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";
import { errors } from "./errors";
import { MARK_ALL_READ_BATCH, TOAST_RECENT_LIMIT } from "./lib/constants";

type TestCtx = ReturnType<typeof createTestContext>;

async function insertNotification(
  t: Awaited<ReturnType<TestCtx["setupProject"]>>["t"],
  overrides: {
    userId: Id<"users">;
    organizationId: Id<"organizations">;
    projectId: Id<"projects">;
    taskId: Id<"tasks">;
    read?: boolean;
    taskTitle?: string;
    type?: Doc<"notifications">["type"];
    actorUserId?: Id<"users">;
  }
): Promise<Id<"notifications">> {
  let id!: Id<"notifications">;
  await t.run(async (runCtx) => {
    id = await runCtx.db.insert("notifications", {
      userId: overrides.userId,
      type: overrides.type ?? "task.status_changed",
      actorUserId: overrides.actorUserId,
      organizationId: overrides.organizationId,
      projectId: overrides.projectId,
      subject: { kind: "task", id: overrides.taskId },
      read: overrides.read ?? false,
      snapshot: { taskRef: "T-1", taskTitle: overrides.taskTitle ?? "task" },
    });
  });
  return id;
}

describe("notifications core API", () => {
  test("list paginates newest first and unreadOnly filters", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const row = { userId: user._id, organizationId: org._id, projectId: project._id, taskId: task._id };

    await insertNotification(t, { ...row, taskTitle: "a" });
    await insertNotification(t, { ...row, taskTitle: "b", read: true });
    await insertNotification(t, { ...row, taskTitle: "c" });

    const firstPage = await asUser.query(api.notifications.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page.map((row: Doc<"notifications">) => row.snapshot.taskTitle)).toEqual(["c", "b"]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await asUser.query(api.notifications.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page.map((row: Doc<"notifications">) => row.snapshot.taskTitle)).toEqual(["a"]);
    expect(secondPage.isDone).toBe(true);

    const unread = await asUser.query(api.notifications.core.list, {
      organizationId: org._id,
      unreadOnly: true,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(unread.page.map((row: Doc<"notifications">) => row.snapshot.taskTitle)).toEqual(["c", "a"]);

    // Unauthenticated callers get an empty page, not an error.
    const anonymous = await t.query(api.notifications.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(anonymous.page).toEqual([]);
  });

  test("another organization's rows never reach the feed, the badge, or mark-all", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const otherOrg = await ctx.organization(user._id);
    const otherProject = await ctx.project(otherOrg._id, user._id, { alias: "OTH" });
    const otherTask = await ctx.task(otherProject._id, user._id);

    await insertNotification(t, {
      userId: user._id,
      organizationId: org._id,
      projectId: project._id,
      taskId: task._id,
      taskTitle: "here",
    });
    const elsewhere = await insertNotification(t, {
      userId: user._id,
      organizationId: otherOrg._id,
      projectId: otherProject._id,
      taskId: otherTask._id,
      taskTitle: "elsewhere",
    });

    // Legacy row from before the org stamp: no index entry matches an org, so
    // it stays invisible until the backfill migration stamps it.
    await t.run(async (runCtx) => {
      await runCtx.db.insert("notifications", {
        userId: user._id,
        type: "task.status_changed",
        projectId: project._id,
        subject: { kind: "task", id: task._id },
        read: false,
        snapshot: { taskRef: "T-1", taskTitle: "legacy" },
      });
    });

    const page = await asUser.query(api.notifications.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((row) => row.snapshot.taskTitle)).toEqual(["here"]);
    expect(await asUser.query(api.notifications.core.unreadCount, { organizationId: org._id })).toBe(1);
    const recent = await asUser.query(api.notifications.core.recent, { organizationId: org._id });
    expect(recent.items.map((row) => row.snapshot.taskTitle)).toEqual(["here"]);

    // Clearing one org's inbox leaves the other org's badge alone.
    await asUser.mutation(api.notifications.core.markAllAsRead, { organizationId: org._id });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("notifications", elsewhere))?.read).toBe(false);
    });
    expect(await asUser.query(api.notifications.core.unreadCount, { organizationId: otherOrg._id })).toBe(1);
  });

  test("list enriches rows with org slug, project alias, and actor avatar", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const actor = await ctx.user();
    await t.run(async (runCtx) => {
      await runCtx.db.patch("users", actor._id, { avatarUrl: "https://example.com/a.png" });
    });
    const task = await ctx.task(project._id, user._id);

    await insertNotification(t, {
      userId: user._id,
      organizationId: org._id,
      projectId: project._id,
      taskId: task._id,
      actorUserId: actor._id,
    });

    const page = await asUser.query(api.notifications.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0]).toMatchObject({
      orgSlug: org.slug,
      projectAlias: project.alias,
      actorAvatarUrl: "https://example.com/a.png",
    });
  });

  test("inaccessible-project rows stay listed without link fields and still count", async () => {
    const ctx = createTestContext();
    const { user: owner, org, project, t } = await ctx.setupProject();
    // Org member with access to `project` only — the other project in the same
    // org is invisible to them, so its rows render as "No access".
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const asMember = ctx.asUser(member);
    const closedProject = await ctx.project(org._id, owner._id, { alias: "CLS" });
    const closedTask = await ctx.task(closedProject._id, owner._id);
    const task = await ctx.task(project._id, owner._id);

    await insertNotification(t, {
      userId: member._id,
      organizationId: org._id,
      projectId: project._id,
      taskId: task._id,
    });
    await insertNotification(t, {
      userId: member._id,
      organizationId: org._id,
      projectId: closedProject._id,
      taskId: closedTask._id,
    });

    const page = await asMember.query(api.notifications.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(2);
    const closedRow = page.page.find((row) => row.projectId === closedProject._id);
    const ownRow = page.page.find((row) => row.projectId === project._id);
    expect(closedRow?.orgSlug).toBeUndefined();
    expect(closedRow?.projectAlias).toBeUndefined();
    expect(ownRow?.projectAlias).toBe(project.alias);

    expect(await asMember.query(api.notifications.core.unreadCount, { organizationId: org._id })).toBe(2);
  });

  test("thread rows require CLI_THREAD: a project viewer keeps task links but gets No access on threads", async () => {
    const ctx = createTestContext();
    const { user: owner, org, project, t } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);
    const task = await ctx.task(project._id, owner._id);
    const profile = await ctx.cliProfile(viewer._id, project._id);
    const thread = await ctx.cliThread(viewer._id, project._id, profile._id);

    await insertNotification(t, {
      userId: viewer._id,
      organizationId: org._id,
      projectId: project._id,
      taskId: task._id,
    });
    await t.run(async (runCtx) => {
      await runCtx.db.insert("notifications", {
        userId: viewer._id,
        type: "thread.completed",
        organizationId: org._id,
        projectId: project._id,
        subject: { kind: "thread", id: thread._id },
        read: false,
        snapshot: { threadTitle: "run" },
      });
    });

    const page = await asViewer.query(api.notifications.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(2);
    const taskRow = page.page.find((row) => row.subject.kind === "task");
    const threadRow = page.page.find((row) => row.subject.kind === "thread");
    // Viewer role has TASK_VIEW but not CLI_THREAD: the thread page would
    // reject them, so the row must degrade to "No access" (no link fields).
    expect(taskRow?.projectAlias).toBe(project.alias);
    expect(threadRow?.orgSlug).toBeUndefined();
    expect(threadRow?.projectAlias).toBeUndefined();
  });

  test("recent returns the newest enriched rows for the toast channel", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    for (let i = 0; i <= TOAST_RECENT_LIMIT; i++) {
      await insertNotification(t, {
        userId: user._id,
        organizationId: org._id,
        projectId: project._id,
        taskId: task._id,
        taskTitle: `task ${i}`,
      });
    }

    const recent = await asUser.query(api.notifications.core.recent, { organizationId: org._id });
    expect(recent.items).toHaveLength(TOAST_RECENT_LIMIT);
    // Newest first; the oldest row falls off the bounded read.
    expect(recent.items[0]?.snapshot.taskTitle).toBe(`task ${TOAST_RECENT_LIMIT}`);
    expect(recent.items.at(-1)?.snapshot.taskTitle).toBe("task 1");
    expect(recent.items[0]).toMatchObject({ orgSlug: org.slug, projectAlias: project.alias });
    expect(recent.watermark).toBe(recent.items[0]?._creationTime);

    expect(await t.query(api.notifications.core.recent, { organizationId: org._id })).toEqual({
      items: [],
      watermark: 0,
    });
  });

  test("a disabled toast preference hides that type from recent but not from list", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const row = { userId: user._id, organizationId: org._id, projectId: project._id, taskId: task._id };

    await insertNotification(t, { ...row, type: "task.status_changed" });
    await insertNotification(t, { ...row, type: "task.comment_added" });
    await asUser.mutation(api.notifications.preferences.set, {
      entries: [{ type: "task.comment_added", channel: "toast", enabled: false }],
    });

    const recent = await asUser.query(api.notifications.core.recent, { organizationId: org._id });
    expect(recent.items.map((row) => row.type)).toEqual(["task.status_changed"]);
    const listed = await asUser.query(api.notifications.core.list, {
      organizationId: org._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(listed.page).toHaveLength(2);
  });

  test("muted rows do not starve the toast window", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const row = { userId: user._id, organizationId: org._id, projectId: project._id, taskId: task._id };

    await asUser.mutation(api.notifications.preferences.set, {
      entries: [{ type: "task.comment_added", channel: "toast", enabled: false }],
    });
    // A toastable row followed by a full window of muted ones: filtering after
    // a limit-sized read would return nothing and lose the toast.
    await insertNotification(t, { ...row, type: "thread.failed" });
    for (let i = 0; i < TOAST_RECENT_LIMIT; i++) {
      await insertNotification(t, { ...row, type: "task.comment_added" });
    }

    const recent = await asUser.query(api.notifications.core.recent, { organizationId: org._id });
    expect(recent.items.map((row) => row.type)).toEqual(["thread.failed"]);
  });

  test("watermark covers filtered rows so re-enabling toast cannot replay them", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.notifications.preferences.set, {
      entries: [{ type: "task.comment_added", channel: "toast", enabled: false }],
    });
    const mutedId = await insertNotification(t, {
      userId: user._id,
      organizationId: org._id,
      projectId: project._id,
      taskId: task._id,
      type: "task.comment_added",
    });
    const mutedCreationTime = await t.run(async (runCtx) => (await runCtx.db.get("notifications", mutedId))?._creationTime);

    // The row is filtered, but the watermark still advances past it — the
    // client cursor follows the watermark, so re-enabling the type later
    // cannot toast this stale row.
    const recent = await asUser.query(api.notifications.core.recent, { organizationId: org._id });
    expect(recent.items).toEqual([]);
    expect(recent.watermark).toBe(mutedCreationTime);
  });

  test("markRead marks own rows, is idempotent, and rejects foreign rows", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    const asOther = ctx.asUser(other);
    const task = await ctx.task(project._id, user._id);

    const id = await insertNotification(t, {
      userId: user._id,
      organizationId: org._id,
      projectId: project._id,
      taskId: task._id,
    });

    await asUser.mutation(api.notifications.core.markRead, { id });
    await asUser.mutation(api.notifications.core.markRead, { id }); // idempotent

    await t.run(async (runCtx) => {
      const row = await runCtx.db.get("notifications", id);
      expect(row?.read).toBe(true);
      expect(row?.readAt).toBeTypeOf("number");
    });

    await expect(asOther.mutation(api.notifications.core.markRead, { id })).rejects.toThrow(
      expect.objectContaining({ data: errors.NOTIFICATION_NOT_FOUND }) as ConvexError<string>
    );
  });

  test("markUnread reverts own read rows and rejects foreign rows", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    const asOther = ctx.asUser(other);
    const task = await ctx.task(project._id, user._id);

    const id = await insertNotification(t, {
      userId: user._id,
      organizationId: org._id,
      projectId: project._id,
      taskId: task._id,
      read: true,
    });

    await asUser.mutation(api.notifications.core.markUnread, { id });
    await asUser.mutation(api.notifications.core.markUnread, { id }); // idempotent

    await t.run(async (runCtx) => {
      const row = await runCtx.db.get("notifications", id);
      expect(row?.read).toBe(false);
      expect(row?.readAt).toBeUndefined();
    });
    expect(await asUser.query(api.notifications.core.unreadCount, { organizationId: org._id })).toBe(1);

    await expect(asOther.mutation(api.notifications.core.markUnread, { id })).rejects.toThrow(
      expect.objectContaining({ data: errors.NOTIFICATION_NOT_FOUND }) as ConvexError<string>
    );
  });

  test("markAllAsRead marks only the caller's unread rows", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    const task = await ctx.task(project._id, user._id);

    const row = { organizationId: org._id, projectId: project._id, taskId: task._id };
    const mine1 = await insertNotification(t, { ...row, userId: user._id });
    const mine2 = await insertNotification(t, { ...row, userId: user._id });
    const theirs = await insertNotification(t, { ...row, userId: other._id });

    await asUser.mutation(api.notifications.core.markAllAsRead, { organizationId: org._id });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("notifications", mine1))?.read).toBe(true);
      expect((await runCtx.db.get("notifications", mine2))?.read).toBe(true);
      expect((await runCtx.db.get("notifications", theirs))?.read).toBe(false);
    });
  });

  test("markAllAsRead drains an over-batch inbox via scheduled sweeps", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    const total = MARK_ALL_READ_BATCH + 1;
    await t.run(async (runCtx) => {
      for (let i = 0; i < total; i++) {
        await runCtx.db.insert("notifications", {
          userId: user._id,
          type: "task.status_changed",
          organizationId: org._id,
          projectId: project._id,
          subject: { kind: "task", id: task._id },
          read: false,
          snapshot: { taskRef: "T-1", taskTitle: `task ${i}` },
        });
      }
    });

    await asUser.mutation(api.notifications.core.markAllAsRead, { organizationId: org._id });

    // First batch is synchronous; the overflow row waits on the sweep.
    const unreadAfterFirstRun = await t.run(async (runCtx) => {
      const rows = await runCtx.db
        .query("notifications")
        .withIndex("by_user_and_org_and_read", (q) =>
          q.eq("userId", user._id).eq("organizationId", org._id).eq("read", false)
        )
        .collect();
      return rows.length;
    });
    expect(unreadAfterFirstRun).toBe(1);

    try {
      vi.advanceTimersByTime(1);
      await t.finishInProgressScheduledFunctions();
    } finally {
      vi.useRealTimers();
    }

    const unreadAfterSweep = await t.run(async (runCtx) => {
      const rows = await runCtx.db
        .query("notifications")
        .withIndex("by_user_and_org_and_read", (q) =>
          q.eq("userId", user._id).eq("organizationId", org._id).eq("read", false)
        )
        .collect();
      return rows.length;
    });
    expect(unreadAfterSweep).toBe(0);
  });
});
