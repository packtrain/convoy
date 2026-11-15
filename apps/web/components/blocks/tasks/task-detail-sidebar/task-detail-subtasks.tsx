"use client";

import { useRef, type RefObject } from "react";
import { Plus } from "lucide-react";
import { useElementWidth } from "@/hooks/browser/use-element-width";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskTable } from "@/components/blocks/tasks/task-table";
import { MultiSelectToolbar } from "@/components/blocks/tasks/multi-select-toolbar";
import { TaskShortcutPicker } from "@/components/blocks/tasks/task-shortcut-picker";
import { Badge } from "@/components/ui/badge";
import { KanbanCard, type KanbanCardProps } from "@/components/blocks/tasks/kanban-card";
import { useTaskCardDrag } from "@/lib/tasks/hooks/use-task-card-drag";
import { setTaskDragPayload } from "@/lib/tasks/task-drag";
import type { Status, Task } from "@/lib/tasks/types";
import type { Status as TaskStatus } from "@/lib/tasks/status";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import { useTaskTableController } from "@/components/blocks/tasks/task-table/hooks/use-task-table-controller";
import type { TaskOperations } from "./task-detail-sidebar";

interface TaskDetailSubtasksProps {
  task: Task;
  allTasks: Task[];
  taskOperations: TaskOperations;
  inputRefs: RefObject<Map<string, HTMLInputElement> | null>;
  focusInput: (id: string, cursorPosition?: "start" | "end") => void;
  currentUserId?: string;
  projectId?: Id<"projects">;
  allowedStatuses?: TaskStatus[];
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  onOpenSubtask?: (clientId: string) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  /** Read-only viewers get no add rows and no drag (docs/specs/read-only-viewer-ux.md). */
  readOnly?: boolean;
}

function TaskDetailSubtaskCard({ readOnly, ...props }: KanbanCardProps & { readOnly: boolean }) {
  const { task, projectId } = props;
  const drag = useTaskCardDrag({
    enabled: Boolean(projectId) && !task.isArchived && !readOnly,
    onDragStart: (event) => {
      if (!projectId) return;
      event.dataTransfer.effectAllowed = "move";
      setTaskDragPayload(event.dataTransfer, {
        projectId,
        taskIds: [String(task._id)],
        taskRefIds: [task.refId],
      });
    },
  });

  return <div {...drag}><KanbanCard {...props} /></div>;
}

