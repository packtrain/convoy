import type {
  CliRunDiffSummary,
  CliRunDiffSummaryPreview,
} from "@/convex/lib/contracts/validators";

/** Minimal envelope shape the timeline needs (structural on purpose). */
export interface TimelineRunSource {
  _id: string;
  role: string;
  runId?: string;
  createdAt: number;
  diffSummary?: CliRunDiffSummaryPreview;
}

export interface TimelineRun {
  diffSummary: CliRunDiffSummaryPreview;
  createdAt: number;
  /** Text of the user message that triggered the run ("" when unknown). */
  prompt: string;
  fileCount: number;
  additions: number;
  deletions: number;
}

/**
 * The thread's runs for the timeline popover (OS-1160): assistant messages
 * with a diff summary, oldest-first, labeled by the first user message of
 * the same run. Only loaded chunks contribute — same window as the
 * cumulative All-changes range.
 */
export function buildTimelineRuns(
  envelopes: readonly TimelineRunSource[],
  userTextById: ReadonlyMap<string, string>
): TimelineRun[] {
  const promptByRun = new Map<string, string>();
  for (const message of envelopes) {
    if (message.role !== "user" || !message.runId || promptByRun.has(message.runId)) {
      continue;
    }
    promptByRun.set(message.runId, userTextById.get(message._id) ?? "");
  }

  const runs: TimelineRun[] = [];
  for (const message of envelopes) {
    if (message.role !== "assistant" || !message.diffSummary) {
      continue;
    }
    // Totals and the file count come off the envelope preview — the full file
    // list is not loaded here and is not needed for a timeline row (OS-1600).
    runs.push({
      diffSummary: message.diffSummary,
      createdAt: message.createdAt,
      prompt: (message.runId && promptByRun.get(message.runId)) || "",
      fileCount: message.diffSummary.fileCount,
      additions: message.diffSummary.additions,
      deletions: message.diffSummary.deletions,
    });
  }
  return runs;
}

/**
 * Synthetic summary spanning the selected runs (endpoints in either order):
 * oldest run's preRef → newest run's postRef, files derived from the fetched
 * patch by the viewer — the same mechanism as the cumulative view (OS-1158).
 */
export function timelineRangeSummary(
  runs: readonly TimelineRun[],
  a: number,
  b: number
): CliRunDiffSummary {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return {
    preRef: runs[lo].diffSummary.preRef,
    postRef: runs[hi].diffSummary.postRef,
    files: [],
  };
}
