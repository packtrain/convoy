import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "destructive" | "muted";

const TEXT: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

const DOT: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-border-strong",
};

/** Dot + label status indicator (agent rows, connection state, tray popover). */
export function StatusChip({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-1.5 text-[12.5px] font-medium", TEXT[tone], className)}>
      <span className={cn("size-1.5 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}
