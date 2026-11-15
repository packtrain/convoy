"use client";

import { useState, useRef, useMemo, type RefObject, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Id } from "@/convex/_generated/dataModel";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AttachmentDropZone } from "@/components/blocks/attachment-drop-zone";
import { TaskArtifactsSection } from "@/components/blocks/tasks/task-artifacts-section";
import { TaskArtifactPanel } from "@/components/blocks/tasks/task-artifact-panel";
import { TaskChecksSection } from "@/components/blocks/checks";
import type { TimelineComposerMode } from "@/components/blocks/tasks/task-timeline";
import type { TimelineThreadContext } from "@/lib/tasks/timeline/rows";
import { readTimelineSortDirection } from "@/lib/tasks/timeline-view-prefs";
import {
  Status,
  type Task,
  type Priority,
  type TaskUpdate,
} from "@/lib/tasks/types";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import type { Status as TaskStatus } from "@/lib/tasks/status";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import { useTaskAttachments } from "@/lib/tasks/hooks/use-task-attachments";
import { useTaskArtifacts } from "@/lib/tasks/hooks/use-task-artifacts";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { getClipboardImageFiles } from "@/lib/browser/clipboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { showConvexErrorToast } from "@/lib/errors";
import { MAX_ARTIFACT_CONTENT_LENGTH } from "@/convex/tasks/lib/artifacts/normalize";
import { TaskDetailHeader } from "./task-detail-header";
import { TaskDetailMetadata } from "./task-detail-metadata";
import type {
  AddTaskOptions,
  ReorderTasksFn,
  ReorderMultipleFn,
} from "@/lib/tasks/types";
import { useTaskListMove } from "@/components/blocks/tasks/task-table/task-list-move-context";

const TaskTimeline = dynamic(
  () =>
    import("@/components/blocks/tasks/task-timeline").then(
      (mod) => mod.TaskTimeline
    ),
  {
    ssr: false,
    loading: () => <SidebarSectionLoadingSkeleton />,
  }
);

const TaskDetailSubtasks = dynamic(
  () =>
    import("./task-detail-subtasks").then(
      (mod) => mod.TaskDetailSubtasks
    ),
  {
    ssr: false,
    loading: () => <SidebarSectionLoadingSkeleton />,
  }
);

const TaskDescriptionEditor = dynamic(
  () =>
    import("@/components/blocks/tasks/task-description-editor").then(
      (mod) => mod.TaskDescriptionEditor
    ),
  {
    ssr: false,
    loading: () => <TaskDescriptionEditorLoadingSkeleton />,
  }
);

function TaskDescriptionEditorLoadingSkeleton() {
  return (
    <div className="tiptap-theme h-[144px] overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="mx-1 h-5 w-px" />
        <Skeleton className="h-4 w-12 rounded-sm" />
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-4 w-4 rounded-sm" />
      </div>
      <div className="space-y-3 p-3 h-[100px]">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-10/12" />
      </div>
    </div>
  );
}

