import { getActiveProjectByAlias } from "../../projects/lib/projectsRepo";
import { getUsersByIds } from "../../users/lib/usersRepo";
import { query, type MutationCtx, type QueryCtx } from "../../_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { getOptionalAuthenticatedAccess, getOptionalAuthenticatedUser } from "../../lib/access/auth";
import { getAccessibleProjectsById, hasProjectAccess } from "../../lib/access/permissions";
import { resolveTaskSummaries } from "../../lib/contracts/taskSummaries";
import {
  cliTypeValidator,
  cliThreadStatusValidator,
  cliThreadProcessingStateValidator,
  cliThreadWatchStatusValidator,
  cliThreadWorktreeValidator,
  threadSortByValidator,
  type CliThreadAggregateStatus,
  type CliThreadWatchStatus,
} from "../../lib/contracts/validators";
import { EMPTY_PAGE } from "../../lib/shared/pagination";
import { getAppUrlBase } from "../../lib/shared/appUrl";
import { join } from "../../lib/shared/join";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { getActiveTaskById } from "../../tasks/lib/tasksRepo";
import { getActiveOrganizationById, getActiveOrganizationBySlug } from "../../organizations/lib/organizationsRepo";
import { getCliProfileById, getCliProfilesByIds } from "../lib/cliProfilesRepo";
import {
  listPendingThreadsByProfile,
  listPinnedProjectThreads,
  listThreadsByAssociatedTask,
  listThreadsByAttachedPullRequest,
  listUserThreadsByProcessingState,
  listUserThreadsByWatchStatus,
  listUserThreadsWithPendingMessages,
  paginateProjectThreads,
  paginateSharedProjectThreads,
  paginateUserThreadsByWatchStatus,
  paginateProjectThreadsByWatchStatus,
} from "./lib/cliThreadsRepo";
import { getWorkflowById } from "../../workflows/lib/workflowsRepo";
import { getWorkflowRunById } from "../../workflows/runs/lib/runsRepo";
import { resolvePathInfo } from "../lib/paths";
import { isSharedForViewer } from "../lib/permissions";
import { toAttachedPullRequest } from "../../lib/contracts/github";
import { toExecutionWorkspace } from "../lib/validators";
import { resolveCliThreadAgents } from "./lib/threadAgents";
import { hasUnreadThreadActivity, isContainerThread, isThreadDone, requiresThreadAttention, threadDisplayTaskId } from "../lib/watchStatus";
import { watchTowerThreadItemValidator, toWatchTowerThreadItem, cliThreadItemValidator, toThreadItem, type CliThreadWorkflow } from "./lib/validators";

/**
 * Project a container's aggregate child status into the item's `status` so the
 * shared thread card renders group rows with no client-side special-casing.
 * List-only shaping — `get` keeps the container's real status so the detail view
 * doesn't act on a status the thread doesn't have.
 */
const CONTAINER_ITEM_STATUS: Record<CliThreadAggregateStatus, Doc<"cliThreads">["status"]> = {
  running: "streaming",
  needs_attention: "waiting_input",
  failed: "failed",
  idle: "completed",
};

function containerItemStatus(aggregateStatus: Doc<"cliThreads">["aggregateStatus"]): Doc<"cliThreads">["status"] {
  return aggregateStatus ? CONTAINER_ITEM_STATUS[aggregateStatus] : "completed";
}

/**
 * Workflow identity for run-bound rows (OS-1875): run → workflow, resolved live
 * so a rename or color edit shows on existing runs. One pair of gets per unique
 * run on the page; a gone run or workflow fails soft to no identity.
 */
async function resolveThreadWorkflows(
  ctx: QueryCtx | MutationCtx,
  runIds: ReadonlyArray<Id<"workflowRuns"> | undefined>
): Promise<Map<Id<"workflowRuns">, CliThreadWorkflow>> {
  const uniqueIds = [...new Set(runIds.filter((runId) => runId !== undefined))];
  const workflowByRunId = new Map<Id<"workflowRuns">, CliThreadWorkflow>();
  await Promise.all(
    uniqueIds.map(async (runId) => {
      const run = await getWorkflowRunById(ctx, runId);
      const workflow = run ? await getWorkflowById(ctx, run.workflowId) : null;
      if (workflow) {
        workflowByRunId.set(runId, { _id: workflow._id, name: workflow.name, color: workflow.color });
      }
    })
  );
  return workflowByRunId;
}

