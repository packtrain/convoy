import { RefObject } from "react";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { Archive, ArrowDownToLine, Check, ChevronsDownUp, ChevronDown, ChevronRight, GitPullRequest, GripVertical, ListTree, Paperclip, Signal, UnfoldHorizontal, UserRound, type LucideIcon } from "lucide-react";
import { PullRequestLink } from "@/components/blocks/integrations";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoveToListMenuContent } from "@/components/blocks/project/task-lists/move-to-list-menu-content";
import { AgentThreadWorkCell } from "@/components/blocks/tasks/agent-thread-work/agent-thread-work-cell";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { ARCHIVE_COMPLETED_TASKS_HOTKEY, getHotkeyKeycaps, MOVE_CLOSED_TASKS_BOTTOM_HOTKEY } from "@/lib/browser/hotkeys";
import { Status, type Task, type TaskTreeNode } from "@/lib/tasks/types";
import { getExternalLinkLabel, type TaskExternalLink } from "@/lib/tasks/external-links";
import { PRIORITY_CONFIG } from "@/lib/tasks/constants";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import { NameCellInput, StatusCell, PriorityCell, AssigneeCell, DueDateCell, LabelCell, TagsCell } from "./cells";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { BUILT_IN_TASK_TYPES } from "@/lib/tasks/task-types";
import { isClosedStatus } from "@/lib/tasks/status-policy";
// Import types to ensure TableMeta extension is loaded
import "@/lib/tasks/types";

/** Column style configuration */
export interface ColumnStyle {
  header: string;
  cell: string;
}

/**
 * Name column — **fixed** width mode. At @4xl the column takes the user-set
 * `--task-name-w` as a `flex-initial` width and never grows to absorb leftover space. The
 * table itself is `w-max`, so a too-narrow container scrolls horizontally rather than
 * shrinking the column; `flex-shrink` + `min-w` only apply below @4xl, where it flexes
 * like the auto variant.
 *
 * The floor reads `--task-name-min-w` (set from MIN_NAME_COLUMN_WIDTH) rather than a
 * hardcoded class value, so it has one source of truth.
 */
const NAME_COLUMN_STYLE_FIXED: ColumnStyle = {
  header:
    "flex-1 min-w-[150px] @4xl:flex-initial @4xl:w-[var(--task-name-w)] @4xl:min-w-[var(--task-name-min-w)] @4xl:border-r @4xl:border-border",
  cell: "flex-1 min-w-[150px] @4xl:flex-initial @4xl:w-[var(--task-name-w)] @4xl:min-w-[var(--task-name-min-w)] p-0 @4xl:border-r @4xl:border-border",
};

/**
 * Name column — **auto/responsive** width mode (the default). The column flexes
 * to fill all available width at every breakpoint; no fixed width is applied, so
 * the table is fully responsive (pre-resize-feature behavior).
 */
const NAME_COLUMN_STYLE_AUTO: ColumnStyle = {
  header: "flex-1 min-w-[150px] @4xl:border-r @4xl:border-border",
  cell: "flex-1 min-w-[150px] p-0 @4xl:border-r @4xl:border-border",
};

/**
 * Responsive column styles using Tailwind container queries: compact by default,
 * switching to full at @4xl (~896px). The container must have `@container`.
 *
 * This is the **fixed** name-column variant; `COLUMN_STYLES_AUTO` is the auto one. Both
 * are module constants, so selecting by mode gives the stable reference the row memo
 * relies on for free.
 */
