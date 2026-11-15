"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import type { Id } from "@/convex/_generated/dataModel";
import { useCliThreads } from "@/lib/threads/hooks/use-cli-threads";
import { useUserPreferences } from "@/lib/preferences/use-user-preferences";
import { MOBILE_NAV_BAR_CLEARANCE } from "@/lib/mobile/constants";
import { DeleteThreadDialog } from "@/components/blocks/thread/delete-thread-dialog";
import { ThreadSidebarSettings } from "@/components/blocks/thread/thread-sidebar-settings";
import { RenameThreadDialog } from "@/components/blocks/thread/rename-thread-dialog";
import {
  ThreadListItem,
  type ThreadListItemData,
} from "@/components/blocks/thread/thread-list-item";
import { ThreadListSections } from "@/components/blocks/thread/thread-list-sections";
import { ThreadConnectedClisSection } from "@/components/blocks/thread/thread-connected-clis-section";

interface MobileThreadListPanelProps {
  projectId: Id<"projects">;
  projectName: string;
  organizationSlug: string;
  projectAlias: string;
  currentThreadId: string | undefined;
  onClose: () => void;
}

export function MobileThreadListPanel({
  projectId,
  projectName,
  organizationSlug,
  projectAlias,
  currentThreadId,
  onClose,
}: MobileThreadListPanelProps) {
  const {
    threadSortBy,
    threadCompactLayout,
    threadGroupDone,
    isLoading: preferencesLoading,
    setThreadSortBy,
    setThreadCompactLayout,
    setThreadGroupDone,
  } = useUserPreferences();
  const {
    threads,
    doneThreads,
    pinnedThreads,
    isLoading,
    hasMore,
    isLoadingMore,
    loadMore,
    hasMoreDone,
    isLoadingMoreDone,
    loadMoreDone,
    removeThread,
    markRead,
    markUnread,
    renameThread,
    pinThread,
    unpinThread,
  } = useCliThreads(projectId, {
    sortBy: threadSortBy,
    groupDone: threadGroupDone,
    // Wait for the grouping preference so the first fetch commits to the
    // right mode instead of flashing an ungrouped list (OS-1394).
    enabled: !preferencesLoading,
  });

  const [pendingRename, setPendingRename] = useState<ThreadListItemData | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ThreadListItemData | null>(null);

  const handleDelete = useCallback(
    async (threadId: Id<"cliThreads">, isCurrentThread: boolean) => {
      await removeThread(threadId);
      if (isCurrentThread) {
        onClose();
      }
    },
    [removeThread, onClose]
  );

  const handlePin = useCallback(
    async (chatItem: ThreadListItemData) => {
      try {
        if (chatItem.isPinned) {
          await unpinThread(chatItem._id);
        } else {
          await pinThread(chatItem._id);
        }
      } catch {
        toast.error("Failed to update pin");
      }
    },
    [pinThread, unpinThread]
  );

  const handleToggleRead = useCallback(
    async (chatItem: ThreadListItemData) => {
      try {
        if (chatItem.hasUnread || chatItem.requiresAttention) {
          await markRead(chatItem._id, {
            acknowledgeAttention: chatItem.requiresAttention,
          });
        } else {
          await markUnread(chatItem._id);
        }
      } catch {
        toast.error("Failed to update read state");
      }
    },
    [markRead, markUnread]
  );

  const handleSelectThread = useCallback(
    (_threadId: Id<"cliThreads">, isCurrentThread: boolean) => {
      if (!isCurrentThread) {
        onClose();
      }
    },
    [onClose]
  );

  const renderThreadRow = (
    chat: ThreadListItemData,
    compactLayout = threadCompactLayout
  ) => (
    <ThreadListItem
      key={chat._id}
      chat={chat}
      isActive={chat._id === currentThreadId}
      compactLayout={compactLayout}
      organizationSlug={organizationSlug}
      projectAlias={projectAlias}
      onSelectThread={handleSelectThread}
      onRenameRequest={setPendingRename}
      onToggleReadRequest={handleToggleRead}
      onPinRequest={handlePin}
      onDeleteRequest={setPendingDelete}
      showDoneState
    />
  );

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-foreground">Threads</span>
          <ThreadSidebarSettings
            sortBy={threadSortBy}
            compactLayout={threadCompactLayout}
            groupDone={threadGroupDone}
            onSortByChange={setThreadSortBy}
            onCompactLayoutChange={setThreadCompactLayout}
            onGroupDoneChange={setThreadGroupDone}
          />
        </div>

        {/* The list scrolls under the floating global nav bar; the clearance
            padding keeps the last rows reachable above it. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: MOBILE_NAV_BAR_CLEARANCE }}
        >
          {isLoading ? (
            <MobileThreadRowsSkeleton />
          ) : (
            <>
              <ThreadConnectedClisSection
                projectId={projectId}
                projectName={projectName}
                organizationSlug={organizationSlug}
                projectAlias={projectAlias}
                compactLayout={threadCompactLayout}
              />
              <ThreadListSections
                threads={threads}
                doneThreads={doneThreads}
                pinnedThreads={pinnedThreads}
                groupDone={threadGroupDone}
                compactLayout={threadCompactLayout}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={loadMore}
                hasMoreDone={hasMoreDone}
                isLoadingMoreDone={isLoadingMoreDone}
                onLoadMoreDone={loadMoreDone}
                renderRow={renderThreadRow}
              />
            </>
          )}
        </div>
      </div>

      <RenameThreadDialog
        open={pendingRename !== null}
        onOpenChange={(open) => !open && setPendingRename(null)}
        threadId={pendingRename?._id}
        currentTitle={pendingRename?.title ?? ""}
        onRename={async (threadId, title) => {
          await renameThread(threadId, title);
          setPendingRename(null);
        }}
      />

      <DeleteThreadDialog
        thread={pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={(thread) => {
          handleDelete(thread._id, thread._id === currentThreadId);
          setPendingDelete(null);
        }}
      />
    </>
  );
}

/** List placeholder shaped like the default (non-compact) thread rows. */
function MobileThreadRowsSkeleton() {
  return (
    <div aria-label="Loading threads" className="py-1">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="mx-2 my-1 flex flex-col gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
          <Skeleton className="h-4 w-3/4 rounded-sm" />
          <Skeleton className="h-3 w-1/3 rounded-sm" />
        </div>
      ))}
    </div>
  );
}