async function enrichThreadItems(ctx: QueryCtx | MutationCtx, threads: Doc<"cliThreads">[]) {
  const [taskSummaries, threadAgents, threadWorkflows] = await Promise.all([
    resolveTaskSummaries(ctx, threads.map(threadDisplayTaskId)),
    resolveCliThreadAgents(
      ctx,
      threads.map((thread) => thread.projectAgentId)
    ),
    resolveThreadWorkflows(
      ctx,
      threads.map((thread) => thread.workflowRunId)
    ),
  ]);

  return join(threads)
    .on((thread) => thread.profileId)
    .with((ids) => getCliProfilesByIds(ctx, ids))
    .selectAll((thread, profile) => {
      const { pathLabel, pathString, gitRemoteUrl, branch } = resolvePathInfo(thread, profile);
      const isContainer = isContainerThread(thread);

      return toThreadItem(thread, {
        profileName: profile?.name ?? "Unknown",
        pathLabel,
        pathString,
        gitRemoteUrl,
        // Containers show the group's origin branch, falling back to their own
        // snapshotted profile-path branch.
        branch: isContainer ? (thread.originBranch ?? branch) : branch,
        status: isContainer ? containerItemStatus(thread.aggregateStatus) : thread.status,
        // Containers aggregate purely from children (OS-1475): their own readAt would
        // go stale-unread the moment a child is read individually in the tab view.
        hasUnread: isContainer ? (thread.hasUnreadChildren ?? false) : hasUnreadThreadActivity(thread),
        // Same source as the projected status: `hasAttentionChildren` misses
        // parked-approval/held-queue children, which would demote it on the client.
        requiresAttention: isContainer
          ? thread.aggregateStatus === "needs_attention" || thread.aggregateStatus === "failed"
          : requiresThreadAttention(thread),
        isDone: isThreadDone(thread),
        associatedTask: taskSummaries.get(threadDisplayTaskId(thread)),
        agent: threadAgents.get(thread.projectAgentId),
        workflow: thread.workflowRunId !== undefined ? threadWorkflows.get(thread.workflowRunId) : undefined,
      });
    });
}

/**
 * List threads for a project with pagination.
 * Returns only the current user's non-deleted threads, sorted by the given sort option.
 */
export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
    sortBy: v.optional(threadSortByValidator),
    // Omit for one ungrouped list (today's behavior); set to page a single
    // Active/Done section (OS-1451).
    isDone: v.optional(v.boolean()),
    // The Background threads view (OS-2513) instead of the normal list.
    background: v.optional(v.boolean()),
  },
  returns: paginationResultValidator(cliThreadItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return EMPTY_PAGE;
    }

    // Check project access
    const hasAccess = await hasProjectAccess(ctx, user._id, args.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return EMPTY_PAGE;
    }

    const results = await paginateProjectThreads(ctx, {
      userId: user._id,
      projectId: args.projectId,
      sortBy: args.sortBy ?? "lastActivity",
      isDone: args.isDone,
      background: args.background,
      paginationOpts: args.paginationOpts,
    });

    return {
      ...results,
      page: await enrichThreadItems(ctx, results.page),
    };
  },
});

/**
 * The current user's pinned threads in a project, most recently pinned first
 * (OS-1173). Separate from `listByProject` so pinned threads render even when
 * they are deeper than the loaded pages; the client filters pinned rows out of
 * the paginated list.
 */
export const listPinnedByProject = query({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.array(cliThreadItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const hasAccess = await hasProjectAccess(ctx, user._id, args.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return [];
    }

    const threads = await listPinnedProjectThreads(ctx, { userId: user._id, projectId: args.projectId });
    return enrichThreadItems(ctx, threads);
  },
});

