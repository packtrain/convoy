import { mutation, query } from "../../_generated/server";
import { v, type Infer } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { getAuthenticatedAccess, getAuthenticatedUser, getOptionalAuthenticatedUser } from "../../lib/access/auth";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { cliThreadStatusValidator } from "../../lib/contracts/validators";
import { getViewableThread } from "../lib/permissions";
import { getCliProfileById } from "../lib/cliProfilesRepo";
import {
  getThreadById,
  listGroupRows,
  setThreadParent,
} from "./lib/cliThreadsRepo";
import { hasUnreadThreadActivity, isThreadDone, requiresThreadAttention } from "../lib/watchStatus";
import { createThreadArgs } from "./lib/validators";
import { createThreadCore, resolveGroupContainer } from "./lib/lifecycle";

/**
* Add a thread to a group, creating the container lazily when needed (OS-1474).
* Called on the draft tab's first send. Spec: docs/specs/thread-groups.md.
*
* `spawnedByThreadId` is pass-through lineage for the agent spawn path (OS-1162), inert here; it
* can differ from `sourceThreadId` when an agent names a container. `apiKey` opens this to
* MCP/CLI callers — reusing this function is what grants them every guard below for free.
*/
export const addThreadToGroup = mutation({
  args: {
    ...createThreadArgs,
    sourceThreadId: v.id("cliThreads"),
    spawnedByThreadId: v.optional(v.id("cliThreads")),
    // Re-checked below, since the caller resolved it a transaction ago (OS-1629).
    expectedContainerId: v.optional(v.id("cliThreads")),
    apiKey: v.optional(v.string()),
  },
  returns: v.object({
    containerId: v.id("cliThreads"),
    threadId: v.id("cliThreads"),
  }),
  handler: async (ctx, args) => {
    const access = await getAuthenticatedAccess(ctx, args.apiKey);
    const { user, principal } = access;
    const source = await ensure(getThreadById(ctx, args.sourceThreadId)).notDeleted(errors.THREAD_NOT_FOUND);
    ensure(source.userId).eq(user._id, errors.NOT_AUTHORIZED);
    await requireAuthorizedProject(ctx, principal, source.projectId, ProjectPermission.CLI_THREAD);
    // A workflow container can accept a manual thread before any lane exists.
    if (source.workflowRunId === undefined) {
      ensure(source.kind).isNull(errors.ADD_TO_GROUP_SOURCE_IS_CONTAINER);
    }
    // A group never spans projects: spec: docs/specs/thread-groups.md (OS-1629).
    const targetProfile = await ensure(getCliProfileById(ctx, args.profileId)).notDeleted(errors.PROFILE_NOT_FOUND);
    ensure(targetProfile.projectId).eq(source.projectId, errors.ADD_TO_GROUP_CROSS_PROJECT);
    // Removed since resolution? Grouping it again would build a second container.
    if (args.expectedContainerId) {
      ensure(source.kind === "group" ? source._id : source.parentThreadId).eq(args.expectedContainerId, errors.ADD_TO_GROUP_SOURCE_MOVED);
    }

    if (args.spawnedByThreadId) {
      const spawner = await ensure(getThreadById(ctx, args.spawnedByThreadId)).notDeleted(errors.THREAD_NOT_FOUND);
      ensure(spawner.userId).eq(user._id, errors.NOT_AUTHORIZED);
    }

    const containerId = await resolveGroupContainer(ctx, user._id, source);

    // Container membership does not enroll a manual thread in the workflow.
    const { threadId } = await createThreadCore(ctx, access, args, {
      parentThreadId: containerId,
      spawnedByThreadId: args.spawnedByThreadId,
    });
    return { containerId, threadId };
  },
});

/**
 * Move a group child back to the root of the thread list (OS-1474): unsets
 * `parentThreadId`. Workflow-owned threads stay attached; manual threads can
 * leave. Empty workflow containers persist. Spec: docs/specs/thread-groups.md.
 */
