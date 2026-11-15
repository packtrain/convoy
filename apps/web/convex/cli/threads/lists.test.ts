import * as accessRepo from "../../lib/accessRepo";
import { expect, test, describe, vi } from "vitest";
import type { PaginationResult } from "convex/server";
import type { WatchTowerThreadItem } from "./lib/validators";
import { api } from "../../_generated/api";
import { createTestContext, setupFakeTimers } from "../../../convex-testing";
import { TASK_THREADS_MAX } from "@/lib/threads/constants";

import {
  insertWorkflowRunContainer,
  markThreadStreamEnded,
  markThreadUnread,
  setContainerAggregateStatus,
  setThreadHasPendingInteraction,
  setThreadParent,
} from "./lib/cliThreadsRepo";

setupFakeTimers();

describe("listByProject", () => {
  test("returns the worktree branch from the resolved profile path with a thread snapshot fallback", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [
        {
          id: "repo-path",
          path: "/home/user/project",
          label: "project",
          gitRemoteUrl: "git@github.com:contoso/contoso.git",
        },
        {
          id: "worktree-path",
          path: "/home/user/project-worktrees/feat-path",
          label: "feat/path",
          gitRemoteUrl: "git@github.com:contoso/contoso.git",
          kind: "worktree",
          parentPathId: "repo-path",
          branch: "feat/path",
        },
      ],
    });

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Resolved path branch",
      pathId: "worktree-path",
      path: "/home/user/project-worktrees/feat-path",
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Pending snapshot branch",
      pathId: "repo-path",
      path: "/home/user/project",
      git: {
        worktree: {
          parentPathId: "repo-path",
          branch: "feat/snapshot",
          status: "pending",
        },
      },
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.find((thread) => thread.title === "Resolved path branch")?.branch).toBe("feat/path");
    expect(result.page.find((thread) => thread.title === "Pending snapshot branch")?.branch).toBe("feat/snapshot");
  });

  test("should list non-deleted threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, { title: "Chat 1" });
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Chat 2" });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Deleted",
      isDeleted: true,
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(2);
    expect(result.page.map((c) => c.title).sort()).toEqual(
      ["Chat 1", "Chat 2"].sort()
    );
  });

  test("run container rows carry the workflow's identity (id, name, color)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/repo/path-1", label: "path-1" }],
    });

    const workflowId = await asUser.mutation(api.workflows.core.create, {
      projectId: project._id,
      name: "Colored workflow",
      color: "#ef4444",
      definition: {
        lanes: [{ laneId: "lane-1", name: "Executor", type: "single", defaults: { cliType: "claude-code" } }],
        stages: [
          {
            stageId: "stage-1",
            name: "Plan",
            steps: [{ stepId: "step-1", laneId: "lane-1", action: { type: "prompt", content: { displayContent: "go" } } }],
          },
        ],
      },
    });
    await asUser.mutation(api.workflows.runs.core.start, { workflowId, profileId: profile._id, pathId: "path-1" });
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Plain thread" });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const container = result.page.find((c) => c.title === "Colored workflow");
    expect(container?.workflow).toEqual({ _id: workflowId, name: "Colored workflow", color: "#ef4444" });
    expect(result.page.find((c) => c.title === "Plain thread")?.workflow).toBeUndefined();
  });

  test("should include hasUnread flag", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Read",
      readAt: Date.now(),
      lastActivityAt: Date.now() - 1000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Unread",
      readAt: Date.now() - 2000,
      lastActivityAt: Date.now(),
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const read = result.page.find((c) => c.title === "Read");
    const unread = result.page.find((c) => c.title === "Unread");
    expect(read?.hasUnread).toBe(false);
    expect(unread?.hasUnread).toBe(true);
  });

  test("should include hasPendingInteraction flag", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Parked on question",
      status: "streaming",
      hasPendingInteraction: true,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Just streaming",
      status: "streaming",
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const parked = result.page.find((c) => c.title === "Parked on question");
    const streaming = result.page.find((c) => c.title === "Just streaming");
    expect(parked?.hasPendingInteraction).toBe(true);
    expect(streaming?.hasPendingInteraction).toBe(false);
  });

  test("should include requiresAttention flag", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const now = Date.now();

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Acknowledged",
      status: "failed",
      readAt: now,
      attentionAcknowledgedAt: now,
      lastActivityAt: now - 1000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Needs attention",
      status: "failed",
      readAt: now,
      attentionAcknowledgedAt: now - 2000,
      lastActivityAt: now - 1000,
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const acknowledged = result.page.find((c) => c.title === "Acknowledged");
    const needsAttention = result.page.find((c) => c.title === "Needs attention");
    expect(acknowledged?.requiresAttention).toBe(false);
    expect(needsAttention?.requiresAttention).toBe(true);
  });

  test("returns associated task summaries in list results", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const task = await ctx.task(project._id, user._id, {
      name: "List task summary",
    });

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Thread with task",
      associatedTaskId: task._id,
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page[0]?.associatedTask).toEqual({
      _id: task._id,
      refId: `${project.alias}-${task.refNumber}`,
      name: "List task summary",
      taskType: expect.objectContaining({ key: "task" }),
      isArchived: false,
    });
  });

  test("should include soft-deleted profile names in thread list", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      name: "Deleted Profile",
    });

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Chat 1",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliProfiles", profile._id, {
        isDeleted: true,
        deletedAt: Date.now(),
        deletedBy: user._id,
      });
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0]?.profileName).toBe("Deleted Profile");
  });

  test("should sort by createdAt when sortBy is 'created'", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const now = Date.now();
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Oldest",
      createdAt: now - 3000,
      lastActivityAt: now, // most recent activity but oldest created
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Middle",
      createdAt: now - 2000,
      lastActivityAt: now - 3000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Newest",
      createdAt: now - 1000,
      lastActivityAt: now - 2000,
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
      sortBy: "created",
    });

    expect(result.page.map((c) => c.title)).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });

  test("should sort by lastActivityAt by default", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const now = Date.now();
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Old activity",
      lastActivityAt: now - 2000,
      createdAt: now, // newest created but oldest activity
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "New activity",
      lastActivityAt: now,
      createdAt: now - 2000,
    });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.map((c) => c.title)).toEqual([
      "New activity",
      "Old activity",
    ]);
  });

  test("should return empty for non-member", async () => {
    const ctx = createTestContext();
    const { project } = await ctx.setupProject();
    const { asUser: asOtherUser } = await ctx.setupUser();

    const result = await asOtherUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(0);
  });
});

