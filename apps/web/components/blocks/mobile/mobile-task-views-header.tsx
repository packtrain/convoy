"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "./mobile-sheet";

interface MobileTaskViewsHeaderProps {
  projectName: string;
  /** Rendered after the project name (the view-only badge). */
  badge?: ReactNode;
  /** List selector rendered right of the project name, left of Filters. */
  listSelector?: ReactNode;
  /** Rendered inside the view-options drawer (the filters/view toolbar panel). */
  renderToolbar: (props: { onClose: () => void }) => ReactNode;
}

/**
 * Compact mobile-only header for the task views. Hosts the List selector plus
 * the per-page tools (filters, view switch, group-by) that the global mobile
 * nav bar no longer carries (spec: docs/specs/mobile-bottom-nav.md).
 */
export function MobileTaskViewsHeader({
  projectName,
  badge,
  listSelector,
  renderToolbar,
}: MobileTaskViewsHeaderProps) {
  const [toolbarOpen, setToolbarOpen] = useState(false);

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-4 md:hidden">
      <div className="mr-auto flex min-w-0 max-w-[40%] shrink items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {projectName}
        </span>
        {badge}
      </div>
      {listSelector ? (
        <div className="flex min-w-0 items-center">{listSelector}</div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 cursor-pointer text-muted-foreground"
        onClick={() => setToolbarOpen(true)}
      >
        <SlidersHorizontal className="size-4" />
        Filters
      </Button>
      <MobileSheet
        open={toolbarOpen}
        onClose={() => setToolbarOpen(false)}
        title="View options"
        description="Filters, view mode, and project shortcuts."
      >
        {renderToolbar({ onClose: () => setToolbarOpen(false) })}
      </MobileSheet>
    </div>
  );
}
