import type { QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { loadTaskListMapForTasks } from "./lists/resolution";
import { toStructuredTaskList } from "./lists/validators";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { stripInternalTaskFields } from "./searchText";
import { getUsersByIds } from "../../users/lib/usersRepo";
import { hydrateTaskAssigneeSplits } from "./assignees";

/**
 * Enrich tasks with user metadata and computed refId. Uses batch-first lookups
 * to avoid N+1 queries.
 */
export async function enrichTasksWithUserDetails(
  ctx: QueryCtx,
  tasks: Doc<"tasks">[],
  project: Doc<"projects">
) {
  const userIds = [...new Set(tasks.map((task) => task.createdBy))];

  const [users, assigneeMap] = await Promise.all([
    getUsersByIds(ctx, userIds),
    hydrateTaskAssigneeSplits(ctx, tasks),
  ]);
  const userMap = new Map(
    users
      .filter((u): u is Doc<"users"> => u !== null)
      .map((u) => [u._id, u])
  );

  const listMap = await loadTaskListMapForTasks(ctx, tasks);

  return tasks.map((task) => {
    const split = assigneeMap.get(task._id);
    const creator = userMap.get(task.createdBy);
    const taskWithoutInternalFields = stripInternalTaskFields(task);
    return {
      ...taskWithoutInternalFields,
      parentId: task.parentId ?? null,
      status: task.status,
      list: toStructuredTaskList(task, listMap),
      refId: `${project.alias}-${task.refNumber}`,
      description: task.description ?? null,
      dueDate: task.dueDate ?? null,
      // Clients resolve label name/color from api.tasks.labels.list — no per-task join.
      labelId: task.labelId ?? null,
      sectionId: task.sectionId ?? null,
      externalLinks: task.externalLinks ?? [],
      attachmentCount: task.attachmentCount ?? 0,
      artifactCount: task.artifactCount ?? 0,
      assignee: split?.assignee ?? null,
      delegatedToAgent: split?.delegatedToAgent ?? null,
      createdByName: creator?.name ?? null,
      taskType: resolveTaskTypeSummary(task.taskTypeKey),
    };
  });
}
