import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { resolveTaskTypeSummary, taskTypeSummaryValidator } from "./taskTypes";
import { getProjectsByIds } from "../../projects/lib/projectsRepo";
import { getTasksByIds } from "../../tasks/lib/tasksRepo";

/**
 * A task as other surfaces render it beside their own content — the ref chip
 * and enough to label it. Batched by id so a list never resolves one task per
 * row.
 */
export const taskSummaryValidator = v.object({
  _id: v.id("tasks"),
  refId: v.string(),
  name: v.string(),
  taskType: taskTypeSummaryValidator,
  isArchived: v.boolean(),
});

export type TaskSummary = Infer<typeof taskSummaryValidator>;

export interface TaskSummaryLookup {
  get(taskId: Id<"tasks"> | null | undefined): TaskSummary | undefined;
}

/** The summary itself, for callers that already hold both documents. */
export function toTaskSummary(task: Doc<"tasks">, project: Doc<"projects">): TaskSummary {
  return {
    _id: task._id,
    refId: `${project.alias}-${task.refNumber}`,
    name: task.name,
    taskType: resolveTaskTypeSummary(task.taskTypeKey),
    isArchived: task.isArchived,
  };
}

export async function resolveTaskSummaries(
  ctx: QueryCtx | MutationCtx,
  taskIds: ReadonlyArray<Id<"tasks"> | null | undefined>,
): Promise<TaskSummaryLookup> {
  // Callers are responsible for enforcing project-level access before
  // resolving summaries through this helper.
  const uniqueTaskIds = [...new Set(taskIds.filter(isDefinedTaskId))];
  const tasks = await getTasksByIds(ctx, uniqueTaskIds);
  const visibleTasks = tasks.filter(
    (task): task is Doc<"tasks"> => task !== null && !task.isDeleted,
  );

  const projectIds = [...new Set(visibleTasks.map((task) => task.projectId))];
  const projects = await getProjectsByIds(ctx, projectIds);
  const projectMap = new Map(
    projects
      .filter((project): project is Doc<"projects"> => project !== null && !project.isDeleted)
      .map((project) => [project._id, project]),
  );

  const summaries = new Map<Id<"tasks">, TaskSummary>();
  for (const task of visibleTasks) {
    const project = projectMap.get(task.projectId);
    if (!project) {
      continue;
    }

    summaries.set(task._id, toTaskSummary(task, project));
  }

  return {
    get: (taskId) => (taskId != null ? summaries.get(taskId) : undefined),
  };
}

function isDefinedTaskId(
  taskId: Id<"tasks"> | null | undefined,
): taskId is Id<"tasks"> {
  return taskId !== null && taskId !== undefined;
}
