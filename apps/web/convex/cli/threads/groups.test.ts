import { expect, test, describe, vi } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildCliThread, createTestContext, setupFakeTimers } from "../../../convex-testing";

setupFakeTimers();

describe("container denorms (OS-1473)", () => {
  test("child write recomputes aggregateStatus, childCount, and container lastActivityAt", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Group",
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const failed = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: past + 5_000,
      parentThreadId: container._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      processingState: "streaming",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });
    const completed = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });

    // Any child write through the repo seam syncs the container in-transaction.
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: completed._id });

    let doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.childCount).toBe(3);
    // Failed outranks waiting/running in Group status (OS-1476).
    expect(doc?.aggregateStatus).toBe("failed");
    expect(doc?.lastActivityAt).toBe(past + 5_000);

    // Acknowledging the failure settles it; the streaming child keeps the group running.
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: failed._id, acknowledgeAttention: true });

    doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.aggregateStatus).toBe("running");
  });

  test("waiting_input children need attention; all settled leaves the group idle", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const waiting = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "waiting_input",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });
    const failed = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: past + 3_000,
      parentThreadId: container._id,
    });
    const completed = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });

    // Failed outranks waiting in Group status (OS-1476).
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: completed._id });
    let doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.aggregateStatus).toBe("failed");

    // Acknowledging the failure surfaces the waiting child.
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: failed._id, acknowledgeAttention: true });
    doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.aggregateStatus).toBe("needs_attention");

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: waiting._id, acknowledgeAttention: true });
    doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.aggregateStatus).toBe("idle");
  });

  test("soft-deleting a child recounts; done children still count", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      doneAt: past + 1_000,
      parentThreadId: container._id,
    });
    const active = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: active._id });
    let doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.childCount).toBe(2);
    expect(doc?.aggregateStatus).toBe("idle");

    await asUser.mutation(api.cli.threads.core.remove, { threadId: active._id });
    doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.childCount).toBe(1);
    expect(doc?.aggregateStatus).toBe("idle");
    expect(doc?.isDeleted).toBe(false);
  });

  test("writes to plain threads never touch containers", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      processingState: "streaming",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });
    const plain = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 9_000,
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: plain._id });

    const doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.childCount).toBeUndefined();
    expect(doc?.aggregateStatus).toBeUndefined();
    expect(doc?.lastActivityAt).toBe(past);
  });

  test("a recovering child leaves the group failed while a Group child still holds it (OS-1599)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const firstFailure = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });

    // De-escalation cannot be decided from the acknowledged child alone: the
    // second failure still holds the group at `failed`. Only a recompute over
    // the Group children can know that.
    await asUser.mutation(api.cli.threads.core.markRead, {
      threadId: firstFailure._id,
      acknowledgeAttention: true,
    });

    const doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.aggregateStatus).toBe("failed");
    expect(doc?.hasAttentionChildren).toBe(true);
  });

  test("a user turn in a child clears the container's done mark (OS-1599, OS-2176)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [container._id] });
    let doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.statusProjection?.isDone).toBe(true);

    // The clear must re-derive the container's own projection: the Done
    // section is indexed on `statusProjection.isDone` (OS-1382).
    // Strictly after the mark's `readAt`, so the child counts as unread.
    await vi.advanceTimersByTimeAsync(1_000);
    await asUser.mutation(api.cli.messages.send, {
      threadId: child._id,
      content: "more work",
    });

    doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.statusProjection?.isDone).toBe(false);
    expect(doc?.hasUnreadChildren).toBe(true);
  });

  test("a legacy container with no originThreadId still picks up an origin branch change (OS-1599)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const past = Date.now() - 60_000;

    // Containers written before OS-1599 have every other denorm but no
    // `originThreadId`, so the origin check cannot match on it.
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
      childCount: 1,
      aggregateStatus: "idle",
      originBranch: "feat/stale",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past,
      parentThreadId: container._id,
      git: { executionBranch: "feat/stale" },
    });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", container._id, { originThreadId: undefined });
      await runCtx.db.patch("cliThreads", child._id, { claimedBySessionId: session._id });
    });

    await asUser.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId: child._id,
      sessionId: session._id,
      branch: "feat/renamed",
    });

    const doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.originBranch).toBe("feat/renamed");
    expect(doc?.originThreadId).toBe(child._id);
  });

  test("container tracks its origin child, following the oldest live member (OS-1599)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const founder = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
      git: { executionBranch: "feat/founder" },
    });
    const second = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
      git: { executionBranch: "feat/second" },
    });

    // The oldest live child is the group's origin: it supplies the row's
    // branch chip, so the container must name it to answer "is this write
    // from the origin?" without collecting Group children.
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: second._id });

    let doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.originThreadId).toBe(founder._id);
    expect(doc?.originBranch).toBe("feat/founder");

    // Origin leaves: the next-oldest live child inherits, denorm follows.
    await asUser.mutation(api.cli.threads.core.remove, { threadId: founder._id });

    doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.originThreadId).toBe(second._id);
    expect(doc?.originBranch).toBe("feat/second");
  });
});

