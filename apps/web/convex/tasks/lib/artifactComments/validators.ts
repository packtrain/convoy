import { v, type Infer } from "convex/values";

/**
 * A comment's range anchor (roots only): the selected snippet plus surrounding
 * context, copied at creation. Offsets are search hints, not authoritative
 * (docs/specs/artifact-comments.md).
 */
export const artifactCommentAnchorValidator = v.object({
  text: v.string(),
  prefix: v.string(),
  suffix: v.string(),
  startOffset: v.number(),
  endOffset: v.number(),
});

export type ArtifactCommentAnchor = Infer<typeof artifactCommentAnchorValidator>;

export const artifactCommentStatusValidator = v.union(v.literal("open"), v.literal("resolved"));

export const artifactCommentListItemValidator = v.object({
  _id: v.id("artifactComments"),
  _creationTime: v.number(),
  artifactId: v.id("taskArtifacts"),
  taskId: v.id("tasks"),
  parentId: v.optional(v.id("artifactComments")),
  authorId: v.id("users"),
  content: v.string(),
  anchor: v.optional(artifactCommentAnchorValidator),
  status: v.optional(artifactCommentStatusValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
  isEdited: v.boolean(),
  authorName: v.string(),
  authorAvatarUrl: v.union(v.string(), v.null()),
  canEdit: v.boolean(),
  canDelete: v.boolean(),
});

export type ArtifactCommentListItem = Infer<typeof artifactCommentListItemValidator>;
