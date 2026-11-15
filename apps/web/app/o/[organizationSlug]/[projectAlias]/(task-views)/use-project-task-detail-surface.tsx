"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { BulkDeleteDialog } from "@/components/blocks/tasks/bulk-delete-dialog";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import {
  TaskDetailSidebar,
  type TaskOperations,
} from "@/components/blocks/tasks/task-detail-sidebar";
import { TaskSidebarOverlay } from "@/components/blocks/tasks/task-sidebar-overlay";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { ARTIFACT_RESIZE_BOUNDS, RESIZE_BOUNDS } from "@/lib/tasks/constants";
import { useTaskPanelHotkeys } from "@/lib/tasks/hooks/detail/use-task-panel-hotkeys";
import { useTaskSidebarNavigation } from "@/lib/tasks/hooks/use-task-sidebar-navigation";
import { useTaskUndoActions } from "@/lib/tasks/hooks/use-task-undo-actions";
import { getEffectiveSidebarWidthPx } from "@/lib/tasks/sidebar-layout";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import { getDescendantIds } from "@/lib/tasks/tree";
import type {
  ArchiveFilter,
  Status,
  Task,
  TaskTreeNode,
} from "@/lib/tasks/types";

const MIN_ARTIFACT_VISIBLE_WIDTH_PX = 240;
const OVERLAY_SUBPIXEL_TOLERANCE_PX = 1;

type BulkDeleteCascadeMode = "delete_all" | "keep_children";

interface ProjectTaskDetailSurfaceOperations
  extends Omit<TaskOperations, "deleteTask" | "bulkArchive" | "bulkDelete"> {
  deleteTask: (id: string) => Promise<string[]>;
  archiveTask?: (id: string) => Promise<string[]>;
  bulkArchive: (ids: string[]) => Promise<string[]>;
  bulkDeleteWithChildren: (
    ids: string[],
    cascadeMode: BulkDeleteCascadeMode
  ) => Promise<string[]>;
  restoreTask: (id: string) => Promise<void>;
}

interface ProjectTaskDetailSurfaceTaskSource
  extends ProjectTaskDetailSurfaceOperations {
  tasks: Task[];
  taskTree: TaskTreeNode[];
  inputRefs: RefObject<Map<string, HTMLInputElement> | null>;
  focusInput: (id: string, cursorPosition?: "start" | "end") => void;
}

interface UseProjectTaskDetailSurfaceOptions {
  organizationSlug: string;
  projectAlias: string;
  projectId: Id<"projects">;
  allowedStatuses?: Status[];
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  taskSource: ProjectTaskDetailSurfaceTaskSource;
  taskRefId: string | null;
  artifactId: string | null;
  archiveFilter: ArchiveFilter;
  setTaskRefId: (taskRefId: string | null) => void;
  selectArtifact: (artifactId: string | null) => void;
  selectTaskArtifact: (
    taskRefId: string | null,
    artifactId: string | null,
    archiveFilter?: ArchiveFilter
  ) => void;
  currentUserId?: string;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  onBulkDeleteConfirmed?: () => void;
  /** Visible task client ids for the panel's J/K keys; omitted means no J/K. */
  getPanelTaskOrder?: () => readonly string[];
}