export const COLUMN_STYLES: Record<string, ColumnStyle> = {
  drag: {
    header: "w-6 shrink-0",
    cell: "w-6 shrink-0 px-1 relative",
  },
  name: NAME_COLUMN_STYLE_FIXED,
  status: {
    header: "w-8 @4xl:w-30 shrink-0 @4xl:border-r @4xl:border-border",
    cell: "w-8 @4xl:w-30 shrink-0 p-0 @4xl:border-r @4xl:border-border",
  },
  // Dedicated narrow column for agent-thread-work badges, after status
  // (w-10 fits 3 stacked size-5 badges at -ml-2.5 overlap).
  agentWork: {
    header: "w-16 shrink-0 @4xl:border-r @4xl:border-border",
    cell: "w-16 shrink-0 p-0 @4xl:border-r @4xl:border-border",
  },
  // Icon-only (priority) and avatar-only (assignee) columns keep one width.
  priority: {
    header: "w-8 @4xl:w-10 shrink-0 @4xl:border-r @4xl:border-border",
    cell: "w-8 @4xl:w-10 shrink-0 p-0 @4xl:border-r @4xl:border-border",
  },
  assignee: {
    header: "w-8 @4xl:w-12 shrink-0 @4xl:border-r @4xl:border-border",
    cell: "w-8 @4xl:w-12 shrink-0 p-0 @4xl:border-r @4xl:border-border",
  },
  dueDate: {
    header: "w-12 @4xl:w-30 shrink-0 @4xl:border-r @4xl:border-border",
    cell: "w-12 @4xl:w-30 shrink-0 @4xl:border-r @4xl:border-border",
  },
  tags: {
    header: "hidden @4xl:flex @4xl:w-44 shrink-0 @4xl:border-r @4xl:border-border",
    cell: "hidden @4xl:flex @4xl:w-44 shrink-0 overflow-hidden p-0 @4xl:border-r @4xl:border-border",
  },
  label: {
    header: "hidden @4xl:flex @4xl:w-36 shrink-0 @4xl:border-r @4xl:border-border",
    cell: "hidden @4xl:flex @4xl:w-36 shrink-0 overflow-hidden p-0 @4xl:border-r @4xl:border-border",
  },
};

/** Column styles for auto/responsive name-column mode (name flexes to fill). */
export const COLUMN_STYLES_AUTO: Record<string, ColumnStyle> = {
  ...COLUMN_STYLES,
  name: NAME_COLUMN_STYLE_AUTO,
};

const columnHelper = createColumnHelper<Task>();

const TASK_TABLE_CONFIGURABLE_COLUMN_ORDER = ["priority", "assignee", "label", "dueDate", "tags"] as const satisfies readonly TaskTableColumnId[];

function MetadataColumnHeader({ label }: { label: string }) {
  return <span className="sr-only @4xl:not-sr-only">{label}</span>;
}

