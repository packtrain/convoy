import { v, type Infer } from "convex/values";
import type { Doc } from "../../../_generated/dataModel";

const artifactSourceValidator = v.union(v.literal("user"), v.literal("agent"));

export const artifactContentTypeValidator = v.union(v.literal("markdown"), v.literal("html"));

export type TaskArtifactContentType = Infer<typeof artifactContentTypeValidator>;

/** Absent `contentType` means a legacy markdown artifact. */
export function resolveArtifactContentType(
  contentType: TaskArtifactContentType | undefined
): TaskArtifactContentType {
  return contentType ?? "markdown";
}

export const taskArtifactSummaryValidator = v.object({
  _id: v.id("taskArtifacts"),
  _creationTime: v.number(),
  taskId: v.id("tasks"),
  name: v.string(),
  fileName: v.string(),
  contentType: v.optional(artifactContentTypeValidator),
  source: artifactSourceValidator,
  runId: v.optional(v.string()),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const taskArtifactValidator = v.object({
  _id: v.id("taskArtifacts"),
  _creationTime: v.number(),
  taskId: v.id("tasks"),
  name: v.string(),
  fileName: v.string(),
  content: v.string(),
  contentType: v.optional(artifactContentTypeValidator),
  source: artifactSourceValidator,
  runId: v.optional(v.string()),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const replaceInTaskArtifactResultValidator = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({
    ok: v.literal(false),
    code: v.union(v.literal("old_string_not_found"), v.literal("multiple_matches")),
    message: v.string(),
  })
);

export function toTaskArtifactSummary(artifact: Doc<"taskArtifacts">) {
  const { content: _content, ...summary } = artifact;
  void _content;
  return summary;
}

export type TaskArtifactSummary = Infer<typeof taskArtifactSummaryValidator>;
