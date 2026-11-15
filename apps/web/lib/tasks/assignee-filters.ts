import type { Id } from "@/convex/_generated/dataModel";
import {
  TASK_ASSIGNEE_PROJECT_AGENT_PREFIX,
  TASK_ASSIGNEE_USER_PREFIX,
} from "./assignees";
import type {
  Task,
  TaskAssigneeFilter,
  TaskAssigneeInput,
} from "./types";

export function serializeAssigneeFilter(
  filter: TaskAssigneeFilter
): string | undefined {
  if (!filter) return undefined;
  if (filter.type === "me") return "me";
  if (filter.type === "unassigned") return "unassigned";
  if (filter.type === "user") return `${TASK_ASSIGNEE_USER_PREFIX}${filter.userId}`;
  return `${TASK_ASSIGNEE_PROJECT_AGENT_PREFIX}${filter.projectAgentId}`;
}

export function parseAssigneeFilter(value: string | null): TaskAssigneeFilter {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized === "me") return { type: "me" };
  if (normalized === "unassigned") return { type: "unassigned" };
  if (normalized.startsWith(TASK_ASSIGNEE_USER_PREFIX)) {
    const userId = normalized.slice(TASK_ASSIGNEE_USER_PREFIX.length);
    return userId ? { type: "user", userId: userId as Id<"users"> } : null;
  }
  if (normalized.startsWith(TASK_ASSIGNEE_PROJECT_AGENT_PREFIX)) {
    const projectAgentId = normalized.slice(TASK_ASSIGNEE_PROJECT_AGENT_PREFIX.length);
    return projectAgentId
      ? { type: "projectAgent", projectAgentId: projectAgentId as Id<"projectAgents"> }
      : null;
  }
  return { type: "user", userId: normalized as Id<"users"> };
}

export function taskMatchesAssigneeFilter(
  task: Task,
  filter: TaskAssigneeFilter,
  currentUserId?: string
): boolean {
  if (!filter) return true;

  // Split model (OS-1335): user filters match the human owner — a task
  // delegated to an agent still shows up for its owner (that's the point).
  // Agent filters match the delegation; "unassigned" means no human owner.
  if (filter.type === "unassigned") return !task.assignee;
  if (filter.type === "me") {
    return task.assignee?.userId === currentUserId;
  }
  if (filter.type === "user") {
    return task.assignee?.userId === filter.userId;
  }
  return task.delegatedToAgent?.projectAgentId === filter.projectAgentId;
}

export function taskAssigneeFilterToCreateDefault(
  filter: TaskAssigneeFilter,
  currentUserId?: string
): TaskAssigneeInput | undefined {
  if (!filter) return undefined;
  if (filter.type === "unassigned") return null;
  if (filter.type === "me") {
    return currentUserId
      ? { type: "user", userId: currentUserId as Id<"users"> }
      : undefined;
  }
  if (filter.type === "user") return { type: "user", userId: filter.userId };
  return { type: "projectAgent", projectAgentId: filter.projectAgentId };
}