describe("listMine", () => {
  test("returns own threads scoped to the organization, newest activity first", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const secondProject = await ctx.project(org._id, user._id, {
      alias: "SEC",
      name: "Second Project",
    });
    const otherOrg = await ctx.organization(user._id, { slug: "other-org" });
    const otherOrgProject = await ctx.project(otherOrg._id, user._id, {
      alias: "OTH",
      name: "Other Project",
    });

    const profile = await ctx.cliProfile(user._id, project._id);
    const secondProfile = await ctx.cliProfile(user._id, secondProject._id);
    const otherProfile = await ctx.cliProfile(user._id, otherOrgProject._id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Older thread",
      lastActivityAt: Date.now() - 10_000,
    });
    await ctx.cliThread(user._id, secondProject._id, secondProfile._id, {
      title: "Newer thread",
      lastActivityAt: Date.now() - 1_000,
    });
    await ctx.cliThread(user._id, otherOrgProject._id, otherProfile._id, {
      title: "Other org thread",
      lastActivityAt: Date.now(),
    });

    const result = await asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug,
      section: "waiting_input",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.map((thread) => thread.title)).toEqual([
      "Newer thread",
      "Older thread",
    ]);
    expect(result.page[0].location).toEqual({
      projectAlias: "SEC",
      projectName: "Second Project",
    });
    expect(result.page[1].location.projectAlias).toBe(project.alias);
  });

  test("excludes deleted threads and other users' threads", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const otherUser = await ctx.user();
    const profile = await ctx.cliProfile(user._id, project._id);
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, { title: "Mine" });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Deleted",
      isDeleted: true,
    });
    await ctx.cliThread(otherUser._id, project._id, otherProfile._id, {
      title: "Someone else's",
    });

    const result = await asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug,
      section: "waiting_input",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.map((thread) => thread.title)).toEqual(["Mine"]);
  });

  test("drops threads whose project has been deleted", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const doomedProject = await ctx.project(org._id, user._id, { alias: "DOOM" });
    const profile = await ctx.cliProfile(user._id, project._id);
    const doomedProfile = await ctx.cliProfile(user._id, doomedProject._id);

    await ctx.cliThread(user._id, project._id, profile._id, { title: "Kept" });
    await ctx.cliThread(user._id, doomedProject._id, doomedProfile._id, {
      title: "Orphaned",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", doomedProject._id, { isDeleted: true });
    });

    const result = await asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug,
      section: "waiting_input",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.map((thread) => thread.title)).toEqual(["Kept"]);
  });

  test("returns empty page when unauthenticated", async () => {
    const ctx = createTestContext();
    const { user, org, project, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Mine" });

    const result = await t.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug,
      section: "waiting_input",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(0);
  });

  test("drops threads in projects the user can no longer access", async () => {
    const ctx = createTestContext();
    const { org, project, t } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    const membership = await ctx.projectMember(project._id, member._id, "member");
    const profile = await ctx.cliProfile(member._id, project._id);
    await ctx.cliThread(member._id, project._id, profile._id, { title: "Mine" });
    const asMember = ctx.asUser(member);

    const before = await asMember.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug,
      section: "waiting_input",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(before.page.map((thread) => thread.title)).toEqual(["Mine"]);

    await t.run(async (runCtx) => {
      await runCtx.db.delete("projectMembers", membership._id);
    });

    const after = await asMember.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug,
      section: "waiting_input",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(after.page).toHaveLength(0);
  });

  test("buckets threads into sections by watch status", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const now = Date.now();

    await ctx.cliThread(user._id, project._id, profile._id, { title: "Streaming", status: "streaming" });
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Queued", status: "pending" });
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Waiting", status: "waiting_input" });
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Broken", status: "failed" });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Acked failure",
      status: "failed",
      lastActivityAt: now - 1_000,
      attentionAcknowledgedAt: now,
      readAt: now,
    });
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Unreviewed", status: "completed" });
    // Read but not explicitly done: stays in needs_review (OS-1382).
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Reviewed",
      status: "completed",
      lastActivityAt: now - 1_000,
      readAt: now,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Marked done",
      status: "completed",
      lastActivityAt: now - 1_000,
      readAt: now,
      doneAt: now,
    });
    // A legacy mark (no `isMarkedDone`) expires on newer activity (OS-2176).
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Done then updated",
      status: "completed",
      lastActivityAt: now,
      readAt: now - 1_000,
      doneAt: now - 1_000,
    });

    const titlesIn = async (section: "running" | "waiting_input" | "failed" | "needs_review" | "done") => {
      const result = await asUser.query(api.cli.threads.lists.listMine, {
        organizationSlug: org.slug,
        section,
        paginationOpts: { numItems: 10, cursor: null },
      });
      return result.page.map((thread) => thread.title).sort();
    };

    expect(await titlesIn("running")).toEqual(["Queued", "Streaming"]);
    expect(await titlesIn("waiting_input")).toEqual(["Waiting"]);
    expect(await titlesIn("failed")).toEqual(["Broken"]);
    expect(await titlesIn("needs_review")).toEqual([
      "Acked failure",
      "Done then updated",
      "Reviewed",
      "Unreviewed",
    ]);
    expect(await titlesIn("done")).toEqual(["Marked done"]);
  });

  test("statusProjection.watchTowerStatus tracks lifecycle transitions at the write seams", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    // Creation: pending status buckets as running.
    const createdId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Hello",
    });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", createdId))?.statusProjection?.watchTowerStatus).toBe("running");
    });

    // Reading a finished thread no longer moves it out of needs_review —
    // only the explicit done mark does (OS-1382).
    const finished = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Finished",
      status: "completed",
    });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", finished._id))?.statusProjection?.watchTowerStatus).toBe("needs_review");
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: finished._id });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", finished._id))?.statusProjection?.watchTowerStatus).toBe("needs_review");
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [finished._id] });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", finished._id))?.statusProjection?.watchTowerStatus).toBe("done");
    });

    await asUser.mutation(api.cli.threads.batch.batchMarkNotDone, { threadIds: [finished._id] });
    await t.run(async (runCtx) => {
      const doc = await runCtx.db.get("cliThreads", finished._id);
      expect(doc?.statusProjection?.watchTowerStatus).toBe("needs_review");
      // Still read: clearing the done mark does not touch read state.
      expect(doc?.readAt).toBeDefined();
    });

    // Mark as unread clears the done mark too: unread implies not done.
    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [finished._id] });
    await asUser.mutation(api.cli.threads.core.markUnread, { threadId: finished._id });
    await t.run(async (runCtx) => {
      const doc = await runCtx.db.get("cliThreads", finished._id);
      expect(doc?.statusProjection?.watchTowerStatus).toBe("needs_review");
      expect(doc?.doneAt).toBeUndefined();
    });

    // Acknowledging attention demotes a failed thread to needs_review, not done.
    const failed = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Failed",
      status: "failed",
    });
    await asUser.mutation(api.cli.threads.core.markRead, {
      threadId: failed._id,
      acknowledgeAttention: true,
    });
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", failed._id))?.statusProjection?.watchTowerStatus).toBe("needs_review");
    });

    // Marking a failed thread done acknowledges its attention state.
    const failedDone = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Failed done",
      status: "failed",
    });
    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [failedDone._id] });
    await t.run(async (runCtx) => {
      const doc = await runCtx.db.get("cliThreads", failedDone._id);
      expect(doc?.statusProjection?.watchTowerStatus).toBe("done");
      expect(doc?.readAt).toBeDefined();
      expect(doc?.attentionAcknowledgedAt).toBeDefined();
    });
  });

  test("returns empty page for an unknown organization slug", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Mine" });

    const result = await asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: "no-such-org",
      section: "waiting_input",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(0);
  });
});

