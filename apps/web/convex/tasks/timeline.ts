import { v } from "convex/values";
import { query } from "../_generated/server";
import { ProjectPermission } from "../../lib/authz/permissions";
import { getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { authorizeProjectAccess } from "../lib/access/permissions";
import { hydrateTaskActivityLogs } from "./lib/activity/hydrate";
import { hydrateTaskComments } from "./lib/comments/hydrate";
import { takeTaskActivityLogsByTaskBefore } from "./lib/taskActivityLogsRepo";
import { takeTaskCommentsByTaskBefore } from "./lib/taskCommentsRepo";
import { getTaskById } from "./lib/tasksRepo";
import { mergeTimelineSources, type TimelineSourceRead } from "./lib/timeline/merge";
import {
  EMPTY_TIMELINE_PAGE,
  timelineCursorValidator,
  timelinePageValidator,
  timelineSourcesValidator,
  type TimelineCursor,
} from "./lib/timeline/validators";

const MAX_TIMELINE_LIMIT = 100;
const DEFAULT_TIMELINE_LIMIT = 20;

/**
 * Clamp `limit` into 1..MAX. `Number.isFinite` first because `Math.min`/`Math.max`
 * propagate `NaN`, which would reach `.take(NaN)` and throw — the one path in
 * this otherwise fail-soft handler that could blank the sidebar. A client
 * computing `limit` arithmetically (`pageSize * n`, a parsed value, uninitialised
 * state) must not be able to do that.
 */
function resolveLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_TIMELINE_LIMIT;
  }
  return Math.max(1, Math.min(Math.floor(limit), MAX_TIMELINE_LIMIT));
}

/**
 * Reject a non-finite cursor as absent. Convex's index range degenerates to
 * unbounded on a `NaN` comparison, so a corrupt cursor would otherwise silently
 * restart pagination from the newest row instead of failing visibly — and this
 * feature round-trips cursors through client state.
 */
function resolveCursor(before: TimelineCursor | undefined): TimelineCursor | undefined {
  if (!before || !Number.isFinite(before.at) || !Number.isFinite(before.creationTime)) {
    return undefined;
  }
  return before;
}

/**
 * The task detail sidebar's merged feed: comments and activity in one
 * reverse-chronological page (docs/specs/task-timeline.md).
 *
 * Not `.paginate()` — a Convex cursor is per-table and per-index, so it cannot span a
 * merge. The cursor here is a `(createdAt, _creationTime)` position, and pagination is
 * always newest-first regardless of display direction.
 *
 * No thread rows: every thread list index is `userId`-scoped, so the client sources
 * its own from `cli.threads.lists.listByAssociatedTask` and others' from `agentThreadWork`.
 */
export const listByTask = query({
  args: {
    taskId: v.id("tasks"),
    sources: timelineSourcesValidator,
    before: v.optional(timelineCursorValidator),
    limit: v.number(),
  },
  returns: timelinePageValidator,
  handler: async (ctx, args) => {
    // Fail soft rather than throw, matching `tasks.activity.listByTask`: the
    // sidebar renders this alongside other reads and must not blank out.
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth) {
      return EMPTY_TIMELINE_PAGE;
    }
    const { user, principal } = auth;

    const task = await getTaskById(ctx, args.taskId);
    if (!task || task.isDeleted) {
      return EMPTY_TIMELINE_PAGE;
    }

    const access = await authorizeProjectAccess(ctx, principal, task.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return EMPTY_TIMELINE_PAGE;
    }

    const limit = resolveLimit(args.limit);
    const before = resolveCursor(args.before);

    // A disabled source runs no read at all. `sources.threads` gates only a
    // client-side read, so it is accepted and ignored here.
    const [activityLogs, comments] = await Promise.all([
      args.sources.activity ? takeTaskActivityLogsByTaskBefore(ctx, args.taskId, before, limit) : Promise.resolve([]),
      args.sources.comments ? takeTaskCommentsByTaskBefore(ctx, args.taskId, before, limit) : Promise.resolve([]),
    ]);

    const [hydratedActivity, hydratedComments] = await Promise.all([
      hydrateTaskActivityLogs(ctx, activityLogs),
      hydrateTaskComments(ctx, comments, { userId: user._id, access }),
    ]);

    // Cursors come from the raw docs: `_creationTime` is the index's implicit
    // final field, and hydration preserves row order.
    const reads: TimelineSourceRead[] = [];
    if (args.sources.activity) {
      reads.push({
        limit,
        rows: hydratedActivity.map((activity) => ({
          kind: "activity" as const,
          at: activity.createdAt,
          activity,
        })),
        cursors: activityLogs.map((log) => ({ at: log.createdAt, creationTime: log._creationTime })),
      });
    }
    if (args.sources.comments) {
      reads.push({
        limit,
        rows: hydratedComments.map((comment) => ({
          kind: "comment" as const,
          at: comment.createdAt,
          comment,
        })),
        cursors: comments.map((comment) => ({ at: comment.createdAt, creationTime: comment._creationTime })),
      });
    }

    return mergeTimelineSources(reads, limit);
  },
});
