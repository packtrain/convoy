"use client";

import type { BoardRowGroupBy, ListGroupBy } from "@/lib/navigation";

import { useState } from "react";
import { toast } from "sonner";
import {
  Settings,
  Link,
  UserPlus,
  Ungroup,
  Eye,
  EyeOff,
  Import,
  Download,
  Bell,
  Bot,
  CheckCircle,
  CircleDot,
  Flag,
  ListTree,
  Pin,
  RotateCcw,
  Shapes,
  Funnel,
  AtSign,
  ServerCog,
  Tag,
  Rows3,
  Text,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BOARD_GROUP_BY_OPTIONS,
  DEFAULT_BOARD_GROUP_BY,
  type BoardGroupBy,
  type ProjectViewMode,
} from "@/lib/navigation";
import { useDefaultViewAction } from "./use-default-view-action";
import type { TaskListItem } from "./task-lists/task-list-types";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { useProjectTaskTableColumnVisibility } from "@/lib/tasks/hooks/use-project-task-table-column-visibility";
import {
  PROJECT_TASK_TABLE_COLUMNS,
  type TaskTableColumnId,
} from "@/lib/tasks/task-table-columns";
import { ProjectMcpConfigurationDialog } from "./project-mcp-configuration-dialog";
import { useShowUnfinishedItems } from "@/lib/dev-mode/use-dev-mode";
import { useShowCardDescription } from "@/lib/tasks/card-view-prefs";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const GROUPING_ICONS = { CircleDot, AtSign, UserPlus, Flag, Shapes, Tag, Rows3 };
export const NO_GROUPING_ICON = Ungroup;
export const BOARD_GROUP_BY_ICONS = Object.fromEntries(
  BOARD_GROUP_BY_OPTIONS.map(option => [option.value, GROUPING_ICONS[option.icon]])
) as Record<BoardGroupBy, LucideIcon>;

