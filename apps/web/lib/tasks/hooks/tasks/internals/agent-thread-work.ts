import { useMemo } from "react";
import { useQueries } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskAgentThreadWork } from "@/convex/lib/contracts/agentThreadWork";
import { MAX_AGENT_THREAD_WORK_TASK_IDS } from "@/convex/tasks/lib/constants";
import { useLastResolvedValue } from "@/hooks/react/use-last-resolved-value";
import type { TaskAgentThreadWorkEntry } from "@/lib/tasks/types";

/**
 * Merges each task's runs into the rows a board or list shows. A separate
 * subscription, so a status change doesn't re-run the task list (OS-2579).
 */
export function useWithAgentThreadWork<TTask extends { _id: Id<"tasks">; refNumber: number }>(
  projectId: Id<"projects"> | undefined,
  tasks: readonly TTask[] | undefined
): (TTask & { agentThreadWork?: TaskAgentThreadWorkEntry[] })[] | undefined {
  // Optimistic rows carry refNumber 0 and a temp id the server would reject.
  // Sorted and keyed by content, so reordering or a list refresh keeps the subscriptions.
  const idsKey = useMemo(
    () => (tasks ?? []).filter((task) => task.refNumber > 0).map((task) => task._id).sort().join(","),
    [tasks]
  );
  const queries = useMemo(() => {
    const taskIds = idsKey ? (idsKey.split(",") as Id<"tasks">[]) : [];
    const chunks: Record<string, { query: typeof api.tasks.agentThreadWork.listByTasks; args: { projectId: Id<"projects">; taskIds: Id<"tasks">[] } }> = {};
    // One subscription per server-capped chunk.
    for (let start = 0; projectId && start < taskIds.length; start += MAX_AGENT_THREAD_WORK_TASK_IDS) {
      chunks[start] = {
        query: api.tasks.agentThreadWork.listByTasks,
        args: { projectId, taskIds: taskIds.slice(start, start + MAX_AGENT_THREAD_WORK_TASK_IDS) },
      };
    }
    return chunks;
  }, [projectId, idsKey]);
  const results = useQueries(queries);
  const queried = useMemo(() => {
    const groups: TaskAgentThreadWork[] = [];
    for (const result of Object.values(results)) {
      if (result instanceof Error) throw result;
      if (result === undefined) return undefined;
      groups.push(...(result as TaskAgentThreadWork[]));
    }
    return groups;
  }, [results]);
  // Keyed by project only, so the last result stays up while new ids load.
  const work = useLastResolvedValue({
    cacheKey: projectId ? `agent-thread-work:${projectId}` : null,
    enabled: Boolean(projectId),
    value: queried,
  });

  return useMemo(() => {
    if (!tasks) return undefined;
    const byTask = new Map((work ?? []).map((group) => [group.taskId, group.entries]));
    return tasks.map((task) => ({ ...task, agentThreadWork: byTask.get(task._id) }));
  }, [tasks, work]);
}
