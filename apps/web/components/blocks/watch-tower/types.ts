import type { useWatchTowerSection } from "@/lib/watch-tower/use-watch-tower-threads";
import type { ThreadBatchSelection } from "@/lib/threads/thread-batch-selection";
import type { WatchStatus } from "@/lib/watch-tower/watch-tower-view";

export type SectionData = ReturnType<typeof useWatchTowerSection>;

/**
 * Batch selection lives in one section at a time; starting a selection in
 * another section replaces it, keeping header actions unambiguous (OS-1255).
 * A board column is a section, so the board reuses this as-is.
 */
export type SectionSelection = { section: WatchStatus } & ThreadBatchSelection;

export type BatchAction = "markRead" | "markDone" | "markNotDone" | "delete";

// Bulk actions offered per section. Running is not selectable at all —
// bulk-acting on mid-flight threads from the dashboard is all edge cases.
export const SECTION_BULK_ACTIONS: Record<
  WatchStatus,
  { markRead: boolean; markDone: boolean; markNotDone: boolean } | null
> = {
  running: null,
  waiting_input: { markRead: true, markDone: true, markNotDone: false },
  failed: { markRead: true, markDone: true, markNotDone: false },
  needs_review: { markRead: true, markDone: true, markNotDone: false },
  done: { markRead: false, markDone: false, markNotDone: true },
};
