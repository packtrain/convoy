import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import {
  getAuthenticatedAccess,
  getAuthenticatedUser,
  getOptionalAuthenticatedAccess,
} from "../lib/access/auth";
import {
  hasProjectAccess,
  requireAuthorizedProject,
} from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { ensure } from "../lib/shared/ensure";
import { isSafeFileName } from "../lib/shared/strings";
import { logTaskActivity } from "./lib/activity/logger";
import { errors } from "./errors";
import { taskAttachmentRowValidator } from "./lib/attachments/validators";
import { getTaskById, patchTask, transferTaskResourceCount } from "./lib/tasksRepo";
import {
  deleteTaskAttachment as deleteTaskAttachmentRow,
  getTaskAttachmentById,
  insertTaskAttachment,
  listTaskAttachmentsByTaskId,
  moveTaskAttachmentToTask,
} from "./lib/taskAttachmentsRepo";
import {
  findOwnedTaskAttachmentPendingUpload,
  insertTaskAttachmentPendingUpload,
} from "./lib/taskAttachmentPendingUploadsRepo";
import { claimPendingUpload } from "./lib/attachments/pendingUploads";
import { deleteStorageIfOversized, deleteStorageIfUnreferenced, isStorageClaimed } from "../lib/storageRepo";

/**
 * Generate an upload URL for file attachment.
 * Requires authentication.
 */
