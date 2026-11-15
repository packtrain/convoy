import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api.js";

export type ArtifactCommentItem = FunctionReturnType<typeof api.tasks.artifactComments.listByArtifact>[number];

export const COMMENT_STATUSES = ["open", "resolved"] as const;
export type ArtifactCommentStatus = (typeof COMMENT_STATUSES)[number];

export function parseCommentStatus(value: string): ArtifactCommentStatus {
  if (!(COMMENT_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`--status must be one of: ${COMMENT_STATUSES.join(", ")}`);
  }
  return value as ArtifactCommentStatus;
}
