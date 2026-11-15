import { getTaskGroupTarget } from "@/lib/tasks/types";
import { useCallback, useRef, useState, useEffect, RefObject } from "react";
import type {
  ReorderMultipleFn,
  ReorderTasksFn,
  Task,
  TaskTreeNode,
} from "@/lib/tasks/types";
import { getDescendantIds } from "@/lib/tasks/tree";
import { getRootDragTasks, setTaskDragPayload } from "@/lib/tasks/task-drag";
import { dragHasResource } from "@/lib/tasks/resource-drag";
import { isTaskTableInteractiveTarget } from "@/lib/tasks/table-interaction";
import { isTaskFieldDragTarget } from "@/lib/tasks/hooks/use-task-field-menu";
import type { ResourceDropHandlers } from "@/components/blocks/tasks/use-resource-task-drop";

const SCROLL_ZONE = 80; // pixels from edge to trigger scroll
const SCROLL_SPEED = 15; // pixels per frame
const MOBILE_LONG_PRESS_DELAY = 450;
const MOBILE_LONG_PRESS_MOVE_TOLERANCE = 8;
const MOBILE_CONTEXT_MENU_SUPPRESS_MS = 1500;
const MOBILE_VIEWPORT_WIDTH = 768;

type DropPosition = {
  targetId: string;
  position: "before" | "inside" | "after";
} | null;

export type GroupDropHandler = (ids: string[], targetId: string, position: "before" | "after" | "inside") => boolean;

interface UseTableDndOptions {
  onGroupDrop?: GroupDropHandler;
  tasks: Task[];
  taskTree: TaskTreeNode[];
  selectedIds: Set<string>;
  isDndEnabled: boolean;
  // When set, drag starts also write a cross-surface task drag payload so
  // drop targets outside the table (e.g. sidebar Lists) can accept the drag.
  projectId?: string;
  // Injected so rows can also accept resource drags (artifacts, attachments)
  // from the task details Resources section (OS-1711) without this controller
  // reaching Convex.
  resourceDrop?: ResourceDropHandlers;
  reorderTasks: ReorderTasksFn;
  reorderMultiple: ReorderMultipleFn;
  setParent: (id: string, parentId: string | null, rank?: string) => void;
  setParentMultiple: (ids: string[], parentId: string | null) => void;
}

interface UseTableDndReturn {
  draggedId: string | null;
  dropPosition: DropPosition;
  dragImageRef: RefObject<HTMLDivElement | null>;
  setDropPosition: (pos: DropPosition) => void;
  handleDragStart: (e: React.DragEvent, id: string) => void;
  handleDragOver: (e: React.DragEvent, id: string) => void;
  handleContainerDragOver: (e: React.DragEvent, container: HTMLElement | null) => void;
  handleContainerDrop: (e: React.DragEvent) => void;
  handleDragEnd: () => void;
  handleDrop: (e: React.DragEvent, targetId: string) => void;
  handleMobileDragPointerDown: (e: React.PointerEvent, id: string) => void;
  handleMobileContextMenu: (e: React.MouseEvent) => void;
  shouldSuppressNextClick: () => boolean;
}

type MobileDragState = {
  sourceClientId: string;
  isMultiSelect: boolean;
  startX: number;
  startY: number;
  pointerId: number;
  phase: "pending" | "active";
  timerId: number;
};

function isMobileDragExcludedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  // Task-field selector triggers defer their menu open to a quick tap
  // (use-task-field-menu), so a long-press on them starts a row drag
  // (OS-1381).
  if (isTaskFieldDragTarget(target)) {
    return false;
  }

  // A mobile card's title button opens details on tap but stays a grab surface.
  return isTaskTableInteractiveTarget(target, { allowTaskNameInputDrag: true, allowTaskCardBodyDrag: true });
}

function getRowDropPosition(element: Element, clientY: number): "before" | "inside" | "after" {
  const rect = element.getBoundingClientRect();
  const y = clientY - rect.top;
  const height = rect.height;

  if (y < height * 0.25) {
    return "before";
  }

  if (y > height * 0.75) {
    return "after";
  }

  return "inside";
}

function isRowOrAddTaskDropTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("[data-task-row-id], [data-task-add-row-id], [data-task-group-id]"))
  );
}