describe("group row item (OS-1476)", () => {
  test("container list item projects aggregateStatus into status", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Running group",
      kind: "group",
      status: "completed",
      aggregateStatus: "running",
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Attention group",
      kind: "group",
      status: "completed",
      aggregateStatus: "needs_attention",
      hasAttentionChildren: true,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Failed group",
      kind: "group",
      status: "completed",
      aggregateStatus: "failed",
      hasAttentionChildren: true,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Idle group",
      kind: "group",
      status: "completed",
      aggregateStatus: "idle",
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Plain thread",
      status: "streaming",
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const byTitle = new Map(result.page.map((item) => [item.title, item]));

    expect(byTitle.get("Running group")?.status).toBe("streaming");
    expect(byTitle.get("Attention group")?.status).toBe("waiting_input");
    expect(byTitle.get("Attention group")?.requiresAttention).toBe(true);
    expect(byTitle.get("Failed group")?.status).toBe("failed");
    expect(byTitle.get("Failed group")?.requiresAttention).toBe(true);
    expect(byTitle.get("Idle group")?.status).toBe("completed");
    // Plain threads keep their raw status untouched.
    expect(byTitle.get("Plain thread")?.status).toBe("streaming");
  });

  test("a child parked on an approval surfaces attention on the group row", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Parked group",
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    // Streaming with a pending interaction (OS-1469): buckets as
    // waiting_input without a failed/waiting status, so hasAttentionChildren
    // alone would miss it.
    const parked = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      processingState: "streaming",
      hasPendingInteraction: true,
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });

    // Seam write recomputes the denorms.
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: parked._id });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const item = result.page.find((thread) => thread.title === "Parked group");

    expect(item?.status).toBe("waiting_input");
    // Must pair with the projected status, or the client demotes the row
    // back to completed while a child blocks on the user.
    expect(item?.requiresAttention).toBe(true);
  });

  test("get returns the container's real status, not the list projection", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Group",
      kind: "group",
      status: "completed",
      aggregateStatus: "running",
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: container._id });

    // The detail view must not mistake a group for a running thread.
    expect(result?.status).toBe("completed");
  });

  test("get returns a container's origin task as its associatedTask (OS-2067)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const task = await ctx.task(project._id, user._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      originTaskId: task._id,
    });

    const result = await asUser.query(api.cli.threads.core.get, { threadId: container._id });

    // The redirect to a child seeds the task tab from this before the child's doc lands.
    expect(result?.associatedTask?._id).toBe(task._id);
  });

  test("container list item shows the oldest live child's branch", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Group",
      kind: "group",
      status: "completed",
      aggregateStatus: "idle",
    });
    // Oldest child is deleted — the next live child is the origin.
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      isDeleted: true,
      deletedAt: Date.now(),
      git: { executionBranch: "feat/deleted-founder" },
      parentThreadId: container._id,
    });
    const founder = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      git: { executionBranch: "feat/founder" },
      parentThreadId: container._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      git: { executionBranch: "feat/second" },
      parentThreadId: container._id,
    });

    // Any seam write recomputes the container denorms, `originBranch` included.
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: founder._id });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.find((item) => item.title === "Group")?.branch).toBe("feat/founder");
  });

  test("container list item shows the oldest live child's task ref (OS-1557)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const founderTask = await ctx.task(project._id, user._id, { name: "Founder task" });
    const groupChildTask = await ctx.task(project._id, user._id, { name: "Group child task" });

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Group",
      kind: "group",
      status: "completed",
      aggregateStatus: "idle",
    });
    const founder = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      associatedTaskId: founderTask._id,
      parentThreadId: container._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      associatedTaskId: groupChildTask._id,
      parentThreadId: container._id,
    });

    // Any seam write recomputes the container denorms, `originTaskId` included.
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: founder._id });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.find((item) => item.title === "Group")?.associatedTask?._id).toBe(
      founderTask._id
    );
  });
});

