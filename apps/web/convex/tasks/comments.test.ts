/// <reference types="vite/client" />
import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { buildUser, buildOrgMember, buildProjectMember } from "../../convex-testing/builders";
import { listByTask } from "./comments";
import type { Id } from "../_generated/dataModel";
import { errors } from "./errors";

function exportReturns(definition: unknown): string {
  if (typeof definition !== "function" || !("exportReturns" in definition) || typeof definition.exportReturns !== "function") {
    throw new Error("Convex function definition does not expose exportReturns");
  }
  return definition.exportReturns();
}

describe("taskComments", () => {
  test("listByTask returns validator includes Convex pagination metadata fields", () => {
    const returnsSchema = exportReturns(listByTask);
    expect(returnsSchema).toContain('"continueCursor"');
    expect(returnsSchema).toContain('"pageStatus"');
    expect(returnsSchema).toContain('"splitCursor"');
  });

  describe("listByTask", () => {
    test("should return empty page for task without comments", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toEqual([]);
      expect(result.isDone).toBe(true);
    });

    test("should return comments with author info", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      await ctx.comment(task._id, user._id, {
        content: "Test comment",
      });

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0].content).toBe("Test comment");
      expect(result.page[0].authorName).toBe(user.name);
      expect(result.page[0].canEdit).toBe(true);
      expect(result.page[0].canDelete).toBe(true);
    });

    test("should return comments in descending order (newest first)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Create comments with different timestamps
      await t.run(async (runCtx) => {
        await runCtx.db.insert("taskComments", {
          taskId: task._id,
          authorId: user._id,
          content: "First",
          createdAt: 1000,
          updatedAt: 1000,
          isEdited: false,
        });
        await runCtx.db.insert("taskComments", {
          taskId: task._id,
          authorId: user._id,
          content: "Second",
          createdAt: 2000,
          updatedAt: 2000,
          isEdited: false,
        });
      });

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page[0].content).toBe("Second");
      expect(result.page[1].content).toBe("First");
    });

    test("should return empty for non-org-member", async () => {
      const ctx = createTestContext();
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      await ctx.comment(task._id, user._id);

      const { asUser: asOtherUser } = await ctx.setupUser();

      const result = await asOtherUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toEqual([]);
    });

    test("should return empty for deleted task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      await ctx.comment(task._id, user._id);

      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", task._id, { isDeleted: true });
      });

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toEqual([]);
    });

    test("canEdit should be false for other users' comments", async () => {
      const ctx = createTestContext();
      const { project, user, org, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Create another user in the org and project
      let otherUser!: Awaited<ReturnType<typeof buildUser>>;
      await t.run(async (runCtx) => {
        otherUser = await buildUser(runCtx.db);
        await buildOrgMember(runCtx.db, org._id, otherUser._id, "member");
        await buildProjectMember(runCtx.db, project._id, otherUser._id, "member");
      });

      // First user creates a comment
      await ctx.comment(task._id, user._id, { content: "User 1 comment" });

      // Other user queries
      const asOtherUser = ctx.t.withIdentity({
        tokenIdentifier: otherUser.tokenIdentifier,
        email: otherUser.email,
      });

      const result = await asOtherUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page[0].canEdit).toBe(false);
      expect(result.page[0].canDelete).toBe(false);
    });

    test("project admin can delete any comment", async () => {
      const ctx = createTestContext();
      const { project, user, org, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // `comment:delete_any` is project-level, so the project row grants it (OS-1536).
      let adminUser!: Awaited<ReturnType<typeof buildUser>>;
      await t.run(async (runCtx) => {
        adminUser = await buildUser(runCtx.db);
        await buildOrgMember(runCtx.db, org._id, adminUser._id, "admin");
      });
      await ctx.projectMember(project._id, adminUser._id, "project-admin");

      // First user creates a comment
      await ctx.comment(task._id, user._id, { content: "User comment" });

      // Admin queries
      const asAdmin = ctx.t.withIdentity({
        tokenIdentifier: adminUser.tokenIdentifier,
        email: adminUser.email,
      });

      const result = await asAdmin.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page[0].canEdit).toBe(false); // Admin can't edit others' comments
      expect(result.page[0].canDelete).toBe(true); // Admin can delete any comment
    });

    test("should list comments when authenticated via apiKey", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      await ctx.comment(task._id, user._id, {
        content: "Comment from API key",
      });

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Comments MCP",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      const result = await t.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
        apiKey: key,
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0].content).toBe("Comment from API key");
    });

    test("returns empty for an out-of-scope API key task", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const otherTask = await ctx.task(otherProject._id, user._id);
      await ctx.comment(otherTask._id, user._id, {
        content: "Out of scope",
      });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const result = await t.query(api.tasks.comments.listByTask, {
        taskId: otherTask._id,
        paginationOpts: { numItems: 10, cursor: null },
        apiKey: key,
      });

      expect(result.page).toEqual([]);
    });

    test("should return empty for invalid apiKey", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      await ctx.comment(task._id, user._id, {
        content: "Comment from API key",
      });

      const result = await t.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
        apiKey: "sk_user_invalid_key_12345",
      });

      expect(result.page).toEqual([]);
    });
  });

  describe("create", () => {
    test("should create a comment", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const commentId = await asUser.mutation(api.tasks.comments.create, {
        taskId: task._id,
        content: "New comment",
      });

      expect(commentId).toBeDefined();

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0].content).toBe("New comment");
      expect(result.page[0].isEdited).toBe(false);
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await expect(
        t.mutation(api.tasks.comments.create, {
          taskId: task._id,
          content: "Test",
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("should throw for deleted task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", task._id, { isDeleted: true });
      });

      await expect(
        asUser.mutation(api.tasks.comments.create, {
          taskId: task._id,
          content: "Test",
        })
      ).rejects.toThrow("Task not found");
    });

    test("should throw for non-org-member", async () => {
      const ctx = createTestContext();
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const { asUser: asOtherUser } = await ctx.setupUser();

      await expect(
        asOtherUser.mutation(api.tasks.comments.create, {
          taskId: task._id,
          content: "Test",
        })
      ).rejects.toThrow("Not a member of this organization");
    });

    test("should create a comment when authenticated via apiKey", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Comments API key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      const commentId = await t.mutation(api.tasks.comments.create, {
        taskId: task._id,
        content: "Created via API key",
        apiKey: key,
      });

      expect(commentId).toBeDefined();

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0].content).toBe("Created via API key");
    });

    test("should reject apiKey user without project access", async () => {
      const ctx = createTestContext();
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const { asUser: asOtherUser, t } = await ctx.setupUser();

      const { key } = await asOtherUser.mutation(api.apiKeys.core.create, {
        name: "Other User Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      await expect(
        t.mutation(api.tasks.comments.create, {
          taskId: task._id,
          content: "Should fail",
          apiKey: key,
        })
      ).rejects.toThrow("Not a member of this organization");
    });

    test("rejects an API key scoped away from the task project", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const otherTask = await ctx.task(otherProject._id, user._id);
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      await expect(
        t.mutation(api.tasks.comments.create, {
          taskId: otherTask._id,
          content: "Should fail",
          apiKey: key,
        })
      ).rejects.toThrow("Permission denied");
    });
  });

  describe("update", () => {
    test("should update comment content and set isEdited", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const comment = await ctx.comment(task._id, user._id, {
        content: "Original",
      });

      await asUser.mutation(api.tasks.comments.update, {
        commentId: comment._id,
        content: "Updated",
      });

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page[0].content).toBe("Updated");
      expect(result.page[0].isEdited).toBe(true);
    });

    test("should throw when editing other users comment", async () => {
      const ctx = createTestContext();
      const { project, user, org, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const comment = await ctx.comment(task._id, user._id);

      let otherUser!: Awaited<ReturnType<typeof buildUser>>;
      await t.run(async (runCtx) => {
        otherUser = await buildUser(runCtx.db);
        await buildOrgMember(runCtx.db, org._id, otherUser._id, "member");
        await buildProjectMember(runCtx.db, project._id, otherUser._id, "member");
      });

      const asOtherUser = ctx.t.withIdentity({
        tokenIdentifier: otherUser.tokenIdentifier,
        email: otherUser.email,
      });

      await expect(
        asOtherUser.mutation(api.tasks.comments.update, {
          commentId: comment._id,
          content: "Hacked",
        })
      ).rejects.toThrow("Only the comment author can edit");
    });

    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const comment = await ctx.comment(task._id, user._id);

      await expect(
        t.mutation(api.tasks.comments.update, {
          commentId: comment._id,
          content: "Test",
        })
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("remove", () => {
    test("author can delete own comment", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const comment = await ctx.comment(task._id, user._id);

      await asUser.mutation(api.tasks.comments.remove, {
        commentId: comment._id,
      });

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(0);
    });

    test("project admin can delete any comment", async () => {
      const ctx = createTestContext();
      const { project, user, org, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const comment = await ctx.comment(task._id, user._id);

      let adminUser!: Awaited<ReturnType<typeof buildUser>>;
      await t.run(async (runCtx) => {
        adminUser = await buildUser(runCtx.db);
        await buildOrgMember(runCtx.db, org._id, adminUser._id, "admin");
      });
      await ctx.projectMember(project._id, adminUser._id, "project-admin");

      const asAdmin = ctx.t.withIdentity({
        tokenIdentifier: adminUser.tokenIdentifier,
        email: adminUser.email,
      });

      await asAdmin.mutation(api.tasks.comments.remove, {
        commentId: comment._id,
      });

      const result = await asAdmin.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(0);
    });

    test("regular member cannot delete others comments", async () => {
      const ctx = createTestContext();
      const { project, user, org, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const comment = await ctx.comment(task._id, user._id);

      let otherUser!: Awaited<ReturnType<typeof buildUser>>;
      await t.run(async (runCtx) => {
        otherUser = await buildUser(runCtx.db);
        await buildOrgMember(runCtx.db, org._id, otherUser._id, "member");
        await buildProjectMember(runCtx.db, project._id, otherUser._id, "member");
      });

      const asOtherUser = ctx.t.withIdentity({
        tokenIdentifier: otherUser.tokenIdentifier,
        email: otherUser.email,
      });

      await expect(
        asOtherUser.mutation(api.tasks.comments.remove, {
          commentId: comment._id,
        })
      ).rejects.toThrow("Permission denied");
    });

    test("should be idempotent for already deleted comment", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const comment = await ctx.comment(task._id, user._id);

      // Delete directly
      await t.run(async (runCtx) => {
        await runCtx.db.delete("taskComments", comment._id);
      });

      // Should not throw
      await asUser.mutation(api.tasks.comments.remove, {
        commentId: comment._id,
      });
    });
  });

  describe("generateUploadUrl", () => {
    test("should generate upload URL for org member", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const url = await asUser.mutation(api.tasks.comments.generateTaskCommentAttachmentUploadUrl, {
        taskId: task._id,
      });

      expect(url).toBeDefined();
      expect(typeof url).toBe("string");
    });

    test("should throw for deleted task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", task._id, { isDeleted: true });
      });

      await expect(
        asUser.mutation(api.tasks.comments.generateTaskCommentAttachmentUploadUrl, {
          taskId: task._id,
        })
      ).rejects.toThrow("Task not found");
    });

    test("should throw for non-org-member", async () => {
      const ctx = createTestContext();
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const { asUser: asOtherUser } = await ctx.setupUser();

      await expect(
        asOtherUser.mutation(api.tasks.comments.generateTaskCommentAttachmentUploadUrl, {
          taskId: task._id,
        })
      ).rejects.toThrow("Not a member of this organization");
    });
  });

  describe("createWithAttachments", () => {
    test("creates comment and attachments atomically", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["test file"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      const commentId = await asUser.mutation(api.tasks.comments.createWithAttachments, {
        taskId: task._id,
        content: "Comment with files",
        attachments: [
          {
            storageId,
            fileName: "image.png",
            fileSize: 9,
            contentType: "image/png",
          },
        ],
      });

      expect(commentId).toBeDefined();

      const result = await asUser.query(api.tasks.comments.listByTask, {
        taskId: task._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0].content).toBe("Comment with files");
      expect(result.page[0].attachments).toHaveLength(1);
      expect(result.page[0].attachments[0].fileName).toBe("image.png");
    });

    test("rejects attachment file names with path segments (OS-1902)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["test file"]));
      });

      await expect(
        asUser.mutation(api.tasks.comments.createWithAttachments, {
          taskId: task._id,
          content: "Escapes",
          attachments: [{ storageId, fileName: "../outside.png", fileSize: 9, contentType: "image/png" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_FILE_NAME_INVALID);
    });

    test("throws when not authenticated", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await expect(
        t.mutation(api.tasks.comments.createWithAttachments, {
          taskId: task._id,
          content: "No auth",
          attachments: [],
        })
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("deletePendingUploadedAttachment", () => {
    test("lets a CLI API key discard its own upload (OS-1676)", async () => {
      const ctx = createTestContext();
      const { org, project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: { organizationId: org._id, projectIds: [project._id] },
      });
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob(["test file"])));
      await t.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId, apiKey: key });

      await t.mutation(api.tasks.comments.deletePendingUploadedAttachment, { taskId: task._id, storageId, apiKey: key });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.system.get("_storage", storageId)).toBeNull();
      });
    });

    test("returns null for authenticated project member", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["test file"]));
      });

      const result = await asUser.mutation(api.tasks.comments.deletePendingUploadedAttachment, {
        taskId: task._id,
        storageId,
      });

      expect(result).toBeNull();
    });

    test("throws when task is deleted", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["test file"]));
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", task._id, { isDeleted: true });
      });

      await expect(
        asUser.mutation(api.tasks.comments.deletePendingUploadedAttachment, {
          taskId: task._id,
          storageId,
        })
      ).rejects.toThrow("Task not found");
    });

    test("does not delete storage referenced by an existing comment attachment", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      await asUser.mutation(api.tasks.comments.createWithAttachments, {
        taskId: task._id,
        content: "with attachment",
        attachments: [
          {
            storageId,
            fileName: "attached.png",
            fileSize: 8,
            contentType: "image/png",
          },
        ],
      });

      await asUser.mutation(api.tasks.comments.deletePendingUploadedAttachment, {
        taskId: task._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        const url = await runCtx.storage.getUrl(storageId);
        expect(url).not.toBeNull();
      });
    });
  });

  describe("attachment size (OS-1676)", () => {
    test("rejects a claimed fileSize that disagrees with the stored blob", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob(["attached"])));
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      await expect(
        asUser.mutation(api.tasks.comments.createWithAttachments, {
          taskId: task._id,
          content: "lying size",
          attachments: [{ storageId, fileName: "liar.txt", fileSize: 1, contentType: "text/plain" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_SIZE_MISMATCH);
    });
  });

  describe("storage ownership (OS-1901)", () => {
    async function victimTaskAttachment(ctx: ReturnType<typeof createTestContext>) {
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["victim file"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      await asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId: task._id,
        storageId,
        fileName: "victim.txt",
        fileSize: 11,
        contentType: "text/plain",
      });
      return { storageId, t };
    }

    test("createWithAttachments rejects a storage id the caller did not register", async () => {
      const ctx = createTestContext();
      const { storageId } = await victimTaskAttachment(ctx);
      const { project, user, asUser: asAttacker } = await ctx.setupProject();
      const attackerTask = await ctx.task(project._id, user._id);

      await expect(
        asAttacker.mutation(api.tasks.comments.createWithAttachments, {
          taskId: attackerTask._id,
          content: "steal",
          attachments: [{ storageId, fileName: "stolen.txt", fileSize: 11, contentType: "text/plain" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("createWithAttachments rejects a saved attachment re-registered by another user", async () => {
      const ctx = createTestContext();
      const { storageId } = await victimTaskAttachment(ctx);
      const { project, user, asUser: asAttacker } = await ctx.setupProject();
      const attackerTask = await ctx.task(project._id, user._id);
      await asAttacker.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      await expect(
        asAttacker.mutation(api.tasks.comments.createWithAttachments, {
          taskId: attackerTask._id,
          content: "steal",
          attachments: [{ storageId, fileName: "stolen.txt", fileSize: 11, contentType: "text/plain" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("deletePendingUploadedAttachment does not delete a blob a thread message references", async () => {
      const ctx = createTestContext();
      const { project, user, asUser: asVictim, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["thread file"]));
      });
      await asVictim.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });
      await asVictim.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        attachments: [{ storageId, fileName: "thread.txt", fileSize: 11, contentType: "text/plain" }],
      });
      const { project: attackerProject, user: attacker, asUser: asAttacker } = await ctx.setupProject();
      const attackerTask = await ctx.task(attackerProject._id, attacker._id);

      await asAttacker.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      await asAttacker.mutation(api.tasks.comments.deletePendingUploadedAttachment, {
        taskId: attackerTask._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
      });
    });

    test("deletePendingUploadedAttachment keeps a referenced blob but drops the caller's claim", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["kept"]));
        await runCtx.db.insert("taskAttachmentPendingUploads", { userId: user._id, storageId, createdAt: Date.now() });
        await runCtx.db.insert("taskAttachments", {
          taskId: task._id,
          storageId,
          fileName: "kept.txt",
          fileSize: 4,
          contentType: "text/plain",
          uploadedBy: user._id,
          uploadedAt: Date.now(),
        });
      });

      await asUser.mutation(api.tasks.comments.deletePendingUploadedAttachment, { taskId: task._id, storageId });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
        expect(await runCtx.db.query("taskAttachmentPendingUploads").collect()).toEqual([]);
      });
    });

    test("deleteTaskCommentAttachment keeps a blob that a task attachment still references", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      let attachmentId!: Id<"taskCommentAttachments">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["shared"]));
        const meta = { storageId, fileName: "shared.txt", fileSize: 6, contentType: "text/plain", uploadedBy: user._id, uploadedAt: Date.now() };
        await runCtx.db.insert("taskAttachments", { taskId: task._id, ...meta });
        const now = Date.now();
        const commentId = await runCtx.db.insert("taskComments", { taskId: task._id, authorId: user._id, content: "c", createdAt: now, updatedAt: now, isEdited: false });
        attachmentId = await runCtx.db.insert("taskCommentAttachments", { commentId, ...meta });
      });

      await asUser.mutation(api.tasks.comments.deleteTaskCommentAttachment, { attachmentId });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
      });
    });

    test("deletePendingUploadedAttachment does not delete another tenant's task attachment", async () => {
      const ctx = createTestContext();
      const { storageId, t } = await victimTaskAttachment(ctx);
      const { project, user, asUser: asAttacker } = await ctx.setupProject();
      const attackerTask = await ctx.task(project._id, user._id);

      await asAttacker.mutation(api.tasks.comments.deletePendingUploadedAttachment, {
        taskId: attackerTask._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
      });
    });

    test("deletePendingUploadedAttachment does not delete a pending upload registered by another user", async () => {
      const ctx = createTestContext();
      const { asUser: asVictim, t } = await ctx.setupProject();
      const { project, user, asUser: asAttacker } = await ctx.setupProject();
      const attackerTask = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["pending"]));
      });
      await asVictim.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      await asAttacker.mutation(api.tasks.comments.deletePendingUploadedAttachment, {
        taskId: attackerTask._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
      });
    });

    test("deletePendingUploadedAttachment deletes an owned upload that nothing references", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["abandoned"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      await asUser.mutation(api.tasks.comments.deletePendingUploadedAttachment, {
        taskId: task._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).toBeNull();
      });
    });

    test("remove keeps a storage object that a task attachment still references", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      let commentId!: Id<"taskComments">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["shared"]));
        const meta = { storageId, fileName: "shared.txt", fileSize: 6, contentType: "text/plain", uploadedBy: user._id, uploadedAt: Date.now() };
        await runCtx.db.insert("taskAttachments", { taskId: task._id, ...meta });
        const now = Date.now();
        commentId = await runCtx.db.insert("taskComments", { taskId: task._id, authorId: user._id, content: "c", createdAt: now, updatedAt: now, isEdited: false });
        await runCtx.db.insert("taskCommentAttachments", { commentId, ...meta });
      });

      await asUser.mutation(api.tasks.comments.remove, { commentId });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
      });
    });
  });
});

describe("project viewer comments", () => {
  test("a viewer cannot comment (docs/specs/read-only-viewer-ux.md)", async () => {
    const ctx = createTestContext();
    const { org, project, user } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const task = await ctx.task(project._id, user._id);

    await expect(
      ctx.asUser(viewer).mutation(api.tasks.comments.create, {
        taskId: task._id,
        content: "Viewer comment",
      })
    ).rejects.toThrow("Permission denied");
  });
});
