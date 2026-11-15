import { format } from "date-fns";

/** "Just now" / "5m ago" / "3h ago" / "Yesterday" / "4d ago" / locale date. */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** "now" / "5m" / "3h" / "4d" / "2y", for one-line list rows. */
export function formatCompactRelativeTime(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 365) return `${diffDays}d`;
  return `${Math.floor(diffDays / 365)}y`;
}

/** Full date and time ("Mar 5, 2026, 2:30:00 PM") for the `title` of a relative time. */
export function formatAbsoluteTime(timestamp: number): string {
  return format(new Date(timestamp), "PPpp");
}
