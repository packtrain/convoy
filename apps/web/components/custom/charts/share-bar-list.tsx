import { cn } from "@/lib/utils";
import type { ShareBarRow } from "./types";

/**
 * Labeled horizontal bars scaled relative to the largest row. Identity is
 * carried by the label (and optional swatch color), values by the bar and
 * the right-aligned value text — never color alone.
 */
export function ShareBarList({
  rows,
  showSwatches = false,
  className,
}: {
  rows: ShareBarRow[];
  /** Render a color swatch before each label (multi-hue lists). */
  showSwatches?: boolean;
  className?: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), Number.EPSILON);
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {rows.map((row) => {
        const color = row.color ?? "var(--chart-1)";
        return (
          <div key={row.key}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
              <span className="flex min-w-24 max-w-full items-center gap-1.5">
                {showSwatches ? (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                <span className="truncate text-foreground">{row.label}</span>
              </span>
              <span className="max-w-full tabular-nums text-muted-foreground">
                {row.detail ? `${row.detail} · ` : ""}
                {row.valueText}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-[4px] bg-muted">
              <div
                className="h-full rounded-r-[4px]"
                style={{
                  width: `${(row.value / max) * 100}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
