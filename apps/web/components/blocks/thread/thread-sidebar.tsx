"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  BotMessageSquare,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Eye,
  Trash2,
  X,
} from "lucide-react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { showConvexErrorToast } from "@/lib/errors";
import { DeleteThreadDialog } from "@/components/blocks/thread/delete-thread-dialog";
import {
  THREAD_BATCH_ACTION_MAX,
  THREAD_SIDEBAR_RESIZE_BOUNDS,
} from "@/lib/threads/constants";
import {
  EMPTY_THREAD_BATCH_SELECTION,
  intersectVisibleThreadIds,
  toggleThreadBatchSelection,
} from "@/lib/threads/thread-batch-selection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppLink, appRoute } from "@/lib/navigation";
import { EmptyState } from "@/components/custom/empty-state";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadSortBy } from "@/convex/lib/contracts/validators";
import { areThreadListsEqual } from "@/lib/threads/thread-list-item-equality";
import type { ThreadSidebarView } from "@/lib/threads/hooks/use-sidebar-view-threads";
import { THREAD_SIDEBAR_VIEWS, ThreadSidebarSettings } from "./thread-sidebar-settings";
import { useThreadListCollapse } from "./thread-list-collapse-context";
import { RenameThreadDialog } from "./rename-thread-dialog";
import { ThreadListItem, type ThreadListItemData } from "./thread-list-item";
import { ThreadListNewThreadLink } from "./thread-list-new-thread-link";
import { ThreadListSections } from "./thread-list-sections";
import { ThreadConnectedClisSection } from "./thread-connected-clis-section";
import { ThreadsLoadMoreButton } from "./threads-load-more-button";

const THREAD_SIDEBAR_SKELETON_KEYS = [
  "thread-skeleton-1",
  "thread-skeleton-2",
  "thread-skeleton-3",
  "thread-skeleton-4",
  "thread-skeleton-5",
] as const;

interface ThreadSidebarProps {
  projectId: Id<"projects">;
  threads: ThreadListItemData[];
  doneThreads: ThreadListItemData[];
  pinnedThreads: ThreadListItemData[];
  currentThreadId: string | undefined;
  organizationSlug: string;
  projectAlias: string;
  projectName: string;
  width: number;
  onRename: (threadId: Id<"cliThreads">, title: string) => Promise<void>;
  onDelete: (threadId: Id<"cliThreads">, isCurrentThread: boolean) => void;
  onSelectThread: (
    threadId: Id<"cliThreads">,
    isCurrentThread: boolean
  ) => void;
  onToggleRead: (
    threadId: Id<"cliThreads">,
    hasUnread: boolean,
    requiresAttention: boolean,
    isCurrentThread: boolean
  ) => Promise<void>;
  onToggleDone: (threadId: Id<"cliThreads">, isDone: boolean) => Promise<void>;
  onPinToggle: (threadId: Id<"cliThreads">, isPinned: boolean) => void;
  onBatchMarkRead: (threadIds: Id<"cliThreads">[]) => Promise<void>;
  onBatchMarkDone: (threadIds: Id<"cliThreads">[]) => Promise<void>;
  onBatchMarkNotDone: (threadIds: Id<"cliThreads">[]) => Promise<void>;
  onBatchDelete: (threadIds: Id<"cliThreads">[]) => Promise<void>;
  sortBy: ThreadSortBy;
  compactLayout: boolean;
  groupDone: boolean;
  onSortByChange: (sortBy: ThreadSortBy) => void;
  onCompactLayoutChange: (compact: boolean) => void;
  onGroupDoneChange: (group: boolean) => void;
  isLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  hasMoreDone: boolean;
  isLoadingMoreDone: boolean;
  onLoadMoreDone: () => void;
  /**
   * The open separate view, Shared (OS-1576) or Background (OS-2513) threads,
   * entered from the settings menu and left with X or Escape. The container
   * owns it because it also gates the query, mounted only while a view is open.
   */
  view: ThreadSidebarView | null;
  viewThreads: ThreadListItemData[];
  isLoadingView: boolean;
  hasMoreView: boolean;
  isLoadingMoreView: boolean;
  onLoadMoreView: () => void;
  onOpenView: (view: ThreadSidebarView) => void;
  onCloseView: () => void;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onResizeByStep: (delta: number, options?: { persist?: boolean }) => void;
}