export const generateTaskAttachmentUploadUrl = mutation({
  args: { apiKey: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    await getAuthenticatedUser(ctx, args.apiKey);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Step 2 of the upload flow (OS-1901): record who uploaded the blob so only they
 * can attach or discard it. Returns the blob URL, or null when someone else
 * already registered it. See `docs/specs/task-attachments.md`.
 */
export const registerPendingUploadedAttachment = mutation({
  args: {
    storageId: v.id("_storage"),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx, args.apiKey);
    // URL first: a missing blob must not leave a claim behind.
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) return null;
    if (await findOwnedTaskAttachmentPendingUpload(ctx, user._id, args.storageId)) return url;
    // Referenced or pending anywhere means "not yours". Same answer as missing, so
    // ownership stays opaque.
    if (await isStorageClaimed(ctx, args.storageId)) return null;
    if (await deleteStorageIfOversized(ctx, args.storageId)) return null;
    await insertTaskAttachmentPendingUpload(ctx, { userId: user._id, storageId: args.storageId });
    return url;
  },
});

/**
 * Save an attachment after successful upload.
 * Logs activity and returns the attachment ID.
 */
export const saveTaskAttachment = mutation({
  args: {
    taskId: v.id("tasks"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("taskAttachments"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    ensure(isSafeFileName(args.fileName)).isTrue(errors.ATTACHMENT_FILE_NAME_INVALID);

    // Verify task exists
    const task = await ensure(getTaskById(ctx, args.taskId)).notDeleted(
      errors.TASK_NOT_FOUND
    );

    // Verify user has project access with TASK_UPDATE permission
    await requireAuthorizedProject(
      ctx,
      principal,
      task.projectId,
      ProjectPermission.TASK_UPDATE
    );

    // Only the uploader may attach the blob, and only once (OS-1901).
    await claimPendingUpload(ctx, user._id, args.storageId, args.fileSize);

    // Insert attachment
    const attachmentId = await insertTaskAttachment(
      ctx,
      {
        taskId: args.taskId,
        storageId: args.storageId,
        fileName: args.fileName,
        fileSize: args.fileSize,
        contentType: args.contentType,
      },
      user._id
    );

    // Maintain the denormalized counter (OS-882). No `updatedAt` bump on
    // purpose: attachment changes are already recorded via activity logs.
    await patchTask(
      ctx,
      args.taskId,
      { attachmentCount: (task.attachmentCount ?? 0) + 1 },
      { bumpUpdatedAt: false }
    );

    // Log activity
    await logTaskActivity.attachmentAdded(ctx, {
      taskId: args.taskId,
      userId: user._id,
      fileName: args.fileName,
    });

    return attachmentId;
  },
});

/**
 * List all attachments for a task with their URLs.
 */
export const listTaskAttachmentsByTask = query({
  args: {
    taskId: v.id("tasks"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(taskAttachmentRowValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { principal } = auth;

    // Verify task exists
    const task = await getTaskById(ctx, args.taskId);
    if (!task || task.isDeleted) {
      return [];
    }

    // Verify user has project access with TASK_VIEW permission
    const hasAccess = await hasProjectAccess(
      ctx,
      principal,
      task.projectId,
      ProjectPermission.TASK_VIEW
    );
    if (!hasAccess) {
      return [];
    }

    // Get attachments
    const attachments = await listTaskAttachmentsByTaskId(ctx, args.taskId);

    // Get URLs for all attachments
    return Promise.all(
      attachments.map(async (attachment) => ({
        ...attachment,
        url: await ctx.storage.getUrl(attachment.storageId),
      }))
    );
  },
});

/**
 * Move an attachment to another task in the same project (OS-1711). Cheaper
 * than the artifact move: no per-task file-name uniqueness, no comments, and
 * the stored file never moves. See `docs/specs/task-attachments.md`.
 */
export const moveTaskAttachment = mutation({
  args: {
    attachmentId: v.id("taskAttachments"),
    taskId: v.id("tasks"),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const attachment = await ensure(
      getTaskAttachmentById(ctx, args.attachmentId)
    ).notNull(errors.ATTACHMENT_NOT_FOUND);
    const task = await ensure(getTaskById(ctx, attachment.taskId)).notDeleted(
      errors.TASK_NOT_FOUND
    );

    await requireAuthorizedProject(
      ctx,
      principal,
      task.projectId,
      ProjectPermission.TASK_UPDATE
    );

    if (attachment.taskId === args.taskId) {
      return null;
    }

    const target = await ensure(getTaskById(ctx, args.taskId)).notDeleted(
      errors.TASK_NOT_FOUND
    );
    // Same project only: TASK_UPDATE is project-scoped, so the source check
    // above covers the target.
    ensure(target.projectId).eq(task.projectId, errors.TASKS_SAME_PROJECT);

    await moveTaskAttachmentToTask(ctx, args.attachmentId, args.taskId);

    await transferTaskResourceCount(ctx, {
      from: task,
      to: target,
      field: "attachmentCount",
    });

    await logTaskActivity.attachmentRemoved(ctx, {
      taskId: task._id,
      userId: user._id,
      fileName: attachment.fileName,
    });
    await logTaskActivity.attachmentAdded(ctx, {
      taskId: args.taskId,
      userId: user._id,
      fileName: attachment.fileName,
    });

    return null;
  },
});

/**
 * Delete an attachment from storage and database.
 * Logs activity.
 */
export const deleteTaskAttachment = mutation({
  args: {
    attachmentId: v.id("taskAttachments"),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    // Get the attachment
    const attachment = await ensure(
      getTaskAttachmentById(ctx, args.attachmentId)
    ).notNull(errors.ATTACHMENT_NOT_FOUND);

    // Verify task exists
    const task = await ensure(getTaskById(ctx, attachment.taskId)).notNull(
      errors.TASK_NOT_FOUND
    );

    // Verify user has project access with TASK_UPDATE permission
    await requireAuthorizedProject(
      ctx,
      principal,
      task.projectId,
      ProjectPermission.TASK_UPDATE
    );

    const fileName = attachment.fileName;

    // Row first, so the reference check below sees only other records (OS-1901).
    await deleteTaskAttachmentRow(ctx, args.attachmentId);
    await deleteStorageIfUnreferenced(ctx, attachment.storageId);

    // Clamped at zero so defensive cleanup/retry paths can't go negative.
    await patchTask(
      ctx,
      task._id,
      { attachmentCount: Math.max(0, (task.attachmentCount ?? 0) - 1) },
      { bumpUpdatedAt: false }
    );

    // Log activity
    await logTaskActivity.attachmentRemoved(ctx, {
      taskId: attachment.taskId,
      userId: user._id,
      fileName,
    });

    return null;
  },
});
