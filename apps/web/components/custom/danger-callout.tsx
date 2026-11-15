import type { CSSProperties, ReactNode } from "react";
import { CircleX } from "lucide-react";
import { cn } from "@/lib/utils";

// The palette comes straight from the `--danger-callout*` vars rather than
// Tailwind color utilities: a bespoke `@theme` namespace never reached the
// browser in dev, so the surface silently rendered grey.
const SURFACE_STYLE = {
  backgroundColor: "color-mix(in oklab, var(--danger-callout) 15%, transparent)",
  borderColor: "color-mix(in oklab, var(--danger-callout-accent) 25%, transparent)",
} satisfies CSSProperties;

const ICON_STYLE = { color: "var(--danger-callout-accent)" } satisfies CSSProperties;
const TITLE_STYLE = { color: "var(--danger-callout-copy)" } satisfies CSSProperties;
const DETAIL_STYLE = {
  color: "color-mix(in oklab, var(--danger-callout-copy) 80%, transparent)",
} satisfies CSSProperties;

/**
 * Red callout for an error the user can act on — stale app version, failed run.
 * Actions render on the right; give the primary one `DANGER_CALLOUT_ACTION_CLASS`.
 */
export function DangerCallout({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      style={SURFACE_STYLE}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 gap-3">
        <CircleX aria-hidden="true" className="size-5 shrink-0" style={ICON_STYLE} />
        <div className="min-w-0">
          <h3 className="text-sm font-medium" style={TITLE_STYLE}>
            {title}
          </h3>
          {description ? (
            <div
              className="mt-1 text-sm break-words whitespace-pre-wrap"
              style={DETAIL_STYLE}
            >
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export const DANGER_CALLOUT_ACTION_CLASS = "danger-callout-action shrink-0";