/**
 * A page of the current user's shared threads in a project, most recently shared
 * first (OS-1576). Separate from `listByProject` rather than a client-side filter:
 * that list is paginated, so filtering loaded pages would omit a thread shared
 * deeper than what happens to be loaded.
 *
 * `userId`-scoped, so it shows the caller's own shares — not what teammates shared
 * with them.
 */
export const listSharedByProject = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(cliThreadItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return EMPTY_PAGE;
    }

    const hasAccess = await hasProjectAccess(ctx, user._id, args.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return EMPTY_PAGE;
    }

    const results = await paginateSharedProjectThreads(ctx, {
      userId: user._id,
      projectId: args.projectId,
      paginationOpts: args.paginationOpts,
    });

    return {
      ...results,
      page: await enrichThreadItems(ctx, results.page),
    };
  },
});

async function enrichWatchTowerItems(
  ctx: QueryCtx,
  threads: Doc<"cliThreads">[],
  projectById: Map<Id<"projects">, Doc<"projects">>,
  userId: Id<"users">,
  section: CliThreadWatchStatus,
) {
  const [ownItems, owners] = await Promise.all([
    enrichThreadItems(ctx, threads.filter((thread) => thread.userId === userId)),
    getUsersByIds(ctx, [...new Set(threads.filter((thread) => thread.userId !== userId).map((thread) => thread.userId))]),
  ]);
  const ownById = new Map(ownItems.map((item) => [item._id, item]));
  const ownerById = new Map(owners.flatMap((owner) => owner ? [[owner._id, owner.name] as const] : []));
  return threads.map((thread) => {
    const project = projectById.get(thread.projectId)!;
    return toWatchTowerThreadItem(thread, { projectAlias: project.alias, projectName: project.name }, section,
      ownById.get(thread._id), thread.userId !== userId ? ownerById.get(thread.userId) ?? "Unknown" : undefined);
  });
}

