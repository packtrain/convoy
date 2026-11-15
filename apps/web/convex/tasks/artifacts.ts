import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthenticatedAccess, getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { hasProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { countStringOccurrences } from "../lib/shared/strings";
import { ensure } from "../lib/shared/ensure";
import { buildPatch, mapClearable, mapDefined } from "../lib/shared/patch";
import { logTaskActivity } from "./lib/activity/logger";
import { getActiveTaskById, getTaskById, patchTask, transferTaskResourceCount } from "./lib/tasksRepo";
import {
  deleteArtifact,
  generateUniqueArtifactFileName,
  getArtifactById,
  insertArtifact,
  listArtifactsByTaskNewestFirst,
  moveArtifactToTask,
  normalizeTaskArtifactId,
  updateArtifact,
  type TaskArtifactPatch,
} from "./lib/taskArtifactsRepo";
import {
  normalizeArtifactContent,
  normalizeArtifactName,
  normalizeArtifactRunId,
} from "./lib/artifacts/normalize";
import {
  artifactContentTypeValidator,
  replaceInTaskArtifactResultValidator,
  taskArtifactSummaryValidator,
  taskArtifactValidator,
  toTaskArtifactSummary,
} from "./lib/artifacts/validators";
import { errors } from "./errors";

/**
 * View access: empty/null when unauthenticated, the task is missing or
 * deleted, or the principal lacks TASK_VIEW (access semantics, not errors).
 */
async function getViewableArtifacts(
  ctx: QueryCtx,
  taskId: Id<"tasks">,
  apiKey: string | undefined
): Promise<Doc<"taskArtifacts">[]> {
  const auth = await getOptionalAuthenticatedAccess(ctx, apiKey);
  if (!auth) {
    return [];
  }

  const task = await getActiveTaskById(ctx, taskId);
  if (!task) {
    return [];
  }

  const hasAccess = await hasProjectAccess(ctx, auth.principal, task.projectId, ProjectPermission.TASK_VIEW);
  if (!hasAccess) {
    return [];
  }

  return listArtifactsByTaskNewestFirst(ctx, taskId);
}

async function getViewableArtifact(
  ctx: QueryCtx,
  artifactId: Id<"taskArtifacts">,
  apiKey: string | undefined
): Promise<Doc<"taskArtifacts"> | null> {
  const auth = await getOptionalAuthenticatedAccess(ctx, apiKey);
  if (!auth) {
    return null;
  }

  const artifact = await getArtifactById(ctx, artifactId);
  if (!artifact) {
    return null;
  }

  const task = await getActiveTaskById(ctx, artifact.taskId);
  if (!task) {
    return null;
  }

  const hasAccess = await hasProjectAccess(ctx, auth.principal, task.projectId, ProjectPermission.TASK_VIEW);
  if (!hasAccess) {
    return null;
  }

  return artifact;
}

/** Edit access: throws unless the artifact and its task exist and the principal has TASK_UPDATE. */
async function requireEditableArtifact(ctx: MutationCtx, artifactId: Id<"taskArtifacts">, apiKey: string | undefined) {
  const { user, principal } = await getAuthenticatedAccess(ctx, apiKey);

  const artifact = await ensure(getArtifactById(ctx, artifactId)).notNull(errors.ARTIFACT_NOT_FOUND);
  const task = await ensure(getTaskById(ctx, artifact.taskId)).notDeleted(errors.TASK_NOT_FOUND);

  await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.TASK_UPDATE);

  return { user, artifact, task };
}

