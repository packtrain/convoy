import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import {
  getAuthenticatedAccess,
  getAuthenticatedUser,
  getOptionalAuthenticatedAccess,
} from "../lib/access/auth";
import {
  authorizeProjectAccess,
  hasAuthorizedProjectPermission,
  requireAuthorizedProject,
} from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { ensure } from "../lib/shared/ensure";
import { join } from "../lib/shared/join";
import { getUsersByIds } from "../users/lib/usersRepo";
import { errors } from "./errors";
import { deriveArtifactCommentAnchor } from "./lib/artifactComments/anchor";
import {
  artifactCommentAnchorValidator,
  artifactCommentListItemValidator,
  artifactCommentStatusValidator,
} from "./lib/artifactComments/validators";
import { getArtifactById } from "./lib/taskArtifactsRepo";
import { getTaskById } from "./lib/tasksRepo";
import {
  deleteArtifactComment,
  getArtifactCommentById,
  insertArtifactComment,
  listArtifactCommentRepliesByParent,
  listArtifactCommentsByArtifact,
  updateArtifactCommentContent,
  setArtifactCommentStatus,
} from "./lib/artifactComments/artifactCommentsRepo";

// ponytail: hard cap instead of pagination — highlights need every anchor at
// once and artifacts hold dozens of comments, not thousands. Paginate if a
// real artifact ever approaches this.
const MAX_COMMENTS_PER_ARTIFACT = 1000;

/**
 * All comments for an artifact (roots and replies, oldest first), enriched
 * with author info and permission flags. Not paginated: the highlight overlay
 * needs every root's anchor, and the client groups replies under roots.
 * Resolve/un-resolve needs no flag — anyone who can view can resolve.
 */
