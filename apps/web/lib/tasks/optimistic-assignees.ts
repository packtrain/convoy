import type { Id } from "@/convex/_generated/dataModel";
import type { AssigneeIdInput } from "@/convex/tasks/lib/validators";
import type { TaskDelegatedAgentDetails, TaskUserAssigneeDetails } from "@/lib/tasks/types";

/** Optimistic display details for a split assignment change; absent fields are untouched. */
export type PendingAssigneeSplitDetails = {
  assignee?: TaskUserAssigneeDetails;
  delegatedToAgent?: TaskDelegatedAgentDetails;
};

/**
 * Map a UI change payload (TaskUpdate / TaskAssigneeChange) onto queued display
 * details. Returns undefined when the change carries no assignment details so
 * call sites can skip queueing entirely.
 */
export function pendingDetailsFromUpdate(updates: {
  assigneeDetails?: TaskUserAssigneeDetails;
  delegatedToAgentDetails?: TaskDelegatedAgentDetails;
}): PendingAssigneeSplitDetails | undefined {
  if (updates.assigneeDetails === undefined && updates.delegatedToAgentDetails === undefined) {
    return undefined;
  }
  return {
    ...(updates.assigneeDetails !== undefined && { assignee: updates.assigneeDetails }),
    ...(updates.delegatedToAgentDetails !== undefined && { delegatedToAgent: updates.delegatedToAgentDetails }),
  };
}

/** Minimal acting-user shape needed to synthesize optimistic owner details. */
type OptimisticActingUser = {
  _id: Id<"users">;
  name: string;
  avatarUrl?: string | null;
};

/**
 * Client mirror of the server auto-set-owner rule (`applyAutoSetOwner` in
 * convex/tasks/lib/assignees.ts): delegating to an agent with no explicit
 * owner in the same call, no queued owner details, and no current owner makes
 * the acting user the optimistic owner. The server result stays canonical.
 * Mutates `split` in place.
 */
export function applyOptimisticAutoSetOwner({
  split,
  assigneeId,
  delegatedToAgentId,
  currentAssignee,
  currentUser,
}: {
  split: PendingAssigneeSplitDetails;
  assigneeId?: AssigneeIdInput;
  delegatedToAgentId?: Id<"projectAgents"> | null;
  /** The task's current owner details; null when creating. */
  currentAssignee: TaskUserAssigneeDetails;
  currentUser: OptimisticActingUser | null | undefined;
}): void {
  if (typeof delegatedToAgentId !== "string") return;
  if (assigneeId !== undefined) return;
  if (split.assignee !== undefined) return;
  if (currentAssignee !== null) return;
  if (!currentUser) return;
  split.assignee = {
    type: "user",
    userId: currentUser._id,
    name: currentUser.name,
    avatarUrl: currentUser.avatarUrl ?? null,
  };
}

export function consumePendingAssigneeDetails(
  pendingDetails: Map<string, PendingAssigneeSplitDetails>,
  id: string
): PendingAssigneeSplitDetails | undefined {
  if (!pendingDetails.has(id)) return undefined;
  const details = pendingDetails.get(id);
  pendingDetails.delete(id);
  return details;
}

/**
 * Build the optimistic display patch for a task's split assignment from queued
 * details plus raw mutation args. Fallbacks when no details were queued: a set
 * owner renders as a placeholder user, cleared fields render immediately; a
 * newly delegated agent without queued details stays untouched (its name/color
 * are unknown client-side).
 */
export function resolveOptimisticAssigneeSplit({
  pendingDetails,
  assigneeId,
  delegatedToAgentId,
}: {
  pendingDetails?: PendingAssigneeSplitDetails;
  assigneeId?: AssigneeIdInput;
  delegatedToAgentId?: Id<"projectAgents"> | null;
}): PendingAssigneeSplitDetails {
  const result: PendingAssigneeSplitDetails = { ...pendingDetails };
  // "me" (API callers only) has no client-side user to show; the server fills it in.
  if (result.assignee === undefined && assigneeId !== undefined && assigneeId !== "me") {
    result.assignee =
      assigneeId === null ? null : { type: "user", userId: assigneeId, name: null, avatarUrl: null };
  }
  if (result.delegatedToAgent === undefined && delegatedToAgentId === null) {
    result.delegatedToAgent = null;
  }
  return result;
}