export const moveChildOut = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const thread = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    ensure(thread.userId).eq(user._id, errors.NOT_AUTHORIZED);
    await requireAuthorizedProject(ctx, user._id, thread.projectId, ProjectPermission.CLI_THREAD);
    ensure(thread.parentThreadId).notNull(errors.THREAD_NOT_IN_GROUP);
    ensure(thread.workflowRunId).isNull(errors.MOVE_OUT_GROUP_ONLY);
    await setThreadParent(ctx, args.threadId, undefined);
    return null;
  },
});

const cliGroupChildValidator = v.object({
  _id: v.id("cliThreads"),
  title: v.string(),
  lastActivityAt: v.number(),
  associatedTaskId: v.optional(v.id("tasks")),
  // Done children sort to the end of the strip, newest-done first (OS-1478).
  // `doneAt` rides along as the sort key — `isDone` alone can't order them.
  isDone: v.boolean(),
  doneAt: v.optional(v.number()),
  // The tab's status indicator (OS-1618). All four fields, not a pre-derived status,
  // because the client folds them through the same `getThreadDisplayStatus` the list
  // uses — a tab must not become a fourth place that decides what "working" means.
  status: cliThreadStatusValidator,
  hasPendingInteraction: v.boolean(),
  requiresAttention: v.boolean(),
  pullRequestChecksRunning: v.boolean(),
  // Derived here, not from `readAt` on the client, so that rule lives in one place.
  // For a settled tab it is the only thing the indicator can show.
  hasUnread: v.boolean(),
});

type CliGroupChild = Infer<typeof cliGroupChildValidator>;

const cliGroupValidator = v.object({
  children: v.array(cliGroupChildValidator),
  /**
   * Every row ever parented under the container — soft-deleted included —
   * because that is what the `addThreadToGroup` cap guards on
   * (`childCount` excludes deleted rows and is not the guard's input).
   */
  totalRowCount: v.number(),
});

function toGroupChild(child: Doc<"cliThreads">): CliGroupChild {
  return {
    _id: child._id,
    title: child.title,
    lastActivityAt: child.lastActivityAt,
    associatedTaskId: child.associatedTaskId,
    isDone: isThreadDone(child),
    doneAt: child.doneAt,
    // Same derivation as a list row: a child is never a container, so an unread child
    // is unread on its own `readAt`, not via `hasUnreadChildren`.
    status: child.status,
    hasPendingInteraction: child.hasPendingInteraction ?? false,
    requiresAttention: requiresThreadAttention(child),
    pullRequestChecksRunning: child.pullRequestChecksRunning === true,
    hasUnread: hasUnreadThreadActivity(child),
  };
}

/**
* A group's live children for the tabs view (OS-1477) — one subscription for strip membership,
* tab labels/states and the "+" cap. The payload is deliberately narrow because this re-fires on
* every child write: no enrichment, one index scan.
*
* `totalRowCount` counts deleted rows too, because that is what the `addThreadToGroup` cap guards
* on. Children come back in creation order: the stable tab order.
*/
export const getGroup = query({
  args: {
    containerId: v.id("cliThreads"),
  },
  returns: v.union(v.null(), cliGroupValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    // A viewer of a shared group gets the strip too (OS-1579) — without it the group's
    // other runs would be unreachable from the link.
    const viewable = await getViewableThread(ctx, user._id, args.containerId);
    // Containers only — run containers are groups too and get the same tabs (OS-1366).
    if (!viewable || viewable.thread.kind !== "group") {
      return null;
    }
    const container = viewable.thread;

    // One scan covers both views: the live tabs and the cap's row count.
    const rows = await listGroupRows(ctx, container._id, { includeDeleted: true });
    return {
      children: rows.filter((child) => !child.isDeleted).map(toGroupChild),
      totalRowCount: rows.length,
    };
  },
});
