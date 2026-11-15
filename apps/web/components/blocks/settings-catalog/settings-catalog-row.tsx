"use client";

import { ArrowDownToLine, Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { getCatalogItemCategory } from "./settings-catalog-list-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AppLink, type RouteTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** One row of a settings catalog list: title, preview, badges, `⋯` actions. */
export function SettingsCatalogRow({
  title,
  titleClassName,
  preview,
  category,
  versionBadge,
  titleLeading,
  titleTrailing,
  actionsLabel,
  href,
  onDelete,
  onRefresh,
  refreshLabel = "Update",
}: {
  title: string;
  titleClassName?: string;
  preview?: string;
  category?: string;
  versionBadge?: ReactNode;
  /** Decoration rendered before the title (e.g. the workflow's colored glyph, OS-1875). */
  titleLeading?: ReactNode;
  /** Control rendered right after the title. Above the click layer, so it may be a link. */
  titleTrailing?: ReactNode;
  actionsLabel: string;
  /** Where the row opens; a link, so middle-click opens it in a new tab. */
  href: RouteTarget | string;
  onDelete?: () => void;
  /** Refresh an installed copy from its organization template (OS-1781). */
  onRefresh?: () => void;
  /** `Update` when the template is ahead, `Reset` when it is not; the dialog has the detail. */
  refreshLabel?: string;
}) {
  // Version then category, matching the AI Agents rows (OS-1759).
  const badges = (
    <>
      {versionBadge}
      <CategoryBadge category={category?.trim()} />
    </>
  );

  return (
    <div className="relative flex w-full items-stretch transition-colors hover:bg-muted/50">
      {/* The click target is a layer under the content, not a wrapper around it: the
          title's own link cannot be nested inside it. */}
      <AppLink
        href={href}
        aria-label={title}
        className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {null}
      </AppLink>
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {titleLeading ? <span className="flex shrink-0 items-center">{titleLeading}</span> : null}
            <h3 className={cn("truncate text-sm font-medium", titleClassName)}>{title}</h3>
            {titleTrailing ? <span className="pointer-events-auto shrink-0">{titleTrailing}</span> : null}
          </div>
          {preview ? <p className="truncate text-xs text-muted-foreground">{preview}</p> : null}
        </div>
        <span className="ml-auto hidden shrink-0 items-center gap-2 sm:flex">{badges}</span>
      </div>
      <div className="pointer-events-none relative flex shrink-0 items-center gap-3 py-4 pr-4 pl-0">
        <span className="flex shrink-0 items-center gap-2 sm:hidden">{badges}</span>
        {onDelete || onRefresh ? (
          <span className="pointer-events-auto">
            <RowMenu actionsLabel={actionsLabel} editHref={href} onDelete={onDelete} onRefresh={onRefresh} refreshLabel={refreshLabel} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CategoryBadge({ category }: { category?: string }) {
  return (
    <Badge variant="outline" className={cn(!category && "text-muted-foreground")}>
      {getCatalogItemCategory({ category })}
    </Badge>
  );
}

function RowMenu({
  actionsLabel,
  editHref,
  onDelete,
  onRefresh,
  refreshLabel,
}: {
  actionsLabel: string;
  editHref: RouteTarget | string;
  onDelete?: () => void;
  onRefresh?: () => void;
  refreshLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="icon-sm" aria-label={actionsLabel} className="shrink-0 text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem asChild className="cursor-pointer">
          <AppLink href={editHref}>
            <Pencil className="size-4" />
            Edit
          </AppLink>
        </DropdownMenuItem>
        {onRefresh ? (
          <DropdownMenuItem onClick={onRefresh}>
            <ArrowDownToLine className="size-4" />
            {refreshLabel}
          </DropdownMenuItem>
        ) : null}
        {onDelete ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
