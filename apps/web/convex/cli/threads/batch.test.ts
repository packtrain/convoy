import { expect, test, describe } from "vitest";
import { api } from "../../_generated/api";
import { createTestContext, setupFakeTimers } from "../../../convex-testing";

setupFakeTimers();

describe("batch actions", () => {
  test("batchMarkRead marks threads read and acknowledges attention", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const failed = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Failed",
      status: "failed",
    });
    const completed = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Completed",
      status: "completed",
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkRead, {
      threadIds: [failed._id, completed._id],
    });

    await t.run(async (runCtx) => {
      const failedDoc = await runCtx.db.get("cliThreads", failed._id);
      const completedDoc = await runCtx.db.get("cliThreads", completed._id);
      expect(failedDoc?.readAt).toBeDefined();
      expect(failedDoc?.attentionAcknowledgedAt).toBeDefined();
      expect(completedDoc?.readAt).toBeDefined();
      expect(completedDoc?.attentionAcknowledgedAt).toBeUndefined();
    });

    // Both demote to needs_review (not done — that takes an explicit mark,
    // OS-1382): read + attention acknowledged.
    const needsReview = await asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug,
      section: "needs_review",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(needsReview.page).toHaveLength(2);
    for (const thread of needsReview.page) {
      expect(thread.hasUnread).toBe(false);
      expect(thread.requiresAttention).toBe(false);
      expect(thread.isDone).toBe(false);
    }
  });

  test("batchMarkDone moves threads to done and batchMarkNotDone returns them", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const profile = await ctx.cliProfile(user._id, project._id);
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);

    const mine = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Mine",
      status: "completed",
    });
    const theirs = await ctx.cliThread(otherUser._id, project._id, otherProfile._id, {
      title: "Theirs",
      status: "completed",
    });

    const titlesIn = async (section: "needs_review" | "done") => {
      const result = await asUser.query(api.cli.threads.lists.listMine, {
        organizationSlug: org.slug,
        section,
        paginationOpts: { numItems: 10, cursor: null },
      });
      return result.page.map((thread) => thread.title);
    };

    // Other users' threads are skipped fail-soft.
    await asUser.mutation(api.cli.threads.batch.batchMarkDone, {
      threadIds: [mine._id, theirs._id],
    });
    expect(await titlesIn("done")).toEqual(["Mine"]);
    expect(await titlesIn("needs_review")).toEqual([]);

    await asUser.mutation(api.cli.threads.batch.batchMarkNotDone, {
      threadIds: [mine._id],
    });
    expect(await titlesIn("done")).toEqual([]);
    expect(await titlesIn("needs_review")).toEqual(["Mine"]);
  });

  test("batch actions apply to own threads and skip other users' threads", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const profile = await ctx.cliProfile(user._id, project._id);
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);

    const mine = await ctx.cliThread(user._id, project._id, profile._id, { title: "Mine" });
    const theirs = await ctx.cliThread(otherUser._id, project._id, otherProfile._id, {
      title: "Theirs",
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkDone, {
      threadIds: [mine._id, theirs._id],
    });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", mine._id))?.doneAt).toBeDefined();
      expect((await runCtx.db.get("cliThreads", theirs._id))?.doneAt).toBeUndefined();
    });
  });

  test("batchRemove soft-deletes threads and tolerates duplicates", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const first = await ctx.cliThread(user._id, project._id, profile._id, { title: "First" });
    const second = await ctx.cliThread(user._id, project._id, profile._id, { title: "Second" });

    await asUser.mutation(api.cli.threads.batch.batchRemove, {
      threadIds: [first._id, second._id, first._id],
    });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", first._id))?.isDeleted).toBe(true);
      expect((await runCtx.db.get("cliThreads", second._id))?.isDeleted).toBe(true);
    });
  });

  test("rejects batches over the size cap", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { title: "One" });

    await expect(
      asUser.mutation(api.cli.threads.batch.batchMarkDone, {
        threadIds: Array.from({ length: 51 }, () => thread._id),
      })
    ).rejects.toThrow("Batch actions are limited to 50 threads");
  });

  test("rejects batches whose group cascades exceed the fan-out cap", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    // 11 selected rows, but 1,111 threads once the cascades expand.
    const containers = await Promise.all(
      Array.from({ length: 11 }, () =>
        ctx.cliThread(user._id, project._id, profile._id, { kind: "group", status: "completed", childCount: 100 })
      )
    );

    await expect(
      asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: containers.map((container) => container._id) })
    ).rejects.toThrow("Batch actions are limited to 1000 threads including group members");
  });
});
