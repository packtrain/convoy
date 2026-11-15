import { mutation } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { getAuthenticatedUser } from "../../lib/access/auth";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import { ProjectPermission } from "@/lib/authz/permissions";
import { getActiveTaskById, getTaskById, patchTask } from "../lib/tasksRepo";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";

export const update = mutation({
  args: {
    id: v.id("tasks"),
    rank: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const task = await ensure(getActiveTaskById(ctx, args.id)).notNull(
      errors.TASK_NOT_FOUND
    );

    await requireAuthorizedProject(ctx, user._id, task.projectId, ProjectPermission.TASK_UPDATE);

    await patchTask(ctx, args.id, {
      rank: args.rank,
    });

    return null;
  },
});

export const batchUpdate = mutation({
  args: {
    updates: v.array(v.object({
      id: v.id("tasks"),
      rank: v.string(),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.updates.length === 0) return null;
    const uniqueTaskIds = new Set(args.updates.map((update) => update.id));
    if (uniqueTaskIds.size !== args.updates.length) {
      throw new ConvexError(errors.RANK_UPDATES_NO_DUPLICATES);
    }

    const user = await getAuthenticatedUser(ctx);
    const tasks = await Promise.all(
      args.updates.map((update) => getTaskById(ctx, update.id))
    );
    const validTasks = tasks.filter(
      (task): task is Doc<"tasks"> => task !== null && !task.isDeleted
    );

    if (validTasks.length !== args.updates.length) {
      throw new ConvexError(errors.TASK_NOT_FOUND);
    }

    const firstTask = validTasks[0];
    await requireAuthorizedProject(
      ctx,
      user._id,
      firstTask.projectId,
      ProjectPermission.TASK_UPDATE
    );

    for (const task of validTasks) {
      if (
        task.projectId !== firstTask.projectId ||
        task.parentId !== firstTask.parentId ||
        task.isArchived !== firstTask.isArchived ||
        task.listKey !== firstTask.listKey
      ) {
        throw new ConvexError(errors.RANK_UPDATES_SAME_SCOPE);
      }
    }

    for (const update of args.updates) {
      await patchTask(ctx, update.id, {
        rank: update.rank,
      });
    }

    return null;
  },
});
