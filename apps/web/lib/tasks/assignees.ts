import type { Id } from "@/convex/_generated/dataModel";
import type {
  TaskAssigneeDetails,
  TaskAssigneeInput,
  TaskDelegatedAgentDetails,
  TaskUserAssigneeDetails,
} from "./types";

export const TASK_ASSIGNEE_USER_PREFIX = "user:";
export const TASK_ASSIGNEE_PROJECT_AGENT_PREFIX = "projectAgent:";

/**
 * Split assignment change (OS-1335): picking a person changes the owner
 * (`assigneeId`), picking an agent changes the delegation
 * (`delegatedToAgentId`). Absent fields are untouched; `null` clears.
 * The `*Details` fields carry optimistic display data.
 */
export type TaskAssigneeChange = {
  assigneeId?: Id<"users"> | null;
  delegatedToAgentId?: Id<"projectAgents"> | null;
  assigneeDetails?: TaskUserAssigneeDetails;
  delegatedToAgentDetails?: TaskDelegatedAgentDetails;
};

/** Map a selected directory option (user / agent / null = "No assignee") to the split change it represents. */
export function taskAssigneeOptionToChange(details: TaskAssigneeDetails): TaskAssigneeChange {
  if (!details) return { assigneeId: null, assigneeDetails: null };
  if (details.type === "user") return { assigneeId: details.userId, assigneeDetails: details };
  return { delegatedToAgentId: details.projectAgentId, delegatedToAgentDetails: details };
}

export const CLEAR_DELEGATION_CHANGE: TaskAssigneeChange = {
  delegatedToAgentId: null,
  delegatedToAgentDetails: null,
};

export function taskAssigneeToKey(
  assignee: TaskAssigneeInput | TaskAssigneeDetails | undefined
): string | undefined {
  if (!assignee) return undefined;
  if (assignee.type === "user") {
    return `${TASK_ASSIGNEE_USER_PREFIX}${assignee.userId}`;
  }
  return `${TASK_ASSIGNEE_PROJECT_AGENT_PREFIX}${assignee.projectAgentId}`;
}

export function taskAssigneeInputsEqual(
  a: TaskAssigneeInput | undefined,
  b: TaskAssigneeInput | undefined
): boolean {
  return taskAssigneeToKey(a) === taskAssigneeToKey(b);
}

export function displayNameForTaskAssignee(assignee: TaskAssigneeDetails): string {
  if (!assignee) return "No assignee";
  if (assignee.type === "user") return assignee.name ?? "Unknown assignee";
  return assignee.name;
}
