import type { AddTaskOptions } from "@/lib/tasks/types";
import { useState, useMemo, useCallback, useEffect, useRef, RefObject } from "react";
import { SortingState } from "@tanstack/react-table";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Status,
  type Task,
  type StatusFilterKey,
  type AssigneeFilter,
  type Priority,
  type TaskUpdate,
  type FlattenedRow,
  type InlineTaskDraftRow,
  type TaskTreeNode,
  type ReorderTasksFn,
  type ReorderMultipleFn,
} from "@/lib/tasks/types";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import { isAddTaskPlaceholder, isInlineTaskDraftRow } from "@/lib/tasks/types";
import { createDefaultTaskFromInput, getFilterDefaultsFromFilters } from "@/lib/tasks/defaults";
import { parseSectionTitleForCreate } from "@/lib/tasks/create-title";
import { buildTaskTree, flattenTree, getAncestorIds, insertChildlessAddTaskPlaceholders } from "@/lib/tasks/tree";
import { filterTaskByFilters } from "@/lib/tasks/filters";
import { useTaskSelection } from "@/lib/tasks/hooks/use-task-selection";
import { isTaskTableInteractiveTarget } from "@/lib/tasks/table-interaction";
import { useKeyboardNavigation } from "./use-keyboard-navigation";
import type { TaskPropertyShortcut } from "@/lib/tasks/metadata-shortcuts";
import type { TaskShortcutPickerRequest } from "@/components/blocks/tasks/task-shortcut-picker";


interface InlineTaskDraftStartOptions {
  parentId?: string | null;
  beforeClientId?: string;
  afterClientId?: string;
}

function getTaskDepth(taskId: string, taskById: ReadonlyMap<string, Task>): number {
  let depth = 0;
  let current = taskById.get(taskId) ?? null;

  while (current?.parentId) {
    depth += 1;
    current = taskById.get(String(current.parentId)) ?? null;
  }

  return depth;
}

const ADD_ROOT_INPUT_ID = "add-root";
const ADD_INPUT_PREFIX = "add-";

function addInputIdForParent(parentId: string | null): string {
  return parentId ? `${ADD_INPUT_PREFIX}${parentId}` : ADD_ROOT_INPUT_ID;
}

function parentIdFromAddInputId(addInputId: string): string | null {
  return addInputId === ADD_ROOT_INPUT_ID ? null : addInputId.slice(ADD_INPUT_PREFIX.length);
}

function findPreviousTaskRow(rows: FlattenedRow[], startIndex: number): TaskTreeNode | null {
  for (let i = startIndex; i >= 0; i--) {
    const row = rows[i];
    if (!isAddTaskPlaceholder(row) && !isInlineTaskDraftRow(row)) {
      return row;
    }
  }

  return null;
}

function insertInlineDraftRow(rows: FlattenedRow[], draft: InlineTaskDraftRow | null): FlattenedRow[] {
  if (!draft) {
    return rows;
  }

  let insertIndex = rows.length;

  if (draft.placementBeforeClientId) {
    const beforeIndex = rows.findIndex((row) => row.clientId === draft.placementBeforeClientId);
    insertIndex = beforeIndex === -1 ? rows.length : beforeIndex;
  } else if (draft.beforeClientId) {
    const beforeIndex = rows.findIndex((row) => row.clientId === draft.beforeClientId);
    insertIndex = beforeIndex === -1 ? 0 : beforeIndex;
  } else if (draft.afterClientId) {
    insertIndex =
      draft.afterPlacement === "after-anchor"
        ? getAfterAnchorInsertIndex(rows, draft.afterClientId)
        : getAfterInsertIndex(rows, draft.afterClientId);
  } else if (draft.parentId) {
    const parentPlaceholderIndex = rows.findIndex((row) => isAddTaskPlaceholder(row) && row.parentId === draft.parentId);
    if (parentPlaceholderIndex !== -1) {
      insertIndex = parentPlaceholderIndex;
    }
  } else if (rows.length === 0) {
    insertIndex = 0;
  }

  return [...rows.slice(0, insertIndex), draft, ...rows.slice(insertIndex)];
}

function getAfterInsertIndex(rows: FlattenedRow[], afterClientId: string): number {
  const anchorIndex = rows.findIndex((row) => row.clientId === afterClientId);
  if (anchorIndex === -1) {
    return 0;
  }

  let insertIndex = anchorIndex + 1;
  const anchorDepth = rows[anchorIndex].depth;

  while (insertIndex < rows.length && rows[insertIndex].depth > anchorDepth) {
    insertIndex += 1;
  }

  return insertIndex;
}

function getAfterAnchorInsertIndex(rows: FlattenedRow[], afterClientId: string): number {
  const anchorIndex = rows.findIndex((row) => row.clientId === afterClientId);
  return anchorIndex === -1 ? 0 : anchorIndex + 1;
}

interface UseTaskTableControllerOptions {
  // Data source
  allTasks: Task[];

  // Optional: filter to show only children of this parent (also sets default parent for new tasks)
  parentFilter?: string | null;

  // CRUD operations (from useTasks)
  updateTask: (id: string, updates: TaskUpdate) => void;
  deleteTask: (id: string) => void;
  archiveTask: (id: string) => void;
  unarchiveTask: (id: string) => void;
  addTask: (task: Omit<Task, "_id" | "clientId">, options?: AddTaskOptions) => string | null;
  reorderTasks: ReorderTasksFn;
  reorderMultiple: ReorderMultipleFn;
  setParent: (id: string, parentId: string | null, rank?: string) => void;
  setParentMultiple: (ids: string[], parentId: string | null, afterTaskId?: string) => void;
  bulkUpdateStatus: (ids: string[], status: Status) => void;
  bulkUpdateAssignee: (ids: string[], change: TaskAssigneeChange) => void;
  bulkUpdatePriority: (ids: string[], priority: Priority) => void;
  bulkUpdateDueDate: (ids: string[], dueDate: number | null) => void;
  bulkUpdateTaskType: (ids: string[], taskTypeKey: string | null) => void;
  bulkArchive: (ids: string[]) => void;
  bulkUnarchive?: (ids: string[]) => void;
  moveToList?: (rootIds: string[], listRef: string, sectionId?: Id<"taskSections">) => void;
  moveClosedToBottom?: (rootIds: string[]) => void;
  bulkDelete: (ids: string[]) => void;
  duplicateTask: (id: string) => string | null;

  // Refs (shared across tables, keyed by task clientId)
  inputRefs: RefObject<Map<string, HTMLInputElement> | null>;
  focusInput: (id: string, cursorPosition?: "start" | "end") => void;

  // Container for scoping keyboard navigation
  containerRef: RefObject<HTMLElement | null>;

  // Callbacks
  onOpenDetails?: (clientId: string) => void;
  /** When true, clicking the task name input opens the details panel. Defaults to false so inline editing keeps focus. */
  openDetailsOnNameClick?: boolean;

