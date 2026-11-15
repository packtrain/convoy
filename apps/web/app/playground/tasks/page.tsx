"use client";

import { Suspense, useState, useRef, useMemo, useCallback } from "react";
import { SortingState } from "@tanstack/react-table";
import { Status, type StatusFilterKey, type AssigneeFilter, type Task, type LocalTask, type TaskTreeNode, type TaskUpdate } from "@/lib/tasks/types";
import type { Id } from "@/convex/_generated/dataModel";
import { initialTasks } from "./constants";
import { createLocalTask } from "@/lib/tasks/defaults";
import { useLocalTasks } from "@/app/playground/tasks/hooks/use-local-tasks";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { useKeyboardNavigation } from "@/components/blocks/tasks/task-table/hooks/use-keyboard-navigation";
import { useTaskSelection } from "@/lib/tasks/hooks/use-task-selection";
import { ProjectHeader } from "@/components/blocks/project/project-header";
import { TaskTable } from "@/components/blocks/tasks/task-table";
import { TaskDetailSidebar } from "@/components/blocks/tasks/task-detail-sidebar";
import { MultiSelectToolbar } from "@/components/blocks/tasks/multi-select-toolbar";
import { cn } from "@/lib/utils";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { RESIZE_BOUNDS } from "@/lib/tasks/constants";
import { buildTaskTree, flattenTree } from "@/lib/tasks/tree";

// Playground page for performance testing with hardcoded data
// Uses local state instead of Convex for testing purposes

// Convert LocalTask to Task (maps id to _id and clientId)
// Uses index as refNumber for playground testing
function localToTask(local: LocalTask, index: number): Task {
  return {
    _id: local.id as Id<"tasks">,
    clientId: local.id, // Use local id as clientId for stable keys
    refNumber: index + 1, // Use index for playground testing
    refId: `TEST-${index + 1}`, // Fake refId for playground
    name: local.name,
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: local.priority,
    dueDate: local.dueDate ? new Date(local.dueDate).getTime() : null,
    status: local.status,
    assignee: local.assignee,
    delegatedToAgent: null,
    tags: local.tags,
    rank: local.rank,
    parentId: local.parentId,
    createdAt: Date.now(),
    isArchived: false,
  };
}

