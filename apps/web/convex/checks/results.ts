import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { authorizeProjectAccess, hasProjectAccess, type ProjectAccessPrincipal } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { checkReportInputValidator, checkResultStatusValidator, cliMessageAttachmentValidator } from "../lib/contracts/validators";
import { ensure } from "../lib/shared/ensure";
import { getViewableThread } from "../cli/lib/permissions";
import { getActiveTaskById } from "../tasks/lib/tasksRepo";
import { getArtifactById, normalizeTaskArtifactId } from "../tasks/lib/taskArtifactsRepo";
import { errors } from "./errors";
import { MAX_CHECK_NOTE_LENGTH, MAX_CHECK_VALUE_LENGTH, MAX_PULL_REQUEST_LIST_CHECKS, MAX_PULL_REQUEST_LIST_REFS } from "./lib/constants";
import { findCheckDefinitionByKey, listCheckDefinitionsByProject } from "./lib/checkDefinitionsRepo";
import { findLatestPullRequestResult, getCheckResultById, insertCheckResult, patchCheckResult } from "./lib/checkResultsRepo";
import { listChecklistsByProject } from "./lib/checklistsRepo";
import { validateCheckKey, validateCheckLabel } from "./lib/naming";
import { parseAttachedPullRequest } from "../lib/contracts/github";
import { findLinkedPullRequest } from "../integrations/github/lib/integrationPullRequestsRepo";
import { listActiveRepositoryLinksForProject } from "../integrations/github/lib/integrationRepositoryLinksRepo";

/**
 * Records one Check result for `convoy threads attach --check`, inside `cli.messages.attachToResponse`
 * so the files and the result commit together. Spec: docs/specs/task-checks.md → Reporting.
 */
export const report = internalMutation({
  args: {
    projectId: v.id("projects"),
    taskId: v.optional(v.id("tasks")),
    pullRequest: v.optional(v.object({ ref: v.string(), headSha: v.string() })),
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

    const resultId = await insertCheckResult(ctx, {
      ...args,
      checkKey,
      label,
      status: check.status,
      note,
      value,
      artifactId: artifact?._id,
      artifactName: artifact?.name,
    });
    // An action, so `report` stays a mutation and a GitHub failure never rolls the result back (OS-2401).
    // Catalog Checks only: an off-catalog label is the agent's, and must not name a check run on GitHub.
    if (args.pullRequest && definition) {
      await ctx.scheduler.runAfter(0, internal.integrations.github.checkRuns.publish, { resultId });
    }
    return resultId;
  },
});

/** Why a PR result is not on GitHub, for the card. */
export const recordGithubPublishError = internalMutation({
  args: { resultId: v.id("checkResults"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { resultId, error }) => {
    if (await getCheckResultById(ctx, resultId)) {
      await patchCheckResult(ctx, resultId, { githubPublishError: error });
    }
    return null;
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

/** Signed URLs for one result's files, gated by task access, thread access while a thread owns it, or project access for a PR's. */
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
  // A PR's results are the project's, like the PR itself (docs/specs/github-integration.md → Pull request checks).
  if (result.pullRequest) {
    return (await authorizeProjectAccess(ctx, principal, result.projectId, ProjectPermission.PROJECT_VIEW)) !== null;
  }
  if (result.taskId === undefined) {
    return (await getViewableThread(ctx, principal, result.threadId)) !== null;
  }
  const task = await getActiveTaskById(ctx, result.taskId);
  return task !== null && (await authorizeProjectAccess(ctx, principal, task.projectId, ProjectPermission.TASK_VIEW)) !== null;
}


/**
 * Each listed PR's current result for the Checks marked "Show in pull request list", Pull request checklist order
 * first, up to three per row. One index read per row and Check, plus the head for a row with results
 * (docs/specs/github-integration.md → Pull request checks).
 */
export const listForPullRequestList = query({
  args: { projectId: v.id("projects"), refs: v.array(v.string()) },
  returns: v.array(
    v.object({
      ref: v.string(),
      checks: v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          /** Pending holds the Check's slot on a row that has other results, so each column is one Check. */
          status: v.union(checkResultStatusValidator, v.literal("pending")),
          value: v.optional(v.string()),
          note: v.optional(v.string()),
          /** Reported on an older head than the PR's stored one. */
          outdated: v.boolean(),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth || !(await authorizeProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.PROJECT_VIEW))) {
      return [];
    }
    const [definitions, checklists] = await Promise.all([
      listCheckDefinitionsByProject(ctx, args.projectId),
      listChecklistsByProject(ctx, args.projectId),
    ]);
    const order = checklists.find((checklist) => checklist.pullRequests)?.checkKeys ?? [];
    const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
    const shown = definitions
      .filter((definition) => definition.showInPullRequestList)
      .sort((a, b) => rank(a.key) - rank(b.key))
      .slice(0, MAX_PULL_REQUEST_LIST_CHECKS);
    const refs = [...new Set(args.refs)];
    ensure(refs.length).lte(MAX_PULL_REQUEST_LIST_REFS, errors.pullRequestListTooManyRefs(MAX_PULL_REQUEST_LIST_REFS));
    // Read once, and only if some row has results.
    let linksRead: Promise<Doc<"integrationRepositoryLinks">[]> | undefined;
    const links = () => (linksRead ??= listActiveRepositoryLinksForProject(ctx, args.projectId));
    return Promise.all(
      refs.map(async (ref) => {
        const results = await Promise.all(shown.map((definition) => findLatestPullRequestResult(ctx, args.projectId, ref, definition.key)));
        // A row nobody checked stays bare; only a checked one pays for its head read.
        if (results.every((result) => result === null)) return { ref, checks: [] };
        const parsed = parseAttachedPullRequest(ref);
        const head = parsed ? (await findLinkedPullRequest(ctx, await links(), parsed))?.headSha : undefined;
        const checks = shown.map(({ key, label }, index) => {
          const result = results[index];
          if (!result) return { key, label, status: "pending" as const, outdated: false };
          const outdated = Boolean(head && result.pullRequest && result.pullRequest.headSha !== head);
          return { key, label, status: result.status, value: result.value, note: result.note, outdated };
        });
        return { ref, checks };
      })
    );
  },
});
