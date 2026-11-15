/// <reference types="vite/client" />
import { describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext, type TestContext } from "../../convex-testing";
import type { TimelineCursor } from "./lib/timeline/validators";

const ALL_SOURCES = { activity: true, comments: true, threads: true };

/**
 * Seeds interleaved comments and activity rows at explicit `createdAt` values,
 * so ordering assertions never depend on wall-clock timing.
 */
async function seedTimeline(
  ctx: ReturnType<typeof createTestContext>,
  taskId: Id<"tasks">,
  userId: Id<"users">,
  rows: Array<{ kind: "comment" | "activity"; at: number; label: string }>
) {
  await ctx.t.run(async (runCtx) => {
    for (const row of rows) {
      if (row.kind === "comment") {
        await runCtx.db.insert("taskComments", {
          taskId,
          authorId: userId,
          content: row.label,
          createdAt: row.at,
          updatedAt: row.at,
          isEdited: false,
        });
        continue;
      }
      await runCtx.db.insert("taskActivityLogs", {
        taskId,
        userId,
        eventType: "name_edited",
        changeDetails: { type: "name", oldValue: "old", newValue: row.label },
        createdAt: row.at,
      });
    }
  });
}

/** Compact `kind:label` view of a page, in returned order. */
function labels(items: Array<Record<string, unknown>>): string[] {
  return items.map((item) => {
    if (item.kind === "comment") {
      const comment = item.comment as { content: string };
      return `comment:${comment.content}`;
    }
    const activity = item.activity as { changeDetails?: { newValue?: string } };
    return `activity:${activity.changeDetails?.newValue}`;
  });
}

/**
 * Page through the whole timeline at `limit`, returning every row's label in
 * order. Asserts the page-size contract and that pagination terminates, so
 * every caller gets those checks for free.
 */
async function drain(
  asUser: ReturnType<TestContext["asUser"]>,
  taskId: Id<"tasks">,
  limit: number,
  sources = ALL_SOURCES
): Promise<string[]> {
  const seen: string[] = [];
  let before: TimelineCursor | undefined;
  let pages = 0;
  for (;;) {
    const page = await asUser.query(api.tasks.timeline.listByTask, {
      taskId,
      sources,
      limit,
      ...(before === undefined ? {} : { before }),
    });
    expect(page.items.length).toBeLessThanOrEqual(limit);
    seen.push(...labels(page.items));
    if (page.isDone) {
      expect(page.nextBefore).toBeNull();
      return seen;
    }
    expect(page.nextBefore).not.toBeNull();
    before = page.nextBefore ?? undefined;
    // Generous but finite: a stalled cursor must fail loudly, not hang.
    if (++pages > 60) throw new Error("pagination did not terminate");
  }
}

