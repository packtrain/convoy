import type { Priority, Status } from "@/lib/tasks/types";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/tasks/constants";
import { cn } from "@/lib/utils";

export function PriorityIcon({ priority }: { priority: Priority }) {
  const config = PRIORITY_CONFIG[priority];
  const Icon = config.icon;
  return <Icon className={`h-4 w-4 ${config.color}`} />;
}

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return <Icon className={cn("h-4 w-4", config.color, className)} />;
}

export function StatusBadge({
  status,
  variant = "default",
  className,
  srLabel,
}: {
  status: Status;
  variant?: "default" | "compact";
  className?: string;
  srLabel?: string;
}) {
  if (variant === "compact") {
    return (
      <span className={cn("inline-flex items-center", className)}>
        <StatusIcon status={status} className="size-4" />
        {srLabel ? <span className="sr-only">{srLabel}</span> : null}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground",
        className
      )}
    >
      <StatusIcon status={status} className="size-3" />
      {status}
    </span>
  );
}

/** The one mark for an empty table value. Spec: docs/specs/task-table-compact-headers.md */
export const EMPTY_VALUE_MARK = "—";

export function EmptyValue({ className }: { className?: string }) {
  return <span className={cn("text-xs text-muted-foreground", className)}>{EMPTY_VALUE_MARK}</span>;
}

export function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {tag}
    </span>
  );
}
