/** `450ms`, `4.2s`, `5m 16s`, `1h 2m 5s`. */
export function formatDurationMs(durationMs: number): string;
export function formatDurationMs(durationMs: number | undefined): string | null;
export function formatDurationMs(durationMs: number | undefined): string | null {
  if (durationMs === undefined) {
    return null;
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  // Below this, toFixed(1) stays under "60.0s".
  if (durationMs < 59_950) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const parts: [number, string][] = [
    [Math.floor(totalSeconds / 3600), "h"],
    [Math.floor(totalSeconds / 60) % 60, "m"],
    [totalSeconds % 60, "s"],
  ];
  return parts
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ");
}
