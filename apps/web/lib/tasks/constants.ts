import { Flame, ChevronsUp, ChevronUp, ChevronDown, Minus, Circle, Loader, CheckCircle, XCircle, Lightbulb, Eye, Ban, AlertTriangle, FileText, type LucideIcon } from "lucide-react";
import type { Priority } from "./types";
import { Status } from "./status";
import { ALL_TASK_STATUSES } from "./status-policy";

export const ROW_HEIGHT = 44;
export const GROUP_INDENT_PX = 24;

export const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low", "None"];
export const STATUS_OPTIONS: Status[] = ALL_TASK_STATUSES;

export const STATUS_CONFIG: Record<Status, { color: string; icon: LucideIcon }> = {
  [Status.TODO]: { color: "text-muted-foreground", icon: Circle },
  [Status.TRIAGE]: { color: "text-orange-600 dark:text-orange-400", icon: AlertTriangle },
  [Status.PLANNING]: { color: "text-purple-600 dark:text-purple-400", icon: Lightbulb },
  [Status.PLAN_REVIEW]: { color: "text-cyan-600 dark:text-cyan-400", icon: FileText },
  [Status.IN_PROGRESS]: { color: "text-warning", icon: Loader },
  [Status.IN_REVIEW]: { color: "text-info", icon: Eye },
  [Status.BLOCKED]: { color: "text-destructive", icon: Ban },
  [Status.DONE]: { color: "text-success", icon: CheckCircle },
  [Status.CANCELED]: { color: "text-muted-foreground", icon: XCircle },
} as const;

export const PRIORITY_CONFIG: Record<Priority, { icon: LucideIcon; color: string; order: number }> = {
  Critical: { icon: Flame, color: "text-rose-600", order: 0 },
  High: { icon: ChevronsUp, color: "text-red-600", order: 1 },
  Medium: { icon: ChevronUp, color: "text-amber-600", order: 2 },
  Low: { icon: ChevronDown, color: "text-blue-500", order: 3 },
  None: { icon: Minus, color: "text-muted-foreground", order: 4 },
} as const;

export const RESIZE_BOUNDS = {
  min: 300,
  max: 900,
  default: 400,
  storageKey: "task-sidebar-width",
} as const;

// Requested width of the artifact panel in the task detail overlay. The
// rendered width is still capped by available container space (CSS), so wide
// stored values degrade gracefully on smaller screens.
export const ARTIFACT_RESIZE_BOUNDS = {
  min: 320,
  max: 1600,
  default: 1140,
  storageKey: "task-artifact-panel-width",
} as const;

// Width of the artifact-comments rail inside the artifact panel.
export const ARTIFACT_COMMENTS_RESIZE_BOUNDS = {
  min: 220,
  max: 560,
  default: 288,
  storageKey: "task-artifact-comments-width",
} as const;

/** Date format for displaying due dates (date-fns format) */
export const DATE_FORMAT = "dd/MM/yyyy";

// Client mirrors of convex/tasks/lib/constants.ts and tasks/labels.ts — the
// server validators remain the source of truth; these only drive UI caps/defaults.
export const MAX_LABELS_PER_PROJECT = 20;
export const DEFAULT_LABEL_COLOR = "#3b82f6"; // blue, from the extended palette