/** Header for icon-only columns: an icon stands in for the label, which stays visually hidden. */
function IconColumnHeader({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <span className="flex w-full justify-center" title={label}>
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function TaskHeaderShortcut({ hotkey }: { hotkey: string }) {
  const keycaps = getHotkeyKeycaps(hotkey);

  return (
    <div className="flex items-center gap-1">
      {keycaps.map((keycap) => (
        <Kbd key={keycap}>{keycap}</Kbd>
      ))}
    </div>
  );
}

function TaskPullRequestLink({
  link,
}: {
  link: Extract<TaskExternalLink, { kind: "pull_request" }>;
}) {
  const label = getExternalLinkLabel(link);
  const accessibleLabel = `Open pull request: ${label}`;

  return (
    // The row opens the task; a click on its PR link must not.
    <span className="inline-flex shrink-0" onClick={(event) => event.stopPropagation()}>
      <PullRequestLink
        url={link.url}
        title={accessibleLabel}
        aria-label={accessibleLabel}
        className="inline-flex shrink-0 cursor-pointer items-center transition-opacity hover:opacity-80"
      >
        <GitPullRequest aria-hidden className="size-3.5 text-success" />
      </PullRequestLink>
    </span>
  );
}

export function createColumns(
  inputRefs: RefObject<Map<string, HTMLInputElement> | null>,
  showTaskRank = false,
  hiddenTaskTableColumns: readonly TaskTableColumnId[] = [],
  showResourceCount = true
) {
  const hiddenColumns = new Set(hiddenTaskTableColumns);
  // Define all column definitions
  const staticColumns = [
    {
      id: "drag",
      header: () => null,
      cell: () => <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 cursor-grab" />,
      size: 24,
      enableSorting: false,
    },

    columnHelper.accessor("name", {
      header: ({ table }) => {
        const {
          archiveFilter,
          doneTaskCount,
          onArchiveAllDone,
          onCollapseAll,
          canMoveClosedToBottom,
          onMoveClosedToBottom,
          projectId,
          activeRootTaskCount,
          onMoveActiveToList,
          moveSourceListRef,
          isNameColumnAutoWidth,
          onSetNameColumnAutoWidth,
          canUpdateTask = true,
        } = table.options.meta!;
        const canArchiveDoneTasks = archiveFilter === "active" && (doneTaskCount ?? 0) > 0;
        const canMoveActiveToList = !!onMoveActiveToList && (activeRootTaskCount ?? 0) > 0;

        return (
          <div className="group/task-name-header flex w-full items-center gap-1">
            <span className="ml-4">Task</span>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Task name column actions"
                  className="ml-auto size-6 p-0 opacity-0 transition-opacity hover:bg-muted group-hover/task-name-header:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={!onCollapseAll}
                  className="gap-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCollapseAll?.();
                  }}
                >
                  <ChevronsDownUp className="size-4 text-muted-foreground" />
                  Collapse all
                </DropdownMenuItem>
                {canUpdateTask && (
                  <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!canArchiveDoneTasks}
                    className="justify-between gap-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveAllDone?.();
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Archive className="size-4 text-muted-foreground" />
                      Archive done
                    </span>
                    <TaskHeaderShortcut hotkey={ARCHIVE_COMPLETED_TASKS_HOTKEY} />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canMoveClosedToBottom}
                    className="justify-between gap-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveClosedToBottom?.();
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <ArrowDownToLine className="size-4 text-muted-foreground" />
                      Closed to bottom
                    </span>
                    <TaskHeaderShortcut hotkey={MOVE_CLOSED_TASKS_BOTTOM_HOTKEY} />
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={!canMoveActiveToList} className="gap-2">
                      <ListTree className="size-4 text-muted-foreground" />
                      Move active to
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="p-0">
                      <MoveToListMenuContent
                        projectId={projectId}
                        selectedListRef={moveSourceListRef}
                        skipSections
                        autoFocusSearch
                        onMoveToList={(listRef) => onMoveActiveToList?.(listRef)}
                      />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isNameColumnAutoWidth || !onSetNameColumnAutoWidth}
                  className="gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetNameColumnAutoWidth?.();
                  }}
                >
                  <UnfoldHorizontal className="size-4 text-muted-foreground" />
                  Auto width
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      cell: ({ row, getValue, table }) => {
        const { updateTask, deleteTask, beginInlineTaskDraft, focusInput, getAdjacentId, toggleExpanded, defaultParentId, canUpdateTask = true } =
          table.options.meta!;
        const isClosed = isClosedStatus(row.original.status);
        const taskId = row.original._id;
        const clientId = row.original.clientId;

        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
          const input = e.currentTarget;

          if (e.key === "Enter") {
            if (input.value === "") return;
            e.preventDefault();

            // Use current task's parentId to create sibling within same parent
            // Falls back to defaultParentId (for subtask table context)
            const parentId = row.original.parentId ?? defaultParentId ?? null;

            if (input.selectionStart === 0) {
              beginInlineTaskDraft({
                beforeClientId: clientId,
                parentId,
              });
            } else {
              beginInlineTaskDraft({
                afterClientId: clientId,
                parentId,
              });
            }
          }

          if (e.key === "Backspace") {
            const hasSelection = input.selectionStart !== input.selectionEnd;

            if (input.value === "") {
              e.preventDefault();
              const prevId = getAdjacentId(clientId, "prev"); // Use clientId for navigation
              deleteTask(taskId); // Use _id for mutation
              if (prevId) {
                focusInput(prevId, "end");
              }
            } else if (input.selectionStart === 0 && !hasSelection) {
              const prevId = getAdjacentId(clientId, "prev"); // Use clientId for navigation
              if (prevId) {
                e.preventDefault();
                focusInput(prevId, "end");
              }
            }
          }

          if (e.key === "Escape") {
            e.preventDefault();
            input.blur();
            // Focus the row element to maintain keyboard navigation context
            // Table uses div-based components with role="row", not <tr>
            const row = input.closest('[role="row"]');
            if (row instanceof HTMLElement) {
              row.focus();
            }
          }
        };

        // Get depth and tree info (TaskTreeNode extends Task)
        const task = row.original as TaskTreeNode;
        const indentPx = (task.depth || 0) * 24;
        const hasChildren = task.hasChildren;
        const isExpanded = task.isExpanded;
        const resourceCount =
          (task.attachmentCount ?? 0) + (task.artifactCount ?? 0);
        const pullRequestLinks = (task.externalLinks ?? []).filter(
          (
            link
          ): link is Extract<TaskExternalLink, { kind: "pull_request" }> =>
            link.kind === "pull_request"
        );
        const showResources = showResourceCount && resourceCount > 0;
        const showTaskLinks = showResources || pullRequestLinks.length > 0;

        return (
          <div className="flex items-center w-full" style={{ paddingLeft: `${indentPx}px` }}>
            {/* Expand/collapse button */}
            {hasChildren ? (
              <button
                type="button"
                aria-label="Subtasks"
                aria-expanded={isExpanded}
                onClick={() => {
                  toggleExpanded?.(task._id);
                }}
                className="flex items-center justify-center w-5 h-5 mr-2 hover:bg-muted rounded shrink-0 cursor-pointer"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-150 pointer-events-none",
                    isExpanded && "rotate-90"
                  )}
                />
              </button>
            ) : (
              <div className="w-5 h-5 mr-2 shrink-0" />
            )}
            <label className={cn("relative mr-2 inline-flex size-4 shrink-0 items-center justify-center after:absolute after:-inset-x-3 after:-inset-y-2", canUpdateTask && "cursor-pointer")} onClick={event => event.stopPropagation()}>
              <input type="checkbox" checked={isClosed} aria-label="Complete task"
                data-state={isClosed ? "checked" : "unchecked"}
                disabled={!canUpdateTask}
                readOnly={!canUpdateTask}
                onChange={canUpdateTask ? event => updateTask(taskId, { status: event.target.checked ? Status.DONE : Status.TODO }) : undefined}
                className="peer size-4 appearance-none rounded-full border border-input outline-none transition-colors dark:bg-input/30 checked:border-primary checked:bg-primary dark:checked:bg-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
              <Check aria-hidden className="pointer-events-none absolute hidden size-3.5 text-primary-foreground peer-checked:block" />
            </label>
            {showTaskRank ? <span className="shrink-0 pr-2 text-xs font-mono text-muted-foreground">{row.original.rank}</span> : null}
            <NameCellInput
              value={getValue()}
              taskId={clientId} // Use clientId for input registration (stable key)
              isClosed={isClosed}
              inputRefs={inputRefs}
              onSave={(value) => updateTask(taskId, { name: value })} // Use _id for mutations
              onDelete={() => deleteTask(taskId)} // Use _id for mutations
              onKeyDown={handleKeyDown}
              isEditable={canUpdateTask}
            />
            {showTaskLinks ? (
              <span className="mr-3 flex shrink-0 items-center gap-2">
                {showResources ? (
                  <span
                    role="img"
                    aria-label={`${resourceCount} ${resourceCount === 1 ? "resource" : "resources"}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground"
                  >
                    <Paperclip className="size-3.5 shrink-0" />
                    {resourceCount}
                  </span>
                ) : null}
                {pullRequestLinks.map((link) => (
                  <TaskPullRequestLink key={link.id} link={link} />
                ))}
              </span>
            ) : null}
            {/* <span className="text-xs text-muted-foreground font-mono shrink-0 pr-2">
              parent: {row.original.parentId}
            </span> */}
            <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0 ml-auto pr-4">
              {task.childCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <CircularProgress completed={task.completedChildCount} total={task.childCount} />
                  {task.completedChildCount}/{task.childCount}
                </span>
              )}
              <TaskRefWithType
                refId={row.original.refId}
                taskType={row.original.taskType}
                editable={canUpdateTask}
                taskTypes={BUILT_IN_TASK_TYPES}
                onTaskTypeChange={(taskType) => updateTask(row.original._id, { taskTypeKey: taskType.key })}
                typeVariant="icon"
                align="start"
                side="bottom"
                contentClassName="w-38"
                refClassName="text-muted-foreground"
              />
            </span>
          </div>
        );
      },
      size: 999,
      enableSorting: false,
    }),
    columnHelper.accessor("status", {
      header: () => <MetadataColumnHeader label="Status" />,
      cell: ({ getValue, row, table }) => {
        const { updateTask, allowedStatuses, canUpdateTask } = table.options.meta!;
        return (
          <StatusCell
            status={getValue()}
            statuses={allowedStatuses}
            isEditable={canUpdateTask}
            onStatusChange={(status) => updateTask(row.original._id, { status })}
          />
        );
      },
      enableSorting: false,
    }),
    columnHelper.display({
      id: "agentWork",
      header: () => <MetadataColumnHeader label="Runs" />,
      cell: ({ row, table }) => (
        <AgentThreadWorkCell
          task={row.original}
          projectId={table.options.meta!.projectId}
          canUseThreads={table.options.meta!.canUseThreads ?? false}
        />
      ),
      enableSorting: false,
    }),
  ];

  const configurableColumns = {
    priority: columnHelper.accessor("priority", {
      header: () => <IconColumnHeader label="Priority" icon={Signal} />,
      cell: ({ getValue, row, table }) => {
        const { updateTask, canUpdateTask } = table.options.meta!;
        return <PriorityCell priority={getValue()} isEditable={canUpdateTask} onPriorityChange={(priority) => updateTask(row.original._id, { priority })} />;
      },
      sortingFn: (rowA, rowB) => {
        return PRIORITY_CONFIG[rowA.original.priority].order - PRIORITY_CONFIG[rowB.original.priority].order;
      },
      enableSorting: false,
    }),
    assignee: columnHelper.accessor("assignee", {
      header: () => <IconColumnHeader label="Assignee" icon={UserRound} />,
      cell: ({ row, table }) => {
        const { updateTask, projectId, onInviteClick, onAddAgentClick, canUpdateTask } = table.options.meta!;
        return (
          <AssigneeCell
            isEditable={canUpdateTask}
            assignee={row.original.assignee}
            delegatedToAgent={row.original.delegatedToAgent}
            projectId={projectId}
            onAssigneeChange={(change) => updateTask(row.original._id, change)}
            onInviteClick={onInviteClick}
            onAddAgentClick={onAddAgentClick}
          />
        );
      },
      enableSorting: false,
    }),
    dueDate: columnHelper.accessor("dueDate", {
      header: () => <MetadataColumnHeader label="Due date" />,
      cell: ({ getValue, row, table }) => {
        const { updateTask, canUpdateTask } = table.options.meta!;
        return <DueDateCell dueDate={getValue()} isEditable={canUpdateTask} onDueDateChange={(dueDate) => updateTask(row.original._id, { dueDate })} />;
      },
      enableSorting: false,
    }),
    tags: columnHelper.accessor("tags", {
      header: "Tags",
      cell: ({ getValue, row, table }) => {
        const { updateTask, canUpdateTask } = table.options.meta!;
        return <TagsCell tags={getValue()} isEditable={canUpdateTask} onTagsChange={(tags) => updateTask(row.original._id, { tags })} />;
      },
      enableSorting: false,
    }),
    label: columnHelper.display({
      id: "label",
      header: "Label",
      cell: ({ row, table }) => {
        const { updateTask, projectId, projectLabels, projectLabelsById, canUpdateTask } = table.options.meta!;
        return (
          <LabelCell
            isEditable={canUpdateTask}
            projectId={projectId}
            labelId={row.original.labelId ?? null}
            labels={projectLabels ?? []}
            labelsById={projectLabelsById ?? new Map()}
            onLabelChange={(labelId) => updateTask(row.original._id, { labelId })}
          />
        );
      },
      enableSorting: false,
    }),
  };

  return [
    ...staticColumns,
    ...TASK_TABLE_CONFIGURABLE_COLUMN_ORDER.filter((columnId) => !hiddenColumns.has(columnId)).map(
      (columnId) => configurableColumns[columnId]
    ),
  ] as ColumnDef<Task>[];
}
