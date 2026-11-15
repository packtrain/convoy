import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { ArtifactCommentAnchor } from "./validators";

type Ctx = QueryCtx | MutationCtx;

export async function getArtifactCommentById(
  ctx: Ctx,
  commentId: Id<"artifactComments">
): Promise<Doc<"artifactComments"> | null> {
  return ctx.db.get("artifactComments", commentId);
}

/**
 * All comments (roots and replies) for an artifact, oldest first. The client
 * needs every root's anchor to draw highlights, so this is intentionally not
 * paginated; `limit` bounds the read.
 */
export async function listArtifactCommentsByArtifact(
  ctx: Ctx,
  artifactId: Id<"taskArtifacts">,
  limit: number
): Promise<Doc<"artifactComments">[]> {
  return ctx.db
    .query("artifactComments")
    .withIndex("by_artifact_and_createdAt", (q) => q.eq("artifactId", artifactId))
    .take(limit);
}

/**
 * Every comment for an artifact, unbounded. For whole-artifact passes — the
 * delete cascade and the move re-anchor — where skipping a row is a correctness
 * bug: `taskId` is the permission anchor, and the caller-supplied limit above
 * caps one list query, not the stored rows.
 */
export async function listAllArtifactCommentsByArtifact(
  ctx: Ctx,
  artifactId: Id<"taskArtifacts">
): Promise<Doc<"artifactComments">[]> {
  return ctx.db
    .query("artifactComments")
    .withIndex("by_artifact_and_createdAt", (q) => q.eq("artifactId", artifactId))
    .collect();
}

/** Replies of a root comment, oldest first (bounded: threads are small). */
export async function listArtifactCommentRepliesByParent(
  ctx: Ctx,
  parentId: Id<"artifactComments">
): Promise<Doc<"artifactComments">[]> {
  return ctx.db
    .query("artifactComments")
    .withIndex("by_parent_and_createdAt", (q) => q.eq("parentId", parentId))
    .collect();
}

/**
 * Insert a comment, stamping `createdAt`/`updatedAt`/`isEdited`. Roots carry an
 * anchor and start `open`; replies carry neither.
 */
export async function insertArtifactComment(
  ctx: MutationCtx,
  props: {
    artifactId: Id<"taskArtifacts">;
    taskId: Id<"tasks">;
    content: string;
    parentId?: Id<"artifactComments">;
    anchor?: ArtifactCommentAnchor;
  },
  authorId: Id<"users">
): Promise<Id<"artifactComments">> {
  const now = Date.now();
  return ctx.db.insert("artifactComments", {
    artifactId: props.artifactId,
    taskId: props.taskId,
    parentId: props.parentId,
    authorId,
    content: props.content,
    anchor: props.parentId ? undefined : props.anchor,
    status: props.parentId ? undefined : "open",
    createdAt: now,
    updatedAt: now,
    isEdited: false,
  });
}

/** Apply an author edit: replaces content, stamps `updatedAt`, marks edited. */
export async function updateArtifactCommentContent(
  ctx: MutationCtx,
  commentId: Id<"artifactComments">,
  content: string
): Promise<void> {
  await ctx.db.patch("artifactComments", commentId, {
    content,
    updatedAt: Date.now(),
    isEdited: true,
  });
}

/** `updatedAt` tracks content edits only, so a status change doesn't bump it. */
export async function setArtifactCommentStatus(
  ctx: MutationCtx,
  commentId: Id<"artifactComments">,
  status: "open" | "resolved"
): Promise<void> {
  await ctx.db.patch("artifactComments", commentId, { status });
}

export async function deleteArtifactComment(
  ctx: MutationCtx,
  commentId: Id<"artifactComments">
): Promise<void> {
  await ctx.db.delete("artifactComments", commentId);
}
