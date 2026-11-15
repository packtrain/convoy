import { cn } from "@/lib/utils";

interface ThreadDiffStatProps {
  added?: number;
  removed?: number;
  className?: string;
}

export function ThreadDiffStat({
  added,
  removed,
  className,
}: ThreadDiffStatProps) {
  if (added === undefined && removed === undefined) {
    return (
      <span className={cn("font-mono text-xs text-muted-foreground", className)}>
        —
      </span>
    );
  }

  return (
    <span
      className={cn("font-mono text-xs", className)}
      aria-label={`${added ?? 0} additions, ${removed ?? 0} deletions`}
    >
      <span className="text-success">
        +{added ?? 0}
      </span>{" "}
      <span className="text-destructive">−{removed ?? 0}</span>
    </span>
  );
}
