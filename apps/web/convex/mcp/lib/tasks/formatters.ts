import type { Id } from "../../../_generated/dataModel";
import { is } from "@/lib/type-guards";
import { projectTaskTypeSummary } from "./types/formatters";
import { projectTaskListSummary } from "./lists/formatters";

export type McpSubtaskSummary = {
  _id: Id<"tasks">;
  refId: string;
  name: string;
  status: string;
  priority: string;
  assignee: unknown;
  delegatedToAgent: unknown;
  dueDate: number | null;
  subtaskCount: number;
};

export const MCP_LIST_TASK_FIELDS = [
  "_id",
  "refId",
  "parentId",
  "name",
  "status",
  "priority",
  "dueDate",
  "assignee",
  "delegatedToAgent",
  "tags",
  "labelId",
  "closedAt",
] as const;

export const MCP_DETAIL_TASK_STRIPPED_FIELDS = new Set([
  "_creationTime",
  "projectId",
  "clientId",
  "refNumber",
  "rank",
  "createdBy",
  "createdByName",
  "assigneeId",
  "assigneeName",
  "assigneeAvatarUrl",
  "delegatedToAgentId",
  "isDeleted",
  "deletedAt",
  "deletedBy",
  "scheduledDeletionId",
  "archivedAt",
  "archivedBy",
  // Replaced by the readable `checklist` and `checks` resources.
  "checklistId",
]);

function projectTaskAssignee(value: unknown): unknown {
  if (!is.record(value)) return value;
  if (value.type === "user") {
    return {
      type: "user",
      userId: value.userId,
      name: value.name,
    };
  }
  if (value.type === "projectAgent") {
    return {
      type: "projectAgent",
      projectAgentId: value.projectAgentId,
      name: value.name,
      isDeleted: value.isDeleted,
      appearance: value.appearance,
    };
  }
  return value;
}

function projectTaskSummary(
  task: Record<string, unknown>,
  options: { includeLinks?: boolean } = {}
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of MCP_LIST_TASK_FIELDS) {
    if (field in task) {
      projected[field] = field === "assignee" || field === "delegatedToAgent"
        ? projectTaskAssignee(task[field])
        : task[field];
    }
  }

  const taskType = projectTaskTypeSummary(task.taskType);
  if (taskType) {
    projected.taskType = taskType;
  }
  const list = projectTaskListSummary(task.list);
  if (list !== undefined) {
    projected.list = list;
  }
  if (options.includeLinks && "externalLinks" in task) {
    projected.externalLinks = task.externalLinks;
  }

  return projected;
}

export function projectListTask(
  task: unknown,
  options: { includeLinks?: boolean } = {}
): unknown {
  if (!is.record(task)) {
    return task;
  }

  return projectTaskSummary(task, options);
}

export function projectTaskListResult(
  result: unknown,
  options: { includeLinks?: boolean } = {}
): unknown {
  if (!is.array(result)) {
    return result;
  }
  return result.map((task) => projectListTask(task, options));
}

export function projectDetailedTask(
  task: Record<string, unknown>,
  options: { keepArchived: boolean }
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(task)) {
    if (key === "taskType") {
      const taskType = projectTaskTypeSummary(value);
      if (taskType) {
        projected.taskType = taskType;
      }
      continue;
    }

    if (key === "list") {
      const list = projectTaskListSummary(value);
      if (list !== undefined) {
        projected.list = list;
      }
      continue;
    }

    if (key === "isArchived" && !options.keepArchived) {
      continue;
    }

    if (key === "assignee" || key === "delegatedToAgent") {
      projected[key] = projectTaskAssignee(value);
      continue;
    }

    if (MCP_DETAIL_TASK_STRIPPED_FIELDS.has(key)) {
      continue;
    }

    projected[key] = value;
  }

  return projected;
}

export function projectSearchTaskResult(task: unknown): unknown {
  if (!is.record(task)) {
    return task;
  }

  return projectTaskSummary(task);
}

export function projectTaskSearchResult(result: unknown): unknown {
  if (!is.record(result) || !is.array(result.page)) {
    return result;
  }
  return {
    ...result,
    page: result.page.map(projectSearchTaskResult),
  };
}
