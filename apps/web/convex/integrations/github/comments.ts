import { ConvexError, v } from "convex/values";
import { internal } from "../../_generated/api";
import { action, internalMutation, mutation } from "../../_generated/server";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { getAuthenticatedAccess } from "../../lib/access/auth";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import { isSafeFileName } from "../../lib/shared/strings";
import { deleteStorageIfOversized, deleteStorageIfUnreferenced, getStorageSize, isStorageClaimed } from "../../lib/storageRepo";
import { errors } from "./errors";
import { writeAs } from "./accounts";
import { deleteCommentFile, findOwnCommentFile, insertCommentFile, markCommentFilePosted } from "./lib/integrationCommentFilesRepo";
import { githubFetch } from "./lib/github";
import { normalizeComment, record, str } from "./lib/parsers";
import { pullRequestCommentValidator, type PullRequestComment } from "./lib/validators";

// Conversation comments, written as the member's own Linked GitHub account (ADR 0012). GitHub decides who may write;
// Convoy also limits edits and deletes to the author's own comments on this PR.

/** GitHub's limit for a comment body. */
const MAX_COMMENT_LENGTH = 65_536;

/** Bounds the reads one comment's files cost. */
const MAX_COMMENT_FILES = 10;

const refused = { refused: errors.COMMENT_REFUSED };

const target = { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() };

function requireBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new ConvexError(errors.COMMENT_EMPTY);
  if (trimmed.length > MAX_COMMENT_LENGTH) throw new ConvexError(errors.COMMENT_TOO_LONG);
  return trimmed;
}

/**
 * GitHub lets anyone with write access edit or delete any comment; Convoy
 * allows only the author's own, and only on this PR.
 */
async function requireOwnComment(token: string, repository: string, githubUserId: number, number: number, commentId: number) {
  const comment = record(await githubFetch(`${repository}/issues/comments/${commentId}`, { token }));
  const author = comment.user ? record(comment.user).id : null;
  if (author !== githubUserId || !str(comment.issue_url).endsWith(`/issues/${number}`)) {
    throw new ConvexError(errors.COMMENT_NOT_YOURS);
  }
}

// Files: GitHub's API can't upload attachments, so Convoy hosts each file and the comment links its
// unguessable storage URL (docs/specs/github-integration.md → Comment attachments).

/** Step 1 of attaching a file: an upload URL for a project member. */
export const generateUploadUrl = mutation({
  args: { projectId: v.id("projects") },
  returns: v.string(),
  handler: async (ctx, { projectId }) => {
    const { principal } = await getAuthenticatedAccess(ctx);
    await requireAuthorizedProject(ctx, principal, projectId, ProjectPermission.PROJECT_VIEW);
    return ctx.storage.generateUploadUrl();
  },
});

/** Step 2: records the uploaded blob as the caller's. A blob anyone already claimed, or a missing one, gets nothing. */
export const registerUpload = mutation({
  args: { projectId: v.id("projects"), storageId: v.id("_storage"), fileName: v.string(), contentType: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, storageId, fileName, contentType }) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    await requireAuthorizedProject(ctx, principal, projectId, ProjectPermission.PROJECT_VIEW);
    if (!isSafeFileName(fileName)) throw new ConvexError(errors.COMMENT_FILE_NAME_INVALID);
    if (await findOwnCommentFile(ctx, { projectId, userId: user._id, storageId })) return null;
    if ((await getStorageSize(ctx, storageId)) === null || (await isStorageClaimed(ctx, storageId))) return null;
    if (await deleteStorageIfOversized(ctx, storageId)) return null;
    await insertCommentFile(ctx, { projectId, userId: user._id, storageId, fileName, contentType });
    return null;
  },
});

/** Removes the caller's unposted upload. A posted one stays: a comment links it. */
export const discardUpload = mutation({
  args: { projectId: v.id("projects"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { projectId, storageId }) => {
    const { user } = await getAuthenticatedAccess(ctx);
    const row = await findOwnCommentFile(ctx, { projectId, userId: user._id, storageId });
    if (!row || row.postedAt) return null;
    await deleteCommentFile(ctx, row._id);
    await deleteStorageIfUnreferenced(ctx, storageId);
    return null;
  },
});

const filesArgs = { projectId: v.id("projects"), storageIds: v.array(v.id("_storage")) };

/** Escapes what would end or style a link's text. */
const linkText = (fileName: string) => fileName.replace(/[\\`*_[\]<>]/g, "\\$&");

/**
 * Before the GitHub request: marks the caller's uploads posted for good, so no discard, mid-post or after
 * a refusal, can break a link GitHub may hold. Returns them as Markdown lines, images inline as on GitHub.
 */
export const reserveFiles = internalMutation({
  args: filesArgs,
  returns: v.string(),
  handler: async (ctx, { projectId, storageIds }) => {
    const { user } = await getAuthenticatedAccess(ctx);
    const lines: string[] = [];
    for (const storageId of storageIds) {
      const row = await findOwnCommentFile(ctx, { projectId, userId: user._id, storageId });
      const url = row ? await ctx.storage.getUrl(storageId) : null;
      if (!row || !url) throw new ConvexError(errors.COMMENT_FILE_NOT_FOUND);
      if (!row.postedAt) await markCommentFilePosted(ctx, row._id);
      lines.push(`${row.contentType.startsWith("image/") ? "!" : ""}[${linkText(row.fileName)}](${url})`);
    }
    return lines.join("\n");
  },
});

export const create = action({
  args: { ...target, body: v.string(), files: v.optional(v.array(v.id("_storage"))) },
  returns: pullRequestCommentValidator,
  handler: async (ctx, { body, files = [], ...args }): Promise<PullRequestComment> => {
    if (files.length > MAX_COMMENT_FILES) throw new ConvexError(errors.COMMENT_TOO_MANY_FILES);
    const storageIds = [...new Set(files)];
    const links = storageIds.length ? await ctx.runMutation(internal.integrations.github.comments.reserveFiles, { projectId: args.projectId, storageIds }) : "";
    const text = requireBody([body.trim(), links].filter(Boolean).join("\n\n"));
    return writeAs(
      ctx,
      args,
      async (token, repository) =>
        normalizeComment(await githubFetch(`${repository}/issues/${args.number}/comments`, { token }, { method: "POST", body: { body: text } })),
      refused
    );
  },
});

export const update = action({
  args: { ...target, commentId: v.number(), body: v.string() },
  returns: pullRequestCommentValidator,
  handler: async (ctx, { body, commentId, ...args }): Promise<PullRequestComment> => {
    const text = requireBody(body);
    return writeAs(ctx, args, async (token, repository, githubUserId) => {
      await requireOwnComment(token, repository, githubUserId, args.number, commentId);
      return normalizeComment(await githubFetch(`${repository}/issues/comments/${commentId}`, { token }, { method: "PATCH", body: { body: text } }));
    }, refused);
  },
});

export const remove = action({
  args: { ...target, commentId: v.number() },
  returns: v.null(),
  handler: async (ctx, { commentId, ...args }): Promise<null> => {
    await writeAs(ctx, args, async (token, repository, githubUserId) => {
      await requireOwnComment(token, repository, githubUserId, args.number, commentId);
      await githubFetch(`${repository}/issues/comments/${commentId}`, { token }, { method: "DELETE" });
    }, refused);
    return null;
  },
});
