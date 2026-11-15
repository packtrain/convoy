import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { EMPTY_PAGE } from "../lib/shared/pagination";
import { getAuthenticatedAccess, getAuthenticatedUser, getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { ensure } from "../lib/shared/ensure";
import { isSafeFileName } from "../lib/shared/strings";
import { emitEvent } from "../lib/events";
import { errors } from "./errors";
import { taskCommentListItemValidator } from "./lib/comments/validators";
import { hydrateTaskComments } from "./lib/comments/hydrate";
import { getTaskById } from "./lib/tasksRepo";
import {
  deleteTaskComment,
  getTaskCommentById,
  insertTaskComment,
  paginateTaskCommentsByTask,
  updateTaskCommentContent,
} from "./lib/taskCommentsRepo";
import { claimPendingUpload } from "./lib/attachments/pendingUploads";
import { deleteStorageIfUnreferenced } from "../lib/storageRepo";
import {
  deleteTaskAttachmentPendingUpload,
  findOwnedTaskAttachmentPendingUpload,
} from "./lib/taskAttachmentPendingUploadsRepo";
import {
  deleteTaskCommentAttachment as deleteTaskCommentAttachmentRow,
  getTaskCommentAttachmentById,
  insertTaskCommentAttachment,
  listTaskCommentAttachmentsByComment,
} from "./lib/taskCommentAttachmentsRepo";

const taskCommentListResponseValidator = v.object({
  page: v.array(taskCommentListItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
  pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  splitCursor: v.optional(v.union(v.string(), v.null())),
});

const createCommentAttachmentInputValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
});

interface CreateCommentAttachmentInput {
  storageId: Id<"_storage">;
  fileName: string;
  fileSize: number;
  contentType: string;
}

async function createCommentCore(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    content: string;
    apiKey?: string;
    attachments?: CreateCommentAttachmentInput[];
  }
) {
  const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
  for (const attachment of args.attachments ?? []) {
    ensure(isSafeFileName(attachment.fileName)).isTrue(errors.ATTACHMENT_FILE_NAME_INVALID);
  }

  const task = await ensure(getTaskById(ctx, args.taskId)).notDeleted(errors.TASK_NOT_FOUND);

  await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.COMMENT_CREATE);

  const commentId = await insertTaskComment(ctx, { taskId: args.taskId, content: args.content }, user._id);

  for (const attachment of args.attachments ?? []) {
    // Only the uploader may attach the blob, and only once (OS-1901).
    await claimPendingUpload(ctx, user._id, attachment.storageId, attachment.fileSize);
    await insertTaskCommentAttachment(
      ctx,
      {
        commentId,
        storageId: attachment.storageId,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        contentType: attachment.contentType,
      },
      user._id
    );
  }

  // No `comment_added` activity row: the merged timeline renders the comment
  // itself, so an "added a comment" row beside it is a duplicate
  // (docs/specs/task-timeline.md). The notification event below is unrelated.
  await emitEvent(ctx, {
    type: "task.comment_added",
    actorUserId: user._id,
    projectId: task.projectId,
    subject: { kind: "task", id: args.taskId },
    payload: { commentId },
  });

  return commentId;
}

/**
 * List comments for a task with pagination.
 * Returns comments in descending order (newest first).
 * Includes author info, attachments, and permission flags.
 */
export const listByTask = query({
  args: {
    taskId: v.id("tasks"),
    paginationOpts: paginationOptsValidator,
    apiKey: v.optional(v.string()),
  },
  returns: taskCommentListResponseValidator,
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return EMPTY_PAGE;
    }
    const { user, principal } = auth;

    const task = await getTaskById(ctx, args.taskId);
    if (!task || task.isDeleted) {
      return EMPTY_PAGE;
    }

    // Check if user can view tasks (implies can view comments)
    const access = await authorizeProjectAccess(ctx, principal, task.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return EMPTY_PAGE;
    }

    // Query comments with pagination
    const results = await paginateTaskCommentsByTask(ctx, args.taskId, args.paginationOpts);

    return {
      ...results,
      page: await hydrateTaskComments(ctx, results.page, { userId: user._id, access }),
    };
  },
});

/**
 * Create a new comment on a task.
 */
