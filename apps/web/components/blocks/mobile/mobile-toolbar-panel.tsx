"use client";

import type { BoardRowGroupBy, ListGroupBy } from "@/lib/navigation";

import { useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  Bot,
  Check,
  Eye,
  EyeOff,
  LayoutGrid,
  Link,
  List,
  Loader,
  CheckCircle,
  ListTree,
  Pin,
  RotateCcw,
  Settings,
  Text,
  User,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  StatusFilterKey,
  AssigneeFilter,
  ArchiveFilter,
} from "@/lib/tasks/types";
import {
  AppLink,
  appRoute,
  href,
  BOARD_GROUP_BY_OPTIONS,
  DEFAULT_BOARD_GROUP_BY,
  type BoardGroupBy,
  type ProjectViewMode,
} from "@/lib/navigation";
import { BOARD_GROUP_BY_ICONS, NO_GROUPING_ICON } from "@/components/blocks/project/settings-dropdown";
import { useDefaultViewAction } from "@/components/blocks/project/use-default-view-action";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import { MobileSheet } from "./mobile-sheet";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { useProjectTaskTableColumnVisibility } from "@/lib/tasks/hooks/use-project-task-table-column-visibility";
import { useShowCardDescription } from "@/lib/tasks/card-view-prefs";
import {
  PROJECT_TASK_TABLE_COLUMNS,
  type TaskTableColumnId,
} from "@/lib/tasks/task-table-columns";
import { cn } from "@/lib/utils";

type FilterOption = {
  value: StatusFilterKey;
  label: string;
  icon: LucideIcon;
  iconColor?: string;
};

const STATUS_FILTERS: FilterOption[] = [
  { value: "all", label: "All", icon: List },
  { value: "active", label: "Active", icon: Loader, iconColor: "text-amber-500" },
  { value: "done", label: "Done", icon: CheckCircle, iconColor: "text-emerald-500" },
  { value: "canceled", label: "Canceled", icon: XCircle, iconColor: "text-muted-foreground" },
];

interface MobileToolbarPanelProps {
  projectId?: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
  // Filters
  statusFilter: StatusFilterKey;
  assigneeFilter: AssigneeFilter;
  archiveFilter: ArchiveFilter;
  onStatusFilterChange: (filter: StatusFilterKey) => void;
  onAssigneeFilterChange: (filter: AssigneeFilter) => void;
  onArchiveFilterChange: (filter: ArchiveFilter) => void;
  // View
  viewMode: ProjectViewMode;
  listPath: string;
  boardPath?: string | null;
  boardGroupBy?: BoardGroupBy;
  listGroupBy?: ListGroupBy;
  defaultListGroupBy?: ListGroupBy;
  onListGroupByChange?: (groupBy: ListGroupBy) => void;
  onBoardGroupByChange?: (groupBy: BoardGroupBy) => void;
  boardRowGroupBy?: BoardRowGroupBy;
  defaultBoardRowGroupBy?: BoardRowGroupBy;
  onBoardRowGroupByChange?: (groupBy: BoardRowGroupBy) => void;
  // Project default view
  defaultViewMode?: ProjectViewMode;
  defaultBoardGroupBy?: BoardGroupBy;
  /** The List the current view belongs to; drives the List-scoped default view. */
  viewedList?: TaskListItem | null;
  // Members & settings
  onMembersClick?: () => void;
  onAiAgentsClick?: () => void;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  // Close drawer
  onClose: () => void;
}

function ToolbarSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function ToolbarRow({
  icon: Icon,
  iconColor,
  label,
  active,
  pressed,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  iconColor?: string;
  label: string;
  active?: boolean;
  /** Marks the row as an on/off toggle for assistive tech. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm active:bg-muted",
        active && "bg-muted font-medium",
        disabled && "opacity-50"
      )}
    >
      <Icon className={cn("size-4", iconColor ?? "text-muted-foreground")} />
      <span className="flex-1 text-left">{label}</span>
      {active && <Check className="size-4 text-primary" />}
    </button>
  );
}

function MobileSettingsDrawer({
  open,
  onClose,
  projectId,
  projectPath,
  hiddenTaskTableColumns,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: Id<"projects">;
  projectPath: string;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
}) {
  const { canEditProject } = useProjectPermissions(projectId ?? null);
  const [showCardDescription, setShowCardDescription] = useShowCardDescription();
  const { isColumnVisible, toggleColumnVisibility, canToggleColumns } =
    useProjectTaskTableColumnVisibility({
      projectId,
      hiddenTaskTableColumns,
      canEdit: canEditProject,
    });

  const handleCopyLink = async () => {
    if (!navigator.clipboard?.writeText) {
      toast.error("Failed to copy project link");
      return;
    }

    try {
      const url = new URL(projectPath, window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      toast.success("Project link copied to clipboard");
    } catch {
      toast.error("Failed to copy project link");
    }
  };

  return (
    <MobileSheet
      open={open}
      onClose={onClose}
      nested
      title="Project settings"
      description="Project link, card display and column visibility."
    >
      <div className="space-y-6 p-4">
        <ToolbarSection label="Project">
          <ToolbarRow
            icon={Link}
            label="Copy link"
            onClick={() => void handleCopyLink()}
          />
        </ToolbarSection>
        <ToolbarSection label="Cards">
          <ToolbarRow
            icon={Text}
            label="Show description"
            active={showCardDescription}
            pressed={showCardDescription}
            onClick={() => setShowCardDescription(!showCardDescription)}
          />
        </ToolbarSection>
        <ToolbarSection label="Column visibility">
          {PROJECT_TASK_TABLE_COLUMNS.map((column) => {
            const visible = isColumnVisible(column.id);
            return (
              <ToolbarRow
                key={column.id}
                icon={visible ? Eye : EyeOff}
                label={column.label}
                active={visible}
                disabled={!canToggleColumns}
                onClick={() => toggleColumnVisibility(column.id)}
              />
            );
          })}
        </ToolbarSection>
      </div>
    </MobileSheet>
  );
}

export function MobileToolbarPanel({
  projectId,
  organizationSlug,
  projectAlias,
  statusFilter,
  assigneeFilter,
  archiveFilter,
  onStatusFilterChange,
  onAssigneeFilterChange,
  onArchiveFilterChange,
  viewMode,
  listPath,
  boardPath,
  boardGroupBy,
  onBoardGroupByChange,
  boardRowGroupBy = "none",
  defaultBoardRowGroupBy,
  onBoardRowGroupByChange,
  defaultViewMode,
  defaultBoardGroupBy,
  listGroupBy = "none",
  defaultListGroupBy,
  onListGroupByChange,
  viewedList = null,
  onMembersClick,
  onAiAgentsClick,
  hiddenTaskTableColumns,
  onClose,
}: MobileToolbarPanelProps) {
  const projectPath = href(appRoute.project(organizationSlug, projectAlias));
  const isArchived = archiveFilter === "archived";
  // Members reads usefully for a viewer; AI Agents has nothing to read.
  const { canManageProjectAgents } = useProjectPermissions(projectId ?? null);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const {
    canSetProjectDefaultView,
    showListDefaultView,
    isCurrentViewProjectDefault,
    isCurrentViewListDefault,
    hasListOverride,
    viewedListName,
    setCurrentViewAsProjectDefault,
    setCurrentViewAsListDefault,
    clearListDefaultView,
  } = useDefaultViewAction({
    projectId,
    currentViewMode: viewMode,
    currentBoardGroupBy: boardGroupBy ?? DEFAULT_BOARD_GROUP_BY,
    defaultViewMode,
    defaultBoardGroupBy,
    currentListGroupBy: listGroupBy,
    defaultListGroupBy,
    currentBoardRowGroupBy: boardRowGroupBy,
    defaultBoardRowGroupBy,
    viewedList,
  });

  return (
    <div className="space-y-6 p-4">
      {/* Project-level destinations. Area switching (Tasks/Threads) lives in
          the global mobile nav bar, not here. */}
      <ToolbarSection label="Project">
        {onMembersClick && (
          <button
            onClick={() => {
              onClose();
              onMembersClick();
            }}
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm active:bg-muted"
          >
            <Users className="size-4 text-muted-foreground" />
            <span>Members</span>
          </button>
        )}
        {onAiAgentsClick && canManageProjectAgents && (
          <button
            onClick={() => {
              onClose();
              onAiAgentsClick();
            }}
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm active:bg-muted"
          >
            <Bot className="size-4 text-muted-foreground" />
            <span>Agents</span>
          </button>
        )}
        <button
          onClick={() => setShowSettingsDrawer(true)}
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm active:bg-muted"
        >
          <Settings className="size-4 text-muted-foreground" />
          <span>Settings</span>
        </button>
      </ToolbarSection>

      {/* View mode */}
      <ToolbarSection label="View">
        <AppLink
          href={listPath}
          onClick={onClose}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm active:bg-muted",
            viewMode === "list" && "bg-muted font-medium"
          )}
        >
          <List className="size-4 text-muted-foreground" />
          <span>List</span>
          {viewMode === "list" && <Check className="ml-auto size-4 text-primary" />}
        </AppLink>
        {boardPath && (
          <AppLink
            href={boardPath}
            onClick={onClose}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm active:bg-muted",
              viewMode === "board" && "bg-muted font-medium"
            )}
          >
            <LayoutGrid className="size-4 text-muted-foreground" />
            <span>Board</span>
            {viewMode === "board" && <Check className="ml-auto size-4 text-primary" />}
          </AppLink>
        )}
        {canSetProjectDefaultView && (
          <ToolbarRow
            icon={Pin}
            label={
              isCurrentViewProjectDefault ? "Default view" : "Set as default view"
            }
            disabled={isCurrentViewProjectDefault}
            onClick={() => void setCurrentViewAsProjectDefault()}
          />
        )}
        {showListDefaultView && (
          <ToolbarRow
            icon={ListTree}
            label={`Set as default view for "${viewedListName}" only`}
            disabled={isCurrentViewListDefault}
            onClick={() => void setCurrentViewAsListDefault()}
          />
        )}
        {showListDefaultView && hasListOverride && (
          <ToolbarRow
            icon={RotateCcw}
            label={`Reset "${viewedListName}" to project default`}
            onClick={() => void clearListDefaultView()}
          />
        )}
      </ToolbarSection>

      {viewMode === "list" && onListGroupByChange && (
        <ToolbarSection label="Group by">
          {[{ value: "none" as const, label: "None" }, ...BOARD_GROUP_BY_OPTIONS].map(option => (
            <ToolbarRow key={option.value} icon={option.value === "none" ? NO_GROUPING_ICON : BOARD_GROUP_BY_ICONS[option.value]} label={option.label} active={listGroupBy === option.value} onClick={() => onListGroupByChange(option.value)} />
          ))}
        </ToolbarSection>
      )}
      {/* Board grouping */}
      {viewMode === "board" && onBoardGroupByChange && (
        <ToolbarSection label="Columns by">
          {BOARD_GROUP_BY_OPTIONS.map((option) => (
            <ToolbarRow
              key={option.value}
              icon={BOARD_GROUP_BY_ICONS[option.value]}
              label={option.label}
              active={(boardGroupBy ?? DEFAULT_BOARD_GROUP_BY) === option.value}
              onClick={() => onBoardGroupByChange(option.value)}
            />
          ))}
        </ToolbarSection>
      )}
      {viewMode === "board" && onBoardRowGroupByChange && (
        <ToolbarSection label="Rows by">
          {[{ value: "none" as const, label: "None" }, ...BOARD_GROUP_BY_OPTIONS].map(option => (
            <ToolbarRow key={option.value} icon={option.value === "none" ? NO_GROUPING_ICON : BOARD_GROUP_BY_ICONS[option.value]} label={option.label} active={boardRowGroupBy === option.value} disabled={boardRowGroupBy === "none" && option.value === boardGroupBy} onClick={() => onBoardRowGroupByChange(option.value)} />
          ))}
        </ToolbarSection>
      )}

      {/* Filters */}
      <ToolbarSection label="Filter">
        <ToolbarRow
          icon={User}
          label="Assigned to me"
          active={assigneeFilter?.type === "me" && !isArchived}
          onClick={() => {
            onAssigneeFilterChange(
              assigneeFilter?.type === "me" ? null : { type: "me" }
            );
          }}
        />
        <div className="my-2 border-t border-border" />
        {STATUS_FILTERS.map((filter) => (
          <ToolbarRow
            key={filter.value}
            icon={filter.icon}
            iconColor={filter.iconColor}
            label={filter.label}
            active={statusFilter === filter.value && !isArchived}
            onClick={() => onStatusFilterChange(filter.value)}
          />
        ))}
        <div className="my-2 border-t border-border" />
        <ToolbarRow
          icon={Archive}
          label="Archived"
          active={isArchived}
          onClick={() => {
            onArchiveFilterChange(isArchived ? "active" : "archived");
          }}
        />
      </ToolbarSection>

      <MobileSettingsDrawer
        open={showSettingsDrawer}
        onClose={() => setShowSettingsDrawer(false)}
        projectId={projectId}
        projectPath={projectPath}
        hiddenTaskTableColumns={hiddenTaskTableColumns}
      />
    </div>
  );
}