export function useProjectTaskDetailSurface({
  organizationSlug,
  projectAlias,
  projectId,
  allowedStatuses,
  hiddenTaskTableColumns,
  taskSource,
  taskRefId,
  artifactId,
  archiveFilter,
  setTaskRefId,
  selectArtifact,
  selectTaskArtifact,
  currentUserId,
  onInviteClick,
  onAddAgentClick,
  onBulkDeleteConfirmed,
  getPanelTaskOrder,
}: UseProjectTaskDetailSurfaceOptions) {
  const {
    tasks: taskList,
    taskTree,
    inputRefs,
    focusInput,
    deleteTask,
    archiveTask,
    bulkArchive,
    bulkUnarchive,
    bulkDeleteWithChildren,
    restoreTask,
  } = taskSource;
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarOverlayRef = useRef<HTMLDivElement>(null);
  const sidebarWidthRef = useRef(0);
  const undoBulkUnarchive = useCallback(
    async (ids: string[]) => {
      await bulkUnarchive?.(ids);
    },
    [bulkUnarchive]
  );
  const { executeArchiveWithUndo, executeDeleteWithUndo } = useTaskUndoActions({
    restoreTask,
    bulkUnarchive: undoBulkUnarchive,
  });
  // Details panel handle: the panel is anchored to the container's right edge,
  // so the requested width is simply right edge minus pointer x (the hook's
  // default). Drags show a guide and commit on mouse up.
  const detailsResize = useResizePanel(containerRef, {
    bounds: RESIZE_BOUNDS,
    deferCommit: true,
  });
  const sidebarWidth = detailsResize.width;

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // Artifact panel handle: the panel's right edge sits where the (effective)
  // details panel begins, so subtract that from the container's right edge.
  const getArtifactWidthFromPointer = useCallback(
    ({ clientX, containerRect }: { clientX: number; containerRect: DOMRect }) => {
      const effectiveSidebarWidthPx = getEffectiveSidebarWidthPx({
        containerWidthPx: Math.max(0, containerRect.width),
        requestedSidebarWidthPx: sidebarWidthRef.current,
        minArtifactWidthPx: MIN_ARTIFACT_VISIBLE_WIDTH_PX,
      });
      return containerRect.right - effectiveSidebarWidthPx - clientX;
    },
    []
  );
  const artifactResize = useResizePanel(containerRef, {
    bounds: ARTIFACT_RESIZE_BOUNDS,
    deferCommit: true,
    getWidthFromPointer: getArtifactWidthFromPointer,
  });

  // Container width snapshot for guide math. Captured at drag start (refs are
  // off-limits during render); stable for the whole gesture because deferred
  // commits keep the layout frozen until mouse up.
  const [dragContainerWidthPx, setDragContainerWidthPx] = useState(0);
  const beginDetailsResize = detailsResize.handleMouseDown;
  const beginArtifactResize = artifactResize.handleMouseDown;
  const handleDetailsResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      setDragContainerWidthPx(containerRef.current?.clientWidth ?? 0);
      beginDetailsResize(event);
    },
    [beginDetailsResize]
  );
  const handleArtifactResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      setDragContainerWidthPx(containerRef.current?.clientWidth ?? 0);
      beginArtifactResize(event);
    },
    [beginArtifactResize]
  );

  const hasSelectedArtifact = Boolean(artifactId);
  const {
    detailsTask,
    isSidebarOpen,
    openTaskSidebar,
    closeTaskSidebar,
  } = useTaskSidebarNavigation({
    taskList,
    taskRefId,
    setTaskRefId,
    projectId,
    isAuthenticated: true,
  });
  useTaskPanelHotkeys({
    isOpen: isSidebarOpen,
    currentTaskId: detailsTask?.clientId ?? null,
    getTaskOrder: getPanelTaskOrder ?? (() => []),
    onOpenTask: openTaskSidebar,
    onClose: closeTaskSidebar,
  });

  const sidebarContainerStyle = {
    "--task-sidebar-requested-width": `${sidebarWidth}px`,
    "--task-sidebar-effective-width": hasSelectedArtifact
      ? `min(var(--task-sidebar-requested-width), max(0px, calc(100% - ${MIN_ARTIFACT_VISIBLE_WIDTH_PX}px)))`
      : "var(--task-sidebar-requested-width)",
    "--task-artifact-preferred-width": `${artifactResize.width}px`,
    "--task-artifact-width": hasSelectedArtifact
      ? "min(var(--task-artifact-preferred-width), max(0px, calc(100% - var(--task-sidebar-effective-width))))"
      : "0px",
    "--task-overlay-width": hasSelectedArtifact
      ? "calc(var(--task-sidebar-effective-width) + var(--task-artifact-width))"
      : "var(--task-sidebar-requested-width)",
    width: "var(--task-overlay-width)",
    "--task-overlay-divider-width": "1px",
    borderLeftWidth: "var(--task-overlay-divider-width)",
  } as CSSProperties;
  const artifactPanelWidthCss = hasSelectedArtifact
    ? "var(--task-artifact-width)"
    : "0px";

  useEffect(() => {
    const containerEl = containerRef.current;
    const overlayEl = sidebarOverlayRef.current;
    if (!containerEl || !overlayEl) {
      return;
    }

    let rafId: number | null = null;
    const setDividerWidth = () => {
      if (!isSidebarOpen || !hasSelectedArtifact) {
        overlayEl.style.setProperty("--task-overlay-divider-width", "1px");
        return;
      }

      const containerLeft = containerEl.getBoundingClientRect().left;
      const overlayLeft = overlayEl.getBoundingClientRect().left;
      const isStuckToSidebar =
        overlayLeft <= containerLeft + OVERLAY_SUBPIXEL_TOLERANCE_PX;
      overlayEl.style.setProperty(
        "--task-overlay-divider-width",
        isStuckToSidebar ? "0px" : "1px"
      );
    };

    const scheduleMeasure = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(setDividerWidth);
    };

    scheduleMeasure();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleMeasure)
        : null;
    resizeObserver?.observe(containerEl);
    resizeObserver?.observe(overlayEl);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [hasSelectedArtifact, isSidebarOpen]);

  // Width the open desktop overlay covers, so views (e.g. the Board) can add
  // matching scroll space. The mobile drawer never attaches the overlay ref,
  // so this stays 0 on mobile.
  const [detailsSurfaceWidth, setDetailsSurfaceWidth] = useState(0);
  useEffect(() => {
    const overlayEl = sidebarOverlayRef.current;
    let rafId: number | null = null;
    const scheduleMeasure = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        setDetailsSurfaceWidth(
          isSidebarOpen && overlayEl
            ? overlayEl.getBoundingClientRect().width
            : 0
        );
      });
    };

    scheduleMeasure();

    const resizeObserver =
      isSidebarOpen && overlayEl && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleMeasure)
        : null;
    if (overlayEl) {
      resizeObserver?.observe(overlayEl);
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
    };
  }, [isSidebarOpen]);

  const deleteTaskWithUndo = useCallback(
    (id: string) => {
      const task = taskList.find((candidate) => candidate._id === id);
      executeDeleteWithUndo(
        () => deleteTask(id),
        "Failed to delete task",
        task?.name
      );
    },
    [deleteTask, executeDeleteWithUndo, taskList]
  );

  const archiveTaskWithUndo = useCallback(
    (id: string) => {
      if (!archiveTask) {
        return;
      }

      const task = taskList.find((candidate) => candidate._id === id);
      executeArchiveWithUndo(
        () => archiveTask(id),
        "Failed to archive task",
        task?.name
      );
    },
    [archiveTask, executeArchiveWithUndo, taskList]
  );

  const bulkArchiveWithUndo = useCallback(
    (ids: string[]) => {
      executeArchiveWithUndo(
        () => bulkArchive(ids),
        "Failed to archive tasks"
      );
    },
    [bulkArchive, executeArchiveWithUndo]
  );

  // Losing delete access mid-session closes an open confirmation (read-only-viewer-ux.md).
  const { canDeleteTask } = useProjectPermissions(projectId);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{
    ids: string[];
    selectedCount: number;
    totalSubtaskCount: number;
  } | null>(null);

  const bulkDeleteRequest = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }

      if (ids.length === 1) {
        deleteTaskWithUndo(ids[0]);
        return;
      }

      const selectedSet = new Set(ids);
      let totalSubtaskCount = 0;
      for (const id of ids) {
        const descendants = getDescendantIds(id, taskTree);
        for (const descId of descendants) {
          if (!selectedSet.has(descId)) {
            totalSubtaskCount++;
          }
        }
      }

      setPendingBulkDelete({
        ids,
        selectedCount: ids.length,
        totalSubtaskCount,
      });
    },
    [deleteTaskWithUndo, taskTree]
  );

  function confirmBulkDelete(cascadeMode: BulkDeleteCascadeMode) {
    if (!pendingBulkDelete) {
      return;
    }

    const pendingIds = pendingBulkDelete.ids;
    setPendingBulkDelete(null);
    onBulkDeleteConfirmed?.();
    executeDeleteWithUndo(
      () => bulkDeleteWithChildren(pendingIds, cascadeMode),
      "Failed to delete tasks"
    );
  }

  // Drag guide: prospective panel edge, as an offset from the container's
  // right edge. Widths apply on mouse up only ("drop to apply"), so mid-drag
  // the content stays put and just this line follows the cursor.
  const isResizeDragging = detailsResize.isResizing || artifactResize.isResizing;
  let resizeGuideRightPx: number | null = null;
  if (detailsResize.previewWidth !== null) {
    // Mirror the CSS cap that preserves minimum artifact visibility, so the
    // guide lands where the edge will actually end up.
    resizeGuideRightPx = hasSelectedArtifact
      ? Math.min(
          detailsResize.previewWidth,
          Math.max(0, dragContainerWidthPx - MIN_ARTIFACT_VISIBLE_WIDTH_PX)
        )
      : detailsResize.previewWidth;
  } else if (artifactResize.previewWidth !== null) {
    const effectiveSidebarWidthPx = getEffectiveSidebarWidthPx({
      containerWidthPx: dragContainerWidthPx,
      requestedSidebarWidthPx: sidebarWidth,
      minArtifactWidthPx: MIN_ARTIFACT_VISIBLE_WIDTH_PX,
    });
    resizeGuideRightPx = Math.min(
      effectiveSidebarWidthPx + artifactResize.previewWidth,
      dragContainerWidthPx
    );
  }

  const detailsSurface = (
    <>
      <TaskSidebarOverlay
        sidebarOverlayRef={sidebarOverlayRef}
        sidebarContainerStyle={sidebarContainerStyle}
        isOpen={isSidebarOpen}
        detailsResize={{
          width: detailsResize.width,
          onMouseDown: handleDetailsResizeMouseDown,
          onStep: detailsResize.adjustWidthBy,
        }}
        artifactResize={
          hasSelectedArtifact
            ? {
                width: artifactResize.width,
                onMouseDown: handleArtifactResizeMouseDown,
                onStep: artifactResize.adjustWidthBy,
              }
            : null
        }
        onClose={closeTaskSidebar}
      >
        {detailsTask && (
          <TaskDetailSidebar
            task={detailsTask}
            onClose={closeTaskSidebar}
            organizationSlug={organizationSlug}
            projectAlias={projectAlias}
            selectedArtifactId={artifactId}
            artifactPanelWidthCss={artifactPanelWidthCss}
            onSelectArtifact={(selectedArtifactId) =>
              selectTaskArtifact(detailsTask.refId, selectedArtifactId, archiveFilter)
            }
            onClearArtifactSelection={() => selectArtifact(null)}
            projectId={projectId}
            allowedStatuses={allowedStatuses}
            hiddenTaskTableColumns={hiddenTaskTableColumns}
            allTasks={taskList}
            taskOperations={{
              ...taskSource,
              deleteTask: deleteTaskWithUndo,
              bulkArchive: bulkArchiveWithUndo,
              bulkDelete: bulkDeleteRequest,
            }}
            inputRefs={inputRefs}
            focusInput={focusInput}
            currentUserId={currentUserId}
            onOpenSubtask={openTaskSidebar}
            onInviteClick={onInviteClick}
            onAddAgentClick={onAddAgentClick}
          />
        )}
      </TaskSidebarOverlay>
      {isResizeDragging ? (
        // Shield: keeps mousemove flowing during the drag (iframes in html
        // artifacts would otherwise swallow pointer events) and holds the
        // col-resize cursor across the whole surface.
        <div className="absolute inset-0 z-40 cursor-col-resize" />
      ) : null}
      {resizeGuideRightPx !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-50 w-0.5 bg-primary"
          style={{ right: resizeGuideRightPx }}
        />
      ) : null}
      <BulkDeleteDialog
        open={pendingBulkDelete !== null && canDeleteTask}
        onOpenChange={(open) => !open && setPendingBulkDelete(null)}
        selectedCount={pendingBulkDelete?.selectedCount ?? 0}
        totalSubtaskCount={pendingBulkDelete?.totalSubtaskCount ?? 0}
        onKeepChildren={() => confirmBulkDelete("keep_children")}
        onDeleteAll={() => confirmBulkDelete("delete_all")}
      />
    </>
  );

  return {
    containerRef,
    detailsSurface,
    detailsSurfaceWidth,
    isSidebarOpen,
    openTaskSidebar,
    closeTaskSidebar,
    deleteTaskWithUndo,
    archiveTaskWithUndo,
    bulkArchiveWithUndo,
    bulkDeleteRequest,
  };
}
