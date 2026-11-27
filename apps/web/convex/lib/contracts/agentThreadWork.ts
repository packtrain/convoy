import { v, type Infer } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { cliThreadStatusValidator, cliTypeValidator } from "./validators";

// Per-task summary of linked CLI thread work (OS-1094), one `agentThreadWork` row per thread so
// indicators render without per-task thread queries (which are scoped to the current user). Rows
// follow the thread's `associatedTaskId` and are mirrored by `cli/threads/lib/agentThreadWork.ts`.
// Kept off the task document so a status change doesn't re-run task lists (OS-2579).

export const agentThreadWorkSourceValidator = v.union(
  v.literal("assignment_automation"),
  v.literal("manual_attachment"),
  v.literal("workflow_run")
);

export const agentThreadWorkEntryValidator = v.object({
  threadId: v.id("cliThreads"),
  threadTitle: v.string(),
  userId: v.id("users"),
  userName: v.string(),
  cliType: cliTypeValidator,
  status: cliThreadStatusValidator,
  source: agentThreadWorkSourceValidator,
  // Bound Project agent identity (OS-1138): name snapshotted at sync time
  // (like `userName`), absent for threads without an agent binding.
  projectAgentId: v.optional(v.id("projectAgents")),
  agentName: v.optional(v.string()),
  // The thread's own creation time, snapshotted on first sync (OS-1588). The task timeline
  // sorts every source by creation time; `updatedAt` is restamped on each status/title change.
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const taskAgentThreadWorkValidator = v.object({
  taskId: v.id("tasks"),
  entries: v.array(agentThreadWorkEntryValidator),
});

export type AgentThreadWorkSource = Infer<typeof agentThreadWorkSourceValidator>;
export type AgentThreadWorkEntry = Infer<typeof agentThreadWorkEntryValidator>;
export type TaskAgentThreadWork = Infer<typeof taskAgentThreadWorkValidator>;

export function toAgentThreadWorkEntry(row: Doc<"agentThreadWork">): AgentThreadWorkEntry {
  const { _id, _creationTime, projectId, taskId, ...entry } = row;
  void _id;
  void _creationTime;
  void projectId;
  void taskId;
  return entry;
}

// Mirrored by the client in `apps/web/lib/tasks/types.ts`
// (UNRESOLVED_AGENT_THREAD_WORK_STATUSES) — importing this module there would
// pull the runtime registry into the web bundle. Keep both in sync.
const UNRESOLVED_AGENT_THREAD_WORK_STATUSES: ReadonlySet<AgentThreadWorkEntry["status"]> = new Set([
  "pending",
  "streaming",
  "waiting_input",
]);

/** Whether an entry still represents active/attention-needing work (blocks-with-confirmation statuses). */
export function isUnresolvedAgentThreadWork(entry: Pick<AgentThreadWorkEntry, "status">): boolean {
  return UNRESOLVED_AGENT_THREAD_WORK_STATUSES.has(entry.status);
}
