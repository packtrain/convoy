"use client";

import { useState } from "react";
import { FoldVertical } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  contextWindowSeverity,
  formatContextWindowPercentage,
  formatContextWindowTokens,
  type ContextWindowSeverity,
  type ContextWindowUsage,
} from "@/lib/cli-stream-ui";
import { cn } from "@/lib/utils";

// Ring tone tiers; matches the usage-limit pill palette in the same footer row.
const SEVERITY_TEXT_CLASS: Record<ContextWindowSeverity, string> = {
  normal: "text-muted-foreground",
  warning: "text-warning",
  critical: "text-destructive",
};

export function ContextWindowMeter({
  usage,
  onCompact,
  className,
}: {
  // Nullable so the meter renders an empty ring before the agent reports
  // usage — keeps the footer layout stable instead of popping in later.
  usage: ContextWindowUsage | null;
  /** Sends `/compact` ahead of the queue (OS-2339); no button when unset. */
  onCompact?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const usedPercentage = formatContextWindowPercentage(usage?.usedPercentage ?? 0);
  const remainingPercentage = formatContextWindowPercentage(
    usage?.remainingPercentage ?? 100
  );
  const normalizedPercentage = Math.max(
    0,
    Math.min(100, usage?.usedPercentage ?? 0)
  );
  const severity = contextWindowSeverity(usage?.usedTokens ?? 0);
  const radius = 7.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex cursor-pointer items-center justify-center rounded-full transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            SEVERITY_TEXT_CLASS[severity],
            className
          )}
          aria-label={`Context window ${usedPercentage} used`}
        >
          <span className="relative flex size-5 items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              className="absolute inset-0 -rotate-90 transform-gpu"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r={radius}
                fill="none"
                // Track must stay visible on muted surfaces (composer top
                // bar), so tint from the foreground, not the muted bg.
                stroke="color-mix(in oklab, currentColor 35%, transparent)"
                strokeWidth="2.5"
              />
              <circle
                cx="12"
                cy="12"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
              />
            </svg>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-auto min-w-0 px-3 py-2"
      >
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Context window
          </div>
          {usage ? (
            <>
              <div className="whitespace-nowrap text-xs font-medium text-foreground">
                {usedPercentage} used ({remainingPercentage} left)
              </div>
              <div className="whitespace-nowrap text-xs text-muted-foreground">
                {formatContextWindowTokens(usage.usedTokens)} /{" "}
                {formatContextWindowTokens(usage.maxTokens)} tokens used
              </div>
            </>
          ) : (
            <div className="whitespace-nowrap text-xs text-muted-foreground">
              No usage reported yet
            </div>
          )}
        </div>
        {onCompact ? (
          <div className="-mx-3 -mt-0.5 -mb-2 border-t p-1">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
              onClick={() => {
                setOpen(false);
                onCompact();
              }}
            >
              <FoldVertical className="size-3.5 text-muted-foreground" />
              Compact context
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
