const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatCompactRelativeTime(
  timestamp: number,
  now: number = Date.now()
) {
  const elapsed = Math.max(0, now - timestamp);

  if (elapsed < MINUTE) {
    return "<1m ago";
  }

  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m ago`;
  }

  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h ago`;
  }

  if (elapsed < MONTH) {
    return `${Math.floor(elapsed / DAY)}d ago`;
  }

  if (elapsed < YEAR) {
    return `${Math.floor(elapsed / MONTH)}mo ago`;
  }

  return `${Math.floor(elapsed / YEAR)}y ago`;
}
