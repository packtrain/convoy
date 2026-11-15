import { v, type Infer } from "convex/values";
import { cliThreadStatusValidator, cliTypeValidator } from "./validators";

// Denormalized per-task summary of linked CLI thread work (OS-1094). Stored on the task document
// so list/board/sidebar indicators render without per-task thread queries (which are scoped to the
// current user). Entries are keyed by the thread's `associatedTaskId` and mirrored from the thread
// lifecycle by `cli/threads/lib/agentThreadWork.ts`.

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
  // sorts every source by creation time, and `updatedAt` is restamped on each status/title
  // change — which would make a teammate's row drift down the stream while their agent works.
  // Optional so legacy entries need no migration: absent means readers fall back to `updatedAt`.
  createdAt: v.optional(v.number()),
  updatedAt: v.number(),
});

export type AgentThreadWorkSource = Infer<typeof agentThreadWorkSourceValidator>;
export type AgentThreadWorkEntry = Infer<typeof agentThreadWorkEntryValidator>;

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
