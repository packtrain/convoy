import { v, type Infer } from "convex/values";

export const taskAttachmentRowValidator = v.object({
  _id: v.id("taskAttachments"),
  _creationTime: v.number(),
  taskId: v.id("tasks"),
  storageId: v.id("_storage"),
  fileName: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  uploadedBy: v.id("users"),
  uploadedAt: v.number(),
  url: v.union(v.string(), v.null()),
});

export type TaskAttachmentRow = Infer<typeof taskAttachmentRowValidator>;
