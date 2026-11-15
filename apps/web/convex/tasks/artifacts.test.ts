/// <reference types="vite/client" />
import { describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";


describe("taskArtifacts", () => {
  describe("listTaskArtifactsByTask", () => {
    test("returns empty for task without artifacts", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const artifacts = await asUser.query(api.tasks.artifacts.listTaskArtifactsByTask, {
        taskId: task._id,
      });

      expect(artifacts).toEqual([]);
    });

    test("returns empty for unauthenticated callers", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const artifacts = await t.query(api.tasks.artifacts.listTaskArtifactsByTask, {
        taskId: task._id,
      });

      expect(artifacts).toEqual([]);
    });

    test("returns empty for org member without project membership", async () => {
      const ctx = createTestContext();
      const { project, user, org, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "# Plan",
      });

      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      const asOtherUser = ctx.asUser(otherUser);

      const artifacts = await asOtherUser.query(api.tasks.artifacts.listTaskArtifactsByTask, {
        taskId: task._id,
      });

      expect(artifacts).toEqual([]);
    });
  });

  describe("createTaskArtifact", () => {
    test("creates artifact and auto-generates unique .md filenames", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const firstId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Implementation Plan",
        content: "# Plan A",
      });

      const secondId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Implementation Plan",
        content: "# Plan B",
      });

      const first = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId: firstId });
      const second = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId: secondId });

      expect(first?.fileName).toBe("implementation-plan.md");
      expect(second?.fileName).toBe("implementation-plan-2.md");
      expect(first?.source).toBe("user");
      expect(first?.contentType).toBeUndefined();
    });

    test("creates html artifacts with .html filenames and stored contentType", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const firstId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Dashboard Preview",
        content: "<!doctype html><html><body>A</body></html>",
        contentType: "html",
      });

      const secondId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Dashboard Preview",
        content: "<!doctype html><html><body>B</body></html>",
        contentType: "html",
      });

      const first = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId: firstId });
      const second = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId: secondId });

      expect(first?.fileName).toBe("dashboard-preview.html");
      expect(second?.fileName).toBe("dashboard-preview-2.html");
      expect(first?.contentType).toBe("html");
    });

    test("html and markdown artifacts with the same name do not collide on fileName", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const markdownId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Report",
        contentType: "markdown",
      });
      const htmlId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Report",
        contentType: "html",
      });

      const markdown = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId: markdownId });
      const html = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId: htmlId });

      expect(markdown?.fileName).toBe("report.md");
      expect(html?.fileName).toBe("report.html");
    });

    test("stores source=agent when authenticated via apiKey", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Artifact Agent",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      const artifactId = await t.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Agent Review",
        content: "Looks good",
        runId: "run_123",
        apiKey: key,
      });

      const artifact = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId });
      expect(artifact?.source).toBe("agent");
      expect(artifact?.runId).toBe("run_123");
    });

    test("hides out-of-scope artifacts from API key reads", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const otherTask = await ctx.task(otherProject._id, user._id);
      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: otherTask._id,
        name: "Out of scope",
        content: "hidden",
      });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const artifacts = await t.query(api.tasks.artifacts.listTaskArtifactsByTask, {
        taskId: otherTask._id,
        apiKey: key,
      });
      const artifact = await t.query(api.tasks.artifacts.getTaskArtifact, {
        artifactId,
        apiKey: key,
      });
      const safeArtifact = await t.query(api.tasks.artifacts.getTaskArtifactSafe, {
        artifactId,
        apiKey: key,
      });

      expect(artifacts).toEqual([]);
      expect(artifact).toBeNull();
      expect(safeArtifact).toBeNull();
    });

    test("rejects out-of-scope artifact writes via API key", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const otherTask = await ctx.task(otherProject._id, user._id);
      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: otherTask._id,
        name: "Out of scope",
        content: "alpha beta",
      });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      await expect(
        t.mutation(api.tasks.artifacts.createTaskArtifact, {
          taskId: otherTask._id,
          name: "Blocked",
          content: "blocked",
          apiKey: key,
        })
      ).rejects.toThrow("Permission denied");

      await expect(
        t.mutation(api.tasks.artifacts.updateTaskArtifact, {
          artifactId,
          content: "changed",
          apiKey: key,
        })
      ).rejects.toThrow("Permission denied");

      await expect(
        t.mutation(api.tasks.artifacts.replaceInTaskArtifact, {
          artifactId,
          oldString: "alpha",
          newString: "gamma",
          apiKey: key,
        })
      ).rejects.toThrow("Permission denied");

      await expect(
        t.mutation(api.tasks.artifacts.deleteTaskArtifact, {
          artifactId,
          apiKey: key,
        })
      ).rejects.toThrow("Permission denied");
    });

    test("rejects viewer writes", async () => {
      const ctx = createTestContext();
      const { project, user, org } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const viewer = await ctx.user();
      await ctx.orgMember(org._id, viewer._id, "member");
      await ctx.projectMember(project._id, viewer._id, "viewer");
      const asViewer = ctx.asUser(viewer);

      await expect(
        asViewer.mutation(api.tasks.artifacts.createTaskArtifact, {
          taskId: task._id,
          name: "Viewer should fail",
        })
      ).rejects.toThrow();
    });
  });

  describe("updateTaskArtifact and deleteTaskArtifact", () => {
    test("updates artifact name/content and supports delete", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Initial Name",
        content: "Old content",
      });

      await asUser.mutation(api.tasks.artifacts.updateTaskArtifact, {
        artifactId,
        name: "Updated Name",
        content: "New content",
      });

      const updated = await asUser.query(api.tasks.artifacts.getTaskArtifact, {
        artifactId,
      });

      expect(updated?.name).toBe("Updated Name");
      expect(updated?.fileName).toBe("updated-name.md");
      expect(updated?.content).toBe("New content");

      await asUser.mutation(api.tasks.artifacts.deleteTaskArtifact, { artifactId });

      const deleted = await asUser.query(api.tasks.artifacts.getTaskArtifact, {
        artifactId,
      });
      expect(deleted).toBeNull();
    });

    test("renaming an html artifact keeps the .html extension and contentType", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Preview",
        content: "<p>hello</p>",
        contentType: "html",
      });

      await asUser.mutation(api.tasks.artifacts.updateTaskArtifact, {
        artifactId,
        name: "Renamed Preview",
      });

      const updated = await asUser.query(api.tasks.artifacts.getTaskArtifact, {
        artifactId,
      });

      expect(updated?.fileName).toBe("renamed-preview.html");
      expect(updated?.contentType).toBe("html");
    });

    test("supports clearing runId with null", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Artifact Agent",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      const artifactId = await t.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Agent Review",
        runId: "run_123",
        apiKey: key,
      });

      await asUser.mutation(api.tasks.artifacts.updateTaskArtifact, {
        artifactId,
        runId: null,
      });

      const updated = await asUser.query(api.tasks.artifacts.getTaskArtifact, {
        artifactId,
      });
      expect(updated?.runId).toBeUndefined();
    });

    test("allows update with only artifactId and refreshes updatedAt", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const ctx = createTestContext();
        const { project, user, asUser } = await ctx.setupProject();
        const task = await ctx.task(project._id, user._id);

        const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
          taskId: task._id,
          name: "Initial",
          content: "Content",
        });
        const before = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId });

        vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
        await asUser.mutation(api.tasks.artifacts.updateTaskArtifact, {
          artifactId,
        });
        const after = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId });

        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        if (!before || !after) {
          throw new Error("Expected artifact to exist before and after update");
        }
        expect(after.name).toBe(before.name);
        expect(after.content).toBe(before.content);
        expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("replaceInTaskArtifact", () => {
    test("replaces exactly one matching string and logs artifact_updated", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Activity logging is scheduled (runAfter(0)) via logTaskActivity, so use
      // fake timers (active while the mutation schedules) and drain the
      // scheduled mutation before asserting on the log.
      vi.useFakeTimers();
      try {
        const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
          taskId: task._id,
          name: "Plan",
          content: "alpha beta gamma",
        });

        await asUser.mutation(api.tasks.artifacts.replaceInTaskArtifact, {
          artifactId,
          oldString: "beta",
          newString: "delta",
        }).then((result) => expect(result).toEqual({ ok: true }));

        const updated = await asUser.query(api.tasks.artifacts.getTaskArtifact, {
          artifactId,
        });
        expect(updated?.content).toBe("alpha delta gamma");

        await t.finishAllScheduledFunctions(vi.runAllTimers);

        const logs = await asUser.query(api.tasks.activity.listByTask, {
          taskId: task._id,
          paginationOpts: { numItems: 10, cursor: null },
        });
        const updateLog = logs.page.find((log) => log.eventType === "artifact_updated");
        expect(updateLog?.changeDetails).toEqual({
          type: "artifact",
          fileName: "plan.md",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    test("treats replacement strings containing dollar patterns as literal content", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "cost is OLD today",
      });

      await asUser.mutation(api.tasks.artifacts.replaceInTaskArtifact, {
        artifactId,
        oldString: "OLD",
        newString: "$& $$ $1",
      }).then((result) => expect(result).toEqual({ ok: true }));

      const updated = await asUser.query(api.tasks.artifacts.getTaskArtifact, {
        artifactId,
      });
      expect(updated?.content).toBe("cost is $& $$ $1 today");
    });

    test("replaces every matching string when replaceAll is true", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "one fish, two fish",
      });

      await asUser.mutation(api.tasks.artifacts.replaceInTaskArtifact, {
        artifactId,
        oldString: "fish",
        newString: "cat",
        replaceAll: true,
      }).then((result) => expect(result).toEqual({ ok: true }));

      const updated = await asUser.query(api.tasks.artifacts.getTaskArtifact, {
        artifactId,
      });
      expect(updated?.content).toBe("one cat, two cat");
    });

    test("returns structured failures for zero matches and multiple matches without replaceAll", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "same same",
      });

      const missingResult = await asUser.mutation(
        api.tasks.artifacts.replaceInTaskArtifact,
        {
          artifactId,
          oldString: "missing",
          newString: "found",
        }
      );
      const multipleResult = await asUser.mutation(
        api.tasks.artifacts.replaceInTaskArtifact,
        {
          artifactId,
          oldString: "same",
          newString: "different",
        }
      );
      const artifact = await asUser.query(api.tasks.artifacts.getTaskArtifact, {
        artifactId,
      });

      expect(missingResult).toEqual({
        ok: false,
        code: "old_string_not_found",
        message: "oldString was not found in artifact content",
      });
      expect(multipleResult).toEqual({
        ok: false,
        code: "multiple_matches",
        message:
          "oldString matches multiple locations; pass replaceAll to replace every occurrence",
      });
      expect(artifact?.content).toBe("same same");
    });

    test("rejects empty oldString and content over the artifact cap", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: `${"a".repeat(199_999)}b`,
      });

      await expect(
        asUser.mutation(api.tasks.artifacts.replaceInTaskArtifact, {
          artifactId,
          oldString: "",
          newString: "x",
        })
      ).rejects.toThrow(/oldString/);

      await expect(
        asUser.mutation(api.tasks.artifacts.replaceInTaskArtifact, {
          artifactId,
          oldString: "b",
          newString: "cc",
        })
      ).rejects.toThrow(/at most 200000/);
    });

    test("rejects viewer writes", async () => {
      const ctx = createTestContext();
      const { project, user, org, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "Initial",
      });

      const viewer = await ctx.user();
      await ctx.orgMember(org._id, viewer._id, "member");
      await ctx.projectMember(project._id, viewer._id, "viewer");
      const asViewer = ctx.asUser(viewer);

      await expect(
        asViewer.mutation(api.tasks.artifacts.replaceInTaskArtifact, {
          artifactId,
          oldString: "Initial",
          newString: "Updated",
        })
      ).rejects.toThrow();
    });
  });
  describe("artifactCount (OS-882)", () => {
    test("create increments the counter and delete decrements it clamped at zero", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const firstId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan A",
        content: "# A",
      });
      await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan B",
        content: "# B",
      });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.artifactCount).toBe(2);
      });

      await asUser.mutation(api.tasks.artifacts.deleteTaskArtifact, { artifactId: firstId });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.artifactCount).toBe(1);
      });

      // Force a stale-zero counter: deleting must clamp, not go negative
      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", task._id, { artifactCount: 0 });
      });
      const artifacts = await asUser.query(api.tasks.artifacts.listTaskArtifactsByTask, {
        taskId: task._id,
      });
      await asUser.mutation(api.tasks.artifacts.deleteTaskArtifact, {
        artifactId: artifacts[0]._id,
      });
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.artifactCount).toBe(0);
      });
    });

    test("create/delete do not bump the task's updatedAt and listByProject returns artifactCount", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "# Plan",
      });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.updatedAt).toBe(task.updatedAt);
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, { projectId: project._id });
      expect(tasks.find((item) => item._id === task._id)?.artifactCount).toBe(1);
    });
  });

  describe("moveTaskArtifact", () => {
    test("moves the artifact, reallocates a colliding fileName, and adjusts both counters", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const target = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: source._id,
        name: "Plan",
        content: "# Plan",
      });
      // Same name already on the target: fileName is unique per task, so the
      // move must reallocate.
      await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: target._id,
        name: "Plan",
        content: "# Other plan",
      });

      await asUser.mutation(api.tasks.artifacts.moveTaskArtifact, {
        artifactId,
        taskId: target._id,
      });

      const artifact = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId });
      expect(artifact?.taskId).toBe(target._id);
      expect(artifact?.fileName).toBe("plan-2.md");
      expect(artifact?.name).toBe("Plan");

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", source._id))?.artifactCount).toBe(0);
        expect((await runCtx.db.get("tasks", target._id))?.artifactCount).toBe(2);
        // Counters must not reorder updatedAt-sorted views.
        expect((await runCtx.db.get("tasks", target._id))?.updatedAt).toBe(target.updatedAt);
      });

      expect(
        await asUser.query(api.tasks.artifacts.listTaskArtifactsByTask, { taskId: source._id })
      ).toEqual([]);
    });

    test("re-anchors the artifact's comments to the target task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const target = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: source._id,
        name: "Plan",
        content: "# Plan\n\nfindings here",
      });
      await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Check this",
        anchorText: "findings",
      });

      await asUser.mutation(api.tasks.artifacts.moveTaskArtifact, {
        artifactId,
        taskId: target._id,
      });

      await t.run(async (runCtx) => {
        const comments = await runCtx.db
          .query("artifactComments")
          .withIndex("by_artifact_and_createdAt", (q) => q.eq("artifactId", artifactId))
          .collect();
        expect(comments).toHaveLength(1);
        expect(comments[0].taskId).toBe(target._id);
      });
    });

    // A partial re-anchor is an access bug, not a slow read: `taskId` is the
    // permission anchor, and MAX_COMMENTS_PER_ARTIFACT caps one list query, not
    // the stored rows. So the move must cover every comment.
    test("re-anchors comments past the artifact-comments list cap", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const target = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: source._id,
        name: "Plan",
        content: "# Plan",
      });
      const overCap = 1001;
      await t.run(async (runCtx) => {
        for (let index = 0; index < overCap; index += 1) {
          await runCtx.db.insert("artifactComments", {
            artifactId,
            taskId: source._id,
            authorId: user._id,
            content: `Comment ${index}`,
            status: "open",
            createdAt: index,
            updatedAt: index,
            isEdited: false,
          });
        }
      });

      await asUser.mutation(api.tasks.artifacts.moveTaskArtifact, {
        artifactId,
        taskId: target._id,
      });

      await t.run(async (runCtx) => {
        const comments = await runCtx.db
          .query("artifactComments")
          .withIndex("by_artifact_and_createdAt", (q) => q.eq("artifactId", artifactId))
          .collect();
        expect(comments).toHaveLength(overCap);
        expect(comments.every((comment) => comment.taskId === target._id)).toBe(true);
      });
    });

    test("no-ops when the artifact already belongs to the target task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Plan",
        content: "# Plan",
      });

      await asUser.mutation(api.tasks.artifacts.moveTaskArtifact, {
        artifactId,
        taskId: task._id,
      });

      const artifact = await asUser.query(api.tasks.artifacts.getTaskArtifact, { artifactId });
      expect(artifact?.fileName).toBe("plan.md");
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.artifactCount).toBe(1);
      });
    });

    test("rejects a target task in another project", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const otherProject = await ctx.project(org._id, user._id);
      const target = await ctx.task(otherProject._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: source._id,
        name: "Plan",
        content: "# Plan",
      });

      await expect(
        asUser.mutation(api.tasks.artifacts.moveTaskArtifact, {
          artifactId,
          taskId: target._id,
        })
      ).rejects.toThrow("Tasks must be in the same project");
    });

    test("rejects a viewer without TASK_UPDATE", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const target = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: source._id,
        name: "Plan",
        content: "# Plan",
      });

      const viewer = await ctx.user();
      await ctx.orgMember(org._id, viewer._id, "member");
      await ctx.projectMember(project._id, viewer._id, "viewer");

      await expect(
        ctx.asUser(viewer).mutation(api.tasks.artifacts.moveTaskArtifact, {
          artifactId,
          taskId: target._id,
        })
      ).rejects.toThrow("Permission denied: task:update");
    });

    test("rejects a deleted target task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const target = await ctx.task(project._id, user._id);

      const artifactId = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: source._id,
        name: "Plan",
        content: "# Plan",
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", target._id, { isDeleted: true });
      });

      await expect(
        asUser.mutation(api.tasks.artifacts.moveTaskArtifact, {
          artifactId,
          taskId: target._id,
        })
      ).rejects.toThrow("Task not found");
    });
  });
});