export function TaskDetailSubtasks({
  task,
  allTasks,
  taskOperations,
  inputRefs,
  focusInput,
  currentUserId,
  projectId,
  allowedStatuses,
  hiddenTaskTableColumns,
  onOpenSubtask,
  onInviteClick,
  onAddAgentClick,
  readOnly = false,
}: TaskDetailSubtasksProps) {
  const subtaskContainerRef = useRef<HTMLDivElement>(null);
  const sectionWidth = useElementWidth(subtaskContainerRef);
  const useCards = sectionWidth === null || sectionWidth < 768;

  const subtaskTable = useTaskTableController({
    allTasks,
    parentFilter: task._id, // Only show this task's children
    updateTask: taskOperations.updateTask,
    deleteTask: taskOperations.deleteTask,
    addTask: taskOperations.addTask,
    reorderTasks: taskOperations.reorderTasks,
    reorderMultiple: taskOperations.reorderMultiple,
    setParent: taskOperations.setParent,
    setParentMultiple: taskOperations.setParentMultiple,
    bulkUpdateStatus: taskOperations.bulkUpdateStatus,
    bulkUpdateAssignee: taskOperations.bulkUpdateAssignee,
    bulkUpdatePriority: taskOperations.bulkUpdatePriority,
    bulkUpdateDueDate: taskOperations.bulkUpdateDueDate,
    bulkUpdateTaskType: taskOperations.bulkUpdateTaskType,
    bulkArchive: taskOperations.bulkArchive ?? (() => { }),
    bulkUnarchive: taskOperations.bulkUnarchive,
    bulkDelete: taskOperations.bulkDelete,
    duplicateTask: taskOperations.duplicateTask,
    archiveTask: () => { },
    unarchiveTask: () => { },
    inputRefs,
    focusInput,
    containerRef: subtaskContainerRef,
    onOpenDetails: onOpenSubtask,
    openDetailsOnNameClick: Boolean(onOpenSubtask),
    enabled: !useCards,
    projectId,
    currentUserId,
    allowedStatuses,
    statusFilter: "all",
    allowAddTask: !readOnly,
    canUpdateTask: !readOnly,
  });

  // Context menu handlers for subtasks
  const handleSubtaskDuplicate = (subtaskItem: Task) => {
    taskOperations.addTask(
      {
        name: subtaskItem.name,
        taskType: subtaskItem.taskType,
        priority: subtaskItem.priority,
        status: subtaskItem.status,
        dueDate: subtaskItem.dueDate,
        tags: [...subtaskItem.tags],
        rank: subtaskItem.rank,
        createdAt: Date.now(),
        refNumber: 0,
        refId: "",
        description: subtaskItem.description,
        assignee: null,
        delegatedToAgent: null,
        parentId: subtaskItem.parentId,
        isArchived: false,
      },
      { afterId: subtaskItem._id, parentId: subtaskItem.parentId ?? undefined }
    );
  };

  const handleSubtaskUpdateStatus = (id: string, status: Status) => {
    taskOperations.updateTask(id, { status });
  };

  // Count direct subtasks
  const subtaskCount = allTasks.filter(t => t.parentId === task._id).length;

  return (
    <>
      {/* Subtasks */}
      <div ref={subtaskContainerRef}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            Subtasks
            {subtaskCount > 0 && (
              <Badge variant="secondary" shape="square">
                {subtaskCount}
              </Badge>
            )}
          </h3>
        </div>

        {readOnly && subtaskCount === 0 ? (
          <p className="text-sm text-muted-foreground">No subtasks</p>
        ) : useCards ? (
          <div className="space-y-2">
            {subtaskTable.taskTree.map((node) => (
              <TaskDetailSubtaskCard
                key={node.clientId}
                task={node}
                subtaskProgress={node.childCount > 0 ? {
                  completed: node.completedChildCount,
                  total: node.childCount,
                } : undefined}
                projectId={projectId}
                allowedStatuses={allowedStatuses}
                hiddenTaskTableColumns={hiddenTaskTableColumns}
                onTaskUpdate={readOnly ? undefined : subtaskTable.updateTask}
                onClick={onOpenSubtask ? (child) => onOpenSubtask(child.clientId) : undefined}
                onInviteClick={onInviteClick}
                onAddAgentClick={onAddAgentClick}
                readOnly={readOnly}
              />
            ))}
            {readOnly ? null : (
              <label className="flex items-center gap-2 px-1 py-1">
                <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  type="text"
                  aria-label="Add subtask"
                  placeholder="Add task..."
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  value={subtaskTable.addTaskValue}
                  onChange={(event) => subtaskTable.setAddTaskValue(event.target.value)}
                  onKeyDown={subtaskTable.handleAddTaskKeyDown}
                  onBlur={subtaskTable.handleAddTaskBlur}
                />
              </label>
            )}
          </div>
        ) : (
          <div className="border-t border-border -mx-4">
            <TaskTable
              tasks={subtaskTable.flattenedTasks}
              taskTree={subtaskTable.taskTree}
              inputRefs={subtaskTable.inputRefs}
              registerRow={subtaskTable.registerRow}
              rowSelection={subtaskTable.rowSelection}
              onRowSelectionChange={subtaskTable.setRowSelection}
              sorting={subtaskTable.sorting}
              onSortingChange={subtaskTable.setSorting}
              statusFilter={subtaskTable.statusFilter}
              assigneeFilter={subtaskTable.assigneeFilter}
              currentUserId={currentUserId}
              projectId={projectId}
              allowedStatuses={allowedStatuses}
              hiddenTaskTableColumns={hiddenTaskTableColumns}
              selectedIds={subtaskTable.selectedIds}
              onRowClick={subtaskTable.handleRowClick}
              onSelectRow={subtaskTable.handleSelectRow}
              onContextMenuSelectRow={subtaskTable.handleContextMenuSelection}
              expandedIds={subtaskTable.expandedIds}
              toggleExpanded={subtaskTable.toggleExpanded}
              isDndEnabled={subtaskTable.isDndEnabled}
              canUpdateTask={subtaskTable.canUpdateTask}
              reorderTasks={subtaskTable.reorderTasks}
              reorderMultiple={subtaskTable.reorderMultiple}
              setParent={subtaskTable.setParent}
              setParentMultiple={subtaskTable.setParentMultiple}
              addTaskValue={subtaskTable.addTaskValue}
              onAddTaskChange={subtaskTable.setAddTaskValue}
              onAddTaskKeyDown={subtaskTable.handleAddTaskKeyDown}
              onAddTaskBlur={subtaskTable.handleAddTaskBlur}
              getAddTaskInputValue={subtaskTable.getAddTaskInputValue}
              onAddTaskInputChange={subtaskTable.setAddTaskInputValue}
              onAddTaskInputKeyDown={subtaskTable.handleAddTaskInputKeyDown}
              onAddTaskInputBlur={subtaskTable.handleAddTaskInputBlur}
              onInlineDraftChange={subtaskTable.updateInlineTaskDraftValue}
              onInlineDraftCommit={subtaskTable.commitInlineTaskDraft}
              onInlineDraftCancel={subtaskTable.cancelInlineTaskDraft}
              defaultParentId={subtaskTable.defaultParentId as Id<"tasks"> | undefined}
              updateTask={subtaskTable.updateTask}
              deleteTask={subtaskTable.deleteTask}
              addTask={subtaskTable.addTask}
              beginInlineTaskDraft={subtaskTable.beginInlineTaskDraft}
              focusInput={subtaskTable.focusInput}
              getAdjacentId={subtaskTable.getAdjacentId}
              getPreviousTaskId={subtaskTable.getPreviousTaskId}
              onDuplicate={handleSubtaskDuplicate}
              onUpdateStatus={handleSubtaskUpdateStatus}
              onOpenDetails={onOpenSubtask ?? (() => { })}
              onBulkContextUpdateStatus={subtaskTable.handleBulkStatusChange}
              onBulkContextUpdatePriority={subtaskTable.handleBulkPriorityChange}
              onBulkContextUpdateAssignee={subtaskTable.handleBulkAssigneeChange}
              onBulkContextUpdateLabel={subtaskTable.handleBulkLabelChange}
              onBulkContextArchive={
                taskOperations.bulkArchive ? subtaskTable.handleBulkArchive : undefined
              }
              onBulkContextUnarchive={
                taskOperations.bulkUnarchive
                  ? subtaskTable.handleBulkUnarchive
                  : undefined
              }
              onBulkContextDelete={subtaskTable.handleBulkDelete}
              onInviteClick={onInviteClick}
              onAddAgentClick={onAddAgentClick}
              archiveTask={subtaskTable.archiveTask}
              unarchiveTask={subtaskTable.unarchiveTask}
              shortcutPalette={subtaskTable.shortcutPalette}
              allowAddTask={!readOnly}
              compact
            />
          </div>
        )}
      </div>

      {/* Multi-select toolbar for subtasks */}
      {!useCards && subtaskTable.isBulkSelection && (
        <MultiSelectToolbar
          readOnly={readOnly}
          selectedCount={subtaskTable.selectedIds.size}
          projectId={projectId}
          allowedStatuses={allowedStatuses}
          onInviteClick={onInviteClick}
          onAddAgentClick={onAddAgentClick}
          onMarkComplete={subtaskTable.handleBulkComplete}
          onStatusChange={subtaskTable.handleBulkStatusChange}
          onPriorityChange={subtaskTable.handleBulkPriorityChange}
          onAssigneeChange={subtaskTable.handleBulkAssigneeChange}
          onDueDateChange={subtaskTable.handleBulkDueDateChange}
          onLabelChange={subtaskTable.handleBulkLabelChange}
          onDelete={subtaskTable.handleBulkDelete}
          onClearSelection={subtaskTable.clearSelection}
        />
      )}
      <TaskShortcutPicker
        request={subtaskTable.propertyShortcut}
        projectId={projectId}
        onTaskUpdate={subtaskTable.updateTask}
        onInviteClick={onInviteClick}
        onAddAgentClick={onAddAgentClick}
        onClose={subtaskTable.closePropertyShortcut}
      />
    </>
  );
}