describe("listByAssociatedTask", () => {
  test("returns only the current users associated threads", async () => {
    const ctx = createTestContext();
    const { user, project, org, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { name: "Scoped task" });
    const myProfile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, myProfile._id, {
      title: "My associated thread",
      associatedTaskId: task._id,
    });

    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
    await ctx.cliThread(otherUser._id, project._id, otherProfile._id, {
      title: "Other users thread",
      associatedTaskId: task._id,
    });

    const result = await asUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("My associated thread");
  });

  test("excludes threads associated with other tasks", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const targetTask = await ctx.task(project._id, user._id, { name: "Target task" });
    const otherTask = await ctx.task(project._id, user._id, { name: "Other task" });
    const profile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Matching thread",
      associatedTaskId: targetTask._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Different task thread",
      associatedTaskId: otherTask._id,
    });

    const result = await asUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: targetTask._id,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Matching thread");
  });

  test("excludes soft-deleted threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { name: "Scoped task" });
    const profile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Visible thread",
      associatedTaskId: task._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Deleted thread",
      associatedTaskId: task._id,
      isDeleted: true,
    });

    const result = await asUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Visible thread");
  });

  test("orders results by lastActivityAt descending", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { name: "Scoped task" });
    const profile = await ctx.cliProfile(user._id, project._id);
    const now = Date.now();

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Old activity",
      associatedTaskId: task._id,
      lastActivityAt: now - 3_000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Newest activity",
      associatedTaskId: task._id,
      lastActivityAt: now,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Middle activity",
      associatedTaskId: task._id,
      lastActivityAt: now - 1_000,
    });

    const result = await asUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result.map((thread) => thread.title)).toEqual([
      "Newest activity",
      "Middle activity",
      "Old activity",
    ]);
  });

  test("returns hydrated associated task summaries", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, {
      name: "Associated task",
    });
    const profile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Thread with task",
      associatedTaskId: task._id,
    });

    const result = await asUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result[0]?.associatedTask).toEqual({
      _id: task._id,
      refId: `${project.alias}-${task.refNumber}`,
      name: "Associated task",
      taskType: expect.objectContaining({ key: "task" }),
      isArchived: false,
    });
  });

  test("returns empty for unauthenticated access", async () => {
    const ctx = createTestContext();
    const { user, project, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { name: "Scoped task" });

    const result = await t.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result).toEqual([]);
  });

  test("returns empty when the user lacks project access", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { name: "Scoped task" });
    const { asUser: asOtherUser } = await ctx.setupUser();

    const result = await asOtherUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result).toEqual([]);
  });

  test("returns empty for deleted tasks", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { name: "Scoped task" });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task._id, {
        isDeleted: true,
      });
    });

    const result = await asUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result).toEqual([]);
  });

  test("returns empty when task and project do not match", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const { project: otherProject } = await ctx.setupProject();
    const task = await ctx.task(otherProject._id, user._id, { name: "Other project task" });

    const result = await asUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result).toEqual([]);
  });

  /**
   * This list is unpaginated and nothing caps threads per task on write, so the read
   * carries the bound — otherwise a long-lived task's sidebar eventually exceeds
   * Convex's limits with no cursor to recover.
   */
  test("reads at most TASK_THREADS_MAX rows, newest first", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { name: "Busy task" });
    const profile = await ctx.cliProfile(user._id, project._id);
    for (let index = 0; index < TASK_THREADS_MAX + 5; index += 1) {
      await ctx.cliThread(user._id, project._id, profile._id, {
        associatedTaskId: task._id,
        lastActivityAt: index + 1,
      });
    }

    const result = await asUser.query(api.cli.threads.lists.listByAssociatedTask, {
      projectId: project._id,
      taskId: task._id,
    });

    expect(result).toHaveLength(TASK_THREADS_MAX);
    expect(result[0]?.lastActivityAt).toBe(TASK_THREADS_MAX + 5);
  });
});

