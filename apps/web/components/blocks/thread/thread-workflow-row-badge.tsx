"use client";

import { Workflow } from "lucide-react";
import { AppLink, type RouteTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Marker for a Workflow run's row (OS-1875): the workflow glyph tinted the
 * workflow's color, named by its tooltip, linking to the workflow editor. An
 * anchor *sibling* of the row's overlay link (like `ThreadPrBadge`), so a click
 * opens the editor — and a middle click a new tab — without opening the thread.
 * No resolved workflow (deleted run/workflow) → a plain glyph, no link.
 */
export function ThreadWorkflowRowBadge({
  workflow,
  href,
  className,
}: {
  workflow?: { name: string; color?: string };
  href?: RouteTarget | string;
  className?: string;
}) {
  const label = workflow ? `Workflow: ${workflow.name}` : "Workflow run";
  const badgeClassName = cn(
    "pointer-events-auto inline-flex shrink-0 items-center",
    !workflow?.color && "text-muted-foreground",
    className
  );
  const style = workflow?.color ? { color: workflow.color } : undefined;
  const icon = <Workflow aria-hidden className="size-3.5" />;

  if (workflow && href) {
    return (
      <AppLink
        href={href}
        title={label}
        aria-label={label}
        className={cn(badgeClassName, "cursor-pointer")}
        style={style}
      >
        {icon}
      </AppLink>
    );
  }

  return (
    <span role="img" title={label} aria-label={label} className={badgeClassName} style={style}>
      {icon}
    </span>
  );
}
