import type { Id } from "@/convex/_generated/dataModel";
import type { TaskUpdate, TaskMutationFields } from "./types";

/**
 * Strips client-only fields from a TaskUpdate, returning only the fields
 * the backend `tasks.update` mutation accepts.
 */
type TaskMutationArgs = TaskMutationFields & {
  id: Id<"tasks">;
};

export function toTaskMutationArgs(
  id: string,
  updates: TaskUpdate
): TaskMutationArgs {
  return {
    id: id as Id<"tasks">,
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.description !== undefined && { description: updates.description }),
    ...(updates.priority !== undefined && { priority: updates.priority }),
    ...(updates.status !== undefined && { status: updates.status }),
    ...(updates.dueDate !== undefined && { dueDate: updates.dueDate }),
    ...(updates.assigneeId !== undefined && { assigneeId: updates.assigneeId }),
    ...(updates.delegatedToAgentId !== undefined && { delegatedToAgentId: updates.delegatedToAgentId }),
    ...(updates.taskTypeKey !== undefined && { taskTypeKey: updates.taskTypeKey }),
    ...(updates.tags !== undefined && { tags: updates.tags }),
    ...(updates.labelId !== undefined && { labelId: updates.labelId }),
    ...(updates.sectionId !== undefined && { sectionId: updates.sectionId }),
    ...(updates.rank !== undefined && { rank: updates.rank }),
  };
}