function areThreadSidebarPropsEqual(
  prevProps: ThreadSidebarProps,
  nextProps: ThreadSidebarProps
): boolean {
  return (
    prevProps.projectId === nextProps.projectId &&
    areThreadListsEqual(prevProps.threads, nextProps.threads) &&
    areThreadListsEqual(prevProps.doneThreads, nextProps.doneThreads) &&
    areThreadListsEqual(prevProps.pinnedThreads, nextProps.pinnedThreads) &&
    prevProps.view === nextProps.view &&
    areThreadListsEqual(prevProps.viewThreads, nextProps.viewThreads) &&
    prevProps.isLoadingView === nextProps.isLoadingView &&
    prevProps.hasMoreView === nextProps.hasMoreView &&
    prevProps.isLoadingMoreView === nextProps.isLoadingMoreView &&
    prevProps.onLoadMoreView === nextProps.onLoadMoreView &&
    prevProps.onOpenView === nextProps.onOpenView &&
    prevProps.onCloseView === nextProps.onCloseView &&
    prevProps.currentThreadId === nextProps.currentThreadId &&
    prevProps.organizationSlug === nextProps.organizationSlug &&
    prevProps.projectAlias === nextProps.projectAlias &&
    prevProps.projectName === nextProps.projectName &&
    prevProps.width === nextProps.width &&
    prevProps.onRename === nextProps.onRename &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onSelectThread === nextProps.onSelectThread &&
    prevProps.onToggleRead === nextProps.onToggleRead &&
    prevProps.onToggleDone === nextProps.onToggleDone &&
    prevProps.onPinToggle === nextProps.onPinToggle &&
    prevProps.onBatchMarkRead === nextProps.onBatchMarkRead &&
    prevProps.onBatchMarkDone === nextProps.onBatchMarkDone &&
    prevProps.onBatchMarkNotDone === nextProps.onBatchMarkNotDone &&
    prevProps.onBatchDelete === nextProps.onBatchDelete &&
    prevProps.sortBy === nextProps.sortBy &&
    prevProps.compactLayout === nextProps.compactLayout &&
    prevProps.groupDone === nextProps.groupDone &&
    prevProps.onSortByChange === nextProps.onSortByChange &&
    prevProps.onCompactLayoutChange === nextProps.onCompactLayoutChange &&
    prevProps.onGroupDoneChange === nextProps.onGroupDoneChange &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.hasMore === nextProps.hasMore &&
    prevProps.isLoadingMore === nextProps.isLoadingMore &&
    prevProps.onLoadMore === nextProps.onLoadMore &&
    prevProps.hasMoreDone === nextProps.hasMoreDone &&
    prevProps.isLoadingMoreDone === nextProps.isLoadingMoreDone &&
    prevProps.onLoadMoreDone === nextProps.onLoadMoreDone &&
    prevProps.onResizeMouseDown === nextProps.onResizeMouseDown &&
    prevProps.onResizeByStep === nextProps.onResizeByStep
  );
}

