import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Checks by thread (its task's, or its own; docs/specs/task-checks.md → Ownership), so a thread surface
 * starts reading before its thread doc names the task. Without a thread, the task's Checks.
 */
export function useThreadChecks(threadId: Id<"cliThreads"> | undefined, taskId: Id<"tasks"> | undefined) {
  const forThread = useQuery(api.checks.checklists.getForThread, threadId ? { threadId } : "skip");
  const forTask = useQuery(api.checks.checklists.getForTask, !threadId && taskId ? { taskId } : "skip");
  return threadId ? forThread : forTask;
}