describe("listActiveForUser (OS-1237)", () => {
  test("returns streaming, claimed, and queued threads across projects, newest first", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id);
    const profile = await ctx.cliProfile(user._id, project._id);
    const otherProfile = await ctx.cliProfile(user._id, otherProject._id);
    const now = Date.now();

    const streamingThread = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Streaming",
      status: "streaming",
      processingState: "streaming",
      lastActivityAt: now - 1000,
    });
    const claimedThread = await ctx.cliThread(user._id, otherProject._id, otherProfile._id, {
      title: "Claimed",
      processingState: "claimed",
      lastActivityAt: now - 3000,
    });
    const queuedThread = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Queued",
      status: "pending",
      hasPendingUserMessages: true,
      lastActivityAt: now - 2000,
    });
    // Finished and idle without pending messages: not active. (The builder's
    // default status is waiting_input, which now counts as attention.)
    await ctx.cliThread(user._id, project._id, profile._id, { title: "Idle", status: "completed" });
    // Deleted: never returned.
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Deleted",
      processingState: "streaming",
      isDeleted: true,
      deletedAt: now,
    });

    const result = await asUser.query(api.cli.threads.lists.listActiveForUser, {});

    expect(result.map((thread) => thread._id)).toEqual([
      streamingThread._id,
      queuedThread._id,
      claimedThread._id,
    ]);
    expect(result[0]?.location.projectName).toBe(project.name);
    expect(result[0]?.location.organizationSlug).toBe(org.slug);
    // Deep links must target THIS deployment's web app, not a hardcoded host.
    expect(result[0]?.location.appUrl).toBe("https://app.convoy.localhost");
    expect(result[2]?.location.projectAlias).toBe(otherProject.alias);
  });

  test("returns idle threads that still need attention (failed / waiting input)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const now = Date.now();

    // A quick model error leaves the thread idle with no pending messages —
    // it must stay in the desktop feed until the user acknowledges it.
    const failedThread = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Failed",
      status: "failed",
      lastActivityAt: now - 1000,
    });
    const waitingThread = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Waiting",
      status: "waiting_input",
      lastActivityAt: now - 2000,
    });
    // Acknowledged attention: no longer active.
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Acknowledged",
      status: "failed",
      lastActivityAt: now - 3000,
      attentionAcknowledgedAt: now,
    });
    // Unacknowledged but stale: stays in the Watch Tower, leaves the tray.
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Stale",
      status: "failed",
      lastActivityAt: now - 25 * 60 * 60 * 1000,
    });

    const result = await asUser.query(api.cli.threads.lists.listActiveForUser, {});

    expect(result.map((thread) => thread._id)).toEqual([failedThread._id, waitingThread._id]);
    expect(result[0]?.requiresAttention).toBe(true);
    expect(result[1]?.requiresAttention).toBe(true);
  });

  test("dedupes claimed threads that also have pending messages", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      processingState: "claimed",
      hasPendingUserMessages: true,
    });

    const result = await asUser.query(api.cli.threads.lists.listActiveForUser, {});

    expect(result.map((item) => item._id)).toEqual([thread._id]);
  });

  test("supports API key auth", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, { name: "MacBook", hostname: "mbp.local" });

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "Desktop Key",
      expiresAt,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      processingState: "streaming",
      status: "streaming",
      claimedBySessionId: session._id,
    });

    const result = await t.query(api.cli.threads.lists.listActiveForUser, { apiKey: apiKeyResult.key });

    expect(result).toHaveLength(1);
  });

  test("returns empty when unauthenticated and drops threads from deleted projects", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    await ctx.cliThread(user._id, project._id, profile._id, { processingState: "streaming" });

    expect(await t.query(api.cli.threads.lists.listActiveForUser, {})).toEqual([]);

    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", project._id, { isDeleted: true });
    });
    expect(await asUser.query(api.cli.threads.lists.listActiveForUser, {})).toEqual([]);
  });

  test("does not return other users' threads", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();
    const { user: otherUser, project: otherProject } = await ctx.setupProject();
    const otherProfile = await ctx.cliProfile(otherUser._id, otherProject._id);
    await ctx.cliThread(otherUser._id, otherProject._id, otherProfile._id, { processingState: "streaming" });

    expect(await asUser.query(api.cli.threads.lists.listActiveForUser, {})).toEqual([]);
  });
});

describe("listPinnedByProject", () => {
  test("returns only own pinned live threads, most recently pinned first", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Pinned earlier",
      isPinned: true,
      pinnedAt: 1000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Pinned later",
      isPinned: true,
      pinnedAt: 2000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Not pinned",
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Pinned but deleted",
      isPinned: true,
      pinnedAt: 4000,
      isDeleted: true,
    });

    const result = await asUser.query(api.cli.threads.lists.listPinnedByProject, {
      projectId: project._id,
    });

    expect(result.map((chat) => chat.title)).toEqual([
      "Pinned later",
      "Pinned earlier",
    ]);
    expect(result.every((chat) => chat.isPinned)).toBe(true);
  });

});