export const create = mutation({
  args: {
    taskId: v.id("tasks"),
    content: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("taskComments"),
  handler: async (ctx, args) => createCommentCore(ctx, args),
});

/**
 * Create a new comment and attach uploaded files atomically.
 */
export const createWithAttachments = mutation({
  args: {
    taskId: v.id("tasks"),
    content: v.string(),
    attachments: v.array(createCommentAttachmentInputValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("taskComments"),
  handler: async (ctx, args) => createCommentCore(ctx, args),
});

/**
 * Update a comment's content. Only the author can edit.
 */
export const update = mutation({
  args: {
    commentId: v.id("taskComments"),
    content: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const comment = await ensure(getTaskCommentById(ctx, args.commentId)).notNull(errors.COMMENT_NOT_FOUND);

    const task = await ensure(getTaskById(ctx, comment.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    // Only the author can edit their comment
    ensure(comment.authorId).eq(user._id, errors.COMMENT_EDIT_AUTHOR_ONLY);

    // Verify project access
    await requireAuthorizedProject(ctx, user._id, task.projectId, ProjectPermission.COMMENT_UPDATE_OWN);

    await updateTaskCommentContent(ctx, args.commentId, args.content);

    return null;
  },
});

/**
 * Delete a comment and its attachments.
 * Author can delete own comments, admins can delete any.
 */
export const remove = mutation({
  args: {
    commentId: v.id("taskComments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const comment = await getTaskCommentById(ctx, args.commentId);
    if (!comment) {
      return null; // Idempotent
    }

    const task = await ensure(getTaskById(ctx, comment.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    const isAuthor = comment.authorId === user._id;

    await requireAuthorizedProject(
      ctx,
      user._id,
      task.projectId,
      isAuthor ? ProjectPermission.COMMENT_DELETE_OWN : ProjectPermission.COMMENT_DELETE_ANY
    );

    // Delete all attachments
    const attachments = await listTaskCommentAttachmentsByComment(ctx, args.commentId);

    for (const attachment of attachments) {
      await deleteTaskCommentAttachmentRow(ctx, attachment._id);
      await deleteStorageIfUnreferenced(ctx, attachment.storageId);
    }

    // Delete the comment
    await deleteTaskComment(ctx, args.commentId);

    return null;
  },
});

/**
 * Generate an upload URL for comment attachments.
 */
export const generateTaskCommentAttachmentUploadUrl = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const task = await ensure(getTaskById(ctx, args.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    await requireAuthorizedProject(ctx, user._id, task.projectId, ProjectPermission.COMMENT_CREATE);

    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Best-effort deletion for uploads that were never attached. Only the uploader's
 * own pending uploads qualify, and the blob stays if any attachment row
 * references it (OS-1901).
 */
export const deletePendingUploadedAttachment = mutation({
  args: {
    taskId: v.id("tasks"),
    storageId: v.id("_storage"),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const task = await ensure(getTaskById(ctx, args.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.COMMENT_CREATE);

    const owned = await findOwnedTaskAttachmentPendingUpload(ctx, user._id, args.storageId);
    if (!owned) {
      return null;
    }

    try {
      await deleteStorageIfUnreferenced(ctx, args.storageId);
    } catch (error) {
      console.error("[tasks.comments.deletePendingUploadedAttachment] delete failed", error);
    }
    await deleteTaskAttachmentPendingUpload(ctx, owned._id);

    return null;
  },
});

/**
 * Delete a comment attachment.
 */
export const deleteTaskCommentAttachment = mutation({
  args: {
    attachmentId: v.id("taskCommentAttachments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const attachment = await getTaskCommentAttachmentById(ctx, args.attachmentId);
    if (!attachment) {
      return null; // Idempotent
    }

    const comment = await ensure(getTaskCommentById(ctx, attachment.commentId)).notNull(errors.COMMENT_NOT_FOUND);

    // Only the uploader can delete the attachment
    ensure(attachment.uploadedBy).eq(user._id, errors.COMMENT_ATTACHMENT_DELETE_UPLOADER_ONLY);

    const task = await ensure(getTaskById(ctx, comment.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    await requireAuthorizedProject(ctx, user._id, task.projectId, ProjectPermission.COMMENT_DELETE_OWN);

    await deleteTaskCommentAttachmentRow(ctx, args.attachmentId);
    await deleteStorageIfUnreferenced(ctx, attachment.storageId);

    return null;
  },
});
