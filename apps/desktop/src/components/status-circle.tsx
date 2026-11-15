import { cn } from "@/lib/utils";
import type { StatusTone } from "./status-chip";

const TONE: Record<StatusTone, string> = {
  success: "border-success bg-success/15 text-success",
  warning: "border-warning bg-warning/15 text-warning",
  destructive: "border-destructive bg-destructive/15 text-destructive",
  muted: "border-border-strong bg-muted/40 text-muted-foreground",
};

/** Outcome mark (✓ / ! / ✕) in a tinted circle — result screens and cards. */
export function StatusCircle({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-11 items-center justify-center rounded-full border text-lg font-bold",
        TONE[tone],
        className
      )}
    >
      {children}
    </div>
  );
}