export const listByArtifact = query({
  args: {
    artifactId: v.id("taskArtifacts"),
    /** Filter threads by root status; replies follow their root. */
    status: v.optional(artifactCommentStatusValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(artifactCommentListItemValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { user, principal } = auth;

    const artifact = await getArtifactById(ctx, args.artifactId);
    if (!artifact) {
      return [];
    }

    const task = await getTaskById(ctx, artifact.taskId);
    if (!task || task.isDeleted) {
      return [];
    }

    const access = await authorizeProjectAccess(ctx, principal, task.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return [];
    }

    const canDeleteAny = hasAuthorizedProjectPermission(access, ProjectPermission.COMMENT_DELETE_ANY);

    const all = await listArtifactCommentsByArtifact(ctx, args.artifactId, MAX_COMMENTS_PER_ARTIFACT);

    let comments = all;
    if (args.status) {
      const matchingRoots = new Set(
        all
          .filter((c) => !c.parentId && (c.status ?? "open") === args.status)
          .map((c) => c._id)
      );
      comments = all.filter((c) => matchingRoots.has(c.parentId ?? c._id));
    }

    return join(comments)
      .on((comment) => comment.authorId)
      .with((ids) => getUsersByIds(ctx, ids))
      .selectAll((comment, author) => {
        const isAuthor = comment.authorId === user._id;
        return {
          ...comment,
          authorName: author?.name ?? "Unknown",
          authorAvatarUrl: author?.avatarUrl ?? null,
          canEdit: isAuthor,
          canDelete: isAuthor || canDeleteAny,
        };
      });
  },
});

/**
 * Create a root comment, optionally anchored to a text range. The web client
 * sends a full `anchor` captured from the rendered document; agents send a
 * bare `anchorText` (+ optional occurrence) and the anchor is derived here
 * from the artifact's markdown source. At most one of the two may be
 * provided; omitting both creates a general (non-anchored) comment.
 */
export const create = mutation({
  args: {
    artifactId: v.id("taskArtifacts"),
    content: v.string(),
    anchor: v.optional(artifactCommentAnchorValidator),
    anchorText: v.optional(v.string()),
    /** Which match of anchorText to anchor to (1-based, default 1). */
    anchorOccurrence: v.optional(v.number()),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("artifactComments"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const artifact = await ensure(getArtifactById(ctx, args.artifactId)).notNull(errors.ARTIFACT_NOT_FOUND);
    ensure(artifact.contentType ?? "markdown").eq("markdown", errors.ARTIFACT_COMMENT_MARKDOWN_ONLY);
    const task = await ensure(getTaskById(ctx, artifact.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.COMMENT_CREATE);

    const content = args.content.trim();
    ensure(content.length).gte(1, errors.ARTIFACT_COMMENT_CONTENT_REQUIRED);

    ensure(args.anchor === undefined || args.anchorText === undefined).isTrue(
      errors.ARTIFACT_COMMENT_ANCHOR_AMBIGUOUS
    );

    let anchor = args.anchor;
    if (args.anchorText !== undefined) {
      anchor = await ensure(
        deriveArtifactCommentAnchor(artifact.content, args.anchorText, args.anchorOccurrence ?? 1)
      ).notNull(errors.ARTIFACT_COMMENT_ANCHOR_TEXT_NOT_FOUND);
    }
    // Anchor is optional (a general artifact comment); a provided anchor must
    // still carry non-blank text.
    if (anchor !== undefined) {
      ensure(anchor.text.trim().length).gte(1, errors.ARTIFACT_COMMENT_ANCHOR_REQUIRED);
    }

    return insertArtifactComment(
      ctx,
      {
        artifactId: args.artifactId,
        taskId: artifact.taskId,
        content,
        anchor,
      },
      user._id
    );
  },
});

/**
 * Reply to a root comment. Replies live on the parent's artifact, carry no
 * anchor and no status, and cannot be replied to.
 */
export const reply = mutation({
  args: {
    parentId: v.id("artifactComments"),
    content: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("artifactComments"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const parent = await ensure(getArtifactCommentById(ctx, args.parentId)).notNull(errors.COMMENT_NOT_FOUND);
    ensure(parent.parentId).isNull(errors.ARTIFACT_COMMENT_REPLY_TO_REPLY);

    const task = await ensure(getTaskById(ctx, parent.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.COMMENT_CREATE);

    const content = args.content.trim();
    ensure(content.length).gte(1, errors.ARTIFACT_COMMENT_CONTENT_REQUIRED);

    return insertArtifactComment(
      ctx,
      {
        artifactId: parent.artifactId,
        taskId: parent.taskId,
        content,
        parentId: args.parentId,
      },
      user._id
    );
  },
});

/**
 * Update a comment's content. Only the author can edit.
 */
export const update = mutation({
  args: {
    commentId: v.id("artifactComments"),
    content: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const comment = await ensure(getArtifactCommentById(ctx, args.commentId)).notNull(errors.COMMENT_NOT_FOUND);
    const task = await ensure(getTaskById(ctx, comment.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    ensure(comment.authorId).eq(user._id, errors.COMMENT_EDIT_AUTHOR_ONLY);

    await requireAuthorizedProject(ctx, user._id, task.projectId, ProjectPermission.COMMENT_UPDATE_OWN);

    const content = args.content.trim();
    ensure(content.length).gte(1, errors.ARTIFACT_COMMENT_CONTENT_REQUIRED);

    await updateArtifactCommentContent(ctx, args.commentId, content);

    return null;
  },
});

/**
 * Delete a comment. Author can delete own, admins any. Deleting a root
 * cascades to its replies. Idempotent.
 */
export const remove = mutation({
  args: {
    commentId: v.id("artifactComments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const comment = await getArtifactCommentById(ctx, args.commentId);
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

    if (!comment.parentId) {
      const replies = await listArtifactCommentRepliesByParent(ctx, args.commentId);
      for (const reply of replies) {
        await deleteArtifactComment(ctx, reply._id);
      }
    }

    await deleteArtifactComment(ctx, args.commentId);

    return null;
  },
});

const MAX_STATUS_BATCH = 100;

/**
 * Resolve or un-resolve root comments (each covers its replies). Any project
 * member who can view the artifact can change status. Atomic: the whole batch
 * fails if any id is missing or not a root comment.
 */
export const setStatus = mutation({
  args: {
    commentIds: v.array(v.id("artifactComments")),
    status: artifactCommentStatusValidator,
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    ensure(args.commentIds.length).between(1, MAX_STATUS_BATCH, errors.ARTIFACT_COMMENT_STATUS_BATCH_SIZE);

    const authorizedProjects = new Set<string>();
    for (const commentId of args.commentIds) {
      const comment = await ensure(getArtifactCommentById(ctx, commentId)).notNull(errors.COMMENT_NOT_FOUND);
      ensure(comment.parentId).isNull(errors.ARTIFACT_COMMENT_RESOLVE_ROOT_ONLY);

      const task = await ensure(getTaskById(ctx, comment.taskId)).notDeleted(errors.TASK_NOT_FOUND);

      if (!authorizedProjects.has(task.projectId)) {
        await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.TASK_VIEW);
        authorizedProjects.add(task.projectId);
      }

      await setArtifactCommentStatus(ctx, commentId, args.status);
    }

    return null;
  },
});