describe("group lifecycle (OS-1474)", () => {
  const PATHS = { paths: [{ id: "path-1", path: "/repo/path-1", label: "path-1" }] };
  const addToGroupArgs = (profileId: Id<"cliProfiles">) => ({
    profileId,
    pathId: "path-1",
    cliType: "claude-code" as const,
    content: "Group child task",
  });

  test("addThreadToGroup reports a container source before a cross-project profile", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", status: "completed" });
    const otherProject = await ctx.project(project.organizationId, user._id);
    const otherProfile = await ctx.cliProfile(user._id, otherProject._id, PATHS);

    await expect(
      asUser.mutation(api.cli.threads.groups.addThreadToGroup, { sourceThreadId: container._id, ...addToGroupArgs(otherProfile._id) })
    ).rejects.toThrow("Use a member thread when adding to a plain group");
  });

  test("addThreadToGroup on a plain thread creates the container, reparents, and adds the Group child", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Original work",
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });

    const { containerId, threadId } = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id,
      ...addToGroupArgs(profile._id),
    });

    await t.run(async (runCtx) => {
      const container = await runCtx.db.get("cliThreads", containerId);
      expect(container?.kind).toBe("group");
      expect(container?.title).toBe("Original work");
      expect(container?.childCount).toBe(2);
      // The added Group child is pending, so the group is running.
      expect(container?.aggregateStatus).toBe("running");
      const reparented = await runCtx.db.get("cliThreads", source._id);
      expect(reparented?.parentThreadId).toBe(containerId);
      const groupChild = await runCtx.db.get("cliThreads", threadId);
      expect(groupChild?.parentThreadId).toBe(containerId);
      expect(groupChild?.status).toBe("pending");
    });

    // The flat list shows the container, never the children.
    const list = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(list.page.map((thread) => thread._id)).toEqual([containerId]);
  });

  test("addThreadToGroup transfers a pin from the source to the new container", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
      isPinned: true,
      pinnedAt: Date.now() - 1_000,
    });

    const { containerId } = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id,
      ...addToGroupArgs(profile._id),
    });

    await t.run(async (runCtx) => {
      const container = await runCtx.db.get("cliThreads", containerId);
      expect(container?.isPinned).toBe(true);
      expect(container?.pinnedAt).toBeDefined();
      const child = await runCtx.db.get("cliThreads", source._id);
      expect(child?.isPinned).toBe(false);
    });

    // The pin follows the list row: only the container may appear here — a
    // pinned child would leak (the pinned index is not parent-aware).
    const pinned = await asUser.query(api.cli.threads.lists.listPinnedByProject, { projectId: project._id });
    expect(pinned.map((thread) => thread._id)).toEqual([containerId]);
  });

  test("addThreadToGroup from a child joins the existing group", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });

    const result = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: child._id,
      ...addToGroupArgs(profile._id),
    });

    expect(result.containerId).toBe(container._id);
    const doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.childCount).toBe(2);
  });

  test("addThreadToGroup stores spawnedByThreadId independently of parentThreadId (OS-1162)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });
    // The spawner is a third thread: an agent may name a container, which the
    // caller resolves to one of its children before calling addThreadToGroup, so
    // the two ids diverge and neither is derivable from the other.
    const spawner = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
    });

    const { containerId, threadId } = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id,
      spawnedByThreadId: spawner._id,
      ...addToGroupArgs(profile._id),
    });

    await t.run(async (runCtx) => {
      const groupChild = await runCtx.db.get("cliThreads", threadId);
      expect(groupChild?.spawnedByThreadId).toBe(spawner._id);
      expect(groupChild?.parentThreadId).toBe(containerId);
      // The source is reparented but was not spawned by anyone.
      const reparented = await runCtx.db.get("cliThreads", source._id);
      expect(reparented?.spawnedByThreadId).toBeUndefined();
    });
  });

  test("addThreadToGroup leaves spawnedByThreadId unset when the caller omits it", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });

    const { threadId } = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id,
      ...addToGroupArgs(profile._id),
    });

    const groupChild = await t.run(async (runCtx) => runCtx.db.get("cliThreads", threadId));
    expect(groupChild?.spawnedByThreadId).toBeUndefined();
  });

  test("an added Group child titles itself from its prompt, not the shared task name (OS-1559)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const task = await ctx.task(project._id, user._id, { name: "Shared task name" });
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });

    const { threadId } = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id,
      ...addToGroupArgs(profile._id),
      content: "Write the migration script",
      taskId: task._id,
    });

    const groupChild = await t.run(async (runCtx) => runCtx.db.get("cliThreads", threadId));
    expect(groupChild?.title).toBe("Write the migration script");
    // Group children created with only a task still fall back to the task name.
    const taskOnly = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id,
      ...addToGroupArgs(profile._id),
      content: "",
      taskId: task._id,
    });
    const fallback = await t.run(async (runCtx) => runCtx.db.get("cliThreads", taskOnly.threadId));
    expect(fallback?.title).toBe("Shared task name");
  });

  test("manual threads join a workflow container without becoming workflow threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const runContainer = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      workflowRunId: runId,
      status: "completed",
    });
    const runChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      workflowRunId: runId,
      workflowLaneId: "lane-1",
      parentThreadId: runContainer._id,
    });
    const first = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: runChild._id,
      ...addToGroupArgs(profile._id),
    });
    const second = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: first.threadId,
      ...addToGroupArgs(profile._id),
    });
    for (const added of [first, second]) {
      expect(added.containerId).toBe(runContainer._id);
      const thread = await t.run((runCtx) => runCtx.db.get("cliThreads", added.threadId));
      expect(thread?.parentThreadId).toBe(runContainer._id);
      expect(thread?.workflowRunId).toBeUndefined();
      expect(thread?.workflowLaneId).toBeUndefined();
      expect(thread?.workflowRunStepId).toBeUndefined();
    }
    const group = await asUser.query(api.cli.threads.groups.getGroup, { containerId: runContainer._id });
    expect(group?.children.map((child) => child._id)).toEqual([runChild._id, first.threadId, second.threadId]);
  });

  test("creates directly in an empty workflow container and allows the manual thread to leave", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group", workflowRunId: runId, status: "completed",
    });
    const added = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: container._id, expectedContainerId: container._id,
      ...addToGroupArgs(profile._id),
    });
    expect(added.containerId).toBe(container._id);
    const child = await t.run((c) => c.db.get("cliThreads", added.threadId));
    expect(child?.workflowRunId).toBeUndefined();
    expect(child?.parentThreadId).toBe(container._id);
    await asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: added.threadId });
    const moved = await t.run((c) => c.db.get("cliThreads", added.threadId));
    expect(moved?.parentThreadId).toBeUndefined();
    const remaining = await t.run((c) => c.db.get("cliThreads", container._id));
    expect(remaining).toMatchObject({ isDeleted: false, childCount: 0 });
  });

  test("a manual child can leave a workflow container without moving its lane sibling", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group", workflowRunId: runId, status: "completed",
    });
    const lane = await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: container._id, workflowRunId: runId, workflowLaneId: "lane-1",
    });
    const manual = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: container._id });
    await asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: manual._id });
    expect((await t.run((c) => c.db.get("cliThreads", manual._id)))?.parentThreadId).toBeUndefined();
    expect((await t.run((c) => c.db.get("cliThreads", lane._id)))?.parentThreadId).toBe(container._id);
    await expect(asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: lane._id })).rejects.toThrow();
  });

  test.each(["owner", "deleted", "project", "expected container", "cap"])("direct workflow additions enforce %s", async (guard) => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const owner = guard === "owner" ? await ctx.user() : user;
    const container = await ctx.cliThread(owner._id, project._id, profile._id, {
      kind: "group", workflowRunId: runId, isDeleted: guard === "deleted",
    });
    let targetProfile = profile;
    if (guard === "project") {
      const otherProject = await ctx.project(org._id, user._id);
      targetProfile = await ctx.cliProfile(user._id, otherProject._id, PATHS);
    }
    const other = guard === "expected container" ? await ctx.cliThread(user._id, project._id, profile._id) : null;
    if (guard === "cap") {
      await t.run(async (c) => {
        for (let i = 0; i < 100; i++) {
          await buildCliThread(c.db, user._id, project._id, profile._id, { parentThreadId: container._id, isDeleted: true });
        }
      });
    }
    const messages = {
      owner: "Not authorized", deleted: "Thread not found", project: "cannot span projects",
      "expected container": "left the group", cap: "at most 100",
    };
    await expect(asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: container._id, expectedContainerId: other?._id ?? container._id,
      ...addToGroupArgs(targetProfile._id),
    })).rejects.toThrow(new RegExp(messages[guard as keyof typeof messages], "i"));
  });

  test("addThreadToGroup guards: containers and other users' threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    await expect(
      asUser.mutation(api.cli.threads.groups.addThreadToGroup, { sourceThreadId: container._id, ...addToGroupArgs(profile._id) })
    ).rejects.toThrow("Use a member thread when adding to a plain group");

    const other = await ctx.user();
    const asOther = ctx.asUser(other);
    const mine = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed" });
    await expect(
      asOther.mutation(api.cli.threads.groups.addThreadToGroup, { sourceThreadId: mine._id, ...addToGroupArgs(profile._id) })
    ).rejects.toThrow("Not authorized");

    // Lineage is validated like every other id in the pipeline (OS-1162):
    // OS-1299's spawn cap indexes `spawnedByThreadId` without a `userId`
    // component, so a foreign id would inflate another user's count.
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });
    const theirThread = await ctx.cliThread(other._id, project._id, profile._id, {
      status: "completed",
    });
    await expect(
      asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: source._id,
        spawnedByThreadId: theirThread._id,
        ...addToGroupArgs(profile._id),
      })
    ).rejects.toThrow("Not authorized");

    const deletedSpawner = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      isDeleted: true,
    });
    await expect(
      asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: source._id,
        spawnedByThreadId: deletedSpawner._id,
        ...addToGroupArgs(profile._id),
      })
    ).rejects.toThrow("Thread not found");
  });

  test("addThreadToGroup rejects at the cap, counting deleted and done children", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });

    const live = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });
    // 99 more rows in one transaction: 97 live, 1 done, 1 soft-deleted
    // → 100 rows under the index while only 99 are live members.
    await t.run(async (runCtx) => {
      for (let i = 0; i < 97; i++) {
        await buildCliThread(runCtx.db, user._id, project._id, profile._id, {
          status: "completed",
          parentThreadId: container._id,
        });
      }
      await buildCliThread(runCtx.db, user._id, project._id, profile._id, {
        status: "completed",
        doneAt: Date.now(),
        parentThreadId: container._id,
      });
      await buildCliThread(runCtx.db, user._id, project._id, profile._id, {
        status: "completed",
        isDeleted: true,
        deletedAt: Date.now(),
        parentThreadId: container._id,
      });
    });

    await expect(
      asUser.mutation(api.cli.threads.groups.addThreadToGroup, { sourceThreadId: live._id, ...addToGroupArgs(profile._id) })
    ).rejects.toThrow("A thread group can contain at most 100 threads");
  });

  test("moveChildOut unsets the parent and recounts; guards non-children and workflowRun children", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const first = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: first._id });
    await t.run(async (runCtx) => {
      const moved = await runCtx.db.get("cliThreads", first._id);
      expect(moved?.parentThreadId).toBeUndefined();
      const doc = await runCtx.db.get("cliThreads", container._id);
      expect(doc?.childCount).toBe(1);
      expect(doc?.isDeleted).toBe(false);
    });

    // Now a plain thread again — not in a group.
    await expect(asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: first._id })).rejects.toThrow(
      "Thread is not in a group"
    );

    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const runContainer = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      workflowRunId: runId,
      status: "completed",
    });
    const runChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: runContainer._id,
      workflowRunId: runId,
    });
    await expect(asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: runChild._id })).rejects.toThrow(
      "Only group children can be removed from a group"
    );
  });

  test("container auto-deletes when the last live member is removed or deleted", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const first = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });
    const second = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.core.remove, { threadId: first._id });
    let doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.isDeleted).toBe(false);
    expect(doc?.childCount).toBe(1);

    await asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: second._id });
    doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.isDeleted).toBe(true);
  });

  test("a done member keeps the container alive when the last active child leaves", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      doneAt: Date.now(),
      parentThreadId: container._id,
    });
    const active = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: active._id });
    const doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.isDeleted).toBe(false);
    expect(doc?.childCount).toBe(1);
  });
});

