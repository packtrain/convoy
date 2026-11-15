import { v, type Infer } from "convex/values";

const taskCommentAttachmentSummaryValidator = v.object({
  _id: v.id("taskCommentAttachments"),
  fileName: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  url: v.union(v.string(), v.null()),
});

export const taskCommentListItemValidator = v.object({
  _id: v.id("taskComments"),
  _creationTime: v.number(),
  taskId: v.id("tasks"),
  authorId: v.id("users"),
  content: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  isEdited: v.boolean(),
  authorName: v.string(),
  authorAvatarUrl: v.union(v.string(), v.null()),
  attachments: v.array(taskCommentAttachmentSummaryValidator),
  canEdit: v.boolean(),
  canDelete: v.boolean(),
});

export type TaskCommentAttachmentRow = Infer<typeof taskCommentAttachmentSummaryValidator>;
export type TaskCommentRow = Infer<typeof taskCommentListItemValidator>;