function SidebarSectionLoadingSkeleton() {
  return (
    <div className="space-y-2 py-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function SidebarFullLoadingState() {
  return (
    <div className="space-y-3 p-4" aria-label="Loading task details">
      <SidebarSectionLoadingSkeleton />
      <SidebarSectionLoadingSkeleton />
      <SidebarSectionLoadingSkeleton />
    </div>
  );
}

type IdleCallbackWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleIdleOrTimeout(
  callback: () => void,
  options: { idleTimeoutMs: number; fallbackTimeoutMs: number }
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let idleId: number | null = null;
  const maybeWindow = window as IdleCallbackWindow;

  if (maybeWindow.requestIdleCallback) {
    idleId = maybeWindow.requestIdleCallback(callback, { timeout: options.idleTimeoutMs });
  } else {
    timeoutId = setTimeout(callback, options.fallbackTimeoutMs);
  }

  return () => {
    if (idleId !== null && maybeWindow.cancelIdleCallback) {
      maybeWindow.cancelIdleCallback(idleId);
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
}

type ArtifactFileContentType = "markdown" | "html";

const ARTIFACT_FILE_EXTENSION_REGEX = /\.(md|html?)$/i;

function getArtifactFileContentType(
  file: File
): ArtifactFileContentType | null {
  const extension = file.name
    .match(ARTIFACT_FILE_EXTENSION_REGEX)?.[1]
    ?.toLowerCase();
  if (extension === "md") {
    return "markdown";
  }
  if (extension === "htm" || extension === "html") {
    return "html";
  }
  return null;
}

export interface TaskOperations {
  updateTask: (id: string, updates: TaskUpdate) => void;
  deleteTask: (id: string) => void;
  addTask: (task: Omit<Task, "_id" | "clientId">, options?: AddTaskOptions) => string | null;
  reorderTasks: ReorderTasksFn;
  reorderMultiple: ReorderMultipleFn;
  setParent: (id: string, parentId: string | null, rank?: string) => void;
  setParentMultiple: (ids: string[], parentId: string | null) => void;
  bulkUpdateStatus: (ids: string[], status: Status) => void;
  bulkUpdateAssignee: (ids: string[], change: TaskAssigneeChange) => void;
  bulkUpdatePriority: (ids: string[], priority: Priority) => void;
  bulkUpdateDueDate: (ids: string[], dueDate: number | null) => void;
  bulkUpdateTaskType: (ids: string[], taskTypeKey: string | null) => void;
  moveToList?: (rootIds: string[], listRef: string, sectionId?: Id<"taskSections">) => void;
  bulkArchive?: (ids: string[]) => void;
  bulkUnarchive?: (ids: string[]) => void;
  bulkDelete: (ids: string[]) => void;
  duplicateTask: (id: string) => string | null;
  unarchiveTask?: (id: string) => void;
}

interface TaskDetailSidebarProps {
  task: Task;
  onClose: () => void;
  projectId?: Id<"projects">;
  organizationSlug?: string;
  projectAlias?: string;
  allowedStatuses?: TaskStatus[];
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  // Legacy prop for simple usage (backwards compatibility with playground)
  onUpdate?: (id: string, updates: TaskUpdate) => void;
  // For subtask table
  allTasks?: Task[];
  taskOperations?: TaskOperations;
  inputRefs?: RefObject<Map<string, HTMLInputElement> | null>;
  focusInput?: (id: string, cursorPosition?: "start" | "end") => void;
  currentUserId?: string;
  // Navigate to a subtask when clicked
  onOpenSubtask?: (clientId: string) => void;
  // Callback for opening project settings to add members
  onInviteClick?: () => void;
  // Callback for opening project settings to add agents
  onAddAgentClick?: () => void;
  // Selected artifact ID from URL state
  selectedArtifactId?: string | null;
  // URL-state setter for selecting an artifact
  onSelectArtifact?: (artifactId: string | null) => void;
  // URL-state setter for clearing selected artifact
  onClearArtifactSelection?: () => void;
  artifactPanelWidthCss?: string;
  // Narrow hosts (thread sidebar): the artifact panel fills the sidebar and
  // covers the task details instead of opening as a wide side-by-side column.
  artifactPanelCompact?: boolean;
  /** Host-owned thread switch for the artifact's send action (OS-1716). */
  onNavigateToThread?: (threadId: Id<"cliThreads">) => void;
  headerVariant?: "default" | "thread-workspace";
}

export function TaskDetailSidebar({
  task,
  onClose,
  projectId,
  organizationSlug,
  projectAlias,
  allowedStatuses,
  hiddenTaskTableColumns,
  onUpdate: legacyOnUpdate,
  allTasks,
  taskOperations,
  inputRefs,
  focusInput,
  currentUserId,
  onOpenSubtask,
  onInviteClick,
  onAddAgentClick,
  selectedArtifactId,
  onSelectArtifact,
  onClearArtifactSelection,
  artifactPanelWidthCss,
  artifactPanelCompact = false,
  onNavigateToThread,
  headerVariant = "default",
}: TaskDetailSidebarProps) {
  const taskListMove = useTaskListMove({
    selectedListRef: null,
    isEnabled: false,
  });
  const isArchived = task.isArchived;
  const permissions = useProjectPermissions(projectId ?? null);
  // Without a project (playground) the tasks are local state: nothing to gate.
  const readOnlyReason = projectId ? permissions.readOnlyReason : null;
  const canComment = !projectId || permissions.canComment;
  const isReadOnly = isArchived || readOnlyReason !== null;
  // The composer's shape depends on the role, so the timeline waits for it.
  const isRoleLoading = Boolean(projectId) && permissions.isLoading;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineSectionRef = useRef<HTMLDivElement>(null);
  // Resolved once here and passed down as a unit, so no consumer re-derives
  // "is there a project route" — see `TimelineThreadContext`. Memoized because
  // the timeline's merge memo depends on it: a fresh object per render would
  // re-sort the whole loaded window on every paint.
  const threadContext: TimelineThreadContext | undefined = useMemo(
    () =>
      projectId && organizationSlug && projectAlias && permissions.canUseThreads
        ? { projectId, organizationSlug, projectAlias }
        : undefined,
    [projectId, organizationSlug, projectAlias, permissions.canUseThreads]
  );
  const hasThreadComposer = !!threadContext;
  // The thread side is open by default (docs/specs/task-timeline.md).
  const [composerMode, setComposerMode] = useState<TimelineComposerMode>("thread");
  const [threadsComposerFocusRequest, setThreadsComposerFocusRequest] = useState(0);
  const [descriptionEditorReadyTaskId, setDescriptionEditorReadyTaskId] = useState<string | null>(null);
  const [fullContentReadyTaskId, setFullContentReadyTaskId] = useState<string | null>(null);
  const isFullContentReady = fullContentReadyTaskId === task._id;
  const isDescriptionEditorReady =
    isFullContentReady && descriptionEditorReadyTaskId === task._id;
  const taskIdForHeavySections =
    isFullContentReady ? task._id : undefined;

  // Attachments
  const { attachments, uploadFiles, deleteAttachment, uploading } = useTaskAttachments(taskIdForHeavySections);
  const { artifacts, createArtifact, updateArtifact, deleteArtifact } = useTaskArtifacts(taskIdForHeavySections);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleUploadFiles(Array.from(files));
      // Reset the input so the same file can be selected again
      e.target.value = "";
    }
  };

  const handleSidebarPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (isReadOnly || e.defaultPrevented) {
      return;
    }

    const imageFiles = getClipboardImageFiles(e.clipboardData);
    if (imageFiles.length === 0) {
      return;
    }

    const target = e.target;
    if (!(target instanceof Element)) {
      return;
    }

    // Belt-and-suspenders: skip zones that own paste behavior even if they didn't
    // call preventDefault before bubbling.
    if (target.closest('[data-task-description-editor="true"]')) {
      return;
    }

    if (target.closest('[data-task-comment-input="true"]')) {
      return;
    }

    e.preventDefault();
    void Promise.resolve(uploadFiles(imageFiles)).catch((error) => {
      console.error("[TaskDetailSidebar] Clipboard attachment upload failed", error);
    });
  };

  // `onClearArtifactSelection` clears a URL param, and every caller passes an
  // inline closure, so this effect re-runs after each commit. Attempt the clear
  // once per selection: a write that doesn't land would otherwise retry forever
  // and trip React's nested-update limit (#185).
  const attemptedArtifactClearRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedArtifactId || !artifacts) {
      attemptedArtifactClearRef.current = null;
      return;
    }
    const hasSelectedArtifact = artifacts.some((artifact) => artifact._id === selectedArtifactId);
    if (hasSelectedArtifact) {
      attemptedArtifactClearRef.current = null;
      return;
    }
    if (attemptedArtifactClearRef.current === selectedArtifactId) {
      return;
    }
    attemptedArtifactClearRef.current = selectedArtifactId;
    onClearArtifactSelection?.();
  }, [selectedArtifactId, artifacts, onClearArtifactSelection]);

  useEffect(() => {
    return scheduleIdleOrTimeout(
      () => setFullContentReadyTaskId(task._id),
      { idleTimeoutMs: 250, fallbackTimeoutMs: 0 }
    );
  }, [task._id]);

  useEffect(() => {
    if (!isFullContentReady) {
      return;
    }

    return scheduleIdleOrTimeout(
      () => setDescriptionEditorReadyTaskId(task._id),
      { idleTimeoutMs: 500, fallbackTimeoutMs: 120 }
    );
  }, [isFullContentReady, task._id]);

  const handleCreateArtifact = async () => {
    if (isReadOnly) {
      return;
    }

    const artifactId = await createArtifact({ name: "Untitled" });
    onSelectArtifact?.(artifactId);
  };

  const createArtifactFromFile = async (
    file: File,
    contentType: ArtifactFileContentType
  ): Promise<Id<"taskArtifacts"> | null> => {
    let content: string;
    try {
      content = await file.text();
    } catch {
      toast.error(`Could not read "${file.name}"`);
      return null;
    }

    if (content.length > MAX_ARTIFACT_CONTENT_LENGTH) {
      toast.error(
        `"${file.name}" is too large (max ${MAX_ARTIFACT_CONTENT_LENGTH.toLocaleString()} characters)`
      );
      return null;
    }

    const name =
      file.name.replace(ARTIFACT_FILE_EXTENSION_REGEX, "").trim() ||
      "Untitled";
    try {
      return await createArtifact({ name, content, contentType });
    } catch (error) {
      const typeLabel = contentType === "html" ? "HTML" : "Markdown";
      showConvexErrorToast(error, `Could not upload ${typeLabel} artifact`);
      return null;
    }
  };

  // Markdown and HTML documents become artifacts; everything else stays a binary attachment.
  const handleUploadFiles = (files: File[]) => {
    if (isReadOnly) {
      return;
    }

    const artifactFiles: Array<{
      file: File;
      contentType: ArtifactFileContentType;
    }> = [];
    const attachmentFiles: File[] = [];
    for (const file of files) {
      const contentType = getArtifactFileContentType(file);
      if (!contentType) {
        attachmentFiles.push(file);
        continue;
      }
      artifactFiles.push({ file, contentType });
    }

    if (attachmentFiles.length > 0) {
      uploadFiles(attachmentFiles);
    }
    if (artifactFiles.length === 0) {
      return;
    }

    void (async () => {
      let lastArtifactId: Id<"taskArtifacts"> | null = null;
      for (const { file, contentType } of artifactFiles) {
        const artifactId = await createArtifactFromFile(file, contentType);
        if (artifactId) {
          lastArtifactId = artifactId;
        }
      }
      if (lastArtifactId) {
        onSelectArtifact?.(lastArtifactId);
      }
    })();
  };

  const handleDeleteArtifact = async (artifactId: Id<"taskArtifacts">) => {
    if (selectedArtifactId === artifactId) {
      onClearArtifactSelection?.();
    }
    await deleteArtifact(artifactId);
  };

  // Use onUpdate from taskOperations if available, fall back to legacy prop
  const onUpdate = taskOperations?.updateTask ?? legacyOnUpdate ?? (() => { });
  const operationMoveToList = taskOperations?.moveToList;
  const contextMoveToList = taskListMove.moveTaskToList;
  const handleMoveTaskToList = operationMoveToList
    ? (listRef: string, sectionId?: Id<"taskSections">) => operationMoveToList([task._id], listRef, sectionId)
    : contextMoveToList
      ? (listRef: string, sectionId?: Id<"taskSections">) => contextMoveToList(task._id, listRef, sectionId)
      : undefined;

  // Subtask table controller (only if we have the necessary props)
  const hasSubtaskSupport = allTasks && taskOperations && inputRefs && focusInput;

  // Find parent task for back navigation
  const parentTask = task.parentId ? allTasks?.find(t => t._id === task.parentId) : undefined;

  /**
   * The `+` on the Threads metadata row. It opens the timeline's thread
   * composer (swapping away from the comment side if that is showing) and
   * focuses it, preserving any existing draft — it no longer switches a tab.
   */
  const handleOpenThreadsComposer = () => {
    if (!hasThreadComposer) {
      return;
    }

    setComposerMode("thread");
    setThreadsComposerFocusRequest((current) => current + 1);
    const scrollComposerIntoView = () => {
      const timelineSection = timelineSectionRef.current;
      if (typeof timelineSection?.scrollIntoView !== "function") {
        return;
      }

      /*
        The composer sits at whichever end of the timeline the newest row is at,
        so which edge to scroll to depends on the sort direction (OS-1591).
        Scrolling to `end` regardless would land on the stream's oldest rows
        when the viewer reads newest-first.

        Read from storage at click time rather than lifting the timeline's view
        state up here: `useTimelineViewState` persists before it re-renders, so
        this read is never behind the control that set it.
      */
      timelineSection.scrollIntoView({
        block: readTimelineSortDirection() === "asc" ? "end" : "start",
        behavior: "smooth",
      });
    };

    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      window.requestAnimationFrame(scrollComposerIntoView);
      return;
    }

    scrollComposerIntoView();
  };

  return (
    <div
      role="region"
      aria-label="Task details sidebar"
      className="flex h-full min-h-0 min-w-0 bg-background"
      onPaste={handleSidebarPaste}
    >
      {selectedArtifactId && (
        <TaskArtifactPanel
          selectedArtifactId={selectedArtifactId}
          widthCss={artifactPanelWidthCss}
          compact={artifactPanelCompact}
          onClose={() => onClearArtifactSelection?.()}
          onInvalidSelection={() => onClearArtifactSelection?.()}
          onUpdateArtifact={updateArtifact}
          disabled={isReadOnly}
          projectId={projectId}
          taskId={task._id}
          taskRefId={task.refId}
          onNavigateToThread={onNavigateToThread}
        />
      )}

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          // Compact hosts have no room for the side-by-side layout: the open
          // artifact covers the task details (kept mounted to preserve state).
          artifactPanelCompact && selectedArtifactId && "hidden"
        )}
      >
        <TaskDetailHeader
          task={task}
          parentTask={parentTask}
          onClose={onClose}
          onToggleComplete={() =>
            onUpdate(task._id, { status: task.status === Status.DONE ? Status.TODO : Status.DONE })
          }
          onUnarchive={() => taskOperations?.unarchiveTask?.(task._id)}
          onDelete={() => taskOperations?.deleteTask?.(task._id)}
          onNavigateToParent={
            parentTask && onOpenSubtask
              ? () => onOpenSubtask(parentTask.clientId)
              : undefined
          }
          onDuplicate={
            taskOperations?.duplicateTask
              ? () => taskOperations.duplicateTask(task._id)
              : undefined
          }
          onArchive={
            taskOperations?.bulkArchive
              ? () => taskOperations.bulkArchive?.([task._id])
              : undefined
          }
          onUpdateStatus={(status) => onUpdate(task._id, { status })}
          projectId={projectId ?? taskListMove.projectId}
          taskListResultsController={taskListMove.resultsController}
          selectedListRef={task.list?.ref ?? taskListMove.selectedListRef}
          onMoveToList={!isArchived ? handleMoveTaskToList : undefined}
          variant={headerVariant}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          readOnlyReason={readOnlyReason}
          canUseThreads={hasThreadComposer}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex min-h-full flex-col">
              <AttachmentDropZone
                onDrop={handleUploadFiles}
                disabled={isReadOnly}
                className="flex-1"
              >
                <div className="p-4">
                  <TaskDetailMetadata
                    task={task}
                    parentTask={parentTask}
                    projectId={projectId}
                    organizationSlug={organizationSlug}
                    projectAlias={projectAlias}
                    allowedStatuses={allowedStatuses}
                    onUpdate={onUpdate}
                    taskListResultsController={taskListMove.resultsController}
                    onMoveToList={
                      taskOperations?.moveToList
                        ? (taskId, listRef) => taskOperations.moveToList?.([taskId], listRef)
                        : undefined
                    }
                    onOpenThreadsComposer={handleOpenThreadsComposer}
                    onOpenSubtask={onOpenSubtask}
                    onInviteClick={onInviteClick}
                    onAddAgentClick={onAddAgentClick}
                    readOnlyReason={readOnlyReason}
                    canUseThreads={hasThreadComposer}
                  />

                  {isFullContentReady ? (
                    <>
                      <div className="my-4 -mx-4">
                        <Separator />
                      </div>

                      <div className="mb-6">
                        <h3 className="mb-2 text-sm font-medium text-foreground">
                          Description
                        </h3>
                        {isDescriptionEditorReady ? (
                          <TaskDescriptionEditor
                            value={task.description}
                            disabled={isReadOnly}
                            onSave={(description) => onUpdate(task._id, { description })}
                          />
                        ) : (
                          <TaskDescriptionEditorLoadingSkeleton />
                        )}
                      </div>

                      <TaskArtifactsSection
                        projectId={projectId}
                        taskId={task._id}
                        attachments={attachments}
                        uploading={uploading}
                        onDeleteAttachment={deleteAttachment}
                        onAttachFilesClick={() => fileInputRef.current?.click()}
                        artifacts={artifacts}
                        selectedArtifactId={selectedArtifactId ?? null}
                        onSelectArtifact={(artifactId) => onSelectArtifact?.(artifactId)}
                        onDeleteArtifact={handleDeleteArtifact}
                        onCreateArtifact={handleCreateArtifact}
                        disabled={isReadOnly}
                      />
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleFileSelect}
                      />

                      {projectId ? (
                        <TaskChecksSection
                          taskId={task._id}
                          readOnlyReason={isArchived ? "Archived tasks are read-only" : readOnlyReason}
                          projectRoute={organizationSlug && projectAlias ? { organizationSlug, projectAlias } : undefined}
                        />
                      ) : null}

                      {hasSubtaskSupport ? (
                        <TaskDetailSubtasks
                          task={task}
                          allTasks={allTasks}
                          taskOperations={taskOperations}
                          inputRefs={inputRefs}
                          focusInput={focusInput}
                          currentUserId={currentUserId}
                          projectId={projectId}
                          allowedStatuses={allowedStatuses}
                          hiddenTaskTableColumns={hiddenTaskTableColumns}
                          onOpenSubtask={onOpenSubtask}
                          onInviteClick={onInviteClick}
                          onAddAgentClick={onAddAgentClick}
                          readOnly={readOnlyReason !== null}
                        />
                      ) : null}
                    </>
                  ) : (
                    <SidebarFullLoadingState />
                  )}
                </div>
              </AttachmentDropZone>

              {/*
                One merged stream where the tabs and their pinned footer used
                to be. The composer is inside it, at the end — in-stream rather
                than pinned (docs/specs/task-timeline.md).

                `mt-12` sets the stream apart from the task's own fields above
                it: the rule alone read as one more field separator, so Subtasks
                and Activity ran together as a single list.
              */}
              {isFullContentReady && !isRoleLoading ? (
                <div ref={timelineSectionRef} className="mt-12 border-t border-border">
                  <TaskTimeline
                    task={task}
                    threadContext={threadContext}
                    composerMode={composerMode}
                    onComposerModeChange={setComposerMode}
                    threadFocusRequestKey={threadsComposerFocusRequest}
                    canComment={canComment}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
