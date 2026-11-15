import type { ThreadStatus } from "@/lib/threads/types";

/**
 * The one label vocabulary for a thread's status. Lives here rather than beside a
 * renderer because three surfaces word it (full row, compact row, agent-work tooltip);
 * before OS-1590 each had its own copy and they had drifted — `waiting_input` read
 * "Waiting" in one and "Needs input" in another.
 *
 * Words and color only. A surface still owns its glyph and whether to show a label at
 * all. `completed` is muted "Done": a finished run is the resting state and shouldn't
 * compete with live ones for attention.
 */
export const THREAD_STATUS_META: Record<ThreadStatus, { label: string; className: string }> = {
  streaming: { label: "Working", className: "text-info" },
  pending: { label: "Queued", className: "text-muted-foreground" },
  waiting_input: { label: "Waiting", className: "text-warning" },
  failed: { label: "Failed", className: "text-destructive" },
  completed: { label: "Done", className: "text-muted-foreground/70" },
};