export default function PlaygroundTasksPage() {
  // Local task state (no Convex)
  const {
    tasks: localTasks,
    updateTask: updateLocalTask,
    deleteTask: deleteLocalTask,
    addTask: addLocalTask,
    reorderTasks,
    reorderMultiple,
    setParent: setLocalParent,
    setParentMultiple: setLocalParentMultiple,
    bulkUpdateStatus,
    bulkDelete,
    inputRefs,
    rowRefs,
    registerRow,
    focusInput,
    getAdjacentId,
  } = useLocalTasks(initialTasks);

  // Convert to Task format for TaskTable
  const taskList = useMemo(() => localTasks.map((task, index) => localToTask(task, index)), [localTasks]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const taskTree: TaskTreeNode[] = useMemo(() => buildTaskTree(taskList), [taskList]);

  const visibleRows = useMemo(
    () => flattenTree(taskTree, expandedIds),
    [expandedIds, taskTree]
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const setParent = useCallback(
    (id: string, parentId: string | null, rank?: string) => {
      setLocalParent(id, parentId, rank);
      if (parentId) {
        setExpandedIds((prev) => new Set(prev).add(parentId));
      }
    },
    [setLocalParent]
  );

  const setParentMultiple = useCallback(
    (ids: string[], parentId: string | null) => {
      setLocalParentMultiple(ids, parentId);
      if (parentId) {
        setExpandedIds((prev) => new Set(prev).add(parentId));
      }
    },
    [setLocalParentMultiple]
  );

  // Wrapper functions to handle type conversion
  const updateTask = (id: string, updates: TaskUpdate) => {
    const {
      assigneeId: _assigneeId,
      delegatedToAgentId: _delegatedToAgentId,
      assigneeDetails: _assigneeDetails,
      delegatedToAgentDetails: _delegatedToAgentDetails,
      ...taskUpdates
    } = updates;
    void _assigneeId;
    void _delegatedToAgentId;
    void _assigneeDetails;
    void _delegatedToAgentDetails;
    const localUpdates: Partial<LocalTask> = {
      ...taskUpdates,
      dueDate: updates.dueDate ? new Date(updates.dueDate).toLocaleDateString() : undefined,
    };
    updateLocalTask(id, localUpdates);
  };

  const deleteTask = (id: string) => {
    deleteLocalTask(id);
  };

  const addTask = (task: Omit<Task, "_id" | "clientId">, position?: { afterId?: string; beforeId?: string; parentId?: string }): string | null => {
    const localTask = createLocalTask({
      name: task.name,
      priority: task.priority,
      dueDate: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "",
      status: task.status,
      assignee: task.assignee,
      tags: task.tags,
      parentId: position?.parentId ?? task.parentId ?? null,
    });
    // addLocalTask is async but we can ignore the promise since local state updates synchronously
    // and the id is generated before the async call
    const id = localTask.id;
    void addLocalTask(localTask, position);
    return id;
  };

  // Table state
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>(null);
  const [addTaskValue, setAddTaskValue] = useState("");

  // Array is already sorted by rank - array order IS display order
  // Use clientId for keyboard navigation and selection
  const taskIds = visibleRows
    .filter((row): row is TaskTreeNode => !("rowType" in row))
    .map((task) => task.clientId);

  // Simple getPreviousTaskId for playground (no subtasks, just returns last task)
  const getPreviousTaskId = useCallback(
    (): string | null => {
      return taskIds.length > 0 ? taskIds[taskIds.length - 1] : null;
    },
    [taskIds]
  );

  // Local state for sidebar (playground doesn't use URL routing)
  const [detailsRowId, setDetailsRowId] = useState<string | null>(null);
  const openDetails = useCallback((clientId: string) => setDetailsRowId(clientId), []);
  const closeDetails = useCallback(() => setDetailsRowId(null), []);

  // Selection state and handlers
  const {
    selectedIds,
    lastSelectedId,
    handleRowClick,
    handleSelectRow,
    handleContextMenuSelection,
    clearSelection,
    setSelectedIds,
    setLastSelectedId,
  } = useTaskSelection({ taskIds, onOpenDetails: openDetails });

  // Sidebar resize
  const containerRef = useRef<HTMLDivElement>(null);
  const { width: sidebarWidth, handleMouseDown } = useResizePanel(containerRef, {
    bounds: RESIZE_BOUNDS,
  });

  // DnD only works when no column sorting is active (filters are OK - we use full list for rank calculation)
  const isDndEnabled = sorting.length === 0;

  useKeyboardNavigation({
    taskIds,
    selectedIds,
    setSelectedIds,
    lastSelectedId,
    setLastSelectedId,
    focusInput,
    reorderTasks,
    inputRefs,
    rowRefs,
    containerRef,
    enabled: true,
  });

  // Bulk actions
  const handleBulkComplete = () => {
    bulkUpdateStatus(Array.from(selectedIds), Status.DONE);
  };

  const handleBulkStatusChange = (status: Status) => {
    bulkUpdateStatus(Array.from(selectedIds), status);
  };

  const handleBulkDelete = () => {
    bulkDelete(Array.from(selectedIds));
    clearSelection();
  };

  const detailsTask = taskList.find((t) => t.clientId === detailsRowId);

  const handleAddTaskKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && addTaskValue !== "") {
      e.preventDefault();
      const localTask = createLocalTask({ name: addTaskValue });
      addLocalTask(localTask);
      setAddTaskValue("");
    }
  };

  const handleAddTaskBlur = () => {
    if (addTaskValue.trim() !== "") {
      const localTask = createLocalTask({ name: addTaskValue.trim() });
      addLocalTask(localTask);
      setAddTaskValue("");
    }
  };

  const handleHeaderAddTask = async () => {
    const localTask = createLocalTask();
    const newId = await addLocalTask(localTask, { beforeId: localTasks[0]?.id });
    if (newId) {
      focusInput(newId, "start");
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-800">
        Playground Mode - {localTasks.length} tasks (local state, no backend)
      </div>

      <ProjectHeader
        projectName="Performance Test"
        statusFilter={statusFilter}
        assigneeFilter={assigneeFilter}
        archiveFilter="active"
        selectedListRef={null}
        viewMode="list"
        listPath="/playground/tasks"
        onStatusFilterChange={setStatusFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        onArchiveFilterChange={() => {}} // Playground doesn't support archive filter
        onSelectedListChange={() => {}} // Playground doesn't support Lists
        onSearchTaskSelect={() => {}} // Playground doesn't support backend search
        getSearchTaskHref={(taskRefId) => `/playground/tasks?task=${taskRefId}`}
        onAddTask={handleHeaderAddTask}
      />

      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <Suspense fallback={<div className="h-full bg-background" />}>
          <TaskTable
            tasks={visibleRows}
            taskTree={taskTree}
            inputRefs={inputRefs}
            registerRow={registerRow}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            sorting={sorting}
            onSortingChange={setSorting}
            statusFilter={statusFilter}
            assigneeFilter={assigneeFilter}
            selectedIds={selectedIds}
            onRowClick={handleRowClick}
            onSelectRow={handleSelectRow}
            onContextMenuSelectRow={handleContextMenuSelection}
            expandedIds={expandedIds}
            toggleExpanded={toggleExpanded}
            isDndEnabled={isDndEnabled}
            reorderTasks={reorderTasks}
            reorderMultiple={reorderMultiple}
            setParent={setParent}
            setParentMultiple={setParentMultiple}
            addTaskValue={addTaskValue}
            onAddTaskChange={setAddTaskValue}
            onAddTaskKeyDown={handleAddTaskKeyDown}
            onAddTaskBlur={handleAddTaskBlur}
            onInlineDraftChange={() => {}}
            onInlineDraftCommit={() => {}}
            onInlineDraftCancel={() => {}}
            updateTask={updateTask}
            deleteTask={deleteTask}
            addTask={addTask}
            beginInlineTaskDraft={() => {}}
            focusInput={focusInput}
            getAdjacentId={getAdjacentId}
            getPreviousTaskId={getPreviousTaskId}
            onDuplicate={() => {}}
            onUpdateStatus={() => {}}
            onOpenDetails={() => {}}
            archiveTask={() => {}}
            unarchiveTask={() => {}}
          />
        </Suspense>

        {/* Overlay Sidebar */}
        <div
          style={{ width: sidebarWidth }}
          className={cn(
            "absolute inset-y-0 right-0 z-20 flex border-l border-border bg-background shadow-lg transition-transform duration-300 ease-in-out",
            detailsTask ? "translate-x-0" : "translate-x-full"
          )}
        >
          {/* Resize Handle */}
          <div
            onMouseDown={handleMouseDown}
            className="w-1 cursor-col-resize hover:bg-muted active:bg-muted/80 transition-colors -ml-1"
          />
          {/* Sidebar Content */}
          <div className="flex-1 overflow-hidden">
            {detailsTask && (
              <TaskDetailSidebar
                task={detailsTask}
                onClose={closeDetails}
                onUpdate={updateTask}
              />
            )}
          </div>
        </div>
      </div>

      {/* Multi-select toolbar */}
      {selectedIds.size > 1 && (
        <MultiSelectToolbar
          selectedCount={selectedIds.size}
          onMarkComplete={handleBulkComplete}
          onStatusChange={handleBulkStatusChange}
          onPriorityChange={() => {}} // No-op in playground (local state only)
          onAssigneeChange={() => {}} // No-op in playground (no organization)
          onDueDateChange={() => {}} // No-op in playground (local state only)
          onDelete={handleBulkDelete}
          onClearSelection={clearSelection}
        />
      )}
    </div>
  );
}
