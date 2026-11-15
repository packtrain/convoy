import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { expandCliNormalizedEvent } from "@/convex/cli/lib/chunks/normalizedEvents";
import type { NormalizedChunkRow } from "./types";

export type ContextWindowUsage = {
  usedTokens: number;
  maxTokens: number;
  remainingTokens: number;
  usedPercentage: number;
  remainingPercentage: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type ContextWindowSnapshot = Pick<
  Extract<CliNormalizedEvent, { kind: "context-window" }>,
  "usedTokens" | "maxTokens" | "inputTokens" | "cachedInputTokens" | "outputTokens"
>;

/** From a `context-window` event or the thread's persisted snapshot (OS-1889). */
export function toContextWindowUsage(
  event: ContextWindowSnapshot | null | undefined
): ContextWindowUsage | null {
  if (!event) {
    return null;
  }

  const usedTokens = asNumber(event.usedTokens);
  const maxTokens = asNumber(event.maxTokens);
  if (usedTokens === null || usedTokens <= 0 || maxTokens === null || maxTokens <= 0) {
    return null;
  }

  const usedPercentage = Math.min(100, (usedTokens / maxTokens) * 100);

  return {
    usedTokens,
    maxTokens,
    remainingTokens: Math.max(0, maxTokens - usedTokens),
    usedPercentage,
    remainingPercentage: Math.max(0, 100 - usedPercentage),
    inputTokens: asNumber(event.inputTokens),
    cachedInputTokens: asNumber(event.cachedInputTokens),
    outputTokens: asNumber(event.outputTokens),
  };
}

function isPositive(value: number | undefined): value is number {
  return asNumber(value) !== null && (value as number) > 0;
}

/**
 * Newest used count, with the max carried forward from the newest event that
 * has one (Claude's per-API-call events have none, OS-1900), else from
 * `carriedMaxTokens`. Returns null when no event has a positive used count.
 */
export function deriveLatestContextWindow(
  rows: ReadonlyArray<NormalizedChunkRow>,
  carriedMaxTokens?: number
): ContextWindowSnapshot | null {
  let latest: ContextWindowSnapshot | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const events = expandCliNormalizedEvent(rows[index]?.event);
    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = events[eventIndex];
      if (event?.kind !== "context-window") {
        continue;
      }
      if (!latest) {
        if (!isPositive(event.usedTokens)) {
          continue;
        }
        latest = {
          usedTokens: event.usedTokens,
          inputTokens: event.inputTokens,
          cachedInputTokens: event.cachedInputTokens,
          outputTokens: event.outputTokens,
        };
      }
      if (isPositive(event.maxTokens)) {
        return { ...latest, maxTokens: event.maxTokens };
      }
    }
  }

  if (!latest) {
    return null;
  }
  return isPositive(carriedMaxTokens) ? { ...latest, maxTokens: carriedMaxTokens } : latest;
}

export type ContextWindowSeverity = "normal" | "warning" | "critical";

/** Absolute-token tiers — see docs/specs/cli-thread-context-window-meter.md. */
export function contextWindowSeverity(usedTokens: number): ContextWindowSeverity {
  if (usedTokens > 300_000) {
    return "critical";
  }
  if (usedTokens > 150_000) {
    return "warning";
  }

  return "normal";
}

export function formatContextWindowPercentage(value: number): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }

  return `${Math.round(value)}%`;
}

export function formatContextWindowTokens(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 1_000_000) {
    const compactThousands = value / 1_000;
    const roundedThousands = Math.round(compactThousands);
    if (roundedThousands >= 1_000) {
      return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    }
    if (compactThousands < 10) {
      return `${compactThousands.toFixed(1).replace(/\.0$/, "")}k`;
    }
    return `${roundedThousands}k`;
  }

  for (const [suffix, scale] of [
    ["m", 1e6],
    ["b", 1e9],
  ] as const) {
    const compact = (value / scale).toFixed(1);
    if (Number(compact) < 1_000) {
      return `${compact.replace(/\.0$/, "")}${suffix}`;
    }
  }
  return `${(value / 1e12).toFixed(1).replace(/\.0$/, "")}t`;
}
