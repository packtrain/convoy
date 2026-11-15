/**
 * Debug level from `CONVOY_CLI_DEBUG`, shared by all runtime runners and
 * the app layer:
 *   - unset / invalid → 0  (off)
 *   - "1"             → 1  (debug, truncated)
 *   - "2"             → 2  (debug, full / no truncation)
 */
export function getDebugLevel(): number {
  const raw = process.env.CONVOY_CLI_DEBUG;
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}