function ThreadSidebarComponent({
  projectId,
  threads,
  doneThreads,
  pinnedThreads,
  currentThreadId,
  organizationSlug,
  projectAlias,
  projectName,
  width,
  onRename,
  onDelete,
  onSelectThread,
  onToggleRead,
  onToggleDone,
  onPinToggle,
  onBatchMarkRead,
  onBatchMarkDone,
  onBatchMarkNotDone,
  onBatchDelete,
  sortBy,
  compactLayout,
  groupDone,
  onSortByChange,
  onCompactLayoutChange,
  onGroupDoneChange,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  hasMoreDone,
  isLoadingMoreDone,
  onLoadMoreDone,
  view,
  viewThreads,
  isLoadingView,
  hasMoreView,
  isLoadingMoreView,
  onLoadMoreView,
  onOpenView,
  onCloseView,
  onResizeMouseDown,
  onResizeByStep,
}: ThreadSidebarProps) {
  const threadList = useThreadListCollapse();
  const setListHasAttention = threadList?.setHasAttention;
  const listHasAttention = [...pinnedThreads, ...threads].some(
    (thread) => thread.hasUnread || thread.requiresAttention
  );
  useEffect(() => {
    setListHasAttention?.(listHasAttention);
  }, [listHasAttention, setListHasAttention]);

  const [pendingRename, setPendingRename] = useState<ThreadListItemData | null>(
    null
  );
  const [pendingDelete, setPendingDelete] = useState<ThreadListItemData | null>(
    null
  );

  // Multiselect mode (OS-1249): mode is separate from the selection so zero
  // selected rows is a valid active-mode state.
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [selection, setSelection] = useState(EMPTY_THREAD_BATCH_SELECTION);
  const [pendingBatchDeleteIds, setPendingBatchDeleteIds] = useState<
    Id<"cliThreads">[] | null
  >(null);

  // Pinned rows participate in multiselect like any other visible row.
  const allVisibleThreads = [...pinnedThreads, ...threads, ...doneThreads];
  const visibleThreadIds = allVisibleThreads.map((chat) => chat._id);
  const selectedIds = intersectVisibleThreadIds(
    selection.ids,
    visibleThreadIds
  );
  const selectedThreads = allVisibleThreads.filter((chat) =>
    selectedIds.includes(chat._id)
  );
  const canBatchMarkRead = selectedThreads.some(
    (chat) => chat.hasUnread || chat.requiresAttention
  );
  // All-done selection flips the button to the undo direction (OS-1249).
  const allSelectedDone =
    selectedThreads.length > 0 && selectedThreads.every((chat) => chat.isDone);

  // Ref keeps the row toggle callback stable across realtime list updates.
  const visibleThreadIdsRef = useRef(visibleThreadIds);
  useEffect(() => {
    visibleThreadIdsRef.current = visibleThreadIds;
  });

  const handleToggleSelect = useCallback(
    (threadId: Id<"cliThreads">, shiftKey: boolean) => {
      setSelection((prev) =>
        toggleThreadBatchSelection(
          prev,
          visibleThreadIdsRef.current,
          threadId,
          shiftKey
        )
      );
    },
    []
  );

  const handleEnableMultiSelect = useCallback(() => {
    setMultiSelectEnabled(true);
  }, []);

  const handleExitMultiSelect = useCallback(() => {
    setMultiSelectEnabled(false);
    setSelection(EMPTY_THREAD_BATCH_SELECTION);
  }, []);

  // Escape leaves whichever mode is active — one registration rather than two,
  // so the two modes can't race for the key. They are mutually exclusive
  // anyway: both are entered from the settings gear, which neither renders.
  // Never fires while a dialog owns the key.
  const handleEscape = useCallback(() => {
    if (multiSelectEnabled) {
      handleExitMultiSelect();
      return;
    }
    onCloseView();
  }, [handleExitMultiSelect, multiSelectEnabled, onCloseView]);

  useHotkey("Escape", handleEscape, {
    enabled:
      (multiSelectEnabled || view !== null) &&
      pendingBatchDeleteIds === null &&
      pendingRename === null &&
      pendingDelete === null,
  });

  // The selection clears up front so checkboxes disappear together with the
  // optimistic list update; a failure restores it (and keeps the mode) so the
  // action can be retried.
  const runBatchAction = useCallback(
    async (
      action: (threadIds: Id<"cliThreads">[]) => Promise<void>,
      threadIds: Id<"cliThreads">[],
      failureMessage: string
    ) => {
      const previousSelection = selection;
      setSelection(EMPTY_THREAD_BATCH_SELECTION);
      try {
        await action(threadIds);
      } catch (error) {
        setSelection(previousSelection);
        // Surface ConvexError messages (e.g. the group fan-out cap's "select
        // fewer groups") instead of a generic failure.
        showConvexErrorToast(error, failureMessage);
      }
    },
    [selection]
  );
  const handleToggleReadRequest = useCallback(
    (chatItem: ThreadListItemData, isCurrentThread: boolean) => {
      void onToggleRead(
        chatItem._id,
        chatItem.hasUnread,
        chatItem.requiresAttention,
        isCurrentThread
      ).catch(() => {
        toast.error("Failed to update read state");
      });
    },
    [onToggleRead]
  );

  const handleToggleDoneRequest = useCallback(
    (chatItem: ThreadListItemData) => {
      void onToggleDone(chatItem._id, chatItem.isDone ?? false).catch(() => {
        toast.error("Failed to update done state");
      });
    },
    [onToggleDone]
  );

  const handlePinRequest = useCallback(
    (chatItem: ThreadListItemData) => {
      onPinToggle(chatItem._id, chatItem.isPinned ?? false);
    },
    [onPinToggle]
  );

  const renderRow = (
    chat: ThreadListItemData,
    rowCompactLayout: boolean
  ) => (
    <ThreadListItem
      key={chat._id}
      chat={chat}
      isActive={chat._id === currentThreadId}
      compactLayout={rowCompactLayout}
      organizationSlug={organizationSlug}
      projectAlias={projectAlias}
      onSelectThread={onSelectThread}
      onRenameRequest={setPendingRename}
      onToggleReadRequest={handleToggleReadRequest}
      onToggleDoneRequest={handleToggleDoneRequest}
      onPinRequest={handlePinRequest}
      onDeleteRequest={setPendingDelete}
      showDoneState
      multiSelectEnabled={multiSelectEnabled}
      selected={selectedIds.includes(chat._id)}
      onToggleSelect={handleToggleSelect}
    />
  );

  return (
    <>
      <div className="relative h-full shrink-0" style={{ width: `${width}px` }}>
        <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-card">
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            {multiSelectEnabled ? (
              <>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {selectedIds.length} selected
                  {selectedIds.length >= THREAD_BATCH_ACTION_MAX
                    ? " (max)"
                    : ""}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 cursor-pointer"
                    aria-label="Mark selected as read"
                    title="Mark selected as read"
                    disabled={!canBatchMarkRead}
                    onClick={() =>
                      void runBatchAction(
                        onBatchMarkRead,
                        selectedIds,
                        "Failed to mark threads as read"
                      )
                    }
                  >
                    <Eye className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 cursor-pointer"
                    aria-label={
                      allSelectedDone
                        ? "Mark selected as not done"
                        : "Mark selected as done"
                    }
                    title={
                      allSelectedDone
                        ? "Mark selected as not done"
                        : "Mark selected as done"
                    }
                    disabled={selectedIds.length === 0}
                    onClick={() =>
                      void runBatchAction(
                        allSelectedDone ? onBatchMarkNotDone : onBatchMarkDone,
                        selectedIds,
                        "Failed to update done state"
                      )
                    }
                  >
                    {allSelectedDone ? (
                      <CircleDashed className="size-4" />
                    ) : (
                      <CircleCheck className="size-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 cursor-pointer text-destructive hover:text-destructive"
                    aria-label="Delete selected"
                    title="Delete selected"
                    disabled={selectedIds.length === 0}
                    onClick={() => setPendingBatchDeleteIds(selectedIds)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 cursor-pointer"
                    aria-label="Exit multiselect"
                    title="Exit multiselect"
                    onClick={handleExitMultiSelect}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </>
            ) : view !== null ? (
              <ThreadViewHeader view={view} onClose={onCloseView} />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <AppLink
                    href={appRoute.project(organizationSlug, projectAlias)}
                    className="max-w-[120px] truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {projectName}
                  </AppLink>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  <BotMessageSquare className="size-4 shrink-0 text-foreground" />
                </div>
                <div className="flex items-center gap-1">
                  <ThreadSidebarSettings
                    sortBy={sortBy}
                    compactLayout={compactLayout}
                    groupDone={groupDone}
                    onSortByChange={onSortByChange}
                    onCompactLayoutChange={onCompactLayoutChange}
                    onGroupDoneChange={onGroupDoneChange}
                    onEnableMultiSelect={handleEnableMultiSelect}
                    onOpenView={onOpenView}
                    onHideList={threadList?.toggle}
                  />
                </div>
              </>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col">
              {view !== null ? (
                <ThreadViewList
                  view={view}
                  threads={viewThreads}
                  isLoading={isLoadingView}
                  compactLayout={compactLayout}
                  hasMore={hasMoreView}
                  isLoadingMore={isLoadingMoreView}
                  onLoadMore={onLoadMoreView}
                  renderRow={renderRow}
                />
              ) : isLoading ? (
                <ThreadListSkeleton compactLayout={compactLayout} />
              ) : (
                <>
                  <ThreadListNewThreadLink
                    organizationSlug={organizationSlug}
                    projectAlias={projectAlias}
                  />
                  <ThreadConnectedClisSection
                    projectId={projectId}
                    projectName={projectName}
                    organizationSlug={organizationSlug}
                    projectAlias={projectAlias}
                    compactLayout={compactLayout}
                  />
                  <ThreadListSections
                    threads={threads}
                    doneThreads={doneThreads}
                    pinnedThreads={pinnedThreads}
                    groupDone={groupDone}
                    compactLayout={compactLayout}
                    hasMore={hasMore}
                    isLoadingMore={isLoadingMore}
                    onLoadMore={onLoadMore}
                    hasMoreDone={hasMoreDone}
                    isLoadingMoreDone={isLoadingMoreDone}
                    onLoadMoreDone={onLoadMoreDone}
                    renderRow={renderRow}
                  />
                </>
              )}
            </div>
          </ScrollArea>
        </aside>
        <SidebarResizeHandle
          ariaLabel="Resize thread sidebar"
          currentWidth={width}
          bounds={THREAD_SIDEBAR_RESIZE_BOUNDS}
          expandDirection="right"
          onResizeMouseDown={onResizeMouseDown}
          onResizeByStep={onResizeByStep}
          className="absolute inset-y-0 right-0"
        />
      </div>

      <RenameThreadDialog
        open={pendingRename !== null}
        onOpenChange={(open) => !open && setPendingRename(null)}
        threadId={pendingRename?._id}
        currentTitle={pendingRename?.title ?? ""}
        onRename={async (threadId, title) => {
          await onRename(threadId, title);
          setPendingRename(null);
        }}
      />

      <DeleteThreadDialog
        thread={pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={(thread) => {
          onDelete(thread._id, thread._id === currentThreadId);
          setPendingDelete(null);
        }}
      />

      <AlertDialog
        open={pendingBatchDeleteIds !== null}
        onOpenChange={(open) => !open && setPendingBatchDeleteIds(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{" "}
              {pendingBatchDeleteIds?.length === 1
                ? "thread"
                : `${pendingBatchDeleteIds?.length ?? 0} threads`}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedThreads.some((chat) => chat.kind === "group")
                ? "The selected threads, including every thread inside selected groups, will be permanently deleted."
                : "The selected threads will be permanently deleted."}{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingBatchDeleteIds) {
                  void runBatchAction(
                    onBatchDelete,
                    pendingBatchDeleteIds,
                    "Failed to delete threads"
                  );
                  setPendingBatchDeleteIds(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const ThreadSidebar = memo(
  ThreadSidebarComponent,
  areThreadSidebarPropsEqual
);

function ThreadViewHeader({ view, onClose }: { view: ThreadSidebarView; onClose: () => void }) {
  const { icon: Icon, label } = THREAD_SIDEBAR_VIEWS[view];
  return (
    <>
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-8 cursor-pointer"
        aria-label={`Exit ${label.toLowerCase()}`}
        title={`Exit ${label.toLowerCase()}`}
        onClick={onClose}
      >
        <X className="size-4" />
      </Button>
    </>
  );
}

/**
 * A separate view's body (OS-1576, OS-2513). A component rather than an inline
 * branch so `renderRow` is invoked behind a prop, the way `ThreadListSections`
 * invokes it — calling it inline made the React Compiler drop the sidebar's
 * manual memoization.
 */
function ThreadViewList({
  view,
  threads,
  isLoading,
  compactLayout,
  hasMore,
  isLoadingMore,
  onLoadMore,
  renderRow,
}: {
  view: ThreadSidebarView;
  threads: ThreadListItemData[];
  isLoading: boolean;
  compactLayout: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  renderRow: (chat: ThreadListItemData, compactLayout: boolean) => ReactNode;
}) {
  if (isLoading) {
    return <ThreadListSkeleton compactLayout={compactLayout} />;
  }

  // Distinct from the list's "No threads yet": this view is empty because
  // nothing is in it, not because the project is.
  if (threads.length === 0) {
    const { icon, emptyTitle, emptyDescription } = THREAD_SIDEBAR_VIEWS[view];
    return <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      {threads.map((chat) => renderRow(chat, compactLayout))}
      {hasMore ? (
        <ThreadsLoadMoreButton isLoadingMore={isLoadingMore} onClick={onLoadMore} />
      ) : null}
    </>
  );
}

function ThreadListSkeleton({ compactLayout }: { compactLayout: boolean }) {
  return (
    <>
      {THREAD_SIDEBAR_SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className={
            compactLayout
              ? "border-b border-border px-3 py-2.5"
              : "mx-2 my-1 rounded-lg bg-muted/50 px-3 py-2.5"
          }
        >
          {compactLayout ? (
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full shrink-0" />
              <Skeleton className="h-4 flex-1 rounded-sm" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4 rounded-sm" />
              <Skeleton className="h-3 w-1/3 rounded-sm" />
            </div>
          )}
        </div>
      ))}
    </>
  );
}
