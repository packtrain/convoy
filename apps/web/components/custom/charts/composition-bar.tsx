import { cn } from "@/lib/utils";
import type { CompositionSegment } from "./types";

/** 100%-composition bar with a legend row per segment (share of a whole). */
export function CompositionBar({
  segments,
  className,
}: {
  segments: CompositionSegment[];
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);
  return (
    <div className={className}>
      {total > 0 ? (
        <div className="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-[4px]">
          {visible.map((segment) => (
            <div
              key={segment.key}
              style={{
                width: `${(segment.value / total) * 100}%`,
                backgroundColor: segment.color,
                minWidth: 3,
              }}
            />
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 text-xs">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
          >
            <span className="flex min-w-24 max-w-full items-center gap-1.5 text-foreground">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[3px]"
                style={{ backgroundColor: segment.color }}
              />
              <span className="truncate">{segment.label}</span>
            </span>
            <span
              className={cn("max-w-full tabular-nums text-muted-foreground")}
            >
              {total > 0
                ? `${Math.round((segment.value / total) * 100)}% · `
                : ""}
              {segment.valueText}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