describe("done projection and sections (OS-1451)", () => {
  test("batchMarkDone sets the indexed isDone and batchMarkNotDone clears it", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Finished",
      status: "completed",
    });

    const storedIsDone = async () =>
      t.run(async (runCtx) => (await runCtx.db.get("cliThreads", thread._id))?.statusProjection?.isDone);

    expect(await storedIsDone()).toBe(false);

    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [thread._id] });
    expect(await storedIsDone()).toBe(true);

    await asUser.mutation(api.cli.threads.batch.batchMarkNotDone, { threadIds: [thread._id] });
    expect(await storedIsDone()).toBe(false);
  });

  test("new activity on a done thread flips isDone back to false", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Done until poked",
      status: "completed",
      createdAt: past,
      lastActivityAt: past,
      doneAt: past,
    });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", thread._id))?.statusProjection?.isDone).toBe(true);
    });

    await asUser.mutation(api.cli.messages.send, { threadId: thread._id, content: "one more thing" });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", thread._id))?.statusProjection?.isDone).toBe(false);
    });
  });

  test("listByProject filters by isDone under both sorts", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Active",
      status: "completed",
      createdAt: past + 3_000,
      lastActivityAt: past + 3_000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Done active",
      status: "completed",
      createdAt: past + 2_000,
      lastActivityAt: past + 2_000,
      doneAt: past + 2_000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Done older",
      status: "completed",
      createdAt: past + 1_000,
      lastActivityAt: past + 1_000,
      doneAt: past + 1_000,
    });

    const titles = async (args: { isDone?: boolean; sortBy?: "created" | "lastActivity" }) => {
      const result = await asUser.query(api.cli.threads.lists.listByProject, {
        projectId: project._id,
        paginationOpts: { numItems: 10, cursor: null },
        ...args,
      });
      return result.page.map((thread) => thread.title);
    };

    expect(await titles({ isDone: false })).toEqual(["Active"]);
    expect(await titles({ isDone: true })).toEqual(["Done active", "Done older"]);
    expect(await titles({ isDone: true, sortBy: "created" })).toEqual(["Done active", "Done older"]);
    expect(await titles({ isDone: false, sortBy: "created" })).toEqual(["Active"]);
    // Omitting the filter keeps the ungrouped list.
    expect(await titles({})).toEqual(["Active", "Done active", "Done older"]);
  });

  test("listByProject excludes container children on every variant (OS-1472)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;

    const legacy = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Legacy",
      status: "completed",
      createdAt: past + 3_000,
      lastActivityAt: past + 3_000,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Child",
      status: "completed",
      createdAt: past + 2_000,
      lastActivityAt: past + 2_000,
      parentThreadId: legacy._id,
    });
    await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Done child",
      status: "completed",
      createdAt: past + 1_000,
      lastActivityAt: past + 1_000,
      doneAt: past + 1_000,
      parentThreadId: legacy._id,
    });

    const titles = async (args: { isDone?: boolean; sortBy?: "created" | "lastActivity" }) => {
      const result = await asUser.query(api.cli.threads.lists.listByProject, {
        projectId: project._id,
        paginationOpts: { numItems: 10, cursor: null },
        ...args,
      });
      return result.page.map((thread) => thread.title);
    };

    // All four index paths: ungrouped under both sorts and the two isDone
    // sections. Legacy rows (parentThreadId unset) list as before.
    expect(await titles({})).toEqual(["Legacy"]);
    expect(await titles({ sortBy: "created" })).toEqual(["Legacy"]);
    expect(await titles({ isDone: false })).toEqual(["Legacy"]);
    expect(await titles({ isDone: true })).toEqual([]);
  });
});


describe("Watch Tower containers (OS-1984)", () => {
  test("top-level rows do not depend on another user's container fields", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const group = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group", status: "completed", childWatchStatus: "needs_review",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed" });
    await t.run((runCtx) => setThreadParent(runCtx, child._id, group._id));
    const otherUser = await ctx.user();
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
    await ctx.cliThread(otherUser._id, project._id, otherProfile._id, {
      kind: "group", status: "completed",
    });

    const page = await asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug, section: "needs_review", paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((row) => row._id)).toEqual([group._id]);
  });

  const cases = [
    { states: ["failed", "waiting_input", "streaming", "completed"], section: "failed", status: "failed" },
    { states: ["waiting_input", "streaming", "completed"], section: "waiting_input", status: "waiting_input" },
    { states: ["streaming", "completed"], section: "running", status: "streaming" },
    { states: ["completed", "done"], section: "needs_review", status: "completed" },
    { states: ["done", "done"], section: "done", status: "completed" },
  ] as const;

  test.each(cases)("child states $states place the container in $section", async ({ states, section, status }) => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group", status: "completed", lastActivityAt: past, doneAt: Date.now(),
    });
    for (const state of states) {
      const child = await ctx.cliThread(user._id, project._id, profile._id, {
        status: state === "done" ? "completed" : state,
        lastActivityAt: past + 1000,
        doneAt: state === "done" ? Date.now() : undefined,
      });
      await t.run((runCtx) => setThreadParent(runCtx, child._id, container._id));
    }
    const page = await asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug, section, paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((row) => row._id)).toEqual([container._id]);
    expect(page.page[0]).toMatchObject({ status, isDone: section === "done", childCount: states.length });
  });

  test("child done and unread changes move the container, and batch actions cascade", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const past = Date.now() - 60_000;
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group", status: "completed", lastActivityAt: past,
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed", lastActivityAt: past + 1000,
    });
    await t.run((runCtx) => setThreadParent(runCtx, child._id, container._id));
    const list = (section: "needs_review" | "done") => asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug, section, paginationOpts: { numItems: 10, cursor: null },
    });
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: child._id });
    expect((await list("needs_review")).page).toMatchObject([{ _id: container._id, hasUnread: false }]);
    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [child._id] });
    expect((await list("done")).page).toMatchObject([{ _id: container._id, isDone: true }]);
    await t.run((runCtx) => markThreadUnread(runCtx, child._id));
    expect((await list("needs_review")).page).toMatchObject([{ _id: container._id, hasUnread: true, isDone: false }]);
    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [container._id] });
    expect((await list("done")).page.map((row) => row._id)).toEqual([container._id]);
    await asUser.mutation(api.cli.threads.batch.batchMarkNotDone, { threadIds: [container._id] });
    expect((await list("needs_review")).page.map((row) => row._id)).toEqual([container._id]);
    await asUser.mutation(api.cli.threads.batch.batchRemove, { threadIds: [container._id] });
    expect((await list("needs_review")).page).toEqual([]);
    expect(await t.run(async (runCtx) => (await runCtx.db.get("cliThreads", child._id))?.isDeleted)).toBe(true);
  });
});


