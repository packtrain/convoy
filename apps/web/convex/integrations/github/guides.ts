import { ConvexError, v, type Infer } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { getAuthenticatedAccess } from "../../lib/access/auth";
import { hasAuthorizedProjectPermission, requireAuthorizedProject } from "../../lib/access/permissions";
import { GUIDE_PROMPT_MAX, guideStepValidator } from "../../lib/contracts/github";
import { ensure } from "../../lib/shared/ensure";
import { getUserById, getUsersByIds } from "../../users/lib/usersRepo";
import { getThreadById } from "../../cli/threads/lib/cliThreadsRepo";
import { errors } from "./errors";
import { githubFetch, mintRepositoryToken, repoPath, requireConfig, toUserError } from "./lib/github";
import { list as asList, num, record, str } from "./lib/parsers";
import { validateGuide, type GuideRevision } from "./lib/invariants";
import { completeGuide, deleteGuide, failGuide, getGuideById, getGuideByThreadId, getGuideSteps, listGuidesForPullRequest } from "./lib/integrationPullRequestGuidesRepo";
import { findRepositoryLinkForProjectAndRepository, getRepositoryLinkById } from "./lib/integrationRepositoryLinksRepo";
import { getRepositoryById } from "./lib/integrationRepositoriesRepo";
import { getGuidePrompt, setGuidePrompt } from "./lib/integrationGuidePromptsRepo";
import { authorizeIntegrationProject, getReadableRepositoryAccess } from "./lib/permissions";
import { guideDetailValidator, guideSummaryValidator, syncContextValidator, toGuideSummary, toSyncContext, type SyncContext } from "./lib/validators";

// Guides: agent-written walkthroughs of one PR revision (docs/specs/github-integration.md → Guides).

/** The Guide menu lists this many; older ones are not shown. */
const GUIDES_SHOWN = 20;

/** The PR's newest Guides, live, without their steps. Null without access to the PR. */
export const listForPullRequest = query({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() },
  returns: v.union(v.null(), v.array(guideSummaryValidator)),
  handler: async (ctx, args) => {
    const readable = await getReadableRepositoryAccess(ctx, args.projectId, args.repositoryId);
    if (!readable) {
      return null;
    }
    const rows = await listGuidesForPullRequest(ctx, { projectId: args.projectId, repositoryId: readable.link.repositoryId, number: args.number }, GUIDES_SHOWN);
    const viewer = { userId: readable.access.userId, canManage: hasAuthorizedProjectPermission(readable.access, ProjectPermission.PROJECT_UPDATE) };
    // One read per requester, not per Guide.
    const requesterIds = [...new Set(rows.map((row) => row.requesterId))];
    const users = await getUsersByIds(ctx, requesterIds);
    const requesters = new Map(requesterIds.map((id, at) => [id, users[at]]));
    return rows.map((row) => toGuideSummary(row, requesters.get(row.requesterId) ?? null, viewer));
  },
});

/** One Guide with its steps. A ready Guide never changes, so the reader reads it once. */
export const get = query({
  args: { guideId: v.id("integrationPullRequestGuides") },
  returns: v.union(v.null(), guideDetailValidator),
  handler: async (ctx, args) => {
    const row = await getGuideById(ctx, args.guideId);
    const readable = row ? await getReadableRepositoryAccess(ctx, row.projectId, row.repositoryId) : null;
    if (!row || !readable) {
      return null;
    }
    const viewer = { userId: readable.access.userId, canManage: hasAuthorizedProjectPermission(readable.access, ProjectPermission.PROJECT_UPDATE) };
    return { ...toGuideSummary(row, await getUserById(ctx, row.requesterId), viewer), steps: await getGuideSteps(ctx, row._id) };
  },
});

/** The requester or a project admin deletes a Guide; its thread stays. */
export const remove = mutation({
  args: { guideId: v.id("integrationPullRequestGuides") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ensure(getGuideById(ctx, args.guideId)).notNull(errors.GUIDE_NOT_FOUND);
    const readable = await ensure(getReadableRepositoryAccess(ctx, row.projectId, row.repositoryId)).notNull(errors.GUIDE_NOT_FOUND);
    const allowed = row.requesterId === readable.access.userId || hasAuthorizedProjectPermission(readable.access, ProjectPermission.PROJECT_UPDATE);
    ensure(allowed).isTrue(errors.GUIDE_DELETE_NOT_ALLOWED);
    await deleteGuide(ctx, row._id);
    return null;
  },
});

