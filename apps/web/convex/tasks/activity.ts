import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import { EMPTY_PAGE } from "../lib/shared/pagination";
import { getOptionalAuthenticatedUser } from "../lib/access/auth";
import { hasProjectAccess } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { getTaskById } from "./lib/tasksRepo";
import {
  getNewestTaskActivityLog,
  insertTaskActivityLog,
  paginateTaskActivityLogsByTask,
} from "./lib/taskActivityLogsRepo";
import { ACTIVITY_COALESCE_WINDOW_MS, coalesceSubject } from "./lib/activity/coalesce";
import {
  changeDetailsValidator,
  eventTypeValidator,
  taskActivityLogListItemValidator,
} from "./lib/activity/validators";
import { hydrateTaskActivityLogs } from "./lib/activity/hydrate";

/**
 * Internal mutation to create activity logs.
 * Called from task mutations after successful operations.
 *
 * Coalescing: a repeat of a coalescible event by the same actor on the same
 * subject within `ACTIVITY_COALESCE_WINDOW_MS` returns the existing row instead
 * of adding one, so debounced autosave writes one row per editing burst
 * (docs/specs/task-activity-log.md#coalescing).
 */
export const logActivity = internalMutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.id("users"),
    eventType: eventTypeValidator,
    changeDetails: v.optional(changeDetailsValidator),
  },
  returns: v.id("taskActivityLogs"),
  handler: async (ctx, args) => {
    const subject = coalesceSubject(args.eventType, args.changeDetails);
    if (subject !== null) {
      // Newest row only: any other event in between ends the burst, which is
      // what makes "edited, moved, edited again" read as three rows.
      const newest = await getNewestTaskActivityLog(ctx, args.taskId);
      if (
        newest &&
        newest.userId === args.userId &&
        coalesceSubject(newest.eventType, newest.changeDetails) === subject &&
        Date.now() - newest.createdAt < ACTIVITY_COALESCE_WINDOW_MS
      ) {
        // Deliberately not patched: the subject is what matched, so the row
        // already reads correctly, and bumping `createdAt` would reorder it
        // under the timeline's cursor.
        return newest._id;
      }
    }

    return await insertTaskActivityLog(ctx, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: args.eventType,
      changeDetails: args.changeDetails,
    });
  },
});

/**
 * Query to fetch activity logs for a task with pagination.
 * Returns logs in descending order (newest first).
 */
export const listByTask = query({
  args: {
    taskId: v.id("tasks"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(taskActivityLogListItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return EMPTY_PAGE;
    }

    // Verify task exists and user has access
    const task = await getTaskById(ctx, args.taskId);
    if (!task) {
      return EMPTY_PAGE;
    }

    // Verify user has project access with TASK_VIEW permission
    const hasAccess = await hasProjectAccess(
      ctx,
      user._id,
      task.projectId,
      ProjectPermission.TASK_VIEW
    );
    if (!hasAccess) {
      return EMPTY_PAGE;
    }

    // Query logs with Convex's built-in pagination
    const results = await paginateTaskActivityLogsByTask(
      ctx,
      args.taskId,
      args.paginationOpts
    );

    return {
      ...results,
      page: await hydrateTaskActivityLogs(ctx, results.page),
    };
  },
});
