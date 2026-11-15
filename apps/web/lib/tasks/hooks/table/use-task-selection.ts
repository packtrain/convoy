import { useState, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { isTaskTableInteractiveTarget } from "@/lib/tasks/table-interaction";

// Selection can be: single item, array of items, or range (start + end)
export type Selection =
  | { type: "single"; id: string }
  | { type: "array"; ids: string[] }
  | { type: "range"; start: string; end: string }
  | null;

interface UseTaskSelectionOptions {
  taskIds: string[];
  onOpenDetails?: (taskId: string) => void;
  /** When true, clicking the task name input opens the details panel. Defaults to false so inline title editing keeps focus. */
  openDetailsOnNameClick?: boolean;
}

// `bulk` marks a single task picked with a modifier click, which keeps the
// bulk toolbar open (docs/specs/task-bulk-actions.md).
type InternalSelection =
  | { kind: "single"; id: string; bulk?: boolean }
  | { kind: "multi"; ids: string[]; anchor: string; mode: "array" | "range" }
  | null;

interface NormalizedSelection {
  internalSelection: InternalSelection;
  selection: Selection;
  selectedIds: Set<string>;
  anchor: string | null;
}

function buildRangeIds(start: string, end: string, taskIds: string[]): string[] {
  const startIdx = taskIds.indexOf(start);
  const endIdx = taskIds.indexOf(end);

  if (startIdx === -1 || endIdx === -1) {
    return [];
  }

  const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  return taskIds.slice(from, to + 1);
}

function moveAnchorToFront(ids: string[], anchor: string): string[] {
  if (!ids.includes(anchor)) {
    return ids;
  }

  return [anchor, ...ids.filter((id) => id !== anchor)];
}

function getInternalAnchor(selection: InternalSelection): string | null {
  if (!selection) return null;
  if (selection.kind === "single") return selection.id;
  return selection.anchor;
}

function normalizeInternalSelection(
  selection: InternalSelection,
  taskIds: string[]
): InternalSelection {
  if (!selection) {
    return null;
  }

  const visibleIds = new Set(taskIds);

  if (selection.kind === "single") {
    return visibleIds.has(selection.id) ? selection : null;
  }

  const ids = selection.ids.filter((id) => visibleIds.has(id));
  if (ids.length === 0) {
    return null;
  }

  if (ids.length === 1) {
    return { kind: "single", id: ids[0], bulk: true };
  }

  const anchor = ids.includes(selection.anchor) ? selection.anchor : ids[0];
  return {
    kind: "multi",
    ids: moveAnchorToFront(ids, anchor),
    anchor,
    mode: selection.mode,
  };
}

function toPublicSelection(selection: InternalSelection): Selection {
  if (!selection) {
    return null;
  }

  if (selection.kind === "single") {
    return { type: "single", id: selection.id };
  }

  return { type: "array", ids: selection.ids };
}

export function useTaskSelection({ taskIds, onOpenDetails, openDetailsOnNameClick = false }: UseTaskSelectionOptions) {
  const [selection, setSelection] = useState<InternalSelection>(null);

  // Ref to avoid stale closures in memoized row callbacks
  const selectionRef = useRef<InternalSelection>(selection);
  const taskIdsRef = useRef(taskIds);
  const onOpenDetailsRef = useRef(onOpenDetails);
  const openDetailsOnNameClickRef = useRef(openDetailsOnNameClick);

  const normalizedSelection = useMemo<NormalizedSelection>(() => {
    const internalSelection = normalizeInternalSelection(selection, taskIds);
    if (!internalSelection) {
      return {
        internalSelection: null,
        selection: null,
        selectedIds: new Set<string>(),
        anchor: null,
      };
    }

    if (internalSelection.kind === "single") {
      return {
        internalSelection,
        selection: { type: "single", id: internalSelection.id },
        selectedIds: new Set([internalSelection.id]),
        anchor: internalSelection.id,
      };
    }

    return {
      internalSelection,
      selection: toPublicSelection(internalSelection),
      selectedIds: new Set(internalSelection.ids),
      anchor: internalSelection.anchor,
    };
  }, [selection, taskIds]);

  // Memoized rows can hold these handlers across renders; sync refs before
  // the next browser event so those handlers observe the latest committed state.
  useLayoutEffect(() => {
    selectionRef.current = normalizedSelection.internalSelection;
    taskIdsRef.current = taskIds;
    onOpenDetailsRef.current = onOpenDetails;
    openDetailsOnNameClickRef.current = openDetailsOnNameClick;
  }, [
    normalizedSelection.internalSelection,
    onOpenDetails,
    openDetailsOnNameClick,
    taskIds,
  ]);

  const selectedIds = normalizedSelection.selectedIds;
  const lastSelectedId = normalizedSelection.anchor;
  const internal = normalizedSelection.internalSelection;
  const isBulkSelection = internal?.kind === "multi" || (internal?.kind === "single" && internal.bulk === true);

  // Wrapper for keyboard navigation compatibility
  // Note: This doesn't change the anchor - it preserves range selection behavior
  const setSelectedIds = useCallback((ids: Set<string>) => {
    const nextIds = Array.from(ids);

    if (nextIds.length === 0) {
      setSelection(null);
      return;
    }

    if (nextIds.length === 1) {
      setSelection({ kind: "single", id: nextIds[0] });
      return;
    }

    const anchor = getInternalAnchor(selectionRef.current) ?? nextIds[0];
    setSelection({
      kind: "multi",
      ids: moveAnchorToFront(nextIds, anchor),
      anchor,
      mode: "array",
    });
  }, []);

  // Set the anchor point for range selection
  const setLastSelectedId = useCallback((id: string | null) => {
    if (!id) return;

    setSelection((currentSelection) => {
      if (!currentSelection) {
        return { kind: "single", id };
      }

      if (currentSelection.kind === "single") {
        return currentSelection.id === id ? currentSelection : { kind: "single", id };
      }

      if (!currentSelection.ids.includes(id)) {
        return { kind: "single", id };
      }

      return {
        ...currentSelection,
        anchor: id,
        ids: moveAnchorToFront(currentSelection.ids, id),
      };
    });
  }, []);

  // Core selection logic based on selection type (uses ref to avoid stale closures)
  const handleSelection = useCallback((taskId: string, isMeta: boolean, isShift: boolean) => {
    const currentSelection = selectionRef.current;
    const currentTaskIds = taskIdsRef.current;

    if (isShift) {
      // Shift+click: create or update range
      // Note: anchor is NOT changed during shift operations
      if (!currentSelection) {
        // No selection yet - create single and set anchor
        setSelection({ kind: "single", id: taskId, bulk: true });
        return;
      }

      if (currentSelection.kind === "multi" && currentSelection.mode === "array") {
        // Array → reset to single
        setSelection({ kind: "single", id: taskId, bulk: true });
        return;
      }

      const anchor = getInternalAnchor(currentSelection) ?? taskId;
      const rangeIds = buildRangeIds(anchor, taskId, currentTaskIds);

      if (rangeIds.length <= 1) {
        setSelection({ kind: "single", id: taskId, bulk: true });
        return;
      }

      setSelection({
        kind: "multi",
        ids: moveAnchorToFront(rangeIds, anchor),
        anchor,
        mode: "range",
      });
      return;
    }

    if (isMeta) {
      // Cmd+click: add to array or toggle
      if (!currentSelection) {
        // No selection yet - create single
        setSelection({ kind: "single", id: taskId, bulk: true });
        return;
      }

      if (currentSelection.kind === "single") {
        if (currentSelection.id === taskId) {
          // Clicking same item - deselect
          setSelection(null);
        } else {
          // Single → Array
          setSelection({
            kind: "multi",
            ids: [currentSelection.id, taskId],
            anchor: currentSelection.id,
            mode: "array",
          });
        }
        return;
      }

      const newIds = currentSelection.ids.includes(taskId)
        ? currentSelection.ids.filter((id) => id !== taskId)
        : [...currentSelection.ids, taskId];

      if (newIds.length === 0) {
        setSelection(null);
      } else if (newIds.length === 1) {
        setSelection({ kind: "single", id: newIds[0], bulk: true });
      } else {
        const anchor = newIds.includes(currentSelection.anchor)
          ? currentSelection.anchor
          : newIds[0];
        setSelection({
          kind: "multi",
          ids: moveAnchorToFront(newIds, anchor),
          anchor,
          mode: "array",
        });
      }
      return;
    }

    // Normal click - always single select
    setSelection({ kind: "single", id: taskId });
  }, []);

  // Row click handler - selection always happens, details panel conditionally
  const handleRowClick = useCallback((e: React.MouseEvent, taskId: string) => {
    const target = e.target as HTMLElement;
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;
    const isTaskNameInput = Boolean(target.closest("[data-task-input]"));

    const isInteractive = isTaskTableInteractiveTarget(target);
    const shouldOpenDetails =
      !isMeta &&
      !isShift &&
      (!isInteractive ||
        (isTaskNameInput && openDetailsOnNameClickRef.current));

    // Always handle selection
    handleSelection(taskId, isMeta, isShift);

    // Only open details panel on normal click (no modifier keys)
    // and not on interactive elements, except task name input clicks.
    if (shouldOpenDetails) {
      onOpenDetailsRef.current?.(taskId);
    }
  }, [handleSelection]);

  // Select row (for drag handle) - same selection logic, never opens details
  const handleSelectRow = useCallback((e: React.MouseEvent, taskId: string) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;
    handleSelection(taskId, isMeta, isShift);
  }, [handleSelection]);

  const handleContextMenuSelection = useCallback((taskId: string) => {
    const currentSelection = selectionRef.current;

    if (currentSelection?.kind === "single" && currentSelection.id === taskId) {
      return;
    }

    if (currentSelection?.kind === "multi" && currentSelection.ids.includes(taskId)) {
      return;
    }

    setSelection({ kind: "single", id: taskId });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  return {
    // Selection state
    selection: normalizedSelection.selection,
    selectedIds,
    lastSelectedId,
    /** True when the bulk toolbar should show: 2+ tasks, or 1 picked with a modifier click. */
    isBulkSelection,

    // Handlers
    handleRowClick,
    handleSelectRow,
    handleContextMenuSelection,
    clearSelection,

    // For keyboard navigation compatibility
    setSelectedIds,
    setLastSelectedId,
  };
}