  // Options
  enabled?: boolean;
  /** False for read-only viewers: no inline edits, drag, or write hotkeys (docs/specs/read-only-viewer-ux.md). */
  canUpdateTask?: boolean;
  projectId?: Id<"projects">;
  currentUserId?: string;
  allowedStatuses?: Status[];

  // Optional controlled filter state (for URL persistence)
  // If provided, component is controlled; otherwise uses internal state
  statusFilter?: StatusFilterKey;
  onStatusFilterChange?: (filter: StatusFilterKey) => void;
  assigneeFilter?: AssigneeFilter;
  onAssigneeFilterChange?: (filter: AssigneeFilter) => void;
  selectedTaskRefId?: string | null;

  // Whether to show "add task" rows (default: true)
  allowAddTask?: boolean;
  allowRootAddTask?: boolean;

  // When true, preserve root task order from backend (e.g., for archived tasks sorted by archivedAt)
  preserveRootOrder?: boolean;
  transformRows?: (rows: FlattenedRow[]) => FlattenedRow[];
  resolveDraft?: (draft: InlineTaskDraftRow) => { defaults: Partial<Task>; options?: AddTaskOptions } | undefined;
  navigateGroups?: (rows: FlattenedRow[], currentId: string, direction: "prev" | "next") => string | undefined;
  /** Expands the collapsed group holding a deep-linked task. */
  revealGroupRow?: (clientId: string) => void;
  /** Receives "# Name" from the top-level add row; omitted = plain task. */
  onCreateSection?: (name: string) => void;
}

