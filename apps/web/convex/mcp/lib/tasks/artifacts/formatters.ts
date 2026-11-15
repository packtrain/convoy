import type { Id } from "../../../../_generated/dataModel";

export type McpTaskArtifactSummary = {
  _id: Id<"taskArtifacts">;
  name: string;
  contentType: "markdown" | "html";
  source: "user" | "agent";
  runId?: string;
  createdAt: number;
  updatedAt: number;
};

export type McpTaskFileSummary = {
  _id: Id<"taskAttachments">;
  fileName: string;
  fileSize: number;
  contentType: string;
  uploadedAt: number;
  url: string | null;
};
