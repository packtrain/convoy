import type { ToolCallTiming } from "@/lib/cli-stream-ui";
import type { ToolGroup } from "./group-consecutive-tool-parts";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * A group stays live — rendering its parts unwrapped so the run is watchable —
 * while it is the tail of a streaming message, or while any of its calls is
 * still waiting on a result. Otherwise it collapses into its accordion.
 */
export function isToolGroupLive(args: {
  group: ToolGroup;
  isTrailingItem: boolean;
  isMessageStreaming: boolean;
}): boolean {
  if (args.isMessageStreaming && args.isTrailingItem) return true;

  return args.group.parts.some(
    (part) =>
      part.type === "dynamic-tool" &&
      (part.state === "input-streaming" || part.state === "input-available")
  );
}

/**
 * Wall-clock span of a finished tool group: the first tool call's start to the
 * last result. Returns undefined when either end is unknown (legacy chunks
 * without a `toolCallId`, or calls with no result) so callers can fall back to
 * count-based copy instead of showing "0s".
 */
export function getToolGroupDurationMs(
  group: ToolGroup,
  timings: Map<string, ToolCallTiming>
): number | undefined {
  let startedAt: number | undefined;
  let endedAt: number | undefined;

  for (const part of group.parts) {
    if (part.type !== "dynamic-tool") continue;

    const timing = timings.get(part.toolCallId);
    if (!timing || timing.endedAt === undefined) return undefined;

    startedAt =
      startedAt === undefined
        ? timing.startedAt
        : Math.min(startedAt, timing.startedAt);
    endedAt =
      endedAt === undefined ? timing.endedAt : Math.max(endedAt, timing.endedAt);
  }

  if (startedAt === undefined || endedAt === undefined) return undefined;

  return Math.max(0, endedAt - startedAt);
}

/**
 * Accordion title for a finished tool group: `Worked for 12s`,
 * `Worked for 1m 23s` (whole minutes drop the seconds), `Worked for 1h 4m`.
 * Any non-zero span reads as at least 1s.
 */
export function formatWorkedForLabel(durationMs: number): string {
  return `Worked for ${formatWorkDuration(durationMs)}`;
}

function formatWorkDuration(durationMs: number): string {
  if (durationMs >= HOUR_MS) {
    const hours = Math.floor(durationMs / HOUR_MS);
    const minutes = Math.floor((durationMs % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  // Seconds rounding up to a full unit carries into the next one, so 59m59.9s
  // reads "1h" rather than "60m" (and 59.9s reads "1m", not "60s").
  if (durationMs >= MINUTE_MS) {
    const minutes = Math.floor(durationMs / MINUTE_MS);
    const seconds = Math.round((durationMs % MINUTE_MS) / SECOND_MS);
    if (seconds === 60) return formatWorkDuration((minutes + 1) * MINUTE_MS);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }

  const seconds = Math.max(1, Math.round(durationMs / SECOND_MS));
  return seconds === 60 ? formatWorkDuration(MINUTE_MS) : `${seconds}s`;
}