describe("Watch Tower container lifecycle and access", () => {
  test("workflow state cannot override child attention, activity, metadata, or done state", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const task = await ctx.task(project._id, user._id);
    const past = Date.now() - 60_000;
    const groupId = await t.run((runCtx) => insertWorkflowRunContainer(runCtx, {
      userId: user._id, projectId: project._id, profileId: profile._id, workflowRunId: runId,
      pathId: "path-1", path: "/repo", cliType: "claude-code", title: "Workflow group",
    }, past));
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed", lastActivityAt: past + 1000, associatedTaskId: task._id,
      git: {
        executionBranch: "origin-branch", linesAdded: 10, linesRemoved: 3,
        pullRequest: {
          provider: "github", number: 1, title: "Child PR", url: "https://github.com/test/repo/pull/1",
          state: "open", headBranch: "origin-branch", baseBranch: "main", capturedAt: past,
        },
      },
    });
    await t.run((runCtx) => setThreadParent(runCtx, child._id, groupId));
    const list = (section: "failed" | "waiting_input" | "running" | "needs_review" | "done") => asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug, section, paginationOpts: { numItems: 10, cursor: null },
    });
    const row = (await list("failed")).page[0];
    expect(row).toMatchObject({ _id: groupId, status: "failed", branch: "origin-branch", associatedTask: { _id: task._id } });
    expect(row.pullRequest).toBeUndefined();
    expect(row.linesAdded).toBeUndefined();
    expect(row.linesRemoved).toBeUndefined();
    expect((await asUser.query(api.cli.threads.lists.listActiveForUser, {})).map((item) => item._id)).toContain(child._id);
    expect((await asUser.query(api.cli.threads.lists.listActiveForUser, {})).map((item) => item._id)).not.toContain(groupId);
    await asUser.mutation(api.cli.threads.batch.batchMarkRead, { threadIds: [groupId] });
    expect((await list("needs_review")).page).toMatchObject([{ _id: groupId, hasUnread: false }]);
    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [child._id] });
    expect((await list("done")).page.map((item) => item._id)).toEqual([groupId]);
    await t.run((runCtx) => setContainerAggregateStatus(runCtx, groupId, "failed", Date.now()));
    expect((await list("done")).page.map((item) => item._id)).toEqual([groupId]);
    await t.run((runCtx) => markThreadStreamEnded(runCtx, child._id, {
      status: "streaming", processingState: "streaming", hasPendingUserMessages: false, lastActivityAt: Date.now() + 1000,
    }));
    expect((await list("running")).page).toMatchObject([{ _id: groupId, hasUnread: true, lastActivityAt: Date.now() + 1000 }]);
    await t.run((runCtx) => setThreadHasPendingInteraction(runCtx, child._id, true));
    expect((await list("waiting_input")).page.map((item) => item._id)).toEqual([groupId]);
    await t.run((runCtx) => setThreadHasPendingInteraction(runCtx, child._id, false));
    expect((await list("running")).page.map((item) => item._id)).toEqual([groupId]);
  });

  test("empty workflow containers need review, can be done, and stay done on run activity (OS-2176)", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const { runId } = await ctx.workflowRun(user._id, project._id, profile._id);
    const id = await t.run((runCtx) => insertWorkflowRunContainer(runCtx, {
      userId: user._id, projectId: project._id, profileId: profile._id, workflowRunId: runId,
      pathId: "path-1", path: "/repo", cliType: "claude-code", title: "Empty workflow",
    }, Date.now() - 1000));
    const list = (section: "needs_review" | "done") => asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug, section, paginationOpts: { numItems: 10, cursor: null },
    });
    expect((await list("needs_review")).page).toMatchObject([{ _id: id, childCount: 0 }]);
    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [id] });
    expect((await list("done")).page.map((row) => row._id)).toEqual([id]);
    await t.run((runCtx) => setContainerAggregateStatus(runCtx, id, "running", Date.now() + 1000));
    expect((await list("done")).page.map((row) => row._id)).toEqual([id]);
  });

  test("grouping replaces the source, moving children out restores them, and the last departure dissolves the group", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, { paths: [{ id: "path-1", path: "/repo", label: "repo" }] });
    const source = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed" });
    const { containerId, threadId } = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id, profileId: profile._id, pathId: "path-1", cliType: "claude-code", content: "Go",
    });
    const list = (section: "needs_review" | "running") => asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug, section, paginationOpts: { numItems: 10, cursor: null },
    });
    expect((await list("running")).page.map((row) => row._id)).toEqual([containerId]);
    expect((await list("needs_review")).page).toEqual([]);
    await asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId: source._id });
    expect((await list("needs_review")).page.map((row) => row._id)).toEqual([source._id]);
    await asUser.mutation(api.cli.threads.groups.moveChildOut, { threadId });
    expect((await list("running")).page.map((row) => row._id)).toEqual([threadId]);
  });

  test("pagination continues through filtered container pages without leaking children or foreign owners", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const otherOrg = await ctx.organization(user._id, { slug: "other-watch-org" });
    const otherProject = await ctx.project(otherOrg._id, user._id);
    const otherUser = await ctx.user();
    const inaccessibleProject = await ctx.project(org._id, otherUser._id);
    const ids = [];
    for (const [index, target] of [project, inaccessibleProject, otherProject].entries()) {
      const profile = await ctx.cliProfile(user._id, target._id);
      const group = await ctx.cliThread(user._id, target._id, profile._id, {
        kind: "group", status: "completed", lastActivityAt: Date.now() - 60_000 + index * 1000,
      });
      const child = await ctx.cliThread(user._id, target._id, profile._id, {
        status: "completed", lastActivityAt: group.lastActivityAt,
      });
      await t.run((runCtx) => setThreadParent(runCtx, child._id, group._id));
      ids.push(group._id);
    }
    const foreignProfile = await ctx.cliProfile(otherUser._id, project._id);
    await ctx.cliThread(otherUser._id, project._id, foreignProfile._id, { status: "completed" });
    const list = (cursor: string | null) => asUser.query(api.cli.threads.lists.listMine, {
      organizationSlug: org.slug, section: "needs_review", paginationOpts: { numItems: 1, cursor },
    });
    const first = await list(null);
    expect(first.page).toEqual([]);
    expect(first.isDone).toBe(false);
    const second = await list(first.continueCursor);
    expect(second.page).toEqual([]);
    expect(second.isDone).toBe(false);
    const third = await list(second.continueCursor);
    expect(third.page.map((row) => row._id)).toEqual([ids[0]]);
    expect(third.isDone).toBe(true);
  });
});

