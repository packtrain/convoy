/// <reference types="vite/client" />
import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext, gen } from "../../convex-testing";
import { ACTIVITY_COALESCE_WINDOW_MS } from "./lib/activity/coalesce";

describe("taskActivityLogs", () => {
  describe("logActivity", () => {
    test("should create activity log entry", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Call the internal mutation directly
      const logId = await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "created",
      });

      expect(logId).toBeDefined();

      // Verify the log was created
      await t.run(async (runCtx) => {
        const log = await runCtx.db.get("taskActivityLogs", logId);
        expect(log).toBeDefined();
        expect(log?.taskId).toBe(task._id);
        expect(log?.userId).toBe(user._id);
        expect(log?.eventType).toBe("created");
        expect(log?.createdAt).toBeDefined();
      });
    });

    test("should create activity log with status change details", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id, { status: "To Do" });

      const logId = await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "status_changed",
        changeDetails: {
          type: "status",
          oldValue: "To Do",
          newValue: "In Progress",
        },
      });

      await t.run(async (runCtx) => {
        const log = await runCtx.db.get("taskActivityLogs", logId);
        expect(log?.changeDetails).toEqual({
          type: "status",
          oldValue: "To Do",
          newValue: "In Progress",
        });
      });
    });

    test("should create activity log with assignee change details", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const logId = await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "assignee_changed",
        changeDetails: {
          type: "assignee",
          oldUserName: undefined,
          newUserId: user._id,
          newUserName: user.name,
        },
      });

      await t.run(async (runCtx) => {
        const log = await runCtx.db.get("taskActivityLogs", logId);
        expect(log?.changeDetails).toMatchObject({
          type: "assignee",
          newUserId: user._id,
          newUserName: user.name,
        });
      });
    });

    test("should create activity log with delegation change details (OS-1335)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        name: "Planner",
        description: "Plans tasks",
        prompt: "Plan the task.",
        category: "Engineering",
        appearance: { color: "#3b82f6" },
      });

      const logId = await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "delegation_changed",
        changeDetails: {
          type: "delegation",
          newAgentId: projectAgentId,
          newAgentName: "Planner",
        },
      });

      await t.run(async (runCtx) => {
        const log = await runCtx.db.get("taskActivityLogs", logId);
        expect(log?.eventType).toBe("delegation_changed");
        expect(log?.changeDetails).toMatchObject({
          type: "delegation",
          newAgentName: "Planner",
        });
      });
    });

    test("still accepts legacy agent-assignment activity values (pre-OS-1335 rows)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        name: "Planner",
        description: "Plans tasks",
        prompt: "Plan the task.",
        category: "Engineering",
        appearance: { color: "#3b82f6" },
      });

      const logId = await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "assignee_changed",
        changeDetails: {
          type: "assignee",
          newAssignee: {
            type: "projectAgent",
            projectAgentId,
            name: "Planner",
          },
        },
      });

      await t.run(async (runCtx) => {
        const log = await runCtx.db.get("taskActivityLogs", logId);
        expect(log?.changeDetails).toMatchObject({
          type: "assignee",
          newAssignee: { type: "projectAgent", name: "Planner" },
        });
      });
    });
  });

  describe("listByTask", () => {
    test("should return activities in descending order", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Create multiple activity logs
      await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "created",
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "status_changed",
        changeDetails: {
          type: "status",
          oldValue: "To Do",
          newValue: "In Progress",
        },
      });

      const result = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(2);
      // Newest first (descending order)
      expect(result.page[0].eventType).toBe("status_changed");
      expect(result.page[1].eventType).toBe("created");
    });

    test("should include user info in response", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "created",
      });

      const result = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0].userName).toBe(user.name);
    });

    test("should return empty for unauthorized user", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "created",
      });

      // Query without authentication
      const result = await t.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toEqual([]);
    });

    test("org member without project membership cannot view activity logs", async () => {
      const ctx = createTestContext();
      const { project, user, org, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Create activity log
      await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "created",
      });

      // Create another user who is an org member but NOT a project member
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      const asOtherUser = ctx.asUser(otherUser);

      // Org member without project membership should not see activity logs
      const result = await asOtherUser.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toEqual([]);
    });

    test("org admin sees activity logs only through a project membership (OS-1536)", async () => {
      const ctx = createTestContext();
      const { project, user, org, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Create activity log
      await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "created",
      });

      // Create an org admin (not a project member)
      const adminUser = await ctx.user();
      await ctx.orgMember(org._id, adminUser._id, "admin");
      const asAdmin = ctx.asUser(adminUser);
      const listAsAdmin = () =>
        asAdmin.query(api.tasks.activity.listByTask, {
          taskId: task._id,
          paginationOpts: { numItems: 10, cursor: null },
        });

      expect((await listAsAdmin()).page).toHaveLength(0);

      await ctx.projectMember(project._id, adminUser._id, "viewer");

      const result = await listAsAdmin();
      expect(result.page).toHaveLength(1);
      expect(result.page[0].eventType).toBe("created");
    });

    test("project viewer can view activity logs", async () => {
      const ctx = createTestContext();
      const { project, user, org, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Create activity log
      await t.mutation(internal.tasks.activity.logActivity, {
        taskId: task._id,
        userId: user._id,
        eventType: "created",
      });

      // Create a project viewer
      const viewerUser = await ctx.user();
      await ctx.orgMember(org._id, viewerUser._id, "member");
      await ctx.projectMember(project._id, viewerUser._id, "viewer");
      const asViewer = ctx.asUser(viewerUser);

      // Project viewer should be able to view activity logs
      const result = await asViewer.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0].eventType).toBe("created");
    });

    test("should paginate correctly", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Seed 5 rows directly: this test is about paging, and `logActivity` would
      // coalesce same-user `name_edited` repeats into one row (see below).
      await t.run(async (runCtx) => {
        for (let i = 0; i < 5; i++) {
          await runCtx.db.insert("taskActivityLogs", {
            taskId: task._id,
            userId: user._id,
            eventType: "name_edited",
            changeDetails: { type: "name", oldValue: `Name ${i}`, newValue: `Name ${i + 1}` },
            createdAt: Date.now() + i,
          });
        }
      });

      // First page with numItems of 2
      const page1 = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 2, cursor: null },
      });

      expect(page1.page).toHaveLength(2);
      expect(page1.isDone).toBe(false);
      expect(page1.continueCursor).toBeDefined();

      // Second page
      const page2 = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 2, cursor: page1.continueCursor },
      });

      expect(page2.page).toHaveLength(2);
      expect(page2.isDone).toBe(false);

      // Third page (last)
      const page3 = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 2, cursor: page2.continueCursor },
      });

      expect(page3.page).toHaveLength(1);
      expect(page3.isDone).toBe(true);
    });
  });

  describe("integration with task mutations", () => {
    test("should log activity when task is created", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      // Create a task through the mutation
      const { taskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Test task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
      });

      // Wait for scheduled activity log to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await asUser.query(api.tasks.activity.listByTask, {
        taskId,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page.length).toBeGreaterThanOrEqual(1);
      expect(result.page.some((log) => log.eventType === "created")).toBe(true);
    });

    test("should log activity when task status is updated", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id, { status: "To Do" });

      // Update status through the mutation
      await asUser.mutation(api.tasks.core.update, {
        id: task._id,
        status: "In Progress",
      });

      // Wait for scheduled activity log to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      const statusLog = result.page.find((log) => log.eventType === "status_changed");
      expect(statusLog).toBeDefined();
      expect(statusLog?.changeDetails).toEqual({
        type: "status",
        oldValue: "To Do",
        newValue: "In Progress",
      });
    });

    test("should log activity when task is deleted", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Delete through the mutation
      await asUser.mutation(api.tasks.core.remove, {
        id: task._id,
      });

      // Wait for scheduled activity log to be created
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Query activity logs directly from the database since the task is deleted
      let foundDeleteLog = false;
      await t.run(async (runCtx) => {
        const logs = await runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", task._id))
          .collect();
        foundDeleteLog = logs.some((log) => log.eventType === "deleted");
      });

      expect(foundDeleteLog).toBe(true);
    });
  });

  // OS-1668: the description editor autosaves on a debounce, so one paragraph
  // used to write a row per typing pause.
  describe("coalescing", () => {
    // Fake timers throughout: `finishAllScheduledFunctions` drives the scheduler
    // through `vi.runAllTimers`, and the window test moves the clock.
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Every activity row for a task, in insertion order. */
    async function logsFor(t: ReturnType<typeof createTestContext>["t"], taskId: string) {
      // `by_task` is (taskId, _creationTime), so this is already insertion order —
      // which matters here because a burst's rows can share a `createdAt`.
      return t.run(async (runCtx) =>
        runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId as never))
          .collect()
      );
    }

    test("repeated description edits by one user collapse into a single row", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      for (const description of ["a", "ab", "abc", "abcd"]) {
        await asUser.mutation(api.tasks.core.update, { id: task._id, description });
      }
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const logs = await logsFor(t, task._id);
      const descriptionLogs = logs.filter((log) => log.eventType === "description_edited");
      expect(descriptionLogs).toHaveLength(1);
      // Nothing reads a before/after description, so the row carries no payload.
      expect(descriptionLogs[0].changeDetails).toBeUndefined();
    });

    test("an interleaved event ends the burst, so editing after it logs again", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await asUser.mutation(api.tasks.core.update, { id: task._id, description: "first" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      await asUser.mutation(api.tasks.core.update, { id: task._id, status: "In Progress" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      await asUser.mutation(api.tasks.core.update, { id: task._id, description: "second" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const logs = await logsFor(t, task._id);
      expect(logs.map((log) => log.eventType)).toEqual([
        "description_edited",
        "status_changed",
        "description_edited",
      ]);
    });

    test("a second user's edit gets its own row", async () => {
      const ctx = createTestContext();
      const { org, project, user, asUser, t } = await ctx.setupProject();
      const other = await ctx.user();
      await ctx.orgMember(org._id, other._id, "member");
      await ctx.projectMember(project._id, other._id, "member");
      const task = await ctx.task(project._id, user._id);

      await asUser.mutation(api.tasks.core.update, { id: task._id, description: "mine" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      await ctx.asUser(other).mutation(api.tasks.core.update, { id: task._id, description: "theirs" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const logs = await logsFor(t, task._id);
      expect(logs.filter((log) => log.eventType === "description_edited")).toHaveLength(2);
    });

    test("an edit after the window logs a new row, anchored at the burst start", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await asUser.mutation(api.tasks.core.update, { id: task._id, description: "early" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const [firstRow] = (await logsFor(t, task._id)).filter(
        (log) => log.eventType === "description_edited"
      );

      vi.setSystemTime(Date.now() + ACTIVITY_COALESCE_WINDOW_MS + 1);
      await asUser.mutation(api.tasks.core.update, { id: task._id, description: "late" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const descriptionLogs = (await logsFor(t, task._id)).filter(
        (log) => log.eventType === "description_edited"
      );
      expect(descriptionLogs).toHaveLength(2);
      // The kept row never moves: bumping createdAt would reorder it under the
      // timeline's (createdAt, _creationTime) cursor.
      expect(descriptionLogs[0].createdAt).toBe(firstRow.createdAt);
    });

    test("name edits coalesce the same way", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      for (const name of ["Re", "Ren", "Rena", "Renamed"]) {
        await asUser.mutation(api.tasks.core.update, { id: task._id, name });
      }
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const logs = await logsFor(t, task._id);
      expect(logs.filter((log) => log.eventType === "name_edited")).toHaveLength(1);
    });

    test("repeated edits to one artifact collapse, keeping the file name", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "one",
      });
      for (const content of ["two", "three", "four"]) {
        await asUser.mutation(api.tasks.artifacts.updateTaskArtifact, { artifactId, content });
      }
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const logs = await logsFor(t, task._id);
      const updateLogs = logs.filter((log) => log.eventType === "artifact_updated");
      expect(updateLogs).toHaveLength(1);
      // The name is rendered ("updated artifact \"plan.md\""), so it must survive.
      expect(updateLogs[0].changeDetails).toEqual({ type: "artifact", fileName: "plan.md" });
    });

    test("edits to two artifacts stay separate rows", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const [planId, designId] = [
        await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
          taskId: task._id,
          name: "Plan",
          content: "one",
        }),
        await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
          taskId: task._id,
          name: "Design",
          content: "one",
        }),
      ];

      // Interleaved, so a subject-blind key would collapse all four into one row
      // reading only "plan.md". Drained per mutation because same-tick
      // `runAfter(0)` jobs have no guaranteed order among themselves.
      for (const content of ["two", "three"]) {
        for (const artifactId of [planId, designId]) {
          await asUser.mutation(api.tasks.artifacts.updateTaskArtifact, { artifactId, content });
          await t.finishAllScheduledFunctions(() => vi.runAllTimers());
        }
      }

      const logs = await logsFor(t, task._id);
      const fileNames = logs
        .filter((log) => log.eventType === "artifact_updated")
        .map((log) => (log.changeDetails?.type === "artifact" ? log.changeDetails.fileName : null));
      expect(fileNames).toEqual(["plan.md", "design.md", "plan.md", "design.md"]);
    });

    test("a rename ends the burst, because the row's file name changes", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "one",
      });
      // Drain between mutations: under frozen fake timers every `runAfter(0)` log
      // job shares a `scheduledTime`, and draining a batch does not preserve
      // insertion order among ties.
      await asUser.mutation(api.tasks.artifacts.updateTaskArtifact, { artifactId, content: "two" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      await asUser.mutation(api.tasks.artifacts.updateTaskArtifact, { artifactId, name: "Roadmap" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const logs = await logsFor(t, task._id);
      const fileNames = logs
        .filter((log) => log.eventType === "artifact_updated")
        .map((log) => (log.changeDetails?.type === "artifact" ? log.changeDetails.fileName : null));
      // Coalescing onto the old name would show a file that no longer exists.
      expect(fileNames).toEqual(["plan.md", "roadmap.md"]);
    });

    test("value-carrying events are never coalesced", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id, { status: "To Do" });

      await asUser.mutation(api.tasks.core.update, { id: task._id, status: "In Progress" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      await asUser.mutation(api.tasks.core.update, { id: task._id, status: "Done" });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const logs = await logsFor(t, task._id);
      const statusLogs = logs.filter((log) => log.eventType === "status_changed");
      // Collapsing these would lose the To Do -> In Progress transition entirely.
      expect(statusLogs).toHaveLength(2);
    });
  });
});