function groupingButtonClassName(isActive: boolean): string {
  return [
    "[&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden inline-flex size-8 p-0 items-center justify-center rounded-md border border-transparent cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
    "text-muted-foreground hover:bg-muted hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    isActive
      ? "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground focus:**:text-primary-foreground"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

interface SettingsDropdownProps {
  onAddMembers?: () => void;
  onOpenAiAgents?: () => void;
  projectPath?: string;
  projectId?: Id<"projects">;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  showBoardGroupBy?: boolean;
  boardGroupBy?: BoardGroupBy;
  boardRowGroupBy?: BoardRowGroupBy;
  defaultBoardRowGroupBy?: BoardRowGroupBy;
  onBoardRowGroupByChange?: (groupBy: BoardRowGroupBy) => void;
  listGroupBy?: ListGroupBy;
  defaultListGroupBy?: ListGroupBy;
  onListGroupByChange?: (groupBy: ListGroupBy) => void;
  defaultViewMode?: ProjectViewMode;
  defaultBoardGroupBy?: BoardGroupBy;
  viewedList?: TaskListItem | null;
  organizationSlug?: string;
  projectAlias?: string;
  onBoardGroupByChange?: (groupBy: BoardGroupBy) => void;
}

export function SettingsDropdown({
  onAddMembers,
  onOpenAiAgents,
  projectPath,
  projectId,
  hiddenTaskTableColumns,
  showBoardGroupBy = false,
  boardGroupBy = DEFAULT_BOARD_GROUP_BY,
  boardRowGroupBy = "none",
  defaultBoardRowGroupBy,
  onBoardRowGroupByChange,
  defaultViewMode,
  defaultBoardGroupBy,
  listGroupBy = "none",
  defaultListGroupBy,
  onListGroupByChange,
  viewedList = null,
  organizationSlug,
  projectAlias,
  onBoardGroupByChange,
}: SettingsDropdownProps) {
  const [mcpConfigOpen, setMcpConfigOpen] = useState(false);
  const showUnfinishedItems = useShowUnfinishedItems();
  const [showCardDescription, setShowCardDescription] = useShowCardDescription();
  const { canEditProject, canManageMembers, canManageProjectAgents } =
    useProjectPermissions(projectId ?? null);
  const {
    isColumnVisible,
    toggleColumnVisibility,
    canToggleColumns,
  } = useProjectTaskTableColumnVisibility({
    projectId,
    hiddenTaskTableColumns,
    canEdit: canEditProject,
  });

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
    currentViewMode: showBoardGroupBy ? "board" : "list",
    currentBoardGroupBy: boardGroupBy,
    defaultViewMode,
    defaultBoardGroupBy,
    currentListGroupBy: listGroupBy,
    defaultListGroupBy,
    currentBoardRowGroupBy: boardRowGroupBy,
    defaultBoardRowGroupBy,
    viewedList,
  });

  const handleCopyLink = async () => {
    if (!projectPath || !navigator.clipboard?.writeText) {
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

  const groupingLabel = showBoardGroupBy ? "Columns by" : "Group by";
  const RowsIcon = boardRowGroupBy === "none" ? NO_GROUPING_ICON : BOARD_GROUP_BY_ICONS[boardRowGroupBy];
  const rowsLabel = BOARD_GROUP_BY_OPTIONS.find((option) => option.value === boardRowGroupBy)?.label ?? "None";
  const currentGrouping = showBoardGroupBy ? boardGroupBy : listGroupBy;

  const showMcpConfiguration =
    organizationSlug !== undefined && projectAlias !== undefined;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="View settings"
            variant="outline"
            size="sm"
            className="h-8 w-8 rounded-full cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        {/* 308px fits all grouping buttons in one row. */}
        <DropdownMenuContent align="end" className="w-77">
        <div className="px-2 py-2">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {groupingLabel}
          </div>
          <DropdownMenuRadioGroup value={currentGrouping} onValueChange={value => {
            const group = value as ListGroupBy;
            if (showBoardGroupBy && group !== "none") onBoardGroupByChange?.(group);
            else if (!showBoardGroupBy) onListGroupByChange?.(group);
          }} aria-label={groupingLabel} className="flex flex-wrap items-center gap-1">
            {!showBoardGroupBy && (
              <DropdownMenuRadioItem
                value="none"
                aria-label="No grouping"
                title="No grouping"
                disabled={!onListGroupByChange}
                onSelect={(event) => {
                  event.preventDefault();
                }}
                className={groupingButtonClassName(listGroupBy === "none")}
              >
                <Ungroup className="h-4 w-4" />
              </DropdownMenuRadioItem>
            )}
            {BOARD_GROUP_BY_OPTIONS.map((option) => {
              const GroupIcon = BOARD_GROUP_BY_ICONS[option.value];
              const swapsAxes = showBoardGroupBy && option.value === boardRowGroupBy;
              return (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  aria-label={`${groupingLabel}: ${option.label}`}
                  title={`${groupingLabel}: ${option.label}${swapsAxes ? " (swaps axes)" : ""}`}
                  disabled={showBoardGroupBy ? !onBoardGroupByChange : !onListGroupByChange}
                  onSelect={(event) => {
                    event.preventDefault();
                  }}
                  className={groupingButtonClassName(option.value === currentGrouping)}
                >
                  <GroupIcon className="h-4 w-4" />
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </div>
        {showBoardGroupBy && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!onBoardRowGroupByChange} className="mx-1">
              <RowsIcon className="h-4 w-4" />
              <span className="flex-1">Rows by</span>
              <span className="text-xs text-muted-foreground">{rowsLabel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuRadioGroup
                aria-label="Rows by"
                value={boardRowGroupBy}
                onValueChange={(next) => onBoardRowGroupByChange?.(next as BoardRowGroupBy)}
              >
                <DropdownMenuRadioItem value="none">
                  <NO_GROUPING_ICON className="h-4 w-4" />
                  No rows
                </DropdownMenuRadioItem>
                {BOARD_GROUP_BY_OPTIONS.map((option) => {
                  const GroupIcon = BOARD_GROUP_BY_ICONS[option.value];
                  const isColumns = option.value === boardGroupBy;
                  return (
                    // With no rows there is nothing to swap the columns with.
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                      disabled={isColumns && boardRowGroupBy === "none"}
                    >
                      <GroupIcon className="h-4 w-4" />
                      {option.label}
                      {isColumns && boardRowGroupBy !== "none" ? (
                        <span className="ml-auto text-xs text-muted-foreground">Swaps axes</span>
                      ) : null}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {canSetProjectDefaultView && (
          <DropdownMenuItem
            disabled={isCurrentViewProjectDefault}
            onClick={() => void setCurrentViewAsProjectDefault()}
          >
            <Pin className="h-4 w-4" />
            {isCurrentViewProjectDefault ? "Default view" : "Set as default view"}
          </DropdownMenuItem>
        )}
        {showListDefaultView && (
          <DropdownMenuItem
            disabled={isCurrentViewListDefault}
            onClick={() => void setCurrentViewAsListDefault()}
          >
            <ListTree className="h-4 w-4" />
            <span className="truncate">
              {`Set as default view for "${viewedListName}" only`}
            </span>
          </DropdownMenuItem>
        )}
        {showListDefaultView && hasListOverride && (
          <DropdownMenuItem onClick={() => void clearListDefaultView()}>
            <RotateCcw className="h-4 w-4" />
            <span className="truncate">
              {`Reset "${viewedListName}" to project default`}
            </span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* Actions Group */}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void handleCopyLink()}>
            <Link className="h-4 w-4" />
            Copy link
          </DropdownMenuItem>
          {showMcpConfiguration && (
            <DropdownMenuItem onClick={() => setMcpConfigOpen(true)}>
              <ServerCog className="h-4 w-4" />
              Configure MCP
            </DropdownMenuItem>
          )}
          {canManageMembers && (
            <DropdownMenuItem onClick={onAddMembers}>
              <UserPlus className="h-4 w-4" />
              Add members
            </DropdownMenuItem>
          )}
          {canManageProjectAgents && (
            <DropdownMenuItem onClick={onOpenAiAgents}>
              <Bot className="h-4 w-4" />
              Agents
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* View Settings Group */}
        <DropdownMenuGroup>
          {/* Column Visibility Submenu */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Eye className="h-4 w-4" />
              Column visibility
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              {PROJECT_TASK_TABLE_COLUMNS.map((column) => {
                const visible = isColumnVisible(column.id);
                const VisibilityIcon = visible ? Eye : EyeOff;

                return (
                  <div
                    key={column.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm"
                  >
                    <span className="flex-1">{column.label}</span>
                    <button
                      type="button"
                      aria-label={`${visible ? "Hide" : "Show"} ${column.label} column`}
                      disabled={!canToggleColumns}
                      onClick={() => void toggleColumnVisibility(column.id)}
                      className="cursor-pointer rounded p-0.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <VisibilityIcon
                        className={`h-4 w-4 ${
                          visible
                            ? "text-muted-foreground"
                            : "text-muted-foreground/30"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {showBoardGroupBy && (
            <DropdownMenuCheckboxItem
              checked={showCardDescription}
              onCheckedChange={setShowCardDescription}
              onSelect={(event) => event.preventDefault()}
            >
              <Text className="h-4 w-4" />
              Show description
            </DropdownMenuCheckboxItem>
          )}

          {showUnfinishedItems && (
            <>
              <DropdownMenuItem disabled>
                <Funnel className="h-4 w-4" />
                Filters
              </DropdownMenuItem>

              <DropdownMenuItem disabled>
                <CheckCircle className="h-4 w-4" />
                Auto hide done items
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>

        {showUnfinishedItems && (
          <>
            <DropdownMenuSeparator />

            {/* Import/Export Group */}
            <DropdownMenuGroup>
              <DropdownMenuItem disabled>
                <Import className="h-4 w-4" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Download className="h-4 w-4" />
                Export
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem disabled>
              <Bell className="h-4 w-4" />
              Notify me
            </DropdownMenuItem>
          </>
        )}
        </DropdownMenuContent>
      </DropdownMenu>
      {showMcpConfiguration && (
        <ProjectMcpConfigurationDialog
          open={mcpConfigOpen}
          onOpenChange={setMcpConfigOpen}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
        />
      )}
    </>
  );
}
