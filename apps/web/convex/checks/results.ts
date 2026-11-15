import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { authorizeProjectAccess, hasProjectAccess, type ProjectAccessPrincipal } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { checkReportInputValidator, cliMessageAttachmentValidator } from "../lib/contracts/validators";
import { ensure } from "../lib/shared/ensure";
import { getViewableThread } from "../cli/lib/permissions";
import { getActiveTaskById } from "../tasks/lib/tasksRepo";
import { getArtifactById, normalizeTaskArtifactId } from "../tasks/lib/taskArtifactsRepo";
import { errors } from "./errors";
import { MAX_CHECK_NOTE_LENGTH, MAX_CHECK_VALUE_LENGTH } from "./lib/constants";
import { findCheckDefinitionByKey } from "./lib/checkDefinitionsRepo";
import { getCheckResultById, insertCheckResult } from "./lib/checkResultsRepo";
import { validateCheckKey, validateCheckLabel } from "./lib/naming";

/**
 * Records one Check result for `convoy threads attach --check`, inside `cli.messages.attachToResponse`
 * so the files and the result commit together. Spec: docs/specs/task-checks.md → Reporting.
 */
export const report = internalMutation({
  args: {
    projectId: v.id("projects"),
    taskId: v.optional(v.id("tasks")),
    threadId: v.id("cliThreads"),
    messageId: v.id("cliMessages"),
    threadTitle: v.string(),
    threadOwnerId: v.id("users"),
    check: checkReportInputValidator,
    files: v.array(cliMessageAttachmentValidator),
  },
  returns: v.id("checkResults"),
  handler: async (ctx, { check, ...args }) => {
    const checkKey = validateCheckKey(check.key);
    const note = check.note?.trim() || undefined;
    if (check.status !== "passed") {
      ensure(note).notNull(errors.checkNoteRequired(check.status.replace("_", " ")));
    }
    ensure(note?.length ?? 0).lte(MAX_CHECK_NOTE_LENGTH, errors.checkNoteTooLong(MAX_CHECK_NOTE_LENGTH));
    const value = check.value?.trim() || undefined;
    ensure(value?.length ?? 0).lte(MAX_CHECK_VALUE_LENGTH, errors.checkValueTooLong(MAX_CHECK_VALUE_LENGTH));
    const artifact = check.artifactId === undefined ? undefined : await requireReportableArtifact(ctx, check.artifactId, args);

    const definition = await findCheckDefinitionByKey(ctx, args.projectId, checkKey);
    if (!definition) {
      ensure(Boolean(check.label?.trim())).isTrue(errors.checkLabelRequiredOutsideCatalog(checkKey));
    }
    const label = definition?.label ?? validateCheckLabel(check.label ?? "");

    return insertCheckResult(ctx, {
      ...args,
      checkKey,
      label,
      status: check.status,
      note,
      value,
      artifactId: artifact?._id,
      artifactName: artifact?.name,
    });
  },
});

/** Any task's artifact in the result's project that the thread owner can read (docs/specs/task-checks.md → Reporting). */
async function requireReportableArtifact(
  ctx: MutationCtx,
  rawId: string,
  owner: { projectId: Id<"projects">; threadOwnerId: Id<"users"> }
): Promise<Doc<"taskArtifacts">> {
  const id = normalizeTaskArtifactId(ctx, rawId);
  const artifact = id ? await getArtifactById(ctx, id) : null;
  const task = artifact ? await getActiveTaskById(ctx, artifact.taskId) : null;
  // Readability first, so the project error never confirms an artifact the owner cannot see.
  if (!artifact || !task || !(await hasProjectAccess(ctx, owner.threadOwnerId, task.projectId, ProjectPermission.TASK_VIEW))) {
    throw new ConvexError(errors.checkArtifactNotFound(rawId));
  }
  ensure(task.projectId === owner.projectId).isTrue(errors.CHECK_ARTIFACT_DIFFERENT_PROJECT);
  return artifact;
}

/** Signed URLs for one result's files, gated by task access, or thread access while a thread owns it. */
export const getFileUrls = query({
  args: { resultId: v.id("checkResults"), apiKey: v.optional(v.string()) },
  returns: v.array(v.object({ storageId: v.id("_storage"), url: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    const result = auth ? await getCheckResultById(ctx, args.resultId) : null;
    if (!auth || !result || !(await canViewResults(ctx, auth.principal, result))) {
      return [];
    }
    return Promise.all(
      result.files.map(async (file) => ({ storageId: file.storageId, url: await ctx.storage.getUrl(file.storageId) }))
    );
  },
});

async function canViewResults(ctx: QueryCtx, principal: ProjectAccessPrincipal, result: Doc<"checkResults">): Promise<boolean> {
  if (result.taskId === undefined) {
    return (await getViewableThread(ctx, principal, result.threadId)) !== null;
  }
  const task = await getActiveTaskById(ctx, result.taskId);
  return task !== null && (await authorizeProjectAccess(ctx, principal, task.projectId, ProjectPermission.TASK_VIEW)) !== null;
}
