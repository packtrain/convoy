import type { Id } from "../../../../_generated/dataModel";

export type McpTaskCommentAttachmentSummary = {
  _id: Id<"taskCommentAttachments">;
  fileName: string;
  fileSize: number;
  contentType: string;
  url: string | null;
};

export type McpTaskCommentSummary = {
  _id: Id<"taskComments">;
  authorId: Id<"users">;
  authorName: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  isEdited: boolean;
  attachments: McpTaskCommentAttachmentSummary[];
};
