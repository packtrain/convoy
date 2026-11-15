"use client";

import { ArrowDownToLine, Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { AgentAvatar } from "@/components/blocks/agents/agent-avatar";
import { deriveAgentCardPreview, type AgentListItem } from "@/components/blocks/agents/agent-list-utils";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { SettingsCatalogUpdateHint } from "@/components/blocks/settings-catalog/settings-catalog-update-hint";
import { SettingsCatalogVersionBadge } from "@/components/blocks/settings-catalog/settings-catalog-version-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLink, type RouteTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Version state a row can carry (OS-1759): an org template knows its own
 * version, an installed copy knows the version it was installed from. Modelled
 * as a union so a copy's fields can't be attached to a template row.
 */
export type AgentTemplateState =
  | { templateVersion: number }
  | { installedVersion: number; availableVersion?: number; locallyEdited?: boolean };

export function ProjectAgentRow({
  agent,
  action,
  className,
  href,
  onClick,
  onDelete,
  onRefresh,
  refreshLabel = "Update",
  templateState,
  actionsAriaLabel = "Project agent actions",
  showActionsMenu = true,
}: {
  agent: AgentListItem;
  action?: ReactNode;
  className?: string;
  /** Where the row opens; a link, so middle-click opens it in a new tab. */
  href?: RouteTarget | string;
  /** For rows that open something in place (a preview dialog) rather than navigate. */
  onClick?: () => void;
  onDelete?: () => void;
  onRefresh?: () => void;
  /** `Update` when the template is ahead, `Reset` when it is not; the dialog has the detail (OS-1805). */
  refreshLabel?: string;
  templateState?: AgentTemplateState;
  actionsAriaLabel?: string;
  showActionsMenu?: boolean;
}) {
  const category = agent.category?.trim();
  const preview = deriveAgentCardPreview(agent);
  const categoryBadge = category ? <Badge variant="outline">{category}</Badge> : null;
  const availableVersion = templateState && "installedVersion" in templateState ? templateState.availableVersion : undefined;
  // Update state then version, to the left of the category badge (OS-1759).
  const trailing =
    templateState || categoryBadge ? (
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {availableVersion === undefined ? null : <SettingsCatalogUpdateHint version={availableVersion} />}
        {templateState ? <AgentVersionBadge state={templateState} /> : null}
        {categoryBadge}
      </span>
    ) : null;
  const rowContent = (
    <>
      <span className="shrink-0">
        <AgentAvatar name={agent.name} color={agent.appearance.color} size="md" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium">{agent.name}</h3>
        {preview ? <p className="truncate text-xs text-muted-foreground">{preview}</p> : null}
      </div>
    </>
  );

  const isOpenable = Boolean(href || onClick);
  const openableClassName =
    "flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className={cn("flex w-full items-stretch transition-colors", isOpenable && "hover:bg-muted/50", className)}>
      {href ? (
        <AppLink href={href} className={openableClassName}>
          {rowContent}
          {trailing}
        </AppLink>
      ) : onClick ? (
        <button type="button" className={openableClassName} onClick={onClick}>
          {rowContent}
          {trailing}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 p-4">{rowContent}</div>
      )}
      {action || (showActionsMenu && (isOpenable || onDelete)) || (!isOpenable && trailing) ? (
        <div className="flex shrink-0 items-center gap-3 py-4 pr-4 pl-0">
          {!isOpenable ? trailing : null}
          {action ? <div className="flex-none">{action}</div> : null}
          {showActionsMenu && (isOpenable || onDelete) ? (
            <ProjectAgentRowMenu
              ariaLabel={actionsAriaLabel}
              editHref={href}
              onDelete={onDelete}
              onRefresh={onRefresh}
              refreshLabel={refreshLabel}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Template version the row carries — red once a copy diverged from it (OS-1759).
 * Absent for project-created agents, which have no template to version against.
 */
function AgentVersionBadge({ state }: { state: AgentTemplateState }) {
  const isTemplate = "templateVersion" in state;
  const version = isTemplate ? state.templateVersion : state.installedVersion;
  const locallyEdited = !isTemplate && state.locallyEdited === true;
  const label = isTemplate
    ? `Organization template v${version}`
    : locallyEdited
      ? `Edited in this project since installing v${version}`
      : `Installed from organization template v${version}`;

  return <SettingsCatalogVersionBadge version={version} label={label} diverged={locallyEdited} />;
}

function ProjectAgentRowMenu({
  ariaLabel,
  editHref,
  onDelete,
  onRefresh,
  refreshLabel,
}: {
  ariaLabel: string;
  editHref?: RouteTarget | string;
  onDelete?: () => void;
  onRefresh?: () => void;
  refreshLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="icon-sm" aria-label={ariaLabel} className="shrink-0 text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {editHref ? (
          <DropdownMenuItem asChild className="cursor-pointer">
            <AppLink href={editHref}>
              <Pencil className="size-4" />
              Edit
            </AppLink>
          </DropdownMenuItem>
        ) : null}
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

export function ProjectAgentListSkeleton() {
  return (
    <ProjectAgentListFrame>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 p-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full rounded-sm" />
            <Skeleton className="h-3 w-56 max-w-full rounded-sm" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </ProjectAgentListFrame>
  );
}

export function ProjectAgentListFrame({ children }: { children: ReactNode }) {
  return <SettingsCatalogListFrame>{children}</SettingsCatalogListFrame>;
}