export const listTaskArtifactsByTask = query({
  args: {
    taskId: v.id("tasks"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(taskArtifactSummaryValidator),
  handler: async (ctx, args) => {
    const artifacts = await getViewableArtifacts(ctx, args.taskId, args.apiKey);
    return artifacts.map(toTaskArtifactSummary);
  },
});

export const getTaskArtifact = query({
  args: {
    artifactId: v.id("taskArtifacts"),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(taskArtifactValidator, v.null()),
  handler: async (ctx, args) => {
    return await getViewableArtifact(ctx, args.artifactId, args.apiKey);
  },
});

export const getTaskArtifactSafe = query({
  args: {
    artifactId: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(taskArtifactValidator, v.null()),
  handler: async (ctx, args) => {
    const artifactId = normalizeTaskArtifactId(ctx, args.artifactId);
    if (!artifactId) {
      return null;
    }
    return await getViewableArtifact(ctx, artifactId, args.apiKey);
  },
});

export const createTaskArtifact = mutation({
  args: {
    taskId: v.id("tasks"),
    name: v.string(),
    content: v.optional(v.string()),
    contentType: v.optional(artifactContentTypeValidator),
    runId: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("taskArtifacts"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const task = await ensure(getTaskById(ctx, args.taskId)).notDeleted(errors.TASK_NOT_FOUND);

    await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.TASK_UPDATE);

    const name = normalizeArtifactName(args.name);
    const content = normalizeArtifactContent(args.content);
    const runId = normalizeArtifactRunId(args.runId);
    const fileName = await generateUniqueArtifactFileName(ctx, args.taskId, name, args.contentType);

    const artifactId = await insertArtifact(
      ctx,
      {
        taskId: args.taskId,
        name,
        fileName,
        content,
        ...(args.contentType !== undefined && { contentType: args.contentType }),
        source: args.apiKey ? "agent" : "user",
        ...(runId !== undefined && { runId }),
      },
      user._id
    );

    // Maintain the denormalized counter (OS-882). No `updatedAt` bump on
    // purpose: artifact changes are already recorded via activity logs.
    await patchTask(
      ctx,
      args.taskId,
      { artifactCount: (task.artifactCount ?? 0) + 1 },
      { bumpUpdatedAt: false }
    );

    await logTaskActivity.artifactAdded(ctx, {
      taskId: args.taskId,
      userId: user._id,
      fileName,
    });

    return artifactId;
  },
});

export const updateTaskArtifact = mutation({
  args: {
    artifactId: v.id("taskArtifacts"),
    name: v.optional(v.string()),
    content: v.optional(v.string()),
    runId: v.optional(v.union(v.string(), v.null())),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, artifact } = await requireEditableArtifact(ctx, args.artifactId, args.apiKey);

    const name = mapDefined(args.name, normalizeArtifactName);
    const fileName =
      name === undefined
        ? undefined
        : await generateUniqueArtifactFileName(
            ctx,
            artifact.taskId,
            name,
            artifact.contentType,
            artifact._id
          );

    const patch = buildPatch<TaskArtifactPatch>({
      name,
      // contentType is immutable; renames keep the artifact's extension.
      fileName,
      content: mapDefined(args.content, normalizeArtifactContent),
      runId: mapClearable(args.runId, normalizeArtifactRunId),
    });

    await updateArtifact(ctx, args.artifactId, patch, user._id);

    await logTaskActivity.artifactUpdated(ctx, {
      taskId: artifact.taskId,
      userId: user._id,
      fileName: patch.fileName ?? artifact.fileName,
    });

    return null;
  },
});

export const replaceInTaskArtifact = mutation({
  args: {
    artifactId: v.id("taskArtifacts"),
    oldString: v.string(),
    newString: v.string(),
    replaceAll: v.optional(v.boolean()),
    apiKey: v.optional(v.string()),
  },
  returns: replaceInTaskArtifactResultValidator,
  handler: async (ctx, args) => {
    const { user, artifact } = await requireEditableArtifact(ctx, args.artifactId, args.apiKey);

    ensure(args.oldString).notEq("", errors.OLD_STRING_REQUIRED);
    const occurrenceCount = countStringOccurrences(artifact.content, args.oldString);
    if (occurrenceCount === 0) {
      return {
        ok: false as const,
        code: "old_string_not_found" as const,
        message: "oldString was not found in artifact content",
      };
    }
    if (occurrenceCount > 1 && args.replaceAll !== true) {
      return {
        ok: false as const,
        code: "multiple_matches" as const,
        message: "oldString matches multiple locations; pass replaceAll to replace every occurrence",
      };
    }

    const content = artifact.content.split(args.oldString).join(args.newString);

    await updateArtifact(ctx, args.artifactId, { content: normalizeArtifactContent(content) }, user._id);

    await logTaskActivity.artifactUpdated(ctx, {
      taskId: artifact.taskId,
      userId: user._id,
      fileName: artifact.fileName,
    });

    return { ok: true as const };
  },
});

export const moveTaskArtifact = mutation({
  args: {
    artifactId: v.id("taskArtifacts"),
    taskId: v.id("tasks"),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, artifact, task } = await requireEditableArtifact(ctx, args.artifactId, args.apiKey);

    if (artifact.taskId === args.taskId) {
      return null;
    }

    const target = await ensure(getTaskById(ctx, args.taskId)).notDeleted(errors.TASK_NOT_FOUND);
    // Same project only: TASK_UPDATE is project-scoped, so the source check
    // above covers the target, and comments keep their project scope.
    ensure(target.projectId).eq(task.projectId, errors.TASKS_SAME_PROJECT);

    // `fileName` is unique per task, so the move reallocates it.
    const fileName = await generateUniqueArtifactFileName(
      ctx,
      args.taskId,
      artifact.name,
      artifact.contentType
    );
    await moveArtifactToTask(ctx, args.artifactId, args.taskId, fileName, user._id);

    await transferTaskResourceCount(ctx, {
      from: task,
      to: target,
      field: "artifactCount",
    });

    await logTaskActivity.artifactRemoved(ctx, {
      taskId: task._id,
      userId: user._id,
      fileName: artifact.fileName,
    });
    await logTaskActivity.artifactAdded(ctx, {
      taskId: args.taskId,
      userId: user._id,
      fileName,
    });

    return null;
  },
});

export const deleteTaskArtifact = mutation({
  args: {
    artifactId: v.id("taskArtifacts"),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, artifact, task } = await requireEditableArtifact(ctx, args.artifactId, args.apiKey);

    await deleteArtifact(ctx, args.artifactId);

    // Clamped at zero so defensive cleanup/retry paths can't go negative.
    await patchTask(
      ctx,
      task._id,
      { artifactCount: Math.max(0, (task.artifactCount ?? 0) - 1) },
      { bumpUpdatedAt: false }
    );

    await logTaskActivity.artifactRemoved(ctx, {
      taskId: artifact.taskId,
      userId: user._id,
      fileName: artifact.fileName,
    });

    return null;
  },
});