describe("Watch Tower team summaries", () => {
  test("all includes minimal teammate summaries without granting transcript access", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const teammate = await ctx.user({ name: "Teammate" });
    const profile = await ctx.cliProfile(teammate._id, project._id);
    const thread = await ctx.cliThread(teammate._id, project._id, profile._id, {
      title: "Team work", path: "/private/path", status: "completed",
      git: { executionBranch: "private-branch", linesAdded: 12 },
    });
    const mine = await ctx.cliProfile(user._id, project._id);
    const own = await ctx.cliThread(user._id, project._id, mine._id, {
      status: "completed", git: { executionBranch: "my-branch" },
    });
    const args = { organizationSlug: org.slug, projectAlias: project.alias, section: "needs_review" as const, paginationOpts: { numItems: 25, cursor: null } };
    const result = await asUser.query(api.cli.threads.lists.listProjectWatchTower, args);
    expect(result.page.map((row) => row._id)).toEqual(expect.arrayContaining([thread._id, own._id]));
    expect(result.page.find((row) => row._id === own._id)).toMatchObject({
      isOwner: true, branch: "my-branch",
    });
    const summary = result.page.find((row) => row._id === thread._id)!;
    expect(summary).toMatchObject({ title: "Team work", isOwner: false, ownerName: "Teammate", hasUnread: false });
    for (const key of ["profileId", "pathId", "pathString", "path", "branch", "linesAdded", "pullRequest", "gitRemoteUrl", "activeAssistantMessageId", "hasPendingUserMessages", "queueHeldAt"]) {
      expect(summary).not.toHaveProperty(key);
    }
    expect(await asUser.query(api.cli.threads.core.get, { threadId: thread._id })).toBeNull();
    const ownOnly = await asUser.query(api.cli.threads.lists.listProjectWatchTower, { ...args, scope: "mine" });
    const personalArgs = { organizationSlug: args.organizationSlug, section: args.section, paginationOpts: args.paginationOpts };
    expect((await asUser.query(api.cli.threads.lists.listMine, personalArgs)).page.map((row) => row._id)).toEqual([own._id]);
    expect(ownOnly.page.map((row) => row._id)).toEqual([own._id]);
  });

  test("team feed enforces organization, project role, deletion and membership revocation", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const teammate = await ctx.user();
    const outsideOrg = await ctx.organization(user._id, { slug: "outside" });
    const outsideProject = await ctx.project(outsideOrg._id, user._id);
    const privateProject = await ctx.project(org._id, teammate._id);
    const viewerProject = await ctx.project(org._id, teammate._id);
    await ctx.projectMember(viewerProject._id, user._id, "viewer");
    const deletedProject = await ctx.project(org._id, user._id);
    await t.run((db) => db.db.patch("projects", deletedProject._id, { isDeleted: true }));
    for (const target of [project, outsideProject, privateProject, viewerProject, deletedProject]) {
      const profile = await ctx.cliProfile(teammate._id, target._id);
      await ctx.cliThread(teammate._id, target._id, profile._id, { title: target._id });
      await ctx.cliThread(teammate._id, target._id, profile._id, { title: "Deleted thread", isDeleted: true });
    }
    const args = { organizationSlug: org.slug, projectAlias: project.alias, scope: "all" as const, section: "waiting_input" as const, paginationOpts: { numItems: 25, cursor: null } };
    expect((await asUser.query(api.cli.threads.lists.listProjectWatchTower, args)).page.map((row) => row.title)).toEqual([project._id]);
    expect((await t.query(api.cli.threads.lists.listProjectWatchTower, args)).page).toEqual([]);
    for (const denied of [outsideProject, privateProject, viewerProject, deletedProject]) {
      expect((await asUser.query(api.cli.threads.lists.listProjectWatchTower, { ...args, projectAlias: denied.alias })).page).toEqual([]);
    }
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    const membership = await ctx.projectMember(project._id, viewer._id, "member");
    const asViewer = ctx.asUser(viewer);
    expect((await asViewer.query(api.cli.threads.lists.listProjectWatchTower, args)).page).toHaveLength(1);
    await t.run((db) => db.db.delete("projectMembers", membership._id));
    expect((await asViewer.query(api.cli.threads.lists.listProjectWatchTower, args)).page).toEqual([]);
  });

  test("project pagination excludes other projects and children with tied timestamps", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const second = await ctx.project(org._id, user._id);
    const teammate = await ctx.user();
    const expected = [];
    const now = Date.now();
    for (const target of [project, second]) {
      const profile = await ctx.cliProfile(teammate._id, target._id);
      for (let i = 0; i < 3; i++) {
        const row = await ctx.cliThread(teammate._id, target._id, profile._id, { status: "completed", lastActivityAt: now });
        if (target._id === project._id) expected.push(row._id);
      }
      const group = await ctx.cliThread(teammate._id, target._id, profile._id, { kind: "group", status: "completed", lastActivityAt: now });
      const child = await ctx.cliThread(teammate._id, target._id, profile._id, { status: "completed" });
      await t.run((db) => setThreadParent(db, child._id, group._id));
      if (target._id === project._id) expected.push(group._id);
    }
    const received = [];
    let cursor: string | null = null;
    let done = false;
    for (let i = 0; i < 10 && !done; i++) {
      const page: PaginationResult<WatchTowerThreadItem> = await asUser.query(api.cli.threads.lists.listProjectWatchTower, {
        organizationSlug: org.slug, projectAlias: project.alias, scope: "all", section: "needs_review", paginationOpts: { numItems: 2, cursor },
      });
      expect(page.page.length).toBeLessThanOrEqual(2);
      received.push(...page.page.map((row) => row._id));
      cursor = page.continueCursor;
      done = page.isDone;
    }
    expect(done).toBe(true);
    expect(received).toHaveLength(expected.length);
    expect(new Set(received)).toEqual(new Set(expected));
  });

  test("foreign workflow containers use owner buckets and remain summary-only after done", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();
    const teammate = await ctx.user();
    await ctx.orgMember(org._id, teammate._id, "member");
    await ctx.projectMember(project._id, teammate._id, "member");
    const profile = await ctx.cliProfile(teammate._id, project._id);
    const { runId } = await ctx.workflowRun(teammate._id, project._id, profile._id);
    const group = await ctx.cliThread(teammate._id, project._id, profile._id, { kind: "group", workflowRunId: runId, status: "completed" });
    const child = await ctx.cliThread(teammate._id, project._id, profile._id, { status: "failed" });
    await t.run((db) => setThreadParent(db, child._id, group._id));
    const list = (section: "failed" | "done") => asUser.query(api.cli.threads.lists.listProjectWatchTower, {
      organizationSlug: org.slug, projectAlias: project.alias, scope: "all", section, paginationOpts: { numItems: 25, cursor: null },
    });
    expect((await list("failed")).page).toMatchObject([{ _id: group._id, isOwner: false, status: "failed", hasUnread: false }]);
    await asUser.mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [group._id] });
    expect((await list("failed")).page).toHaveLength(1);
    await ctx.asUser(teammate).mutation(api.cli.threads.batch.batchMarkDone, { threadIds: [group._id] });
    expect((await list("failed")).page).toHaveLength(0);
    expect((await list("done")).page).toMatchObject([{ _id: group._id, isOwner: false, isDone: true }]);
  });

  test("all skips permission reads for projects outside the requested organization", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const outsideOrg = await ctx.organization(user._id, { slug: "other-cost" });
    await ctx.project(outsideOrg._id, user._id);
    const reads = vi.spyOn(accessRepo, "getOrgMembership");
    const memberships = vi.spyOn(accessRepo, "listProjectMembershipsForUser");
    try {
      await asUser.query(api.cli.threads.lists.listProjectWatchTower, {
        organizationSlug: org.slug, projectAlias: project.alias, scope: "all", section: "running",
        paginationOpts: { numItems: 25, cursor: null },
      });
      expect(memberships).not.toHaveBeenCalled();
      expect(reads).toHaveBeenCalledTimes(1);
      expect(reads.mock.calls.some(([, , orgId]) => orgId === org._id)).toBe(true);
      expect(reads.mock.calls.some(([, , orgId]) => orgId === outsideOrg._id)).toBe(false);
    } finally {
      reads.mockRestore();
      memberships.mockRestore();
    }
  });

  test("project mine paginates only owned rows in that project", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id);
    const teammate = await ctx.user();
    const expected = [];
    for (const target of [otherProject, project]) {
      for (const owner of [user, teammate]) {
        const profile = await ctx.cliProfile(owner._id, target._id);
        for (let i = 0; i < 3; i++) {
          const thread = await ctx.cliThread(owner._id, target._id, profile._id, { status: "completed" });
          if (target._id === project._id && owner._id === user._id) expected.push(thread._id);
        }
      }
    }
    const received = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page: PaginationResult<WatchTowerThreadItem> = await asUser.query(api.cli.threads.lists.listProjectWatchTower, {
        organizationSlug: org.slug, projectAlias: project.alias, scope: "mine", section: "needs_review",
        paginationOpts: { numItems: 2, cursor },
      });
      expect(page.page.every((row) => row.isOwner)).toBe(true);
      received.push(...page.page.map((row) => row._id));
      if (page.isDone) break;
      expect(page.page).toHaveLength(2);
      cursor = page.continueCursor;
    }
    expect(received).toHaveLength(expected.length);
    expect(new Set(received)).toEqual(new Set(expected));
  });
});

