export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC midnight for the given timestamp. Rollups bucket by UTC day: stable
 * across viewers and timezone-free at the cost of a viewer's local "today"
 * possibly straddling two buckets.
 */
export function utcDayStartMs(timestampMs: number): number {
  return timestampMs - (timestampMs % DAY_MS);
}