describe("getGroup (OS-1477)", () => {
  test("returns live children in creation order while totalRowCount counts deleted rows", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      title: "Group title",
      status: "completed",
    });
    const first = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });
    const second = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      parentThreadId: container._id,
    });
    const third = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: 1_000,
      doneAt: 2_000,
      parentThreadId: container._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      isDeleted: true,
      parentThreadId: container._id,
    });

    const group = await asUser.query(api.cli.threads.groups.getGroup, { containerId: container._id });
    expect(group).not.toBeNull();
    // The deleted row only counts toward the cap's row count.
    expect(group?.children.map((child) => child._id)).toEqual([first._id, second._id, third._id]);
    expect(group?.totalRowCount).toBe(4);
    // Narrow tab projections, not enriched items — just what the strip and
    // the container redirect read.
    expect(group?.children[0]).toEqual({
      _id: first._id,
      title: first.title,
      lastActivityAt: first.lastActivityAt,
      associatedTaskId: undefined,
      isDone: false,
      doneAt: undefined,
      status: "completed",
      hasPendingInteraction: false,
      requiresAttention: false,
      pullRequestChecksRunning: false,
      // Never opened, so the tab's dot is what says there is output to read.
      hasUnread: true,
    });
    // The strip sorts done tabs to its end by `doneAt` (OS-1478), so both
    // the derived flag and its sort key ride along.
    expect(group?.children[2]).toMatchObject({ isDone: true, doneAt: third.doneAt });
  });

  test("children carry the status inputs a tab's indicator folds (OS-1618)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const streaming = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      parentThreadId: container._id,
    });
    // Parked on an approval: still `streaming` on the row, but the client
    // reads it as waiting on the user — which needs `hasPendingInteraction`.
    const parked = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      hasPendingInteraction: true,
      parentThreadId: container._id,
    });
    const failed = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      parentThreadId: container._id,
    });
    // Acknowledged after its last activity: the failure no longer demands
    // attention, so the tab shows it as settled (same rule as a list row).
    const acknowledged = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: 1_000,
      attentionAcknowledgedAt: 2_000,
      parentThreadId: container._id,
    });

    const group = await asUser.query(api.cli.threads.groups.getGroup, { containerId: container._id });
    const byId = new Map(group?.children.map((child) => [child._id, child]));
    expect(byId.get(streaming._id)).toMatchObject({
      status: "streaming",
      hasPendingInteraction: false,
      requiresAttention: false,
    });
    expect(byId.get(parked._id)).toMatchObject({
      status: "streaming",
      hasPendingInteraction: true,
    });
    expect(byId.get(failed._id)).toMatchObject({ status: "failed", requiresAttention: true });
    expect(byId.get(acknowledged._id)).toMatchObject({ status: "failed", requiresAttention: false });
  });

  // Without this a finished-but-unopened tab renders nothing at all: the
  // indicator's unread branch is the only thing a `completed` tab can show,
  // and the client has no `readAt` to derive it from.
  test("children carry hasUnread so a finished tab can show the unread dot (OS-1618)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const unopened = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: 2_000,
      parentThreadId: container._id,
    });
    const read = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: 1_000,
      readAt: 2_000,
      parentThreadId: container._id,
    });
    // Opened, then it kept going: unread again.
    const staleRead = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: 3_000,
      readAt: 2_000,
      parentThreadId: container._id,
    });

    const group = await asUser.query(api.cli.threads.groups.getGroup, { containerId: container._id });
    const byId = new Map(group?.children.map((child) => [child._id, child]));

    expect(byId.get(unopened._id)?.hasUnread).toBe(true);
    expect(byId.get(read._id)?.hasUnread).toBe(false);
    expect(byId.get(staleRead._id)?.hasUnread).toBe(true);
  });

  test("children carry their raw associatedTaskId (resolved by cli/tasks.getSummaries, off this query's read set)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const task = await ctx.task(project._id, user._id, { name: "Tab ref" });
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
      associatedTaskId: task._id,
    });

    const group = await asUser.query(api.cli.threads.groups.getGroup, { containerId: container._id });
    // The shape as a whole is asserted above; this is about the raw ref.
    expect(group?.children).toMatchObject([
      {
        _id: child._id,
        title: child.title,
        lastActivityAt: child.lastActivityAt,
        associatedTaskId: task._id,
        isDone: false,
      },
    ]);
  });

  test("returns null for plain threads and group children, and serves workflow-run containers like any group", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const plain = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed" });
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const runContainer = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      workflowRunId: runId,
      status: "completed",
    });

    expect(await asUser.query(api.cli.threads.groups.getGroup, { containerId: plain._id })).toBeNull();
    expect(await asUser.query(api.cli.threads.groups.getGroup, { containerId: child._id })).toBeNull();
    // A run container is a group (OS-1366): its lane threads render as tabs.
    expect(await asUser.query(api.cli.threads.groups.getGroup, { containerId: runContainer._id })).toEqual({
      children: [],
      totalRowCount: 0,
    });

    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);
    expect(await asOutsider.query(api.cli.threads.groups.getGroup, { containerId: container._id })).toBeNull();
  });

  test("get exposes parentThreadId on group children and leaves it unset on root threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const plain = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed" });
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });

    const childDetail = await asUser.query(api.cli.threads.core.get, { threadId: child._id });
    expect(childDetail?.parentThreadId).toBe(container._id);
    const plainDetail = await asUser.query(api.cli.threads.core.get, { threadId: plain._id });
    expect(plainDetail?.parentThreadId).toBeUndefined();
  });
});