// Environment-level check (media query / viewport) for blanket context-menu
// suppression. Drag initiation uses event-level e.pointerType === "mouse"
// instead, so the two heuristics intentionally differ: pointerType gates per-
// event behavior while this function gates the ambient "is mobile" decision.
function isMobileContextMenuEnvironment(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia?.("(pointer: coarse)").matches ||
    window.innerWidth < MOBILE_VIEWPORT_WIDTH
  );
}

export function useTableDnd({
  tasks,
  onGroupDrop,
  taskTree,
  selectedIds,
  isDndEnabled,
  projectId,
  resourceDrop,
  reorderTasks,
  reorderMultiple,
  setParent,
  setParentMultiple,
}: UseTableDndOptions): UseTableDndReturn {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition>(null);
  const dragImageRef = useRef<HTMLDivElement>(null);
  const mobileDragRef = useRef<MobileDragState | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressMobileContextMenuUntilRef = useRef(0);
  const removeMobileListenersRef = useRef<(() => void) | null>(null);
  const removeSelectStartRef = useRef<(() => void) | null>(null);
  const dropPositionRef = useRef<DropPosition>(dropPosition);
  const tasksRef = useRef(tasks);
  const applyDropRef = useRef<
    (
      sourceClientId: string,
      isMultiSelect: boolean,
      targetClientId: string,
      currentDropPosition: DropPosition
    ) => void
  >(() => {});

  useEffect(() => {
    dropPositionRef.current = dropPosition;
  }, [dropPosition]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Keep a ref to taskTree to avoid stale closures
  const taskTreeRef = useRef(taskTree);
  useEffect(() => {
    taskTreeRef.current = taskTree;
  }, [taskTree]);

  // Keep a ref to selectedIds to avoid stale closures in drag handlers
  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const clearMobileDrag = useCallback(() => {
    const mobileDrag = mobileDragRef.current;
    if (mobileDrag) {
      window.clearTimeout(mobileDrag.timerId);
    }

    removeSelectStartRef.current?.();
    removeSelectStartRef.current = null;
    removeMobileListenersRef.current?.();
    removeMobileListenersRef.current = null;
    mobileDragRef.current = null;
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      if (!isDndEnabled) {
        e.preventDefault();
        return;
      }
      setDraggedId(id);
      e.dataTransfer.effectAllowed = "move";

      // Use ref to get current selectedIds (avoids stale closure)
      const currentSelectedIds = selectedIdsRef.current;
      const isMultiSelect = currentSelectedIds.has(id) && currentSelectedIds.size > 1;
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.setData("application/x-multi-select", isMultiSelect ? "true" : "false");

      // Cross-surface payload for drop targets outside the table (OS-979)
      if (projectId) {
        const draggedClientIds = isMultiSelect
          ? currentSelectedIds
          : new Set([id]);
        const rootTasks = getRootDragTasks(tasks, draggedClientIds);
        if (rootTasks.length > 0) {
          setTaskDragPayload(e.dataTransfer, {
            projectId,
            taskIds: rootTasks.map((task) => String(task._id)),
            taskRefIds: rootTasks.map((task) => task.refId),
          });
        }
      }

      // Custom drag image
      if (dragImageRef.current) {
        // id is now clientId
        const task = tasks.find((t) => t.clientId === id);
        if (task && dragImageRef.current) {
          if (isMultiSelect) {
            dragImageRef.current.textContent = `${currentSelectedIds.size} tasks`;
          } else {
            dragImageRef.current.textContent = task.name;
          }
          e.dataTransfer.setDragImage(dragImageRef.current, 0, 0);
        }
      }
    },
    [tasks, isDndEnabled, projectId]
  );

  // Check if a drop would create a circular reference
  const isValidDropTarget = useCallback(
    (sourceClientId: string, targetClientId: string, position: "before" | "inside" | "after"): boolean => {
      // Can't drop onto self
      if (sourceClientId === targetClientId) return false;

      // For "inside" drops, check if target is a descendant of source (would create cycle)
      if (position === "inside") {
        const sourceTask = tasks.find((t) => t.clientId === sourceClientId);
        const targetTask = tasks.find((t) => t.clientId === targetClientId);
        if (!sourceTask || !targetTask) return false;

        // Get all descendants of the source task
        const sourceDescendants = getDescendantIds(sourceTask._id, taskTreeRef.current);
        // Target can't be a descendant of source
        if (sourceDescendants.includes(targetTask._id)) return false;
      }

      return true;
    },
    [tasks]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault();

      if (dragHasResource(e.dataTransfer)) {
        // A resource drops *into* a task, never between two rows. One from
        // another project is refused outright rather than offered a reorder.
        const accepted = !getTaskGroupTarget(id) && (resourceDrop?.hasResourceDrag(e.dataTransfer) ?? false);
        e.dataTransfer.dropEffect = accepted ? "move" : "none";
        setDropPosition(accepted ? { targetId: id, position: "inside" } : null);
        return;
      }
      // Only this table's task rows reorder here; other drags (sections) get no line.
      if (!e.dataTransfer.types.includes("application/x-multi-select")) {
        e.dataTransfer.dropEffect = "none";
        setDropPosition(null);
        return;
      }

      e.dataTransfer.dropEffect = "move";
      setDropPosition({
        targetId: id,
        position: getRowDropPosition(e.currentTarget, e.clientY),
      });
    },
    [resourceDrop]
  );

  const scrollContainerForPoint = useCallback(
    (clientY: number, container: HTMLElement | null) => {
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;

      if (y < SCROLL_ZONE) {
        const intensity = 1 - y / SCROLL_ZONE;
        container.scrollTop += -SCROLL_SPEED * intensity;
      } else if (y > rect.height - SCROLL_ZONE) {
        const intensity = 1 - (rect.height - y) / SCROLL_ZONE;
        container.scrollTop += SCROLL_SPEED * intensity;
      }
    },
    []
  );

  const handleContainerDragOver = useCallback(
    (e: React.DragEvent, container: HTMLElement | null) => {
      e.preventDefault();
      if (!container || !draggedId) return;
      scrollContainerForPoint(e.clientY, container);
    },
    [draggedId, scrollContainerForPoint]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropPosition(null);
    clearMobileDrag();
  }, [clearMobileDrag]);

  // Helper to convert clientId to _id for server mutations
  const clientIdToId = useCallback(
    (clientId: string): string => {
      // add-* targets are special (add-root, add-{parentId}) - pass through as-is
      if (clientId.startsWith("add-")) return clientId;
      const task = tasks.find((t) => t.clientId === clientId);
      return task ? (task._id as string) : clientId;
    },
    [tasks]
  );

  const applyDrop = useCallback(
    (
      sourceClientId: string,
      isMultiSelect: boolean,
      targetClientId: string,
      currentDropPosition: DropPosition
    ) => {
      if (!isDndEnabled) {
        setDraggedId(null);
        setDropPosition(null);
        return;
      }
      if (onGroupDrop?.(isMultiSelect ? [...selectedIdsRef.current] : [sourceClientId], targetClientId, currentDropPosition?.position ?? "before")) {
        setDraggedId(null);
        setDropPosition(null);
        return;
      }
      // Check if target is an add-task row (add-root or add-{parentId})
      const isAddTaskTarget = targetClientId.startsWith("add-");

      // Allow add-* targets and prevent drop on self
      if (!sourceClientId || (sourceClientId === targetClientId && !isAddTaskTarget)) {
        setDraggedId(null);
        setDropPosition(null);
        return;
      }

      // Validate drop target for circular reference prevention (skip for add-task targets)
      if (!isAddTaskTarget && currentDropPosition && !isValidDropTarget(sourceClientId, targetClientId, currentDropPosition.position)) {
        setDraggedId(null);
        setDropPosition(null);
        return;
      }

      // Use ref to get current selectedIds (avoids stale closure)
      const currentSelectedIds = selectedIdsRef.current;

      // Handle dropping onto add-task rows (add-root or add-{parentId})
      if (isAddTaskTarget) {
        // Extract parentId: "add-root" → null, "add-{id}" → id
        const parentId = targetClientId === "add-root" ? null : targetClientId.slice(4);
        if (isMultiSelect && currentSelectedIds.size > 1) {
          const selectedIds = Array.from(currentSelectedIds).map(clientIdToId);
          setParentMultiple(selectedIds, parentId);
        } else {
          const sourceId = clientIdToId(sourceClientId);
          setParent(sourceId, parentId);
        }
        setDraggedId(null);
        setDropPosition(null);
        return;
      }

      // Convert clientIds to _ids for server mutations
      const targetId = clientIdToId(targetClientId);
      const targetTask = tasks.find((t) => t.clientId === targetClientId);

      const position = currentDropPosition?.position || "before";

      if (position === "inside") {
        // Make dragged task(s) children of target
        if (isMultiSelect && currentSelectedIds.size > 1) {
          const selectedIds = Array.from(currentSelectedIds).map(clientIdToId);
          setParentMultiple(selectedIds, targetId);
        } else {
          const sourceId = clientIdToId(sourceClientId);
          setParent(sourceId, targetId);
        }
      } else {
        // Reorder: determine new parent based on target's parent
        // When dropping before/after, the dragged item becomes a sibling of target
        const newParentId = targetTask?.parentId || null;

        // Pass the drop target and position straight through: resolving the true neighbor (and any
        // append-to-end) happens in reorderTasks/reorderMultiple against the full sibling list, so
        // filtered rows can't skew the insertion point. `position` is already narrowed here.
        const resolvedPosition = position;

        if (isMultiSelect && currentSelectedIds.size > 1) {
          const selectedIds = Array.from(currentSelectedIds).map(clientIdToId);
          // First set parent for all items (they become siblings of target)
          // Then reorder them to the correct position
          setParentMultiple(selectedIds, newParentId);
          // Note: reorderMultiple handles positioning with target's parent context
          reorderMultiple(selectedIds, targetId, newParentId, resolvedPosition);
        } else {
          const sourceId = clientIdToId(sourceClientId);
          const sourceTask = tasks.find((t) => t.clientId === sourceClientId);

          // Check if parent is changing
          if (sourceTask && sourceTask.parentId !== newParentId) {
            // Parent is changing - use setParent which handles rank calculation
            setParent(sourceId, newParentId);
          }
          // Reorder to position with target's parent context
          reorderTasks(sourceId, targetId, newParentId, resolvedPosition);
        }
      }

      setDraggedId(null);
      setDropPosition(null);
    },
    [onGroupDrop, isDndEnabled, reorderTasks, reorderMultiple, setParent, setParentMultiple, clientIdToId, tasks, isValidDropTarget]
  );

  useEffect(() => {
    applyDropRef.current = applyDrop;
  }, [applyDrop]);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetClientId: string) => {
      e.preventDefault();
      if (resourceDrop?.hasResourceDrag(e.dataTransfer)) {
        setDropPosition(null);
        // add-* rows are not tasks, so there is nothing to move into.
        if (!targetClientId.startsWith("add-") && !getTaskGroupTarget(targetClientId)) {
          resourceDrop.dropResource(e.dataTransfer, clientIdToId(targetClientId));
        }
        return;
      }
      const sourceClientId = e.dataTransfer.getData("text/plain");
      const isMultiSelect = e.dataTransfer.getData("application/x-multi-select") === "true";
      applyDrop(sourceClientId, isMultiSelect, targetClientId, dropPosition);
    },
    [applyDrop, resourceDrop, clientIdToId, dropPosition]
  );


  const getAmbientTopDropPosition = useCallback(() => {
    const currentDropPosition = dropPositionRef.current;
    const firstTaskClientId = tasksRef.current[0]?.clientId;

    if (
      currentDropPosition &&
      currentDropPosition.position === "before" &&
      firstTaskClientId &&
      currentDropPosition.targetId === firstTaskClientId
    ) {
      return currentDropPosition;
    }

    return null;
  }, []);

  const tryAmbientTopDrop = useCallback(
    (
      target: EventTarget | null,
      dataTransfer: DataTransfer | null,
      options: { resetOnInvalid: boolean } = { resetOnInvalid: false }
    ) => {
      if (isRowOrAddTaskDropTarget(target)) {
        return false;
      }

      const ambientTopDropPosition = getAmbientTopDropPosition();
      if (!ambientTopDropPosition || !dataTransfer) {
        if (options.resetOnInvalid) {
          setDraggedId(null);
          setDropPosition(null);
        }
        return false;
      }

      const sourceClientId = dataTransfer.getData("text/plain");
      const isMultiSelect = dataTransfer.getData("application/x-multi-select") === "true";
      applyDropRef.current(
        sourceClientId,
        isMultiSelect,
        ambientTopDropPosition.targetId,
        ambientTopDropPosition
      );
      return true;
    },
    [getAmbientTopDropPosition]
  );

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      // Stop here so the document-level drop listener does not re-apply this drop.
      e.stopPropagation();

      tryAmbientTopDrop(e.target, e.dataTransfer, {
        resetOnInvalid: true,
      });
    },
    [tryAmbientTopDrop]
  );

  useEffect(() => {
    if (!draggedId) {
      return;
    }

    const handleDocumentDragOver = (event: DragEvent) => {
      if (isRowOrAddTaskDropTarget(event.target)) {
        return;
      }

      if (!getAmbientTopDropPosition()) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    };

    const handleDocumentDrop = (event: DragEvent) => {
      if (!tryAmbientTopDrop(event.target, event.dataTransfer)) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener("dragover", handleDocumentDragOver);
    document.addEventListener("drop", handleDocumentDrop);

    return () => {
      document.removeEventListener("dragover", handleDocumentDragOver);
      document.removeEventListener("drop", handleDocumentDrop);
    };
  }, [draggedId, getAmbientTopDropPosition, tryAmbientTopDrop]);

  // The other half of the same rule, for the `!draggedId` case: an external
  // resource drag ends on its source pill, so `handleDragEnd` never fires here
  // and the row highlight has to be cleared from the document. Guarded on
  // `draggedId` only — the position is read through its ref so hovering from row
  // to row doesn't re-register the listeners.
  useEffect(() => {
    if (draggedId) {
      return;
    }

    const clear = () => {
      if (dropPositionRef.current) {
        setDropPosition(null);
      }
    };
    document.addEventListener("dragend", clear);
    document.addEventListener("drop", clear);

    return () => {
      document.removeEventListener("dragend", clear);
      document.removeEventListener("drop", clear);
    };
  }, [draggedId]);

  const getDropPositionFromPoint = useCallback(
    (clientX: number, clientY: number): DropPosition => {
      const element = document.elementFromPoint(clientX, clientY);
      if (!element) {
        return null;
      }

      const groupTarget = element.closest<HTMLElement>("[data-task-group-id]");
      if (groupTarget?.dataset.taskGroupId) return { targetId: groupTarget.dataset.taskGroupId, position: "before" };
      const addTaskTarget = element.closest("[data-task-add-row-id]");
      if (addTaskTarget instanceof HTMLElement) {
        const targetId = addTaskTarget.dataset.taskAddRowId;
        if (!targetId) {
          return null;
        }

        return {
          targetId,
          position: "before",
        };
      }

      const rowTarget = element.closest("[data-task-row-id]");
      if (rowTarget instanceof HTMLElement) {
        const targetId = rowTarget.dataset.taskRowId;
        if (!targetId) {
          return null;
        }

        return {
          targetId,
          position: getRowDropPosition(rowTarget, clientY),
        };
      }

      return null;
    },
    []
  );

  const shouldSuppressNextClick = useCallback(() => {
    if (!suppressNextClickRef.current) {
      return false;
    }

    suppressNextClickRef.current = false;
    return true;
  }, []);

  const handleMobileDragPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!isDndEnabled || e.pointerType === "mouse" || !e.isPrimary) {
        return;
      }

      if (isMobileDragExcludedTarget(e.target)) {
        return;
      }

      clearMobileDrag();
      suppressMobileContextMenuUntilRef.current =
        Date.now() + MOBILE_CONTEXT_MENU_SUPPRESS_MS;

      const currentSelectedIds = selectedIdsRef.current;
      const isMultiSelect = currentSelectedIds.has(id) && currentSelectedIds.size > 1;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;

      const preventSelectStart = (event: Event) => event.preventDefault();
      document.addEventListener("selectstart", preventSelectStart);
      removeSelectStartRef.current = () =>
        document.removeEventListener("selectstart", preventSelectStart);

      const timerId = window.setTimeout(() => {
        const mobileDrag = mobileDragRef.current;
        if (!mobileDrag || mobileDrag.pointerId !== pointerId) {
          return;
        }

        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        window.getSelection()?.removeAllRanges();

        mobileDragRef.current = {
          ...mobileDrag,
          phase: "active",
        };
        suppressNextClickRef.current = true;
        setDraggedId(id);
      }, MOBILE_LONG_PRESS_DELAY);

      mobileDragRef.current = {
        sourceClientId: id,
        isMultiSelect,
        startX,
        startY,
        pointerId,
        phase: "pending",
        timerId,
      };

      // Non-passive touchmove prevents scrolling during active drag phase.
      // Registered at pointerdown so the compositor knows about it for the
      // entire touch sequence; during pending phase it does not preventDefault,
      // so the browser still scrolls normally.
      const handleTouchMove = (event: TouchEvent) => {
        if (mobileDragRef.current?.phase === "active") {
          event.preventDefault();
        }
      };

      const handlePointerMove = (event: PointerEvent) => {
        const mobileDrag = mobileDragRef.current;
        if (!mobileDrag || event.pointerId !== mobileDrag.pointerId) {
          return;
        }

        const distance = Math.hypot(
          event.clientX - mobileDrag.startX,
          event.clientY - mobileDrag.startY
        );

        if (mobileDrag.phase === "pending") {
          if (distance > MOBILE_LONG_PRESS_MOVE_TOLERANCE) {
            suppressMobileContextMenuUntilRef.current = 0;
            clearMobileDrag();
          }
          return;
        }

        const eventTarget = event.target;
        const scrollContainer =
          eventTarget instanceof HTMLElement
            ? eventTarget.closest<HTMLElement>("[data-task-table-scroll-container]")
            : document.querySelector<HTMLElement>("[data-task-table-scroll-container]");
        scrollContainerForPoint(
          event.clientY,
          scrollContainer
        );
        setDropPosition(getDropPositionFromPoint(event.clientX, event.clientY));
      };

      const handlePointerUp = (event: PointerEvent) => {
        const mobileDrag = mobileDragRef.current;
        if (!mobileDrag || event.pointerId !== mobileDrag.pointerId) {
          return;
        }

        if (mobileDrag.phase === "active") {
          const finalDropPosition = getDropPositionFromPoint(event.clientX, event.clientY);
          if (finalDropPosition) {
            // Latest callback: write access can be lost mid-gesture.
            applyDropRef.current(
              mobileDrag.sourceClientId,
              mobileDrag.isMultiSelect,
              finalDropPosition.targetId,
              finalDropPosition
            );
          } else {
            setDraggedId(null);
            setDropPosition(null);
          }
        }

        clearMobileDrag();
      };

      const handlePointerCancel = (event: PointerEvent) => {
        const mobileDrag = mobileDragRef.current;
        if (!mobileDrag || event.pointerId !== mobileDrag.pointerId) {
          return;
        }

        setDraggedId(null);
        setDropPosition(null);
        clearMobileDrag();
      };

      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      removeMobileListenersRef.current = () => {
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
      };
    },
    [
      clearMobileDrag,
      getDropPositionFromPoint,
      isDndEnabled,
      scrollContainerForPoint,
    ]
  );

  const handleMobileContextMenu = useCallback((e: React.MouseEvent) => {
    if (isMobileDragExcludedTarget(e.target)) {
      return;
    }

    if (isMobileContextMenuEnvironment()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const hasActiveMobileDrag = mobileDragRef.current?.phase === "active";
    const isRecentMobileLongPressCandidate =
      suppressMobileContextMenuUntilRef.current > Date.now();

    if (!hasActiveMobileDrag && !isRecentMobileLongPressCandidate) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
  }, []);

  useEffect(() => clearMobileDrag, [clearMobileDrag]);

  return {
    draggedId,
    dropPosition,
    dragImageRef,
    setDropPosition,
    handleDragStart,
    handleDragOver,
    handleContainerDragOver,
    handleContainerDrop,
    handleDragEnd,
    handleDrop,
    handleMobileDragPointerDown,
    handleMobileContextMenu,
    shouldSuppressNextClick,
  };
}