export function useTaskTableController({
  allTasks,
  parentFilter,
  updateTask,
  deleteTask,
  archiveTask,
  unarchiveTask,
  addTask,
  reorderTasks,
  reorderMultiple,
  setParent,
  setParentMultiple,
  bulkUpdateStatus,
  bulkUpdateAssignee,
  bulkUpdatePriority,
  bulkUpdateDueDate,
  bulkUpdateTaskType,
  bulkArchive,
  bulkUnarchive,
  moveToList,
  moveClosedToBottom,
  bulkDelete,
  duplicateTask,
  inputRefs,
  focusInput,
  containerRef,
  onOpenDetails,
  openDetailsOnNameClick,
  enabled = true,
  canUpdateTask = true,
  projectId,
  currentUserId,
  statusFilter: controlledStatusFilter,
  onStatusFilterChange,
  assigneeFilter: controlledAssigneeFilter,
  onAssigneeFilterChange,
  selectedTaskRefId,
  allowAddTask = true,
  allowRootAddTask = true,
  preserveRootOrder = false,
  transformRows,
  resolveDraft,
  navigateGroups,
  revealGroupRow,
  onCreateSection,
  allowedStatuses,
}: UseTaskTableControllerOptions) {
  // Filter state - supports controlled (URL) or uncontrolled (internal) mode
  const [internalStatusFilter, setInternalStatusFilter] = useState<StatusFilterKey>("all");
  const [internalAssigneeFilter, setInternalAssigneeFilter] = useState<AssigneeFilter>(null);

  // Use controlled values if provided, otherwise use internal state
  const statusFilter = controlledStatusFilter ?? internalStatusFilter;
  const assigneeFilter = controlledAssigneeFilter ?? internalAssigneeFilter;

  // Setters that work with both controlled and uncontrolled modes
  const setStatusFilter = useCallback(
    (filter: StatusFilterKey) => {
      if (onStatusFilterChange) {
        onStatusFilterChange(filter);
      } else {
        setInternalStatusFilter(filter);
      }
    },
    [onStatusFilterChange]
  );

  const setAssigneeFilter = useCallback(
    (filter: AssigneeFilter) => {
      if (onAssigneeFilterChange) {
        onAssigneeFilterChange(filter);
      } else {
        setInternalAssigneeFilter(filter);
      }
    },
    [onAssigneeFilterChange]
  );

  // Filter tasks by parent if parentFilter is set
  const parentFilteredTasks = useMemo(() => {
    if (parentFilter === undefined) {
      // No filter - return all tasks
      return allTasks;
    }

    // Build a quick lookup map for ancestry checks (keyed by string for easy lookup)
    const taskMap = new Map(allTasks.map((t) => [t._id as string, t]));

    // Check if a task is a descendant of the parent filter
    // (i.e., has parentFilter somewhere in its ancestry chain)
    function isDescendantOf(taskId: string): boolean {
      let current = taskMap.get(taskId);
      while (current) {
        if (current.parentId === parentFilter) return true;
        if (!current.parentId) return false;
        current = taskMap.get(current.parentId as string);
      }
      return false;
    }

    // Include all descendants of parentFilter (children, grandchildren, etc.)
    return allTasks.filter((t) => isDescendantOf(t._id));
  }, [allTasks, parentFilter]);

  // Apply status/assignee filters before building tree
  // This ensures the virtualizer count matches what's actually rendered
  const tasks = useMemo(() => {
    return parentFilteredTasks.filter((t) => filterTaskByFilters(t, statusFilter, assigneeFilter, currentUserId));
  }, [parentFilteredTasks, statusFilter, assigneeFilter, currentUserId]);

  // Build tree structure (for filtered tasks)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [revealedChildlessAddParentIds, setRevealedChildlessAddParentIds] = useState<Set<string>>(() => new Set());

  const taskTree = useMemo(() => {
    return buildTaskTree(tasks, { preserveRootOrder });
  }, [tasks, preserveRootOrder]);

  const visibleParentIdsWithChildren = useMemo(() => {
    const parentIds = new Set<string>();

    for (const task of tasks) {
      if (task.parentId) {
        parentIds.add(String(task.parentId));
      }
    }

    return parentIds;
  }, [tasks]);

  const visibleTopLevelRoots = useMemo(() => taskTree.filter((task) => !task.parentId), [taskTree]);

  const taskByClientId = useMemo(() => new Map(allTasks.map((task) => [task.clientId, task])), [allTasks]);

  const taskById = useMemo(() => new Map(allTasks.map((task) => [String(task._id), task])), [allTasks]);

  const activeRevealedChildlessAddParentIds = useMemo(() => {
    if (revealedChildlessAddParentIds.size === 0) {
      return revealedChildlessAddParentIds;
    }

    let changed = false;
    const next = new Set<string>();

    for (const id of revealedChildlessAddParentIds) {
      if (!taskById.has(id) || visibleParentIdsWithChildren.has(id)) {
        changed = true;
        continue;
      }

      next.add(id);
    }

    return changed ? next : revealedChildlessAddParentIds;
  }, [revealedChildlessAddParentIds, taskById, visibleParentIdsWithChildren]);

  const treeFlattenedTasks = useMemo(() => {
    return flattenTree(taskTree, expandedIds, allowAddTask);
  }, [taskTree, expandedIds, allowAddTask]);

  const baseFlattenedTasks = useMemo(() => {
    return insertChildlessAddTaskPlaceholders(treeFlattenedTasks, activeRevealedChildlessAddParentIds, allowAddTask);
  }, [treeFlattenedTasks, activeRevealedChildlessAddParentIds, allowAddTask]);

  const baseFlattenedRowByClientId = useMemo(() => new Map(baseFlattenedTasks.map((row) => [row.clientId, row])), [baseFlattenedTasks]);

  const [storedInlineDraft, setInlineDraft] = useState<InlineTaskDraftRow | null>(null);
  // Losing create access mid-draft hides the draft and turns its commit into a no-op.
  const inlineDraft = allowAddTask ? storedInlineDraft : null;

  const resolveInlineDraftDepth = useCallback(
    (options: InlineTaskDraftStartOptions): number => {
      const anchorRow =
        (options.beforeClientId ? baseFlattenedRowByClientId.get(options.beforeClientId) : undefined) ??
        (options.afterClientId ? baseFlattenedRowByClientId.get(options.afterClientId) : undefined);
      if (anchorRow) {
        return anchorRow.depth;
      }

      if (options.parentId) {
        return getTaskDepth(options.parentId, taskById) + 1;
      }

      return 0;
    },
    [baseFlattenedRowByClientId, taskById]
  );

  const flattenedTasks = useMemo(() => {
    const rows = insertInlineDraftRow(baseFlattenedTasks, inlineDraft);
    return transformRows ? transformRows(rows) : rows;
  }, [baseFlattenedTasks, inlineDraft, transformRows]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedIds((previous) => previous.size === 0 ? previous : new Set());
    setRevealedChildlessAddParentIds((previous) => previous.size === 0 ? previous : new Set());
  }, []);

  const expandTask = useCallback((id: string) => {
    setExpandedIds((prev) => {
      if (prev.has(id)) {
        return prev;
      }

      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Helper to look up task by clientId
  const getTaskByClientId = useCallback(
    (clientId: string): TaskTreeNode | undefined =>
      flattenedTasks.find(
        (row): row is TaskTreeNode => !isAddTaskPlaceholder(row) && !isInlineTaskDraftRow(row) && row.clientId === clientId
      ),
    [flattenedTasks]
  );

  // Keyboard navigation expand/collapse helpers (work with clientId)
  const handleToggleExpandByClientId = useCallback(
    (clientId: string) => {
      const task = getTaskByClientId(clientId);
      if (task) {
        toggleExpanded(task._id);
      }
    },
    [getTaskByClientId, toggleExpanded]
  );

  const canExpandByClientId = useCallback(
    (clientId: string): boolean => {
      const task = getTaskByClientId(clientId);
      return !!(task && task.hasChildren);
    },
    [getTaskByClientId]
  );

  const isExpandedByClientId = useCallback(
    (clientId: string): boolean => {
      const task = getTaskByClientId(clientId);
      return !!(task && expandedIds.has(task._id));
    },
    [getTaskByClientId, expandedIds]
  );

  // taskIds for selection (only actual tasks, not add-task placeholders)
  const taskIds = useMemo(
    () => flattenedTasks.filter((row) => !isAddTaskPlaceholder(row) && !isInlineTaskDraftRow(row)).map((t) => t.clientId),
    [flattenedTasks]
  );

  // navigableIds includes all items (tasks + add-task placeholders) + "add-root" at the end
  // Used for keyboard navigation to allow navigating to add-task inputs
  const navigableIds = useMemo(
    () =>
      allowAddTask
        ? [...flattenedTasks.map((t) => t.clientId), ...(allowRootAddTask ? [ADD_ROOT_INPUT_ID] : [])]
        : flattenedTasks.filter((t) => !isAddTaskPlaceholder(t)).map((t) => t.clientId),
    [flattenedTasks, allowAddTask, allowRootAddTask]
  );

  // Refs for add-task inputs (for keyboard navigation)
  const addTaskInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const skipNextAddInputBlurCommitRef = useRef<Set<string>>(new Set());

  const registerAddTaskInput = useCallback((id: string, el: HTMLInputElement | null) => {
    if (el) addTaskInputRefs.current.set(id, el);
    else addTaskInputRefs.current.delete(id);
  }, []);

  const focusAddTaskInput = useCallback((clientId: string, sourceId?: string, options?: { skipSourceBlurCommit?: boolean }) => {
    window.requestAnimationFrame(() => {
      if (sourceId) {
        const sourceInput = addTaskInputRefs.current.get(sourceId);
        const activeElement = document.activeElement;
        const sourceStillOwnsFocus = sourceInput ? activeElement === sourceInput : activeElement === document.body;

        if (!sourceStillOwnsFocus) {
          return;
        }
      }

      const input = addTaskInputRefs.current.get(clientId);
      if (!input) {
        // Virtualized rows may not be mounted yet; the draft state is still kept.
        return;
      }

      if (sourceId && options?.skipSourceBlurCommit) {
        skipNextAddInputBlurCommitRef.current.add(sourceId);
      }

      input.focus();
      if (document.activeElement !== input && sourceId) {
        skipNextAddInputBlurCommitRef.current.delete(sourceId);
        return;
      }

      const selectionEnd = input.value.length;
      input.setSelectionRange(selectionEnd, selectionEnd);
    });
  }, []);

  const inlineDraftClientId = inlineDraft?.clientId ?? null;

  useEffect(() => {
    if (!inlineDraftClientId) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      addTaskInputRefs.current.get(inlineDraftClientId)?.focus();
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [inlineDraftClientId]);

  // Selection state
  const {
    selectedIds,
    lastSelectedId,
    isBulkSelection,
    handleRowClick: baseHandleRowClick,
    handleSelectRow: baseHandleSelectRow,
    handleContextMenuSelection,
    clearSelection,
    setSelectedIds,
    setLastSelectedId,
  } = useTaskSelection({ taskIds, onOpenDetails, openDetailsOnNameClick });

  const [focusRequest, setFocusRequest] = useState<{ id: string; focus?: boolean }>();
  const effectiveSelectedTaskRefId = selectedTaskRefId ?? null;
  const pendingDeepLinkRef = useRef<string | null>(effectiveSelectedTaskRefId);
  const lastSeenDeepLinkRef = useRef<string | null>(effectiveSelectedTaskRefId);

  useEffect(() => {
    // Keep `tasks` in this effect's dependency list so unresolved deep links
    // retry when filtering or late-arriving data eventually makes the target visible.
    if (effectiveSelectedTaskRefId !== lastSeenDeepLinkRef.current) {
      pendingDeepLinkRef.current = effectiveSelectedTaskRefId;
      lastSeenDeepLinkRef.current = effectiveSelectedTaskRefId;
    }

    const pendingDeepLink = pendingDeepLinkRef.current;
    if (!pendingDeepLink) {
      return;
    }

    const visibleTask = tasks.find((task) => task.refId === pendingDeepLink);
    if (!visibleTask) {
      return;
    }

    const ancestorIds = getAncestorIds(String(visibleTask._id), tasks);
    if (ancestorIds.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        let changed = false;

        for (const ancestorId of ancestorIds) {
          if (!next.has(ancestorId)) {
            next.add(ancestorId);
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    }

    setSelectedIds(new Set([visibleTask.clientId]));
    setLastSelectedId(visibleTask.clientId);
    revealGroupRow?.(visibleTask.clientId);
    setFocusRequest({ id: visibleTask.clientId, focus: false });
    pendingDeepLinkRef.current = null;
  }, [effectiveSelectedTaskRefId, flattenedTasks.length, revealGroupRow, selectedIds.size, setLastSelectedId, setSelectedIds, tasks]);

  // Row refs for focus management (internal to this controller)
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Wrap selection handlers to also focus the row (for keyboard navigation scoping)
  const handleRowClick = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      baseHandleRowClick(e, taskId);

      // Don't steal focus from interactive elements
      const target = e.target as HTMLElement;
      const isInteractive = isTaskTableInteractiveTarget(target);

      if (!isInteractive) {
        // Focus the row after click completes so keyboard nav knows which table is active
        requestAnimationFrame(() => {
          const row = rowRefs.current?.get(taskId);
          row?.focus();
        });
      }
    },
    [baseHandleRowClick]
  );

  const handleSelectRow = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      baseHandleSelectRow(e, taskId);
      requestAnimationFrame(() => {
        rowRefs.current?.get(taskId)?.focus();
      });
    },
    [baseHandleSelectRow]
  );

  // Table state (activeFilter is declared earlier since it's needed for filtering)
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [addTaskValue, setAddTaskValue] = useState("");
  const [nestedAddTaskValues, setNestedAddTaskValues] = useState<Map<string, string>>(() => new Map());

  const setRevealedChildlessAddParent = useCallback((parentId: string | null | undefined, reveal: boolean) => {
    if (!parentId) {
      return;
    }

    setRevealedChildlessAddParentIds((prev) => {
      const next = new Set(prev);
      const hadParentId = next.has(parentId);

      if (reveal) {
        if (hadParentId) {
          return prev;
        }

        next.add(parentId);
        return next;
      }

      if (!hadParentId) {
        return prev;
      }

      next.delete(parentId);
      return next;
    });
  }, []);

  const getAddTaskInputValue = useCallback(
    (addInputId: string): string => {
      if (parentIdFromAddInputId(addInputId) === null) {
        return addTaskValue;
      }

      return nestedAddTaskValues.get(addInputId) ?? "";
    },
    [addTaskValue, nestedAddTaskValues]
  );

  const setAddTaskInputValue = useCallback(
    (addInputId: string, value: string) => {
      const parentId = parentIdFromAddInputId(addInputId);
      if (parentId === null) {
        setAddTaskValue(value);
        return;
      }

      setNestedAddTaskValues((prev) => {
        if ((prev.get(addInputId) ?? "") === value) {
          return prev;
        }

        const next = new Map(prev);
        if (value === "") {
          next.delete(addInputId);
        } else {
          next.set(addInputId, value);
        }
        return next;
      });

      if (value === "") {
        setRevealedChildlessAddParent(parentId, false);
      }
    },
    [setRevealedChildlessAddParent]
  );

  const clearAddTaskInputValue = useCallback(
    (addInputId: string, options?: { keepRevealed?: boolean }) => {
      const parentId = parentIdFromAddInputId(addInputId);
      if (parentId === null) {
        setAddTaskValue("");
        return;
      }

      setNestedAddTaskValues((prev) => {
        if (!prev.has(addInputId)) {
          return prev;
        }

        const next = new Map(prev);
        next.delete(addInputId);
        return next;
      });

      if (!options?.keepRevealed) {
        setRevealedChildlessAddParent(parentId, false);
      }
    },
    [setRevealedChildlessAddParent]
  );

  const getCreateInputValue = useCallback(
    (inputId: string): string => {
      if (inlineDraft?.clientId === inputId) {
        return inlineDraft.value;
      }

      return getAddTaskInputValue(inputId);
    },
    [getAddTaskInputValue, inlineDraft]
  );

  const clearCreateInputValue = useCallback(
    (inputId: string) => {
      if (inlineDraft?.clientId === inputId) {
        setInlineDraft(null);
        return;
      }

      clearAddTaskInputValue(inputId);
    },
    [clearAddTaskInputValue, inlineDraft?.clientId]
  );

  const getCreateInputParentId = useCallback(
    (inputId: string): string | null | undefined => {
      if (inlineDraft?.clientId === inputId) {
        return inlineDraft.parentId;
      }

      if (inputId === ADD_ROOT_INPUT_ID || inputId.startsWith(ADD_INPUT_PREFIX)) {
        return parentIdFromAddInputId(inputId);
      }

      return undefined;
    },
    [inlineDraft]
  );

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  // Get adjacent ID for keyboard navigation
  const getAdjacentId = useCallback(
    (currentClientId: string, direction: "prev" | "next"): string | null => {
      const currentIndex = taskIds.indexOf(currentClientId);
      if (direction === "prev" && currentIndex > 0) {
        return taskIds[currentIndex - 1];
      }
      if (direction === "next" && currentIndex < taskIds.length - 1) {
        return taskIds[currentIndex + 1];
      }
      return null;
    },
    [taskIds]
  );

  const getPreviousVisibleTaskForAddInput = useCallback(
    (addInputId: string): TaskTreeNode | null => {
      if (addInputId === ADD_ROOT_INPUT_ID) {
        return findPreviousTaskRow(flattenedTasks, flattenedTasks.length - 1);
      }

      const currentIndex = flattenedTasks.findIndex((row) => row.clientId === addInputId);
      if (currentIndex <= 0) {
        return null;
      }

      return findPreviousTaskRow(flattenedTasks, currentIndex - 1);
    },
    [flattenedTasks]
  );

  // Get previous actual task ID from an add-task placeholder.
  // Used for backspace navigation from add-task inputs.
  const getPreviousTaskId = useCallback(
    (inputClientId: string): string | null => getPreviousVisibleTaskForAddInput(inputClientId)?.clientId ?? null,
    [getPreviousVisibleTaskForAddInput]
  );

  const moveAddTaskInputValue = useCallback(
    (sourceAddInputId: string, targetAddInputId: string): void => {
      const targetValue = getAddTaskInputValue(targetAddInputId);
      const sourceValue = getCreateInputValue(sourceAddInputId);
      const sourceIsInlineDraft = inlineDraft?.clientId === sourceAddInputId;

      if (targetValue !== "") {
        focusAddTaskInput(targetAddInputId, sourceAddInputId, {
          skipSourceBlurCommit: true,
        });
        return;
      }

      focusAddTaskInput(targetAddInputId, sourceAddInputId);

      if (sourceValue !== "") {
        clearCreateInputValue(sourceAddInputId);
        setAddTaskInputValue(targetAddInputId, sourceValue);
      } else if (sourceIsInlineDraft) {
        clearCreateInputValue(sourceAddInputId);
      }
    },
    [clearCreateInputValue, focusAddTaskInput, getAddTaskInputValue, getCreateInputValue, inlineDraft?.clientId, setAddTaskInputValue]
  );

  const moveAddTaskInputHierarchy = useCallback(
    (sourceAddInputId: string, direction: "deeper" | "shallower"): void => {
      if (direction === "deeper") {
        if (inlineDraft?.clientId === sourceAddInputId && inlineDraft.tabTargetAddInputId) {
          moveAddTaskInputValue(sourceAddInputId, inlineDraft.tabTargetAddInputId);
          return;
        }

        const previousTask = getPreviousVisibleTaskForAddInput(sourceAddInputId);
        if (!previousTask) {
          return;
        }

        const previousTaskId = String(previousTask._id);
        const targetAddInputId = addInputIdForParent(previousTaskId);
        expandTask(previousTaskId);
        setRevealedChildlessAddParent(previousTaskId, !previousTask.hasChildren);

        moveAddTaskInputValue(sourceAddInputId, targetAddInputId);
        return;
      }

      const sourceParentId = getCreateInputParentId(sourceAddInputId);
      if (!sourceParentId) {
        return;
      }

      const sourceParent = taskById.get(sourceParentId);
      if (!sourceParent) {
        return;
      }

      const targetParentId = sourceParent.parentId ? String(sourceParent.parentId) : null;
      const sourceValue = getCreateInputValue(sourceAddInputId);
      const sourceIsInlineDraft = inlineDraft?.clientId === sourceAddInputId;
      const sourceIsVisibleAddInput = !sourceIsInlineDraft && baseFlattenedRowByClientId.has(sourceAddInputId);
      const sourceIndex = sourceIsVisibleAddInput ? baseFlattenedTasks.findIndex((row) => row.clientId === sourceAddInputId) : -1;
      const sourceNextClientId = sourceIndex === -1 ? undefined : baseFlattenedTasks[sourceIndex + 1]?.clientId;
      const sourceKeepsPreChildPlacement = sourceIsInlineDraft && Boolean(inlineDraft?.beforeClientId);

      if (targetParentId) {
        expandTask(targetParentId);
      }

      if (sourceIsVisibleAddInput && sourceValue === "" && !sourceNextClientId && (targetParentId !== null || allowRootAddTask)) {
        clearAddTaskInputValue(sourceAddInputId);
        setInlineDraft(null);
        focusAddTaskInput(addInputIdForParent(targetParentId), sourceAddInputId);
        return;
      }

      if (sourceIsInlineDraft) {
        skipNextAddInputBlurCommitRef.current.add(sourceAddInputId);
      } else {
        clearAddTaskInputValue(sourceAddInputId, {
          keepRevealed: sourceValue !== "",
        });
      }

      setInlineDraft({
        rowType: "draft-task",
        clientId: `draft-${crypto.randomUUID()}`,
        parentId: targetParentId,
        depth: getTaskDepth(sourceParentId, taskById),
        value: sourceValue,
        afterClientId: sourceParent.clientId,
        afterPlacement: sourceKeepsPreChildPlacement ? "after-anchor" : "after-subtree",
        ...(sourceIsVisibleAddInput
          ? {
              placementBeforeClientId: sourceNextClientId,
              tabTargetAddInputId: sourceAddInputId,
            }
          : {}),
      });
    },
    [
      allowRootAddTask,
      baseFlattenedRowByClientId,
      baseFlattenedTasks,
      clearAddTaskInputValue,
      expandTask,
      focusAddTaskInput,
      getCreateInputParentId,
      getCreateInputValue,
      getPreviousVisibleTaskForAddInput,
      inlineDraft,
      moveAddTaskInputValue,
      setRevealedChildlessAddParent,
      taskById,
    ]
  );

  // DnD needs write access and no active column sort. Filters do not gate
  // reorder: the client always loads the full rank container (OS-902), so rank
  // planning has every sibling regardless of the active status/assignee filter.
  const isDndEnabled = canUpdateTask && sorting.length === 0;

  // Default parent for new tasks (from parentFilter)
  const defaultParentId = parentFilter ?? null;

  const beginInlineTaskDraft = useCallback(
    (options: InlineTaskDraftStartOptions) => {
      // Covers every draft entry point: the C hotkey, the header +, and Enter in a name input.
      if (!allowAddTask) return;

      if (options.afterClientId) {
        const insertIndex = getAfterInsertIndex(baseFlattenedTasks, options.afterClientId);
        const existingAddTaskRow = baseFlattenedTasks[insertIndex];

        if (existingAddTaskRow && isAddTaskPlaceholder(existingAddTaskRow)) {
          setInlineDraft(null);
          focusAddTaskInput(existingAddTaskRow.clientId);
          return;
        }

        if (insertIndex >= baseFlattenedTasks.length && allowRootAddTask) {
          setInlineDraft(null);
          focusAddTaskInput(ADD_ROOT_INPUT_ID);
          return;
        }
      }

      const beforeTask = options.beforeClientId ? taskByClientId.get(options.beforeClientId) : undefined;
      const afterTask = options.afterClientId ? taskByClientId.get(options.afterClientId) : undefined;
      const parentId = options.parentId ?? beforeTask?.parentId ?? afterTask?.parentId ?? null;

      setInlineDraft({
        rowType: "draft-task",
        clientId: `draft-${crypto.randomUUID()}`,
        parentId,
        depth: resolveInlineDraftDepth(options),
        value: "",
        ...(options.beforeClientId ? { beforeClientId: options.beforeClientId } : {}),
        ...(options.afterClientId ? { afterClientId: options.afterClientId } : {}),
      });
    },
    [allowAddTask, allowRootAddTask, baseFlattenedTasks, focusAddTaskInput, resolveInlineDraftDepth, taskByClientId]
  );

  const beginInlineTaskDraftAtTop = useCallback(() => {
    const firstRootTask = taskTree[0];

    beginInlineTaskDraft({
      parentId: defaultParentId ?? null,
      beforeClientId: firstRootTask?.clientId,
    });
  }, [beginInlineTaskDraft, defaultParentId, taskTree]);

  const updateInlineTaskDraftValue = useCallback((value: string) => {
    setInlineDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            value,
          }
        : currentDraft
    );
  }, []);

  const resolveDraftAddTaskOptions = useCallback(
    (draft: InlineTaskDraftRow): AddTaskOptions | undefined => {
      const beforeTask = draft.beforeClientId ? taskByClientId.get(draft.beforeClientId) : undefined;
      if (beforeTask) {
        return {
          beforeId: beforeTask._id,
          parentId: draft.parentId ?? undefined,
        };
      }

      const afterTask = draft.afterClientId ? taskByClientId.get(draft.afterClientId) : undefined;
      if (afterTask) {
        return {
          afterId: afterTask._id,
          parentId: draft.parentId ?? undefined,
        };
      }

      if (draft.parentId) {
        return { parentId: draft.parentId };
      }

      return undefined;
    },
    [taskByClientId]
  );

  const commitInlineTaskDraft = useCallback(
    (value: string, reason: "enter" | "blur") => {
      if (!inlineDraft) {
        return;
      }

      if (reason === "blur" && skipNextAddInputBlurCommitRef.current.delete(inlineDraft.clientId)) {
        return;
      }

      const filterDefaults = getFilterDefaultsFromFilters(statusFilter, assigneeFilter, currentUserId);
      const group = resolveDraft?.(inlineDraft);
      const newTask = createDefaultTaskFromInput(value, { ...filterDefaults, ...group?.defaults });
      if (!newTask) {
        setInlineDraft(null);
        return;
      }
      const newTaskClientId = addTask(newTask, { ...resolveDraftAddTaskOptions(inlineDraft), ...group?.options });

      if (reason === "enter" && newTaskClientId) {
        setInlineDraft({
          rowType: "draft-task",
          clientId: `draft-${crypto.randomUUID()}`,
          parentId: inlineDraft.parentId,
          depth: inlineDraft.depth,
          value: "",
          afterClientId: newTaskClientId,
        });
        return;
      }

      setInlineDraft(null);
    },
    [addTask, assigneeFilter, currentUserId, inlineDraft, resolveDraft, resolveDraftAddTaskOptions, statusFilter]
  );

  const cancelInlineTaskDraft = useCallback(
    (reason?: "escape" | "backspace-empty") => {
      if (reason === "backspace-empty" && inlineDraft) {
        const previousTaskId = getPreviousTaskId(inlineDraft.clientId);
        setInlineDraft(null);
        if (previousTaskId) {
          focusInput(previousTaskId, "end");
        }
        return;
      }

      setInlineDraft(null);
    },
    [focusInput, getPreviousTaskId, inlineDraft]
  );

  // Helper to convert clientIds to _ids for server mutations
  const clientIdsToIds = useCallback(
    (clientIds: string[]): string[] => {
      return clientIds
        .map((clientId) => {
          const task = taskByClientId.get(clientId);
          return task ? (task._id as string) : null;
        })
        .filter((id): id is string => id !== null);
    },
    [taskByClientId]
  );

  // Toggle status for selected tasks (space bar shortcut)
  const handleToggleStatus = useCallback(
    (clientIds: string[]) => {
      for (const clientId of clientIds) {
        const task = taskByClientId.get(clientId);
        if (task) {
          const newStatus = task.status === Status.DONE ? Status.TODO : Status.DONE;
          updateTask(task._id as string, { status: newStatus });
        }
      }
    },
    [taskByClientId, updateTask]
  );

  // Duplicate wrapper that converts clientId to _id for keyboard navigation
  const handleDuplicateByClientId = useCallback(
    (clientId: string) => {
      const task = taskByClientId.get(clientId);
      if (task) {
        duplicateTask(task._id as string);
      }
    },
    [duplicateTask, taskByClientId]
  );

  // Reorder wrapper that converts clientIds to _ids for keyboard navigation
  // targetClientId=null means "append to end" (uses add-task target)
  const handleReorderByClientId = useCallback(
    (sourceClientId: string, targetClientId: string | null) => {
      const sourceTask = taskByClientId.get(sourceClientId);
      if (!sourceTask) return;

      if (targetClientId === null) {
        // Append to end of siblings - use add-task target format
        const addTaskTarget = sourceTask.parentId ? addInputIdForParent(String(sourceTask.parentId)) : ADD_ROOT_INPUT_ID;
        reorderTasks(sourceTask._id as string, addTaskTarget);
      } else {
        const targetTask = taskByClientId.get(targetClientId);
        if (targetTask) {
          reorderTasks(sourceTask._id as string, targetTask._id as string);
        }
      }
    },
    [reorderTasks, taskByClientId]
  );

  // Bulk action handlers (pre-wired with clientId → _id conversion)
  const clearSelectionIfBulkStatusLeavesTable = useCallback(
    (selectedClientIds: string[], status: Status) => {
      const hasSelectedTaskStillVisible = selectedClientIds.some((clientId) => {
        const task = taskByClientId.get(clientId);
        if (!task) {
          return false;
        }

        return filterTaskByFilters({ ...task, status }, statusFilter, assigneeFilter, currentUserId);
      });

      if (!hasSelectedTaskStillVisible) {
        clearSelection();
      }
    },
    [assigneeFilter, clearSelection, currentUserId, statusFilter, taskByClientId]
  );

  const handleBulkComplete = useCallback(() => {
    const selectedClientIds = Array.from(selectedIds);
    const ids = clientIdsToIds(selectedClientIds);
    if (ids.length === 0) return;

    bulkUpdateStatus(ids, Status.DONE);
    clearSelectionIfBulkStatusLeavesTable(selectedClientIds, Status.DONE);
  }, [bulkUpdateStatus, clearSelectionIfBulkStatusLeavesTable, clientIdsToIds, selectedIds]);

  const handleBulkStatusChange = useCallback(
    (status: Status) => {
      const selectedClientIds = Array.from(selectedIds);
      const ids = clientIdsToIds(selectedClientIds);
      if (ids.length === 0) return;

      bulkUpdateStatus(ids, status);
      clearSelectionIfBulkStatusLeavesTable(selectedClientIds, status);
    },
    [bulkUpdateStatus, clearSelectionIfBulkStatusLeavesTable, clientIdsToIds, selectedIds]
  );

  const handleShortcutStatusChange = useCallback(
    (selectedClientIds: string[], status: Status) => {
      const ids = clientIdsToIds(selectedClientIds);
      if (ids.length === 0) return;

      bulkUpdateStatus(ids, status);
      clearSelectionIfBulkStatusLeavesTable(selectedClientIds, status);
    },
    [bulkUpdateStatus, clearSelectionIfBulkStatusLeavesTable, clientIdsToIds]
  );

  const handleBulkPriorityChange = useCallback(
    (priority: Priority) => {
      bulkUpdatePriority(clientIdsToIds(Array.from(selectedIds)), priority);
    },
    [bulkUpdatePriority, clientIdsToIds, selectedIds]
  );

  const handleBulkAssigneeChange = useCallback(
    (change: TaskAssigneeChange) => {
      bulkUpdateAssignee(clientIdsToIds(Array.from(selectedIds)), change);
    },
    [bulkUpdateAssignee, clientIdsToIds, selectedIds]
  );

  const handleBulkDueDateChange = useCallback(
    (dueDate: number | null) => {
      bulkUpdateDueDate(clientIdsToIds(Array.from(selectedIds)), dueDate);
    },
    [bulkUpdateDueDate, clientIdsToIds, selectedIds]
  );

  // No bulk label mutation: each task goes through the single-task update (docs/specs/task-bulk-actions.md).
  const handleBulkLabelChange = useCallback(
    (labelId: Id<"projectLabels"> | null) => {
      for (const id of clientIdsToIds(Array.from(selectedIds))) {
        updateTask(id, { labelId });
      }
    },
    [clientIdsToIds, selectedIds, updateTask]
  );

  const handleBulkTaskTypeChange = useCallback(
    (selectedClientIds: string[], taskTypeKey: string | null) => {
      const ids = clientIdsToIds(selectedClientIds);
      if (ids.length === 0) return;

      bulkUpdateTaskType(ids, taskTypeKey);
    },
    [bulkUpdateTaskType, clientIdsToIds]
  );

  const handleBulkArchive = useCallback(() => {
    const ids = clientIdsToIds(Array.from(selectedIds));
    if (ids.length === 0) return;

    bulkArchive(ids);
    clearSelection();
  }, [bulkArchive, clientIdsToIds, selectedIds, clearSelection]);

  const handleBulkUnarchive = useCallback(() => {
    if (!bulkUnarchive) return;

    const ids = clientIdsToIds(Array.from(selectedIds));
    if (ids.length === 0) return;

    bulkUnarchive(ids);
    clearSelection();
  }, [bulkUnarchive, clientIdsToIds, selectedIds, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    bulkDelete(clientIdsToIds(Array.from(selectedIds)));
  }, [bulkDelete, clientIdsToIds, selectedIds]);

  // Indent/Outdent handlers for Tab/Shift+Tab keyboard shortcuts
  // Helper: Get "root" selected tasks (tasks whose parent is NOT also selected)
  // This filters out nested selections - if B is selected and C (child of B) is selected,
  // only B is a "root" because C will move with B automatically
  const getRootSelectedTasks = useCallback(
    (clientIds: string[]) => {
      const selectedClientIds = new Set(clientIds);
      return clientIds
        .map((cid) => allTasks.find((t) => t.clientId === cid))
        .filter((task): task is Task => {
          if (!task) return false;
          // Include if parent is not selected (or has no parent)
          return !task.parentId || !allTasks.some((t) => t._id === task.parentId && selectedClientIds.has(t.clientId));
        });
    },
    [allTasks]
  );

  const handleMoveSelectedToList = useCallback(
    (listRef: string, sectionId?: Id<"taskSections">) => {
      if (!moveToList) return;

      const rootTasks = getRootSelectedTasks(Array.from(selectedIds));
      const rootIds = rootTasks.map((task) => String(task._id));
      if (rootIds.length === 0) return;

      moveToList(rootIds, listRef, sectionId);
      clearSelection();
    },
    [clearSelection, getRootSelectedTasks, moveToList, selectedIds]
  );

  const handleMoveClosedToBottom = useCallback(() => {
    if (!moveClosedToBottom) return;

    moveClosedToBottom(visibleTopLevelRoots.map((task) => String(task._id)));
  }, [moveClosedToBottom, visibleTopLevelRoots]);

  const canIndentByClientId = useCallback(
    (clientIds: string[]): boolean => {
      if (clientIds.length === 0) return false;

      const rootTasks = getRootSelectedTasks(clientIds);
      if (rootTasks.length === 0) return false;

      // All root tasks must share the same parent
      const firstParentId = rootTasks[0].parentId;
      if (!rootTasks.every((t) => t.parentId === firstParentId)) return false;

      // Get siblings sorted by rank
      const siblings = allTasks.filter((t) => t.parentId === firstParentId).sort((a, b) => a.rank.localeCompare(b.rank));

      // Find the first root task in sibling order
      const rootClientIds = new Set(rootTasks.map((t) => t.clientId));
      const firstSelectedIndex = siblings.findIndex((t) => rootClientIds.has(t.clientId));

      return firstSelectedIndex > 0; // Has a previous sibling
    },
    [allTasks, getRootSelectedTasks]
  );

  const canOutdentByClientId = useCallback(
    (clientIds: string[]): boolean => {
      if (clientIds.length === 0) return false;

      const rootTasks = getRootSelectedTasks(clientIds);
      if (rootTasks.length === 0) return false;

      // All root tasks must have a parent
      if (!rootTasks.every((t) => t.parentId)) return false;

      // All root tasks must share the same parent
      const firstParentId = rootTasks[0].parentId;
      return rootTasks.every((t) => t.parentId === firstParentId);
    },
    [getRootSelectedTasks]
  );

  const handleIndentByClientId = useCallback(
    (clientIds: string[]) => {
      if (clientIds.length === 0) return;

      const rootTasks = getRootSelectedTasks(clientIds);
      if (rootTasks.length === 0) return;

      const firstParentId = rootTasks[0].parentId;

      // Get siblings sorted by rank
      const siblings = allTasks.filter((t) => t.parentId === firstParentId).sort((a, b) => a.rank.localeCompare(b.rank));

      // Find previous sibling (before first root task)
      const rootClientIds = new Set(rootTasks.map((t) => t.clientId));
      const firstSelectedIndex = siblings.findIndex((t) => rootClientIds.has(t.clientId));
      if (firstSelectedIndex <= 0) return;

      const newParent = siblings[firstSelectedIndex - 1];

      // Move only root tasks - their children move with them automatically
      const taskIds = rootTasks.map((t) => t._id as string);
      setParentMultiple(taskIds, newParent._id as string);

      // Expand the new parent so the moved tasks remain visible
      setExpandedIds((prev) => {
        if (prev.has(newParent._id)) return prev;
        const next = new Set(prev);
        next.add(newParent._id);
        return next;
      });
    },
    [allTasks, getRootSelectedTasks, setParentMultiple, setExpandedIds]
  );

  const handleOutdentByClientId = useCallback(
    (clientIds: string[]) => {
      if (clientIds.length === 0) return;

      const rootTasks = getRootSelectedTasks(clientIds);
      if (rootTasks.length === 0) return;

      const parentId = rootTasks[0].parentId;
      if (!parentId) return;

      const parent = allTasks.find((t) => t._id === parentId);
      const grandparentId = parent?.parentId ?? null;

      // Move only root tasks - their children move with them automatically
      // Pass parentId as afterTaskId to position right after former parent
      const taskIds = rootTasks.map((t) => t._id as string);
      setParentMultiple(taskIds, grandparentId, parentId);
    },
    [allTasks, getRootSelectedTasks, setParentMultiple]
  );

  const navigateGroupedRows = useCallback((id: string, direction: "prev" | "next") => {
    if (!navigateGroups) return false;
    const targetId = navigateGroups(baseFlattenedTasks, id, direction);
    if (targetId) {
      setSelectedIds(new Set([targetId]));
      setLastSelectedId(targetId);
      setFocusRequest({ id: targetId });
    }
    return true;
  }, [navigateGroups, baseFlattenedTasks, setSelectedIds, setLastSelectedId]);

  // Backspace in an empty group "Add task..." input, matching the plain list.
  const focusPreviousGroupedRow = useCallback((id: string) => {
    const targetId = navigateGroups?.(baseFlattenedTasks, id, "prev");
    if (targetId) focusInput(targetId, "end");
  }, [navigateGroups, baseFlattenedTasks, focusInput]);

  // P/A/L/D/M open a picker under the first target row's cell; I assigns at once.
  const [propertyShortcut, setPropertyShortcut] = useState<TaskShortcutPickerRequest | null>(null);
  const closePropertyShortcut = useCallback(() => setPropertyShortcut(null), []);
  const handlePropertyShortcut = useCallback(
    (property: TaskPropertyShortcut, clientIds: string[]) => {
      const tasks = clientIds.flatMap((clientId) => {
        const task = taskByClientId.get(clientId);
        return task ? [task] : [];
      });
      if (tasks.length === 0) return;
      if (property === "assignToMe") {
        if (!currentUserId) return;
        for (const task of tasks) updateTask(task._id, { assigneeId: currentUserId as Id<"users"> });
        return;
      }
      const row = rowRefs.current.get(tasks[0].clientId);
      if (!row) return;
      // Open under the property's own cell; Move to List and hidden columns fall back to the row.
      const cell = property === "moveToList" ? null : row.querySelector<HTMLElement>(`[data-column-id="${property}"]`);
      setPropertyShortcut({ property, tasks, anchor: cell ?? row });
    },
    [currentUserId, taskByClientId, updateTask]
  );

  // Keyboard navigation
  const { shortcutPalette } = useKeyboardNavigation({
    taskIds,
    navigableIds,
    onNavigate: navigateGroups ? navigateGroupedRows : undefined,
    selectedIds,
    setSelectedIds,
    lastSelectedId,
    setLastSelectedId,
    focusInput,
    reorderTasks: handleReorderByClientId,
    inputRefs: inputRefs as RefObject<Map<string, HTMLInputElement>>,
    rowRefs,
    containerRef,
    enabled,
    canUpdateTask,
    onToggleStatus: handleToggleStatus,
    onSetStatus: handleShortcutStatusChange,
    onSetTaskType: handleBulkTaskTypeChange,
    allowedStatuses,
    onPropertyShortcut: handlePropertyShortcut,
    onDelete: handleBulkDelete,
    onClearSelection: clearSelection,
    onDuplicate: handleDuplicateByClientId,
    onOpenDetails,
    onToggleExpand: handleToggleExpandByClientId,
    canExpand: canExpandByClientId,
    isExpanded: isExpandedByClientId,
    addTaskInputRefs,
    onIndent: handleIndentByClientId,
    onOutdent: handleOutdentByClientId,
    canIndent: canIndentByClientId,
    canOutdent: canOutdentByClientId,
    onMoveAddTaskInputHierarchy: moveAddTaskInputHierarchy,
  });

  const commitAddTaskInputValue = useCallback(
    (addInputId: string, parentId?: string | null) => {
      const value = getAddTaskInputValue(addInputId).trim();
      if (value === "") {
        setRevealedChildlessAddParent(parentId, false);
        return;
      }

      const sectionName = addInputId === ADD_ROOT_INPUT_ID && onCreateSection ? parseSectionTitleForCreate(value) : null;
      if (sectionName) {
        onCreateSection?.(sectionName);
        setAddTaskInputValue(addInputId, "");
        return;
      }

      const filterDefaults = getFilterDefaultsFromFilters(statusFilter, assigneeFilter, currentUserId);
      const newTask = createDefaultTaskFromInput(value, filterDefaults);
      if (!newTask) {
        return;
      }

      addTask(newTask, { parentId: parentId ?? undefined });
      setAddTaskInputValue(addInputId, "");
    },
    [addTask, assigneeFilter, currentUserId, getAddTaskInputValue, onCreateSection, setRevealedChildlessAddParent, setAddTaskInputValue, statusFilter]
  );

  const handleAddTaskInputKeyDown = useCallback(
    (addInputId: string, parentId: string | null | undefined, e: React.KeyboardEvent<HTMLInputElement>) => {
      const value = getAddTaskInputValue(addInputId);

      if (e.key === "Backspace" && value === "") {
        e.preventDefault();
        const prevId = getPreviousTaskId(addInputId);
        if (prevId) {
          focusInput(prevId, "end");
        }
        return;
      }

      if (e.key === "Enter" && value !== "") {
        e.preventDefault();
        commitAddTaskInputValue(addInputId, parentId);
      }
    },
    [commitAddTaskInputValue, focusInput, getAddTaskInputValue, getPreviousTaskId]
  );

  const handleAddTaskInputBlur = useCallback(
    (addInputId: string, parentId?: string | null) => {
      if (skipNextAddInputBlurCommitRef.current.delete(addInputId)) {
        return;
      }

      commitAddTaskInputValue(addInputId, parentId);
    },
    [commitAddTaskInputValue]
  );

  const handleAddTaskKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      handleAddTaskInputKeyDown(ADD_ROOT_INPUT_ID, defaultParentId, e);
    },
    [defaultParentId, handleAddTaskInputKeyDown]
  );

  const handleAddTaskBlur = useCallback(() => {
    handleAddTaskInputBlur(ADD_ROOT_INPUT_ID, defaultParentId);
  }, [defaultParentId, handleAddTaskInputBlur]);

  return {
    // Filtered/derived data
    tasks,
    taskTree,
    flattenedTasks,
    taskIds,

    // Expansion (internal state)
    expandedIds,
    toggleExpanded,
    collapseAll,

    // Selection (from useTaskSelection)
    selectedIds,
    isBulkSelection,
    handleRowClick,
    handleSelectRow,
    handleContextMenuSelection,
    clearSelection,

    // Table state
    sorting,
    setSorting,
    rowSelection,
    setRowSelection,
    statusFilter,
    setStatusFilter,
    assigneeFilter,
    setAssigneeFilter,

    // Add task
    addTaskValue,
    setAddTaskValue,
    getAddTaskInputValue,
    setAddTaskInputValue,
    handleAddTaskKeyDown,
    handleAddTaskBlur,
    handleAddTaskInputKeyDown,
    handleAddTaskInputBlur,
    moveAddTaskInputHierarchy,

    // Inline draft
    inlineDraft,
    beginInlineTaskDraft,
    beginInlineTaskDraftAtTop,
    updateInlineTaskDraftValue,
    commitInlineTaskDraft,
    cancelInlineTaskDraft,

    // Bulk actions (pre-wired with clientId → _id conversion)
    handleBulkComplete,
    handleBulkStatusChange,
    handleBulkPriorityChange,
    handleBulkAssigneeChange,
    handleBulkDueDateChange,
    handleBulkLabelChange,
    handleBulkTaskTypeChange,
    handleBulkArchive,
    handleBulkUnarchive,
    handleMoveSelectedToList,
    handleMoveClosedToBottom,
    handleBulkDelete,
    shortcutPalette,
    propertyShortcut,
    handlePropertyShortcut,
    closePropertyShortcut,

    // DnD
    isDndEnabled,
    canUpdateTask,

    // Row registration
    registerRow,
    focusRequest,
    navigateRow: navigateGroupedRows,
    focusPreviousRow: focusPreviousGroupedRow,
    rowRefs,
    getAdjacentId,
    getPreviousTaskId,

    // Add-task input registration (for keyboard navigation)
    registerAddTaskInput,

    // Default parent for new tasks (from parentFilter)
    // Used by add-task input and passed to tableMeta
    defaultParentId,

    // Pass through for TaskTable component
    updateTask,
    deleteTask,
    archiveTask,
    unarchiveTask,
    addTask,
    reorderTasks,
    reorderMultiple,
    setParent,
    setParentMultiple,
    focusInput,
    // Cast to non-nullable for TaskTable compatibility
    inputRefs: inputRefs as RefObject<Map<string, HTMLInputElement>>,
    projectId,
    currentUserId,

    // Whether to show "add task" rows
    allowAddTask,
  };
}
