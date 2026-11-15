import { ConvexError, v } from "convex/values";
import { TASK_TYPE_ICON_KEYS, getBuiltInTaskTypeKeys, resolveTaskTypeSummary } from "@/lib/tasks/task-types";

export { resolveTaskTypeSummary };

const taskTypeIconValidator = v.union(...TASK_TYPE_ICON_KEYS.map((key) => v.literal(key)));

export const taskTypeSummaryValidator = v.object({
  key: v.string(),
  name: v.string(),
  icon: taskTypeIconValidator,
  color: v.string(),
  isSystem: v.boolean(),
});

/**
 * Validates that a task type key is one of the built-in keys.
 * Throws a ConvexError if the key is not valid.
 */
export function validateTaskTypeKey(key: string): void {
  const keys = getBuiltInTaskTypeKeys();
  if (!keys.includes(key)) {
    throw new ConvexError(`Invalid task type '${key}'. Allowed task types: ${keys.join(", ")}`);
  }
}