/** The project's Guide prompt for every member; null is the built-in default, or no access. */
export const getPrompt = query({
  args: { projectId: v.id("projects") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const access = await authorizeIntegrationProject(ctx, args.projectId, ProjectPermission.PROJECT_VIEW);
    return access ? getGuidePrompt(ctx, args.projectId) : null;
  },
});

/** Project admins set the Guide prompt; empty or null is Reset to default. */
export const setPrompt = mutation({
  args: { projectId: v.id("projects"), prompt: v.union(v.null(), v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);
    const prompt = args.prompt?.trim() || null;
    ensure((prompt?.length ?? 0) <= GUIDE_PROMPT_MAX).isTrue(errors.GUIDE_PROMPT_TOO_LONG);
    await setGuidePrompt(ctx, args.projectId, prompt, user._id);
    return null;
  },
});

const submitContextValidator = v.object({
  guideId: v.id("integrationPullRequestGuides"),
  threadId: v.id("cliThreads"),
  number: v.number(),
  baseSha: v.string(),
  headSha: v.string(),
  repositoryLinkId: v.id("integrationRepositoryLinks"),
  generation: v.number(),
  context: syncContextValidator,
});

/** The caller's Guide run on `threadId`, not yet ready, in a repository the project still connects. A failed one still takes a late submit. */
export const getSubmitContext = internalQuery({
  args: { threadId: v.id("cliThreads"), apiKey: v.optional(v.string()) },
  returns: submitContextValidator,
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await getThreadById(ctx, args.threadId);
    if (!thread || thread.isDeleted || thread.userId !== user._id || !thread.pullRequestGuide) {
      throw new ConvexError(errors.GUIDE_NOT_FOR_THREAD);
    }
    const guide = await ensure(getGuideByThreadId(ctx, thread._id)).notNull(errors.GUIDE_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, guide.projectId, ProjectPermission.CLI_THREAD);
    ensure(guide.status !== "ready").isTrue(errors.GUIDE_ALREADY_SUBMITTED);
    const link = await findRepositoryLinkForProjectAndRepository(ctx, guide.projectId, guide.repositoryId);
    const repository = await getRepositoryById(ctx, guide.repositoryId);
    if (!link || link.status !== "active" || !repository) {
      throw new ConvexError(errors.NOT_CONNECTED);
    }
    return {
      guideId: guide._id,
      threadId: thread._id,
      number: guide.number,
      baseSha: guide.baseSha,
      headSha: guide.headSha,
      repositoryLinkId: link._id,
      generation: link.generation,
      context: toSyncContext(link, repository),
    };
  },
});

/** The Guide, still `threadId`'s run: a Retry meanwhile hands it to another thread, whose run this submit must not overwrite. */
async function requireGuideOfRun(ctx: MutationCtx, guideId: Id<"integrationPullRequestGuides">, threadId: Id<"cliThreads">) {
  const guide = await ensure(getGuideById(ctx, guideId)).notNull(errors.GUIDE_NOT_FOUND);
  ensure(guide.threadId).eq(threadId, errors.GUIDE_NOT_FOR_THREAD);
  ensure(guide.status !== "ready").isTrue(errors.GUIDE_ALREADY_SUBMITTED);
  return guide;
}

