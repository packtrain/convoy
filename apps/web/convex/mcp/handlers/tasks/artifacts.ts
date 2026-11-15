import { api } from "../../../_generated/api";
import { should, throwInvalidParams } from "../../lib/should";
import { resolveTaskIdOrRef } from "../../lib/tasks/resolution";
import type { ToolHandler, ToolResult } from "../context";
import { fetchArtifactCommentThreads } from "./artifactComments";

export const handleListTaskArtifacts: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const taskIdentifier = should.beString(args, "taskId");
  const taskId = await resolveTaskIdOrRef(
    ctx,
    apiKey,
    taskIdentifier,
    "taskId",
    getProjectId
  );
  return ctx.runQuery(api.tasks.artifacts.listTaskArtifactsByTask, {
    taskId,
    apiKey,
  });
};

export const handleGetTaskArtifact: ToolHandler = async ({ ctx, apiKey, args }) => {
  const artifactId = should.beId<"taskArtifacts">(args, "artifactId");
  const includeComments = should.beOptionalBoolean(args, "includeComments");
  const commentsStatus = should.beOptionalEnum(args, "commentsStatus", [
    "open",
    "resolved",
  ] as const);

  const artifact = await ctx.runQuery(api.tasks.artifacts.getTaskArtifact, {
    artifactId,
    apiKey,
  });
  if (!includeComments || artifact === null) {
    return artifact;
  }

  return {
    ...artifact,
    comments: await fetchArtifactCommentThreads(ctx, apiKey, artifactId, commentsStatus),
  };
};

export const handleCreateTaskArtifact: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const taskIdentifier = should.beString(args, "taskId");
  const taskId = await resolveTaskIdOrRef(
    ctx,
    apiKey,
    taskIdentifier,
    "taskId",
    getProjectId
  );
  const name = should.beTrimmedString(args, "name");
  const content = should.beOptionalString(args, "content");
  const contentType = should.beOptionalEnum(args, "contentType", ["markdown", "html"] as const);
  const runId = should.beOptionalString(args, "runId");

  return ctx.runMutation(api.tasks.artifacts.createTaskArtifact, {
    taskId,
    name,
    ...(content !== undefined && { content }),
    ...(contentType !== undefined && { contentType }),
    ...(runId !== undefined && { runId }),
    apiKey,
  });
};

export const handleUpdateTaskArtifact: ToolHandler = async ({ ctx, apiKey, args }) => {
  const artifactId = should.beId<"taskArtifacts">(args, "artifactId");
  const name = should.beOptionalString(args, "name");
  const content = should.beOptionalString(args, "content");
  const runId = should.beNullableString(args, "runId");

  return ctx.runMutation(api.tasks.artifacts.updateTaskArtifact, {
    artifactId,
    ...(name !== undefined && { name }),
    ...(content !== undefined && { content }),
    ...(runId !== undefined && { runId }),
    apiKey,
  });
};

export const handleReplaceInTaskArtifact: ToolHandler = async ({ ctx, apiKey, args }) => {
  const artifactId = should.beId<"taskArtifacts">(args, "artifactId");
  const oldString = should.beString(args, "oldString");
  const newString = args.newString;
  const replaceAll = should.beOptionalBoolean(args, "replaceAll");

  if (typeof newString !== "string") {
    throwInvalidParams("newString is required and must be a string");
  }

  const result = await ctx.runMutation(api.tasks.artifacts.replaceInTaskArtifact, {
    artifactId,
    oldString,
    newString,
    replaceAll: replaceAll ?? false,
    apiKey,
  });

  if (result.ok === false) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    } satisfies ToolResult;
  }

  return result;
};

export const handleMoveTaskArtifact: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const artifactId = should.beId<"taskArtifacts">(args, "artifactId");
  const taskIdentifier = should.beString(args, "taskId");
  const taskId = await resolveTaskIdOrRef(
    ctx,
    apiKey,
    taskIdentifier,
    "taskId",
    getProjectId
  );

  return ctx.runMutation(api.tasks.artifacts.moveTaskArtifact, {
    artifactId,
    taskId,
    apiKey,
  });
};

export const handleDeleteTaskArtifact: ToolHandler = async ({ ctx, apiKey, args }) => {
  const artifactId = should.beId<"taskArtifacts">(args, "artifactId");
  return ctx.runMutation(api.tasks.artifacts.deleteTaskArtifact, {
    artifactId,
    apiKey,
  });
};
