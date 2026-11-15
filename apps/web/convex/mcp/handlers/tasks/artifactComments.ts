import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { ActionCtx } from "../../../_generated/server";
import type { ArtifactCommentListItem } from "../../../tasks/lib/artifactComments/validators";
import { should, throwInvalidParams } from "../../lib/should";
import type { ToolHandler } from "../context";

const COMMENT_STATUSES = ["open", "resolved"] as const;
const MAX_STATUS_BATCH = 100;

function toReplySummary(comment: ArtifactCommentListItem) {
  return {
    commentId: comment._id,
    authorName: comment.authorName,
    content: comment.content,
    createdAt: comment.createdAt,
    isEdited: comment.isEdited,
  };
}

/**
 * Fetch an artifact's comments grouped into threads (roots with flat replies).
 * Shared by list_artifact_comments and get_task_artifact's includeComments.
 */
export async function fetchArtifactCommentThreads(
  ctx: ActionCtx,
  apiKey: string,
  artifactId: Id<"taskArtifacts">,
  status?: (typeof COMMENT_STATUSES)[number]
) {
  const comments = await ctx.runQuery(api.tasks.artifactComments.listByArtifact, {
    artifactId,
    ...(status !== undefined && { status }),
    apiKey,
  });

  const repliesByParent = new Map<string, ArtifactCommentListItem[]>();
  for (const comment of comments) {
    if (!comment.parentId) continue;
    const list = repliesByParent.get(comment.parentId) ?? [];
    list.push(comment);
    repliesByParent.set(comment.parentId, list);
  }

  return comments
    .filter((comment) => !comment.parentId)
    .map((root) => ({
      ...toReplySummary(root),
      status: root.status ?? "open",
      anchorText: root.anchor?.text ?? "",
      replies: (repliesByParent.get(root._id) ?? []).map(toReplySummary),
    }));
}

export const handleListArtifactComments: ToolHandler = async ({ ctx, apiKey, args }) => {
  const artifactId = should.beId<"taskArtifacts">(args, "artifactId");
  const status = should.beOptionalEnum(args, "status", COMMENT_STATUSES);

  return { threads: await fetchArtifactCommentThreads(ctx, apiKey, artifactId, status) };
};

export const handleCreateArtifactComment: ToolHandler = async ({ ctx, apiKey, args }) => {
  const artifactId = should.beId<"taskArtifacts">(args, "artifactId");
  const content = should.beTrimmedString(args, "content");
  const anchorText = should.beString(args, "anchorText");
  const occurrence = should.beOptionalInteger(args, "occurrence", 1, 10_000);

  const commentId = await ctx.runMutation(api.tasks.artifactComments.create, {
    artifactId,
    content,
    anchorText,
    ...(occurrence !== undefined && { anchorOccurrence: occurrence }),
    apiKey,
  });
  return { commentId };
};

export const handleReplyToArtifactComment: ToolHandler = async ({ ctx, apiKey, args }) => {
  const parentId = should.beId<"artifactComments">(args, "commentId");
  const content = should.beTrimmedString(args, "content");

  const commentId = await ctx.runMutation(api.tasks.artifactComments.reply, {
    parentId,
    content,
    apiKey,
  });
  return { commentId };
};

export const handleSetArtifactCommentStatus: ToolHandler = async ({ ctx, apiKey, args }) => {
  const commentIds = should.beStringArray(args, "commentIds", MAX_STATUS_BATCH);
  const status = should.beOptionalEnum(args, "status", COMMENT_STATUSES);
  if (status === undefined) {
    throwInvalidParams(`status is required and must be one of: ${COMMENT_STATUSES.join(", ")}`);
  }

  await ctx.runMutation(api.tasks.artifactComments.setStatus, {
    commentIds: commentIds as Id<"artifactComments">[],
    status,
    apiKey,
  });
  return null;
};