/** Stores a validated Guide, unless it was deleted, already submitted, retried, or its repository disconnected meanwhile. */
export const complete = internalMutation({
  args: {
    guideId: v.id("integrationPullRequestGuides"),
    threadId: v.id("cliThreads"),
    repositoryLinkId: v.id("integrationRepositoryLinks"),
    generation: v.number(),
    steps: v.array(guideStepValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const guide = await requireGuideOfRun(ctx, args.guideId, args.threadId);
    const link = await getRepositoryLinkById(ctx, args.repositoryLinkId);
    if (link?.status !== "active" || link.generation !== args.generation) {
      throw new ConvexError(errors.NOT_CONNECTED);
    }
    await completeGuide(ctx, guide._id, args.steps, Date.now());
    return null;
  },
});

/** The agent could not write the Guide; `reason` replaces any earlier one. */
export const fail = internalMutation({
  args: { guideId: v.id("integrationPullRequestGuides"), threadId: v.id("cliThreads"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const guide = await requireGuideOfRun(ctx, args.guideId, args.threadId);
    await failGuide(ctx, guide._id, args.reason);
    return null;
  },
});

const FILES_PER_PAGE = 100;
/** GitHub lists at most 3,000 files of a PR. */
const FILES_MAX_PAGES = 30;
/** GitHub's compare lists at most 300 files. */
const COMPARE_MAX_FILES = 300;

const toRevisionFile = (raw: unknown) => {
  const file = record(raw);
  return { path: str(file.filename), sha: typeof file.sha === "string" ? file.sha : undefined };
};

/**
 * The changed files at the Guide's revision: the PR's file list while the PR
 * is still there, else the compare of its base and head (the PR moved during the run).
 */
async function readGuideRevision(token: string, context: SyncContext, guide: { number: number; baseSha: string; headSha: string }): Promise<GuideRevision> {
  const auth = { token };
  const prPath = `${repoPath(context)}/pulls/${guide.number}`;
  const atGuide = (pr: Record<string, unknown>) => str(record(pr.head).sha) === guide.headSha && str(record(pr.base).sha) === guide.baseSha;
  const before = record(await githubFetch(prPath, auth));
  if (atGuide(before)) {
    const files: unknown[] = [];
    for (let page = 1; page <= FILES_MAX_PAGES; page++) {
      const batch = asList(await githubFetch(`${prPath}/files?per_page=${FILES_PER_PAGE}&page=${page}`, auth));
      files.push(...batch);
      if (batch.length < FILES_PER_PAGE) break;
    }
    if (atGuide(record(await githubFetch(prPath, auth)))) {
      // ponytail: files past GitHub's 3,000 are not coverage-checked.
      return { headSha: guide.headSha, files: files.map(toRevisionFile), complete: files.length >= num(before.changed_files) };
    }
  }
  const compare = record(await githubFetch(`${repoPath(context)}/compare/${guide.baseSha}...${guide.headSha}`, auth));
  const files = asList(compare.files);
  return { headSha: guide.headSha, files: files.map(toRevisionFile), complete: files.length < COMPARE_MAX_FILES };
}

const submitResultValidator = v.union(
  v.object({ status: v.literal("accepted"), guideId: v.id("integrationPullRequestGuides") }),
  v.object({ status: v.literal("rejected"), errors: v.array(v.string()) })
);

/**
 * The agent hands its Guide back (`convoy threads submit-guide`). Convoy checks
 * it against the revision's changed files and returns every error, so the
 * agent can fix and resubmit. With `failure`, the agent says why it could not
 * write one, and the Guide fails.
 */
export const submit = action({
  args: {
    threadId: v.id("cliThreads"),
    headSha: v.optional(v.string()),
    // Checked by `validateGuide`, so a wrong shape comes back in the error list.
    steps: v.optional(v.array(v.any())),
    failure: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: submitResultValidator,
  handler: async (ctx, args): Promise<Infer<typeof submitResultValidator>> => {
    const reason = args.failure?.trim();
    if (reason === "") {
      throw new ConvexError(errors.GUIDE_FAILURE_NOTE_REQUIRED);
    }
    const run: Infer<typeof submitContextValidator> = await ctx.runQuery(internal.integrations.github.guides.getSubmitContext, { threadId: args.threadId, apiKey: args.apiKey });
    if (reason !== undefined) {
      await ctx.runMutation(internal.integrations.github.guides.fail, { guideId: run.guideId, threadId: run.threadId, reason });
      return { status: "accepted" as const, guideId: run.guideId };
    }
    if (args.headSha === undefined || args.steps === undefined) {
      return { status: "rejected" as const, errors: [errors.GUIDE_SUBMIT_INCOMPLETE] };
    }
    let revision: GuideRevision;
    try {
      const token = await mintRepositoryToken(requireConfig(), run.context.installationId, run.context.providerRepositoryId);
      revision = await readGuideRevision(token, run.context, run);
    } catch (error) {
      throw toUserError(error, errors.PULL_REQUEST_NOT_FOUND);
    }
    const result = validateGuide({ headSha: args.headSha, steps: args.steps }, revision);
    if (!result.ok) {
      return { status: "rejected" as const, errors: result.errors };
    }
    await ctx.runMutation(internal.integrations.github.guides.complete, {
      guideId: run.guideId,
      threadId: run.threadId,
      repositoryLinkId: run.repositoryLinkId,
      generation: run.generation,
      steps: result.steps,
    });
    return { status: "accepted" as const, guideId: run.guideId };
  },
});
