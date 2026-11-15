import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { isTaskSectionRow, type FlattenedRow, type TaskSectionRow } from "@/lib/tasks/types";
import { ROW_HEIGHT } from "../task-row";

export function getRowHeight(row: FlattenedRow | TaskSectionRow | undefined): number {
  return row && isTaskSectionRow(row) && row.height ? row.height : ROW_HEIGHT;
}

export function useTaskTableVirtualizer(
  tasks: (FlattenedRow | TaskSectionRow)[],
  count: number,
  parentRef: RefObject<HTMLDivElement | null>,
  hasSectionRows: boolean,
  focusRequest?: { id: string; focus?: boolean }
) {
  const getItemKey = useCallback((index: number) => tasks[index]?.clientId ?? index, [tasks]);
  const estimateSize = useCallback((index: number) => getRowHeight(tasks[index]), [tasks]);
  const getScrollElement = useCallback(() => parentRef.current, [parentRef]);
  const virtualizer = useVirtualizer({
    count,
    getItemKey,
    getScrollElement,
    estimateSize,
    overscan: 10,
    useFlushSync: false,
    scrollPaddingStart: ROW_HEIGHT,
    scrollPaddingEnd: ROW_HEIGHT,
  });
  // Fixed-height group expansion needs no cache reset. See task-list-grouping.md.
  const rowHeightSignature = useMemo(() => tasks
    .flatMap((row, index) => (getRowHeight(row) === ROW_HEIGHT ? [] : [`${index}:${row.clientId}:${getRowHeight(row)}`]))
    .join(","), [tasks]);
  const previousHeights = useRef(rowHeightSignature);
  useEffect(() => {
    if (hasSectionRows && previousHeights.current !== rowHeightSignature) virtualizer.measure();
    previousHeights.current = rowHeightSignature;
  }, [hasSectionRows, rowHeightSignature, virtualizer]);
  const completedFocus = useRef<typeof focusRequest>(undefined);
  useEffect(() => {
    if (!focusRequest || completedFocus.current === focusRequest) return;
    const index = tasks.findIndex(row => row.clientId === focusRequest.id);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "auto" });
    if (focusRequest.focus === false) {
      completedFocus.current = focusRequest;
      return;
    }
    let frame: number;
    const focus = () => {
      const row = Array.from(parentRef.current?.querySelectorAll<HTMLElement>("[data-task-row-id]") ?? [])
        .find(row => row.dataset.taskRowId === focusRequest.id);
      if (row) {
        row.focus({ preventScroll: true });
        completedFocus.current = focusRequest;
      } else {
        frame = requestAnimationFrame(focus);
      }
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, tasks, parentRef, virtualizer]);
  return virtualizer;
}
