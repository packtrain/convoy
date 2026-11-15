import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { expandCliNormalizedEvent } from "@/convex/cli/lib/chunks/normalizedEvents";
import type { NormalizedChunkRow, UsageLimitSeverity } from "./types";

export type { UsageLimitSeverity } from "./types";

export type UsageLimitUsage = {
  window: string;
  utilization: number | null;
  resetsAt: number | null;
  isUsingOverage: boolean;
  severity: UsageLimitSeverity;
};

export const USAGE_LIMIT_WARNING_THRESHOLD = 0.8;
export const USAGE_LIMIT_CRITICAL_THRESHOLD = 0.95;

type UsageLimitSnapshot = Pick<
  Extract<CliNormalizedEvent, { kind: "usage-limit" }>,
  "window" | "utilization" | "resetsAt" | "isUsingOverage"
>;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getUsageLimitSeverity(event: {
  utilization?: number;
  isUsingOverage?: boolean;
}): UsageLimitSeverity {
  const utilization = asNumber(event.utilization);
  if (event.isUsingOverage === true) {
    return "critical";
  }
  if (utilization === null) {
    return "none";
  }
  if (utilization >= USAGE_LIMIT_CRITICAL_THRESHOLD) {
    return "critical";
  }
  if (utilization >= USAGE_LIMIT_WARNING_THRESHOLD) {
    return "warning";
  }
  return "none";
}

/** From a `usage-limit` event or the thread's persisted snapshot (OS-1889). */
export function toUsageLimitUsage(event: UsageLimitSnapshot): UsageLimitUsage {
  return {
    window: event.window,
    utilization: asNumber(event.utilization),
    resetsAt: asNumber(event.resetsAt),
    isUsingOverage: event.isUsingOverage === true,
    severity: getUsageLimitSeverity(event),
  };
}

/**
 * Latest usage snapshot per rate-limit window. Usage is state, not a log:
 * a newer event for the same window replaces the older one entirely.
 */
export function deriveLatestUsageLimits(
  rows: ReadonlyArray<NormalizedChunkRow>
): UsageLimitUsage[] {
  const latestByWindow = new Map<string, UsageLimitUsage>();

  for (const row of rows) {
    for (const event of expandCliNormalizedEvent(row.event)) {
      if (event.kind === "usage-limit") {
        latestByWindow.set(event.window, toUsageLimitUsage(event));
      }
    }
  }

  return Array.from(latestByWindow.values());
}

/** Merge newer per-window snapshots over an existing set. */
export function mergeUsageLimits(
  previous: ReadonlyArray<UsageLimitUsage>,
  updates: ReadonlyArray<UsageLimitUsage>
): UsageLimitUsage[] {
  if (updates.length === 0) {
    return [...previous];
  }

  const merged = new Map(previous.map((usage) => [usage.window, usage]));
  for (const usage of updates) {
    merged.set(usage.window, usage);
  }
  return Array.from(merged.values());
}

export function formatUsageLimitWindowLabel(window: string): string {
  if (window === "5h") {
    return "5h limit";
  }
  if (window === "weekly") {
    return "Weekly limit";
  }
  return `${window} limit`;
}

export function formatUsageLimitPercentage(utilization: number | null): string {
  if (utilization === null) {
    return "—";
  }
  return `${Math.round(Math.min(1, Math.max(0, utilization)) * 100)}%`;
}

/** Relative reset time, e.g. "in 2h 10m". `resetsAt` is unix seconds. */
export function formatUsageLimitReset(
  resetsAt: number | null,
  nowMs: number
): string | null {
  if (resetsAt === null) {
    return null;
  }

  const deltaMs = resetsAt * 1000 - nowMs;
  if (deltaMs <= 0) {
    return "now";
  }

  const totalMinutes = Math.ceil(deltaMs / 60_000);
  if (totalMinutes < 60) {
    return `in ${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainderHours = hours % 24;
    return remainderHours > 0 ? `in ${days}d ${remainderHours}h` : `in ${days}d`;
  }

  return minutes > 0 ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
}
