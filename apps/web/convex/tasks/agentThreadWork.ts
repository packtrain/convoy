import { v, ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { getOptionalAuthenticatedUser } from "../lib/access/auth";
import { authorizeProjectAccess } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { taskAgentThreadWorkValidator, toAgentThreadWorkEntry } from "../lib/contracts/agentThreadWork";
import { MAX_AGENT_THREAD_WORK_TASK_IDS } from "./lib/constants";
import { listAgentThreadWorkByTask } from "./lib/agentThreadWorkRepo";

/**
 * Runs for the tasks a board or list shows (docs/specs/task-associated-threads.md).
 * Reads one index range per task, so a status change re-runs only views showing that task.
 */
export const listByTasks = query({
  args: {
    projectId: v.id("projects"),
    taskIds: v.array(v.id("tasks")),
  },
  returns: v.array(taskAgentThreadWorkValidator),
  handler: async (ctx, args) => {
    if (args.taskIds.length > MAX_AGENT_THREAD_WORK_TASK_IDS) {
      throw new ConvexError(`taskIds accepts at most ${MAX_AGENT_THREAD_WORK_TASK_IDS} ids`);
    }
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }
    const access = await authorizeProjectAccess(ctx, user._id, args.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return [];
    }

    const groups = await Promise.all(
      [...new Set(args.taskIds)].map(async (taskId) => ({
        taskId,
        entries: (await listAgentThreadWorkByTask(ctx, args.projectId, taskId)).map(toAgentThreadWorkEntry),
      }))
    );
    return groups.filter((group) => group.entries.length > 0);
  },
});