describe("tasks.timeline.listByTask", () => {
  test("merges comments and activity into one newest-first stream", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [
      { kind: "activity", at: 1000, label: "a1" },
      { kind: "comment", at: 2000, label: "c1" },
      { kind: "activity", at: 3000, label: "a2" },
      { kind: "comment", at: 4000, label: "c2" },
    ]);

    const page = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 10,
    });

    expect(labels(page.items)).toEqual(["comment:c2", "activity:a2", "comment:c1", "activity:a1"]);
    expect(page.items.map((item) => item.at)).toEqual([4000, 3000, 2000, 1000]);
    expect(page.isDone).toBe(true);
    expect(page.nextBefore).toBeNull();
  });

  test("hydrates activity actors and comment author/permission fields", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [
      { kind: "activity", at: 1000, label: "renamed" },
      { kind: "comment", at: 2000, label: "hello" },
    ]);

    const page = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 10,
    });

    const comment = page.items[0];
    if (comment.kind !== "comment") throw new Error("expected a comment row first");
    expect(comment.comment.authorName).toBe(user.name);
    expect(comment.comment.canEdit).toBe(true);
    expect(comment.comment.canDelete).toBe(true);
    expect(comment.comment.attachments).toEqual([]);

    const activity = page.items[1];
    if (activity.kind !== "activity") throw new Error("expected an activity row second");
    expect(activity.activity.userName).toBe(user.name);
    expect(activity.activity.eventType).toBe("name_edited");
  });

  test("honors limit and pages through with `before` without gap or overlap", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    // 6 rows, alternating source, one distinct millisecond each.
    await seedTimeline(
      ctx,
      task._id,
      user._id,
      Array.from({ length: 6 }, (_, index) => ({
        kind: index % 2 === 0 ? ("activity" as const) : ("comment" as const),
        at: 1000 * (index + 1),
        label: `r${index + 1}`,
      }))
    );

    const seen: string[] = [];
    let before: TimelineCursor | undefined;
    let guard = 0;
    for (;;) {
      const page = await asUser.query(api.tasks.timeline.listByTask, {
        taskId: task._id,
        sources: ALL_SOURCES,
        limit: 2,
        ...(before === undefined ? {} : { before }),
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...labels(page.items));
      if (page.isDone) break;
      expect(page.nextBefore).not.toBeNull();
      before = page.nextBefore ?? undefined;
      if (++guard > 10) throw new Error("pagination did not terminate");
    }

    // Every row exactly once, newest first.
    expect(seen).toEqual([
      "comment:r6",
      "activity:r5",
      "comment:r4",
      "activity:r3",
      "comment:r2",
      "activity:r1",
    ]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("a page may end inside a tied millisecond and resume without loss", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    // Three rows share 2000. The composite cursor resumes partway through that
    // millisecond, so the page can honor `limit` exactly.
    await seedTimeline(ctx, task._id, user._id, [
      { kind: "activity", at: 1000, label: "older" },
      { kind: "activity", at: 2000, label: "tie-a" },
      { kind: "comment", at: 2000, label: "tie-b" },
      { kind: "comment", at: 2000, label: "tie-c" },
    ]);

    const seen = await drain(asUser, task._id, 2);

    // All four rows, each exactly once, and the tied group is not reordered
    // arbitrarily across pages.
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(seen[3]).toBe("activity:older");
    expect(seen.slice(0, 3).sort()).toEqual(["activity:tie-a", "comment:tie-b", "comment:tie-c"]);
  });

  test("a tie straddling the read limit loses nothing (regression)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    // The exact shape a scalar `createdAt` cursor dropped: the second tied row
    // sits past position `limit`, so it was never read, and the next page's
    // strict `< 2000` skipped it permanently.
    await seedTimeline(ctx, task._id, user._id, [
      { kind: "comment", at: 3000, label: "newest" },
      { kind: "comment", at: 2000, label: "tie-a" },
      { kind: "comment", at: 2000, label: "tie-b" },
    ]);

    const seen = await drain(asUser, task._id, 2);

    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe("comment:newest");
    expect(seen.slice(1).sort()).toEqual(["comment:tie-a", "comment:tie-b"]);
  });

  test("a tied millisecond at a realistic page boundary loses nothing (regression)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    // 26 rows at limit 20, with two sharing the millisecond that straddles the
    // page boundary — this returned 25 of 26 under the scalar cursor.
    await seedTimeline(
      ctx,
      task._id,
      user._id,
      Array.from({ length: 26 }, (_, index) => ({
        kind: "activity" as const,
        // Index 20 collides with index 19, putting a tie across the boundary.
        at: (index === 20 ? 26 - 19 : 26 - index) * 1000,
        label: `n${index}`,
      }))
    );

    const seen = await drain(asUser, task._id, 20);

    expect(seen).toHaveLength(26);
    expect(new Set(seen).size).toBe(26);
  });

  test("one multi-field task update writes same-millisecond rows that all survive paging", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id, {
        status: "To Do",
        priority: "Low",
        name: "before",
      });

      // The ordinary trigger for tied timestamps: one update writing three logs.
      await asUser.mutation(api.tasks.core.update, {
        id: task._id,
        status: "In Progress",
        priority: "High",
        name: "after",
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const times = await t.run(async (runCtx) => {
        const logs = await runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task", (q) => q.eq("taskId", task._id))
          .collect();
        return logs.map((log) => log.createdAt);
      });
      // Precondition: they really do share a millisecond.
      expect(times).toHaveLength(3);
      expect(new Set(times).size).toBe(1);

      // Paging one row at a time cuts through the tie twice.
      const seen = await drain(asUser, task._id, 1);
      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a source that caps out exactly yields one trailing empty page", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    // Two comments read with limit 2: the read caps out, so the source cannot be
    // distinguished from one with more rows until the next page comes back empty.
    await seedTimeline(ctx, task._id, user._id, [
      { kind: "comment", at: 1000, label: "c1" },
      { kind: "comment", at: 2000, label: "c2" },
    ]);

    const first = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 2,
    });
    expect(labels(first.items)).toEqual(["comment:c2", "comment:c1"]);
    expect(first.isDone).toBe(false);
    expect(first.nextBefore?.at).toBe(1000);

    const second = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 2,
      before: first.nextBefore ?? undefined,
    });
    expect(second.items).toEqual([]);
    expect(second.isDone).toBe(true);
    expect(second.nextBefore).toBeNull();
  });

  test("keeps paginating while one source is exhausted and the other has more", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    // Comments run out after the first page; activity must keep draining.
    await seedTimeline(ctx, task._id, user._id, [
      { kind: "comment", at: 5000, label: "only" },
      { kind: "activity", at: 3000, label: "a3" },
      { kind: "activity", at: 2000, label: "a2" },
      { kind: "activity", at: 1000, label: "a1" },
    ]);

    const seen = await drain(asUser, task._id, 2);

    expect(seen).toEqual(["comment:only", "activity:a3", "activity:a2", "activity:a1"]);
  });

  test("clamps limit to a bounded read", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(
      ctx,
      task._id,
      user._id,
      Array.from({ length: 4 }, (_, index) => ({
        kind: "comment" as const,
        at: 1000 * (index + 1),
        label: `c${index + 1}`,
      }))
    );

    // Below the floor: clamped up to 1, not down to 0 (which would spin forever).
    const zero = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 0,
    });
    expect(zero.items).toHaveLength(1);
    expect(zero.isDone).toBe(false);

    // Above the ceiling: clamped down, still returning everything available.
    const huge = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 100_000,
    });
    expect(huge.items).toHaveLength(4);
    expect(huge.isDone).toBe(true);

    // Negative: clamped up to the floor rather than through it.
    const negative = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: -5,
    });
    expect(negative.items).toHaveLength(1);
  });

  test("a non-finite limit falls back to the default instead of throwing", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [
      { kind: "comment", at: 1000, label: "c1" },
      { kind: "comment", at: 2000, label: "c2" },
    ]);

    // `NaN` propagates through Math.min/max and would reach `.take(NaN)`, which
    // throws — the one path that could blank an otherwise fail-soft sidebar.
    for (const limit of [NaN, Infinity, -Infinity]) {
      const page = await asUser.query(api.tasks.timeline.listByTask, {
        taskId: task._id,
        sources: ALL_SOURCES,
        limit,
      });
      expect(labels(page.items)).toEqual(["comment:c2", "comment:c1"]);
      expect(page.isDone).toBe(true);
    }
  });

  test("a corrupt cursor is treated as absent rather than silently restarting", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [
      { kind: "comment", at: 1000, label: "c1" },
      { kind: "comment", at: 2000, label: "c2" },
      { kind: "comment", at: 3000, label: "c3" },
    ]);

    // A non-finite bound makes Convex's index range degenerate to unbounded, so
    // without normalization this restarts the feed while claiming to resume.
    for (const before of [
      { at: NaN, creationTime: NaN },
      { at: 2000, creationTime: NaN },
      { at: NaN, creationTime: 1 },
    ]) {
      const page = await asUser.query(api.tasks.timeline.listByTask, {
        taskId: task._id,
        sources: ALL_SOURCES,
        limit: 10,
        before,
      });
      expect(labels(page.items)).toEqual(["comment:c3", "comment:c2", "comment:c1"]);
    }

    // A valid-but-exhausted cursor still ends cleanly.
    const past = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 10,
      before: { at: 0, creationTime: 0 },
    });
    expect(past.items).toEqual([]);
    expect(past.isDone).toBe(true);
  });

  test("a disabled source contributes no rows", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [
      { kind: "activity", at: 1000, label: "a1" },
      { kind: "comment", at: 2000, label: "c1" },
    ]);

    const commentsOnly = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: { activity: false, comments: true, threads: true },
      limit: 10,
    });
    expect(labels(commentsOnly.items)).toEqual(["comment:c1"]);
    expect(commentsOnly.isDone).toBe(true);

    const activityOnly = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: { activity: true, comments: false, threads: false },
      limit: 10,
    });
    expect(labels(activityOnly.items)).toEqual(["activity:a1"]);
    expect(activityOnly.isDone).toBe(true);

    const none = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: { activity: false, comments: false, threads: true },
      limit: 10,
    });
    expect(none.items).toEqual([]);
    expect(none.isDone).toBe(true);
    expect(none.nextBefore).toBeNull();
  });

  test("the threads source flag never changes the server result", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [{ kind: "comment", at: 1000, label: "c1" }]);

    const withThreads = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: { activity: true, comments: true, threads: true },
      limit: 10,
    });
    const withoutThreads = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: { activity: true, comments: true, threads: false },
      limit: 10,
    });

    expect(labels(withoutThreads.items)).toEqual(labels(withThreads.items));
  });

  test("returns an empty page when unauthenticated", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [{ kind: "comment", at: 1000, label: "c1" }]);

    const page = await t.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 10,
    });

    expect(page.items).toEqual([]);
    expect(page.isDone).toBe(true);
  });

  test("returns an empty page for an org member without project access", async () => {
    const ctx = createTestContext();
    const { project, user, org } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [{ kind: "comment", at: 1000, label: "c1" }]);

    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");

    const page = await ctx.asUser(otherUser).query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 10,
    });

    expect(page.items).toEqual([]);
    expect(page.isDone).toBe(true);
  });

  test("returns an empty page for a soft-deleted task", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [{ kind: "comment", at: 1000, label: "c1" }]);
    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task._id, { isDeleted: true });
    });

    const page = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 10,
    });

    expect(page.items).toEqual([]);
  });

  test("a project viewer sees the stream but cannot edit another user's comment", async () => {
    const ctx = createTestContext();
    const { project, user, org } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await seedTimeline(ctx, task._id, user._id, [{ kind: "comment", at: 1000, label: "c1" }]);

    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    const page = await ctx.asUser(viewer).query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 10,
    });

    const row = page.items[0];
    if (row.kind !== "comment") throw new Error("expected a comment row");
    expect(row.comment.canEdit).toBe(false);
    expect(row.comment.canDelete).toBe(false);
  });

  test("comment rows are identical to tasks.comments.listByTask's", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    // A comment with an attachment and a since-deleted author — the shape most
    // likely to drift if the shared hydrator were ever reimplemented per query.
    const author = await ctx.user();
    await ctx.orgMember(project.organizationId, author._id, "member");
    await ctx.projectMember(project._id, author._id, "member");
    const comment = await ctx.comment(task._id, author._id, { content: "shared" });
    await t.run(async (runCtx) => {
      const storageId = await runCtx.storage.store(new Blob(["x"]));
      await runCtx.db.insert("taskCommentAttachments", {
        commentId: comment._id,
        storageId,
        fileName: "note.txt",
        fileSize: 1,
        contentType: "text/plain",
        uploadedBy: author._id,
        uploadedAt: 1000,
      });
      // Gone entirely: the hydrators' "Unknown" fallback keys off a missing
      // user, so both readers must degrade identically.
      await runCtx.db.delete("users", author._id);
    });

    const [commentsPage, timelinePage] = await Promise.all([
      asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      }),
      asUser.query(api.tasks.timeline.listByTask, {
        taskId: task._id,
        sources: ALL_SOURCES,
        limit: 10,
      }),
    ]);

    const timelineRow = timelinePage.items.find((item) => item.kind === "comment");
    if (timelineRow?.kind !== "comment") throw new Error("expected a comment row");
    expect(timelineRow.comment).toEqual(commentsPage.page[0]);
    expect(timelineRow.comment.attachments).toHaveLength(1);
  });

  test("activity rows are identical to tasks.activity.listByTask's", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    const actor = await ctx.user();
    await t.run(async (runCtx) => {
      await runCtx.db.insert("taskActivityLogs", {
        taskId: task._id,
        userId: actor._id,
        eventType: "status_changed",
        changeDetails: { type: "status", oldValue: "To Do", newValue: "Done" },
        createdAt: 1000,
      });
      // Missing actor: both readers must fall back to "Unknown" identically.
      await runCtx.db.delete("users", actor._id);
    });

    const [activityPage, timelinePage] = await Promise.all([
      asUser.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      }),
      asUser.query(api.tasks.timeline.listByTask, {
        taskId: task._id,
        sources: ALL_SOURCES,
        limit: 10,
      }),
    ]);

    const timelineRow = timelinePage.items.find((item) => item.kind === "activity");
    if (timelineRow?.kind !== "activity") throw new Error("expected an activity row");
    expect(timelineRow.activity).toEqual(activityPage.page[0]);
  });

  test("creating a comment no longer writes a comment_added activity row", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await asUser.mutation(api.tasks.comments.create, {
        taskId: task._id,
        content: "hello",
      });
      // The activity logger schedules its write, so drain the scheduler before
      // asserting the row is absent — otherwise the assertion passes vacuously.
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      await t.run(async (runCtx) => {
        const logs = await runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task", (q) => q.eq("taskId", task._id))
          .collect();
        expect(logs.some((log) => log.eventType === "comment_added")).toBe(false);
      });

      const page = await asUser.query(api.tasks.timeline.listByTask, {
        taskId: task._id,
        sources: ALL_SOURCES,
        limit: 10,
      });

      // Exactly one row: the comment itself, with no duplicate activity pointer.
      expect(page.items).toHaveLength(1);
      expect(page.items[0].kind).toBe("comment");
    } finally {
      vi.useRealTimers();
    }
  });

  test("historical comment_added rows still validate on read", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    const comment = await ctx.comment(task._id, user._id, { createdAt: 2000, updatedAt: 2000 });
    await t.run(async (runCtx) => {
      await runCtx.db.insert("taskActivityLogs", {
        taskId: task._id,
        userId: user._id,
        eventType: "comment_added",
        changeDetails: { type: "comment", commentId: comment._id },
        createdAt: 1000,
      });
    });

    const page = await asUser.query(api.tasks.timeline.listByTask, {
      taskId: task._id,
      sources: ALL_SOURCES,
      limit: 10,
    });

    expect(page.items).toHaveLength(2);
    const legacy = page.items[1];
    if (legacy.kind !== "activity") throw new Error("expected the legacy activity row");
    expect(legacy.activity.eventType).toBe("comment_added");
  });
});