describe("container cascades (OS-1475)", () => {
  test("markRead on a group cascades to children and acknowledges attention", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    // Own readAt looks fresh — the OCC guard must judge by the child
    // denorms, not the container's own fields.
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
      readAt: past,
      hasUnreadChildren: true,
      hasAttentionChildren: true,
    });
    const unreadChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });
    const failedChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: past + 3_000,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: container._id, acknowledgeAttention: true });

    await t.run(async (runCtx) => {
      const read = await runCtx.db.get("cliThreads", unreadChild._id);
      expect(read?.readAt).toBeDefined();
      const acked = await runCtx.db.get("cliThreads", failedChild._id);
      expect(acked?.readAt).toBeDefined();
      expect(acked?.attentionAcknowledgedAt).toBeDefined();
      const doc = await runCtx.db.get("cliThreads", container._id);
      expect(doc?.hasUnreadChildren).toBe(false);
      expect(doc?.hasAttentionChildren).toBe(false);
      expect(doc?.aggregateStatus).toBe("idle");
    });
  });

  test("markUnread on a group cascades, clearing read and done marks", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      readAt: past + 5_000,
      doneAt: past + 5_000,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.core.markUnread, { threadId: container._id });

    await t.run(async (runCtx) => {
      const doc = await runCtx.db.get("cliThreads", child._id);
      expect(doc?.readAt).toBeUndefined();
      expect(doc?.doneAt).toBeUndefined();
      const group = await runCtx.db.get("cliThreads", container._id);
      expect(group?.hasUnreadChildren).toBe(true);
    });
  });

  test("markUnread clears a sticky done mark (OS-2176)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed" });
    await asUser.mutation(api.cli.threads.core.markDone, { threadId: thread._id });

    await asUser.mutation(api.cli.threads.core.markUnread, { threadId: thread._id });

    expect((await t.run((runCtx) => runCtx.db.get("cliThreads", thread._id)))?.statusProjection?.isDone).toBe(false);
  });

  test("batchMarkDone and batchMarkNotDone cascade through the container", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
      hasAttentionChildren: true,
    });
    const failedChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });
    const completedChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [container._id] });

    await t.run(async (runCtx) => {
      const failed = await runCtx.db.get("cliThreads", failedChild._id);
      expect(failed?.doneAt).toBeDefined();
      expect(failed?.readAt).toBeDefined();
      // The container's own status never needs attention — the ack must be
      // derived from the child denorm and land on the failed child.
      expect(failed?.attentionAcknowledgedAt).toBeDefined();
      const completed = await runCtx.db.get("cliThreads", completedChild._id);
      expect(completed?.doneAt).toBeDefined();
      const group = await runCtx.db.get("cliThreads", container._id);
      expect(group?.doneAt).toBeDefined();
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkNotDone, { threadIds: [container._id] });

    await t.run(async (runCtx) => {
      const failed = await runCtx.db.get("cliThreads", failedChild._id);
      expect(failed?.doneAt).toBeUndefined();
      const completed = await runCtx.db.get("cliThreads", completedChild._id);
      expect(completed?.doneAt).toBeUndefined();
      const group = await runCtx.db.get("cliThreads", container._id);
      expect(group?.doneAt).toBeUndefined();
    });
  });

  test("remove on a group cascades to all children and the container", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const first = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });
    const second = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      doneAt: Date.now(),
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.core.remove, { threadId: container._id });

    await t.run(async (runCtx) => {
      for (const id of [first._id, second._id, container._id]) {
        const doc = await runCtx.db.get("cliThreads", id);
        expect(doc?.isDeleted).toBe(true);
      }
    });
  });

  test("batchRemove deletes a workflow run's container with its children", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    // Run containers never auto-delete at the denorm seam — the explicit
    // cascade must delete both the children and the container itself.
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      workflowRunId: runId,
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.batch.batchRemove, { threadIds: [container._id] });

    await t.run(async (runCtx) => {
      for (const id of [child._id, container._id]) {
        const doc = await runCtx.db.get("cliThreads", id);
        expect(doc?.isDeleted).toBe(true);
      }
    });
  });

  test("child reads keep the container unread/attention denorms fresh", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const completedChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });
    const failedChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: completedChild._id });

    let doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.hasUnreadChildren).toBe(true);
    expect(doc?.hasAttentionChildren).toBe(true);

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: failedChild._id, acknowledgeAttention: true });

    doc = await t.run(async (runCtx) => runCtx.db.get("cliThreads", container._id));
    expect(doc?.hasUnreadChildren).toBe(false);
    expect(doc?.hasAttentionChildren).toBe(false);
  });

  test("the flat list exposes container fields and child-aggregated unread/attention", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const completedChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });
    const failedChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });

    // Seam write populates the denorms (production containers are synced
    // from birth via addThreadToGroup).
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: completedChild._id });

    const listArgs = { projectId: project._id, paginationOpts: { numItems: 10, cursor: null } };
    let list = await asUser.query(api.cli.threads.lists.listByProject, listArgs);
    expect(list.page).toHaveLength(1);
    let item = list.page[0];
    expect(item.kind).toBe("group");
    expect(item.childCount).toBe(2);
    expect(item.aggregateStatus).toBe("failed");
    expect(item.hasUnread).toBe(true);
    expect(item.requiresAttention).toBe(true);

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: failedChild._id, acknowledgeAttention: true });

    // The container's own readAt is still unset — own-field logic would say
    // unread; the aggregate correctly says everything was read in the tabs.
    list = await asUser.query(api.cli.threads.lists.listByProject, listArgs);
    item = list.page[0];
    expect(item.readAt).toBeUndefined();
    expect(item.hasUnread).toBe(false);
    expect(item.requiresAttention).toBe(false);
    expect(item.aggregateStatus).toBe("idle");
  });

  test("a stale unread denorm self-heals on markRead even when every child is settled", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    // Wrongly-true denorm with a fully-read child: the cascade skips the
    // child, so only the end-of-cascade recompute can repair the aggregate.
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
      hasUnreadChildren: true,
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      readAt: past + 2_000,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: container._id });

    await t.run(async (runCtx) => {
      const group = await runCtx.db.get("cliThreads", container._id);
      expect(group?.hasUnreadChildren).toBe(false);
      // The settled child was skipped, not re-stamped.
      const doc = await runCtx.db.get("cliThreads", child._id);
      expect(doc?.readAt).toBe(past + 2_000);
    });
  });

  test("batch actions over two children of the same group leave the denorms fresh", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
      hasUnreadChildren: true,
    });
    const first = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 1_000,
      parentThreadId: container._id,
    });
    const second = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past + 2_000,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkRead, { threadIds: [first._id, second._id] });

    await t.run(async (runCtx) => {
      for (const id of [first._id, second._id]) {
        const child = await runCtx.db.get("cliThreads", id);
        expect(child?.readAt).toBeDefined();
      }
      const group = await runCtx.db.get("cliThreads", container._id);
      expect(group?.hasUnreadChildren).toBe(false);
    });
  });

  test("cascades skip children already in the target state, preserving their own stamps", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
      lastActivityAt: past,
    });
    const doneChild = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      lastActivityAt: past,
      readAt: past + 2_000,
      doneAt: past + 2_000,
      parentThreadId: container._id,
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [container._id] });

    await t.run(async (runCtx) => {
      // The already-done child keeps its earlier doneAt stamp.
      const done = await runCtx.db.get("cliThreads", doneChild._id);
      expect(done?.doneAt).toBe(past + 2_000);
    });
  });

  test("pinning a group child is rejected; the container pins normally", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      parentThreadId: container._id,
    });

    await expect(asUser.mutation(api.cli.threads.core.pin, { threadId: child._id })).rejects.toThrow(
      "Threads inside a group cannot be pinned"
    );

    await asUser.mutation(api.cli.threads.core.pin, { threadId: container._id });
    const pinned = await asUser.query(api.cli.threads.lists.listPinnedByProject, { projectId: project._id });
    expect(pinned.map((thread) => thread._id)).toEqual([container._id]);
  });
});