describe("listByAttachedPullRequest (docs/specs/github-integration.md → Pull requests in threads)", () => {
  const ATTACHED = { owner: "Contoso", name: "Convoy", number: 482, ref: "contoso/convoy#482" };

  test("lists the caller's threads and teammates' shared ones, newest activity first", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const other = await ctx.user({ name: "Teammate" });
    await ctx.projectMember(project._id, other._id, "member");
    const profile = await ctx.cliProfile(user._id, project._id);
    const otherProfile = await ctx.cliProfile(other._id, project._id);
    const mine = await ctx.cliThread(user._id, project._id, profile._id, { attachedPullRequest: ATTACHED, lastActivityAt: 1 });
    const shared = await ctx.cliThread(other._id, project._id, otherProfile._id, { attachedPullRequest: ATTACHED, sharedAt: 5, lastActivityAt: 2 });
    await ctx.cliThread(other._id, project._id, otherProfile._id, { attachedPullRequest: ATTACHED, lastActivityAt: 3 });
    await ctx.cliThread(user._id, project._id, profile._id, { attachedPullRequest: { ...ATTACHED, number: 475, ref: "contoso/convoy#475" } });
    await ctx.cliThread(user._id, project._id, profile._id, { attachedPullRequest: ATTACHED, isDeleted: true });

    const rows = await asUser.query(api.cli.threads.lists.listByAttachedPullRequest, {
      projectId: project._id, owner: "contoso", name: "CONVOY", number: 482,
    });

    expect(rows.map((row) => [row._id, row.ownerName])).toEqual([[shared._id, "Teammate"], [mine._id, undefined]]);
  });

  test("returns nothing to a caller without project access", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    await ctx.cliThread(user._id, project._id, profile._id, { attachedPullRequest: ATTACHED, sharedAt: 1 });
    const stranger = await ctx.user();

    expect(await ctx.asUser(stranger).query(api.cli.threads.lists.listByAttachedPullRequest, {
      projectId: project._id, owner: "contoso", name: "convoy", number: 482,
    })).toEqual([]);
  });
});
