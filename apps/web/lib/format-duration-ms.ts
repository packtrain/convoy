export function formatDurationMs(durationMs: number | undefined): string | null {
  if (durationMs === undefined) {
    return null;
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}
