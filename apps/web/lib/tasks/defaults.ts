import { LexoRank } from "lexorank";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Status,
  type AssigneeFilter,
  type FilterKey,
  type LocalTask,
  type StatusFilterKey,
  type Task,
} from "./types";
import { taskAssigneeFilterToCreateDefault } from "./assignee-filters";
import { parseTaskTitleForCreate } from "./create-title";
import { getDefaultTaskTypeSummary, resolveTaskTypeSummary } from "./task-types";

export function createDefaultTask(
  overrides?: Partial<Omit<Task, "_id" | "clientId">>
): Omit<Task, "_id" | "clientId"> {
  return {
    name: "",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    refNumber: 0,
    refId: "",
    priority: "None",
    dueDate: null,
    status: Status.TODO,
    tags: [],
    rank: LexoRank.middle().toString(),
    parentId: null,
    isArchived: false,
    ...overrides,
    assignee: overrides?.assignee ?? null,
    delegatedToAgent: overrides?.delegatedToAgent ?? null,
    createdAt: overrides?.createdAt ?? Date.now(),
  };
}

export function createLocalTask(overrides?: Partial<LocalTask>): LocalTask {
  return {
    id: Date.now().toString(),
    name: "",
    priority: "None",
    dueDate: "",
    status: Status.TODO,
    assignee: null,
    tags: [],
    rank: LexoRank.middle().toString(),
    parentId: null,
    ...overrides,
  };
}

export function createDefaultTaskFromInput(
  value: string,
  overrides?: Partial<Omit<Task, "_id" | "clientId">>
): Omit<Task, "_id" | "clientId"> | null {
  const parsedTitle = parseTaskTitleForCreate(value);
  if (parsedTitle.name.length === 0) {
    return null;
  }

  return createDefaultTask({
    name: parsedTitle.name,
    tags: parsedTitle.tags,
    ...(parsedTitle.taskTypeKey && {
      taskType: resolveTaskTypeSummary(parsedTitle.taskTypeKey),
    }),
    ...overrides,
  });
}

export function getFilterDefaults(
  filter: FilterKey,
  currentUserId?: string
): Partial<Omit<Task, "_id" | "clientId">> {
  switch (filter) {
    case "done":
      return { status: Status.DONE };
    case "assigned":
      return currentUserId
        ? {
            assignee: {
              type: "user",
              userId: currentUserId as Id<"users">,
              name: null,
              avatarUrl: null,
            },
          }
        : { assignee: null };
    case "active":
    case "all":
    default:
      return {};
  }
}

export function getFilterDefaultsFromFilters(
  statusFilter: StatusFilterKey,
  assigneeFilter: AssigneeFilter,
  currentUserId?: string
): Partial<Omit<Task, "_id" | "clientId">> {
  const defaults: Partial<Omit<Task, "_id" | "clientId">> = {};

  if (statusFilter === "done") {
    defaults.status = Status.DONE;
  }

  const assignee = taskAssigneeFilterToCreateDefault(assigneeFilter, currentUserId);
  if (assignee !== undefined) {
    if (assignee?.type === "user") {
      defaults.assignee = {
        type: "user",
        userId: assignee.userId,
        name: null,
        avatarUrl: null,
      };
    } else if (assignee === null) {
      defaults.assignee = null;
    } else {
      defaults.assigneeInput = assignee;
    }
  }

  return defaults;
}
