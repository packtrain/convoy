/// <reference types="vite/client" />
import { expect, test, describe } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext, gen } from "../../convex-testing";
import type { Id } from "../_generated/dataModel";
import { errors } from "./errors";

describe("taskAttachments", () => {
  describe("listTaskAttachmentsByTask", () => {
    test("should return empty array for task without attachments", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id);

      const attachments = await asUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
      });

      expect(attachments).toEqual([]);
    });

    test("should return empty for unauthorized user (non-org-member)", async () => {
      const ctx = createTestContext();
      const { project, user } = await ctx.setupProject();

      // Create another user who is not a member
      const { asUser: asOtherUser } = await ctx.setupUser();

      const task = await ctx.task(project._id, user._id);

      // Non-member should not see attachments (even if empty)
      const attachments = await asOtherUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
      });

      expect(attachments).toEqual([]);
    });

    test("should return empty for deleted task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id);

      // Soft delete the task
      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", task._id, { isDeleted: true, deletedAt: Date.now() });
      });

      const attachments = await asUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
      });

      expect(attachments).toEqual([]);
    });

    test("should return empty when not authenticated", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id);

      // Query without authentication
      const attachments = await t.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
      });

      expect(attachments).toEqual([]);
    });

    test("should return empty for deleted project", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id);

      // Soft delete the project
      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, { isDeleted: true, deletedAt: Date.now() });
      });

      const attachments = await asUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
      });

      expect(attachments).toEqual([]);
    });

    test("should accept optional apiKey argument without validator error", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id);

      const attachments = await asUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
        apiKey: "sk_user_test",
      });

      expect(attachments).toEqual([]);
    });

    test("returns empty for an out-of-scope API key task", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const otherTask = await ctx.task(otherProject._id, user._id);
      await t.run(async (runCtx) => {
        const storageId = await runCtx.storage.store(new Blob(["attached"]));
        await runCtx.db.insert("taskAttachments", {
          taskId: otherTask._id,
          storageId,
          fileName: "out-of-scope.txt",
          fileSize: 8,
          contentType: "text/plain",
          uploadedBy: user._id,
          uploadedAt: Date.now(),
        });
      });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const attachments = await t.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: otherTask._id,
        apiKey: key,
      });

      expect(attachments).toEqual([]);
    });
  });

  describe("generateTaskAttachmentUploadUrl", () => {
    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupProject();

      await expect(
        t.mutation(api.tasks.attachments.generateTaskAttachmentUploadUrl, {})
      ).rejects.toThrow("Not authenticated");
    });

    test("should return an upload URL when authenticated", async () => {
      const ctx = createTestContext();
      const { asUser } = await ctx.setupProject();

      const url = await asUser.mutation(api.tasks.attachments.generateTaskAttachmentUploadUrl, {});

      expect(url).toBeDefined();
      expect(typeof url).toBe("string");
    });

    test("should return an upload URL with an API key", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });

      const url = await t.mutation(api.tasks.attachments.generateTaskAttachmentUploadUrl, {
        apiKey: key,
      });

      expect(user._id).toBeDefined();
      expect(url).toBeDefined();
      expect(typeof url).toBe("string");
    });
  });

  describe("registerPendingUploadedAttachment (OS-1901)", () => {
    test("returns the URL to the uploader", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupProject();
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });

      const url = await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, {
        storageId,
      });

      expect(typeof url).toBe("string");
    });

    test("returns null when another user registered the blob first", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupProject();
      const { asUser: asAttacker } = await ctx.setupProject();
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      const url = await asAttacker.mutation(api.tasks.attachments.registerPendingUploadedAttachment, {
        storageId,
      });

      expect(url).toBeNull();
    });

    test("refuses a storage id already saved as a task attachment", async () => {
      const ctx = createTestContext();
      const { project, user, asUser: asVictim, t } = await ctx.setupProject();
      const { project: attackerProject, user: attacker, asUser: asAttacker } = await ctx.setupProject();
      const victimTask = await ctx.task(project._id, user._id);
      const attackerTask = await ctx.task(attackerProject._id, attacker._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["victim file"]));
      });
      await asVictim.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      await asVictim.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId: victimTask._id,
        storageId,
        fileName: "victim.txt",
        fileSize: 11,
        contentType: "text/plain",
      });

      const url = await asAttacker.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      expect(url).toBeNull();
      await expect(
        asAttacker.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: attackerTask._id,
          storageId,
          fileName: "stolen.txt",
          fileSize: 11,
          contentType: "text/plain",
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("refuses a legacy attachment that never had a pending row", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const { asUser: asAttacker } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["legacy"]));
        await runCtx.db.insert("taskAttachments", {
          taskId: task._id,
          storageId,
          fileName: "legacy.txt",
          fileSize: 6,
          contentType: "text/plain",
          uploadedBy: user._id,
          uploadedAt: Date.now(),
        });
      });

      const url = await asAttacker.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      expect(url).toBeNull();
    });

    test("returns null for a missing blob and leaves no claim behind", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["gone"]));
        await runCtx.storage.delete(storageId);
      });

      const url = await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      expect(url).toBeNull();
      await t.run(async (runCtx) => {
        const rows = await runCtx.db.query("taskAttachmentPendingUploads").collect();
        expect(rows).toEqual([]);
      });
      await expect(
        asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: task._id,
          storageId,
          fileName: "gone.txt",
          fileSize: 4,
          contentType: "text/plain",
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("works with an API key", async () => {
      const ctx = createTestContext();
      const { org, project, asUser, t } = await ctx.setupProject();
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });

      const url = await t.mutation(api.tasks.attachments.registerPendingUploadedAttachment, {
        storageId,
        apiKey: key,
      });

      expect(typeof url).toBe("string");
    });
  });

  describe("saveTaskAttachment", () => {
    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id);

      // Note: We can't easily create a real storageId in tests, so we use
      // a properly typed cast. The test verifies auth is checked first.
      await expect(
        t.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: task._id,
          storageId: task._id as unknown as Id<"_storage">,
          fileName: "test.txt",
          fileSize: 1024,
          contentType: "text/plain",
        })
      ).rejects.toThrow();
    });

    test("should save an attachment with an API key", async () => {
      const ctx = createTestContext();
      const { project, user, org, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });
      await t.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId, apiKey: key });

      const attachmentId = await t.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId: task._id,
        storageId,
        fileName: "cli.txt",
        fileSize: 8,
        contentType: "text/plain",
        apiKey: key,
      });

      const attachments = await t.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
        apiKey: key,
      });
      expect(attachments).toHaveLength(1);
      expect(attachments[0]._id).toBe(attachmentId);
      expect(attachments[0].uploadedBy).toBe(user._id);
    });

    test("should reject an out-of-scope API key when saving", async () => {
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
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });

      await expect(
        t.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: otherTask._id,
          storageId,
          fileName: "cli.txt",
          fileSize: 8,
          contentType: "text/plain",
          apiKey: key,
        })
      ).rejects.toThrow();
    });

    test("rejects a file name that is not a plain basename (OS-1902)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });

      for (const fileName of ["../outside.txt", "/etc/passwd", "..\\evil.txt", "..", "", "bad\u0000.txt"]) {
        await expect(
          asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
            taskId: task._id,
            storageId,
            fileName,
            fileSize: 8,
            contentType: "text/plain",
          })
        ).rejects.toThrow(errors.ATTACHMENT_FILE_NAME_INVALID);
      }
    });
  });

  describe("size limit (OS-1676)", () => {
    const LIMIT = 50 * 1024 * 1024;

    test("registers a blob exactly at the limit", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupProject();
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob([new Uint8Array(LIMIT)])));

      const url = await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      expect(url).not.toBeNull();
    });

    test("deletes a blob one byte over the limit instead of registering it", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob([new Uint8Array(LIMIT + 1)])));

      const url = await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      expect(url).toBeNull();
      await t.run(async (runCtx) => {
        expect(await runCtx.db.system.get("_storage", storageId)).toBeNull();
        expect(await runCtx.db.query("taskAttachmentPendingUploads").collect()).toEqual([]);
      });
      await expect(
        asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: task._id,
          storageId,
          fileName: "big.bin",
          fileSize: LIMIT + 1,
          contentType: "application/octet-stream",
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("reports a registered blob that no longer exists as not found", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob(["attached"])));
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      await t.run((runCtx) => runCtx.storage.delete(storageId));

      await expect(
        asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: task._id,
          storageId,
          fileName: "gone.txt",
          fileSize: 8,
          contentType: "text/plain",
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("rejects a claimed fileSize that disagrees with the stored blob", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob(["attached"])));
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      await expect(
        asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: task._id,
          storageId,
          fileName: "liar.txt",
          fileSize: 1,
          contentType: "text/plain",
        })
      ).rejects.toThrow(errors.ATTACHMENT_SIZE_MISMATCH);
    });
  });

  describe("deleteTaskAttachment", () => {
    test("should throw when not authenticated", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id);

      await expect(
        t.mutation(api.tasks.attachments.deleteTaskAttachment, {
          attachmentId: task._id as unknown as Id<"taskAttachments">,
        })
      ).rejects.toThrow();
    });

    test("should delete an attachment with an API key", async () => {
      const ctx = createTestContext();
      const { project, user, org, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });
      let attachmentId!: Id<"taskAttachments">;
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
        attachmentId = await runCtx.db.insert("taskAttachments", {
          taskId: task._id,
          storageId,
          fileName: "cli.txt",
          fileSize: 8,
          contentType: "text/plain",
          uploadedBy: user._id,
          uploadedAt: Date.now(),
        });
      });

      await t.mutation(api.tasks.attachments.deleteTaskAttachment, {
        attachmentId,
        apiKey: key,
      });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("taskAttachments", attachmentId)).toBeNull();
        expect(await runCtx.storage.get(storageId)).toBeNull();
      });
    });
  });

  describe("project permission checks", () => {
    test("org member without project membership cannot list attachments", async () => {
      const ctx = createTestContext();
      const { project, user, org } = await ctx.setupProject();

      // Create another user who is an org member but NOT a project member
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      const asOtherUser = ctx.asUser(otherUser);

      const task = await ctx.task(project._id, user._id);

      // Org member without project membership should not see attachments
      const attachments = await asOtherUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
      });

      expect(attachments).toEqual([]);
    });

    // Note: We can't directly test saveAttachment permission denial because
    // Convex validates the storage ID arg BEFORE running the handler.
    // The permission check is in place but not testable without real storage IDs.
    // The listByTask tests verify the permission system works correctly.

    test("org member without project membership cannot delete attachments", async () => {
      const ctx = createTestContext();
      const { project, user, org } = await ctx.setupProject();

      // Create another user who is an org member but NOT a project member
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      const asOtherUser = ctx.asUser(otherUser);

      await ctx.task(project._id, user._id);

      // Org member without project membership should not be able to delete attachments
      await expect(
        asOtherUser.mutation(api.tasks.attachments.deleteTaskAttachment, {
          attachmentId: project._id as unknown as Id<"taskAttachments">,
        })
      ).rejects.toThrow();
    });

    test("org admin lists attachments only through a project membership (OS-1536)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, org, t } = await ctx.setupProject();

      // Create an org admin (not project member)
      const adminUser = await ctx.user();
      await ctx.orgMember(org._id, adminUser._id, "admin");
      const asAdmin = ctx.asUser(adminUser);

      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      await asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId: task._id,
        storageId,
        fileName: "notes.txt",
        fileSize: 8,
        contentType: "text/plain",
      });

      const listAsAdmin = () =>
        asAdmin.query(api.tasks.attachments.listTaskAttachmentsByTask, { taskId: task._id });

      // A real attachment exists, so an empty list means denied, not empty.
      expect(await listAsAdmin()).toEqual([]);

      await ctx.projectMember(project._id, adminUser._id, "viewer");

      expect(await listAsAdmin()).toHaveLength(1);
    });

    test("project viewer can list attachments", async () => {
      const ctx = createTestContext();
      const { project, user, org } = await ctx.setupProject();

      // Create a project viewer
      const viewerUser = await ctx.user();
      await ctx.orgMember(org._id, viewerUser._id, "member");
      await ctx.projectMember(project._id, viewerUser._id, "viewer");
      const asViewer = ctx.asUser(viewerUser);

      const task = await ctx.task(project._id, user._id);

      // Viewer should be able to list attachments
      const attachments = await asViewer.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
      });
      expect(attachments).toEqual([]);
    });

    test("project member can list attachments", async () => {
      const ctx = createTestContext();
      const { project, user, org } = await ctx.setupProject();

      // Create a project member
      const memberUser = await ctx.user();
      await ctx.orgMember(org._id, memberUser._id, "member");
      await ctx.projectMember(project._id, memberUser._id, "member");
      const asMember = ctx.asUser(memberUser);

      const task = await ctx.task(project._id, user._id);

      // Member should be able to list attachments
      const attachments = await asMember.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: task._id,
      });
      expect(attachments).toEqual([]);
    });
  });

  describe("attachmentCount (OS-882)", () => {
    type TestCtx = ReturnType<typeof createTestContext>;

    async function storeBlob(t: TestCtx["t"]) {
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });
      return storageId;
    }

    async function saveAttachment(
      asUser: ReturnType<TestCtx["asUser"]>,
      t: TestCtx["t"],
      taskId: Id<"tasks">
    ) {
      const storageId = await storeBlob(t);
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      return asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId,
        storageId,
        fileName: "file.txt",
        fileSize: 8,
        contentType: "text/plain",
      });
    }

    test("save increments the counter, treating a missing field as 0", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Legacy doc: field absent
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.attachmentCount).toBeUndefined();
      });

      await saveAttachment(asUser, t, task._id);
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.attachmentCount).toBe(1);
      });

      await saveAttachment(asUser, t, task._id);
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.attachmentCount).toBe(2);
      });
    });

    test("save does not bump the task's updatedAt", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await saveAttachment(asUser, t, task._id);
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.updatedAt).toBe(task.updatedAt);
      });
    });

    test("delete decrements the counter", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const attachmentId = await saveAttachment(asUser, t, task._id);
      await saveAttachment(asUser, t, task._id);

      await asUser.mutation(api.tasks.attachments.deleteTaskAttachment, { attachmentId });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.attachmentCount).toBe(1);
      });
    });

    test("delete clamps the counter at zero when it is already 0/missing", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Seed an attachment row directly so the counter was never incremented
      let attachmentId!: Id<"taskAttachments">;
      await t.run(async (runCtx) => {
        attachmentId = await runCtx.db.insert("taskAttachments", {
          taskId: task._id,
          storageId: await runCtx.storage.store(new Blob(["attached"])),
          fileName: "file.txt",
          fileSize: 8,
          contentType: "text/plain",
          uploadedBy: user._id,
          uploadedAt: Date.now(),
        });
      });

      await asUser.mutation(api.tasks.attachments.deleteTaskAttachment, { attachmentId });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.attachmentCount).toBe(0);
      });
    });

    test("listByProject returns attachmentCount (0 default, reflects saves)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      let tasks = await asUser.query(api.tasks.core.listByProject, { projectId: project._id });
      expect(tasks.find((item) => item._id === task._id)?.attachmentCount).toBe(0);

      await saveAttachment(asUser, t, task._id);

      tasks = await asUser.query(api.tasks.core.listByProject, { projectId: project._id });
      expect(tasks.find((item) => item._id === task._id)?.attachmentCount).toBe(1);
    });

    test("duplicate yields attachmentCount 0 (attachments are not copied)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      await saveAttachment(asUser, t, task._id);

      const copyId = await asUser.mutation(api.tasks.core.duplicate, {
        id: task._id,
        newClientId: gen.clientId(),
        newRank: gen.rank(),
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, { projectId: project._id });
      expect(tasks.find((item) => item._id === task._id)?.attachmentCount).toBe(1);
      expect(tasks.find((item) => item._id === copyId)?.attachmentCount).toBe(0);
    });
  });

  describe("moveTaskAttachment", () => {
    type TestCtx = ReturnType<typeof createTestContext>;

    async function saveAttachment(
      asUser: ReturnType<TestCtx["asUser"]>,
      t: TestCtx["t"],
      taskId: Id<"tasks">
    ) {
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      return asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId,
        storageId,
        fileName: "file.txt",
        fileSize: 8,
        contentType: "text/plain",
      });
    }

    test("moves the attachment, keeps the stored file, and adjusts both counters", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const target = await ctx.task(project._id, user._id);

      const attachmentId = await saveAttachment(asUser, t, source._id);
      // Same file name on the target: attachments have no per-task uniqueness,
      // so nothing is renamed.
      await saveAttachment(asUser, t, target._id);
      const before = await asUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: source._id,
      });

      await asUser.mutation(api.tasks.attachments.moveTaskAttachment, {
        attachmentId,
        taskId: target._id,
      });

      const moved = await asUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
        taskId: target._id,
      });
      expect(moved).toHaveLength(2);
      const found = moved.find((item) => item._id === attachmentId);
      expect(found?.fileName).toBe("file.txt");
      expect(found?.storageId).toBe(before[0].storageId);
      expect(found?.url).toBeTruthy();

      expect(
        await asUser.query(api.tasks.attachments.listTaskAttachmentsByTask, {
          taskId: source._id,
        })
      ).toEqual([]);

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", source._id))?.attachmentCount).toBe(0);
        expect((await runCtx.db.get("tasks", target._id))?.attachmentCount).toBe(2);
        expect((await runCtx.db.get("tasks", target._id))?.updatedAt).toBe(target.updatedAt);
      });
    });

    test("no-ops when the attachment already belongs to the target task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const attachmentId = await saveAttachment(asUser, t, task._id);

      await asUser.mutation(api.tasks.attachments.moveTaskAttachment, {
        attachmentId,
        taskId: task._id,
      });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("tasks", task._id))?.attachmentCount).toBe(1);
      });
    });

    test("rejects a target task in another project", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser, t } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const otherProject = await ctx.project(org._id, user._id);
      const target = await ctx.task(otherProject._id, user._id);

      const attachmentId = await saveAttachment(asUser, t, source._id);

      await expect(
        asUser.mutation(api.tasks.attachments.moveTaskAttachment, {
          attachmentId,
          taskId: target._id,
        })
      ).rejects.toThrow("Tasks must be in the same project");
    });

    test("rejects a viewer without TASK_UPDATE", async () => {
      const ctx = createTestContext();
      const { project, org, user, asUser, t } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const target = await ctx.task(project._id, user._id);

      const attachmentId = await saveAttachment(asUser, t, source._id);

      const viewer = await ctx.user();
      await ctx.orgMember(org._id, viewer._id, "member");
      await ctx.projectMember(project._id, viewer._id, "viewer");

      await expect(
        ctx.asUser(viewer).mutation(api.tasks.attachments.moveTaskAttachment, {
          attachmentId,
          taskId: target._id,
        })
      ).rejects.toThrow("Permission denied: task:update");
    });

    test("rejects a deleted target task", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const source = await ctx.task(project._id, user._id);
      const target = await ctx.task(project._id, user._id);

      const attachmentId = await saveAttachment(asUser, t, source._id);

      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", target._id, { isDeleted: true });
      });

      await expect(
        asUser.mutation(api.tasks.attachments.moveTaskAttachment, {
          attachmentId,
          taskId: target._id,
        })
      ).rejects.toThrow("Task not found");
    });
  });

  describe("storage ownership (OS-1901)", () => {
    test("saveTaskAttachment rejects a storage id the caller did not register", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupProject();
      const { project: attackerProject, user: attacker, asUser: asAttacker } = await ctx.setupProject();
      const attackerTask = await ctx.task(attackerProject._id, attacker._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["victim file"]));
      });

      await expect(
        asAttacker.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: attackerTask._id,
          storageId,
          fileName: "stolen.txt",
          fileSize: 11,
          contentType: "text/plain",
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("saveTaskAttachment rejects a storage id registered by another user", async () => {
      const ctx = createTestContext();
      const { asUser: asVictim, t } = await ctx.setupProject();
      const { project: attackerProject, user: attacker, asUser: asAttacker } = await ctx.setupProject();
      const attackerTask = await ctx.task(attackerProject._id, attacker._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["victim file"]));
      });
      await asVictim.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      await expect(
        asAttacker.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: attackerTask._id,
          storageId,
          fileName: "stolen.txt",
          fileSize: 11,
          contentType: "text/plain",
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("the uploader cannot re-register a blob after saving it", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["mine"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      await asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId: task._id,
        storageId,
        fileName: "mine.txt",
        fileSize: 4,
        contentType: "text/plain",
      });

      const url = await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

      expect(url).toBeNull();
    });

    test("permanentlyDelete keeps a blob that a comment attachment still references", async () => {
      const ctx = createTestContext();
      const { project, user, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const otherTask = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["shared"]));
        const meta = { storageId, fileName: "shared.txt", fileSize: 6, contentType: "text/plain", uploadedBy: user._id, uploadedAt: Date.now() };
        await runCtx.db.insert("taskAttachments", { taskId: task._id, ...meta });
        const now = Date.now();
        const commentId = await runCtx.db.insert("taskComments", { taskId: otherTask._id, authorId: user._id, content: "c", createdAt: now, updatedAt: now, isEdited: false });
        await runCtx.db.insert("taskCommentAttachments", { commentId, ...meta });
      });

      await t.mutation(internal.tasks.core.permanentlyDelete, { taskId: task._id });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
      });
    });

    test("a registered upload can be saved once, then the claim is spent", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["mine"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      const save = () =>
        asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
          taskId: task._id,
          storageId,
          fileName: "mine.txt",
          fileSize: 4,
          contentType: "text/plain",
        });

      await expect(save()).resolves.toBeDefined();
      await expect(save()).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("deleteTaskAttachment keeps the storage object while another record references it", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      let firstId!: Id<"taskAttachments">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["shared"]));
        const row = {
          taskId: task._id,
          storageId,
          fileName: "shared.txt",
          fileSize: 6,
          contentType: "text/plain",
          uploadedBy: user._id,
          uploadedAt: Date.now(),
        };
        firstId = await runCtx.db.insert("taskAttachments", row);
        await runCtx.db.insert("taskAttachments", row);
      });

      await asUser.mutation(api.tasks.attachments.deleteTaskAttachment, { attachmentId: firstId });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
      });
    });

    test("deleteTaskAttachment removes the storage object once nothing references it", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["only"]));
      });
      await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      const attachmentId = await asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId: task._id,
        storageId,
        fileName: "only.txt",
        fileSize: 4,
        contentType: "text/plain",
      });

      await asUser.mutation(api.tasks.attachments.deleteTaskAttachment, { attachmentId });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).toBeNull();
      });
    });
  });
});

describe("project viewer attachment writes", () => {
  test("a viewer cannot attach or delete files (docs/specs/read-only-viewer-ux.md)", async () => {
    const ctx = createTestContext();
    const { project, org, user, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);
    const store = async () => {
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });
      return storageId;
    };
    const fileArgs = { fileName: "file.txt", fileSize: 8, contentType: "text/plain" };

    const viewerBlob = await store();
    await asViewer.mutation(api.tasks.attachments.registerPendingUploadedAttachment, {
      storageId: viewerBlob,
    });
    await expect(
      asViewer.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId: task._id,
        storageId: viewerBlob,
        ...fileArgs,
      })
    ).rejects.toThrow("Permission denied: task:update");

    const ownerBlob = await store();
    await asUser.mutation(api.tasks.attachments.registerPendingUploadedAttachment, {
      storageId: ownerBlob,
    });
    const attachmentId = await asUser.mutation(api.tasks.attachments.saveTaskAttachment, {
      taskId: task._id,
      storageId: ownerBlob,
      ...fileArgs,
    });
    await expect(
      asViewer.mutation(api.tasks.attachments.deleteTaskAttachment, { attachmentId })
    ).rejects.toThrow("Permission denied: task:update");
  });
});
