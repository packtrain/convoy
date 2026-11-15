"use client";

import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatUsageLimitPercentage,
  formatUsageLimitReset,
  formatUsageLimitWindowLabel,
  type UsageLimitUsage,
} from "@/lib/cli-stream-ui";
import { cn } from "@/lib/utils";

/** Current time, refreshed once a minute so relative reset times stay fresh. */
function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  return nowMs;
}

function formatAbsoluteResetTime(resetsAt: number | null): string | null {
  if (resetsAt === null) {
    return null;
  }

  return new Date(resetsAt * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UsageLimitPillItem({ usage }: { usage: UsageLimitUsage }) {
  const nowMs = useNowMs();
  const label = formatUsageLimitWindowLabel(usage.window);
  const percentage = formatUsageLimitPercentage(usage.utilization);
  const relativeReset = formatUsageLimitReset(usage.resetsAt, nowMs);
  const absoluteReset = formatAbsoluteResetTime(usage.resetsAt);

  const pillText = [
    `${label} ${percentage}`,
    relativeReset ? `resets ${relativeReset}` : null,
    usage.isUsingOverage ? "using overage" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex cursor-pointer items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            usage.severity === "critical"
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-warning/35 bg-warning-soft text-warning"
          )}
          aria-label={`Usage: ${pillText}`}
        >
          {pillText}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-auto min-w-0 px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </div>
          <div className="whitespace-nowrap text-xs font-medium text-foreground">
            {percentage} of the window used
          </div>
          {absoluteReset ? (
            <div className="whitespace-nowrap text-xs text-muted-foreground">
              Resets {absoluteReset}
            </div>
          ) : null}
          {usage.isUsingOverage ? (
            <div className="whitespace-nowrap text-xs text-destructive">
              Currently using overage
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Thread-footer usage pills: one per rate-limit window, shown only from the
 * warning tier up. Usage is state — each pill reflects the latest snapshot.
 */
export function UsageLimitPills({
  usageLimits,
  className,
}: {
  usageLimits: UsageLimitUsage[];
  className?: string;
}) {
  const visible = usageLimits.filter((usage) => usage.severity !== "none");
  if (visible.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {visible.map((usage) => (
        <UsageLimitPillItem key={usage.window} usage={usage} />
      ))}
    </div>
  );
}