/** Personal Watch Tower across accessible projects in the current organization. */
export const listMine = query({
  args: {
    organizationSlug: v.string(),
    section: cliThreadWatchStatusValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(watchTowerThreadItemValidator),
  handler: async (ctx, args) => {
    const access = await getOptionalAuthenticatedAccess(ctx);
    if (!access) return EMPTY_PAGE;
    const { user, principal } = access;
    const organization = await getActiveOrganizationBySlug(ctx, args.organizationSlug);
    if (!organization) return EMPTY_PAGE;
    const results = await paginateUserThreadsByWatchStatus(ctx, {
      userId: user._id, watchStatus: args.section, paginationOpts: args.paginationOpts,
    });
    const projectIds = [...new Set(results.page.map((thread) => thread.projectId))];
    const projects = await getAccessibleProjectsById(ctx, principal, projectIds, ProjectPermission.CLI_THREAD);
    const threads = results.page.filter((thread) => projects.get(thread.projectId)?.organizationId === organization._id);
    return { ...results, page: await enrichWatchTowerItems(ctx, threads, projects, user._id, args.section) };
  },
});

/** Project Watch Tower defaults to all owners; transcripts stay private. */
export const listProjectWatchTower = query({
  args: {
    organizationSlug: v.string(), projectAlias: v.string(),
    section: cliThreadWatchStatusValidator,
    scope: v.optional(v.union(v.literal("mine"), v.literal("all"))),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(watchTowerThreadItemValidator),
  handler: async (ctx, args) => {
    const access = await getOptionalAuthenticatedAccess(ctx);
    if (!access) return EMPTY_PAGE;
    const organization = await getActiveOrganizationBySlug(ctx, args.organizationSlug);
    if (!organization) return EMPTY_PAGE;
    const project = await getActiveProjectByAlias(ctx, organization._id, args.projectAlias.toUpperCase());
    if (!project || !await hasProjectAccess(ctx, access.principal, project, ProjectPermission.CLI_THREAD)) return EMPTY_PAGE;
    const results = await paginateProjectThreadsByWatchStatus(ctx, {
      projectId: project._id,
      userId: args.scope === "mine" ? access.user._id : undefined,
      watchStatus: args.section, paginationOpts: args.paginationOpts,
    });
    return { ...results, page: await enrichWatchTowerItems(ctx, results.page,
      new Map([[project._id, project]]), access.user._id, args.section) };
  },
});

// Desktop popover item (OS-1237): a thread item plus where it lives.
const cliActiveThreadItemValidator = v.object({
  ...cliThreadItemValidator.fields,
  location: v.object({
    organizationSlug: v.string(),
    projectAlias: v.string(),
    projectName: v.string(),
    // Web-app base URL of THIS deployment — desktop deep links must not
    // assume one hardcoded host across dev/prod installations.
    appUrl: v.string(),
  }),
});

const ACTIVE_THREADS_CAP = 20;
/** Attention threads older than this stay in the Watch Tower but leave the tray. */
const ACTIVE_ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The user's active threads across all projects for the desktop tray feed
 * (OS-1237). Active = claimed or streaming, plus queued threads still waiting for
 * an agent. Capped, no pagination — active threads are few. Inaccessible projects
 * are dropped (fail-soft), checked once per unique project.
 */
export const listActiveForUser = query({
  args: {
    apiKey: v.optional(v.string()),
  },
  returns: v.array(cliActiveThreadItemValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { user, principal } = auth;

    const [streaming, claimed, queued, failed, waitingInput] = await Promise.all([
      listUserThreadsByProcessingState(ctx, { userId: user._id, processingState: "streaming", limit: ACTIVE_THREADS_CAP }),
      listUserThreadsByProcessingState(ctx, { userId: user._id, processingState: "claimed", limit: ACTIVE_THREADS_CAP }),
      listUserThreadsWithPendingMessages(ctx, { userId: user._id, limit: ACTIVE_THREADS_CAP }),
      // Attention buckets: idle with no pending messages, but in the feed until
      // acknowledged (time-boxed so old failures don't flood a "happening now" surface).
      listUserThreadsByWatchStatus(ctx, {
        userId: user._id,
        watchStatus: "failed",
        since: Date.now() - ACTIVE_ATTENTION_WINDOW_MS,
        limit: ACTIVE_THREADS_CAP,
      }),
      listUserThreadsByWatchStatus(ctx, {
        userId: user._id,
        watchStatus: "waiting_input",
        since: Date.now() - ACTIVE_ATTENTION_WINDOW_MS,
        limit: ACTIVE_THREADS_CAP,
      }),
    ]);
    const threadById = new Map(streaming.concat(claimed, queued, failed, waitingInput).map((thread) => [thread._id, thread]));
    const threads = [...threadById.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, ACTIVE_THREADS_CAP);

    const items = await enrichThreadItems(ctx, threads);

    const projectIds = [...new Set(items.map((item) => item.projectId))];
    const projectById = await getAccessibleProjectsById(ctx, principal, projectIds, ProjectPermission.CLI_THREAD);

    // Org slug for deep links; a gone org drops its threads like a gone project.
    const organizationIds = [...new Set([...projectById.values()].map((project) => project.organizationId))];
    const organizations = await Promise.all(organizationIds.map((orgId) => getActiveOrganizationById(ctx, orgId)));
    const organizationById = new Map(organizations.filter((org) => org !== null).map((org) => [org._id, org]));

    const appUrl = getAppUrlBase();
    return items.flatMap((item) => {
      const project = projectById.get(item.projectId);
      const organization = project ? organizationById.get(project.organizationId) : undefined;
      if (!project || !organization) {
        return [];
      }
      return [
        {
          ...item,
          location: { organizationSlug: organization.slug, projectAlias: project.alias, projectName: project.name, appUrl },
        },
      ];
    });
  },
});

export const listByAssociatedTask = query({
  args: {
    projectId: v.id("projects"),
    taskId: v.id("tasks"),
  },
  returns: v.array(cliThreadItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const hasAccess = await hasProjectAccess(ctx, user._id, args.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return [];
    }

    const task = await getActiveTaskById(ctx, args.taskId);
    if (!task || task.projectId !== args.projectId) {
      return [];
    }

    const threads = await listThreadsByAssociatedTask(ctx, {
      userId: user._id,
      projectId: args.projectId,
      taskId: args.taskId,
    });

    return enrichThreadItems(ctx, threads);
  },
});

const pullRequestThreadItemValidator = v.object({ ...cliThreadItemValidator.fields, ownerName: v.optional(v.string()) });

/**
 * Threads whose Attached pull request is this PR: the caller's own, and teammates' shared ones
 * with `ownerName` (docs/specs/github-integration.md → Pull requests in threads).
 */
export const listByAttachedPullRequest = query({
  args: {
    projectId: v.id("projects"),
    owner: v.string(),
    name: v.string(),
    number: v.number(),
  },
  returns: v.array(pullRequestThreadItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user || !(await hasProjectAccess(ctx, user._id, args.projectId, ProjectPermission.CLI_THREAD))) {
      return [];
    }
    const { ref } = toAttachedPullRequest(args);
    // ponytail: unshared foreign rows count toward the 100-row take; page if a PR ever gathers that many.
    const threads = await listThreadsByAttachedPullRequest(ctx, { projectId: args.projectId, ref });
    const readable = await Promise.all(threads.map((thread) => thread.userId === user._id || isSharedForViewer(ctx, thread)));
    const visible = threads.filter((_, index) => readable[index]);
    const owners = await getUsersByIds(ctx, [...new Set(visible.filter((thread) => thread.userId !== user._id).map((thread) => thread.userId))]);
    const ownerName = new Map(owners.flatMap((owner) => (owner ? [[owner._id, owner.name] as const] : [])));
    const items = await enrichThreadItems(ctx, visible);
    return items.map((item): Infer<typeof pullRequestThreadItemValidator> =>
      // Read and done state are the owner's; a teammate has read nothing of it.
      item.userId === user._id ? item : { ...item, hasUnread: false, isDone: false, ownerName: ownerName.get(item.userId) ?? "Unknown" }
    );
  },
});

const cliPendingChatItemValidator = v.object({
  _id: v.id("cliThreads"),
  profileId: v.id("cliProfiles"),
  cliType: cliTypeValidator,
  pathId: v.string(),
  workingDirectory: v.string(),
  previousWorkingDirectory: v.optional(v.string()),
  worktree: v.optional(cliThreadWorktreeValidator),
  projectFolder: v.optional(v.string()),
  status: cliThreadStatusValidator,
  processingState: cliThreadProcessingStateValidator,
  hasPendingUserMessages: v.boolean(),
  claimedBySessionId: v.optional(v.id("cliSessions")),
  lastActivityAt: v.number(),
  // Bound Project agent delivery fields (OS-1138): the CLI passes the display
  // name and prompt snapshot to the runtime runner (Phase 2 wiring).
  agentName: v.optional(v.string()),
  agentPromptSnapshot: v.optional(v.string()),
});

/**
 * List threads with pending user messages for a profile.
 * Used by CLI workers to discover threads to claim and process.
 */
export const listPendingThreads = query({
  args: {
    profileId: v.id("cliProfiles"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(cliPendingChatItemValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { user, principal } = auth;

    const profile = await getCliProfileById(ctx, args.profileId);
    if (!profile || profile.isDeleted) {
      return [];
    }

    if (profile.userId !== user._id) {
      return [];
    }

    const hasAccess = await hasProjectAccess(ctx, principal, profile.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return [];
    }

    const threads = await listPendingThreadsByProfile(ctx, args.profileId);
    const threadAgents = await resolveCliThreadAgents(
      ctx,
      threads.map((chat) => chat.projectAgentId)
    );

    return threads.map((chat) => {
      const workspace = toExecutionWorkspace(chat, profile);
      return {
        _id: chat._id,
        profileId: chat.profileId,
        cliType: chat.cliType,
        pathId: workspace.pathId,
        workingDirectory: workspace.path,
        worktree: workspace.worktree,
        projectFolder: workspace.projectFolder,
        previousWorkingDirectory: chat.git?.previousWorkingDirectory,
        status: chat.status,
        processingState: chat.processingState,
        hasPendingUserMessages: chat.hasPendingUserMessages,
        claimedBySessionId: chat.claimedBySessionId,
        lastActivityAt: chat.lastActivityAt,
        agentName: threadAgents.get(chat.projectAgentId)?.name,
        agentPromptSnapshot: chat.agentPromptSnapshot,
      };
    });
  },
});
