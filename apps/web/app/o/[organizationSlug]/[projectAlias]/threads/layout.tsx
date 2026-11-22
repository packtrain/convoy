"use client";

import { memo, use, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { useAppAuth, useAppConvexAuth } from "@/lib/auth/hooks";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NEW_THREAD_HOTKEY } from "@/lib/browser/hotkeys";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCliThreads } from "@/lib/threads/hooks/use-cli-threads";
import { useSidebarViewThreads, type ThreadSidebarView } from "@/lib/threads/hooks/use-sidebar-view-threads";
import { useUserPreferences } from "@/lib/preferences/use-user-preferences";
import { buildProjectDraftStorageKey } from "@/lib/threads/draft-storage";
import {
  appRoute,
  isNewThreadComposerTarget,
  parseWorktreeChangesTarget,
  useNavigation,
  useRouteParams,
} from "@/lib/navigation";
import { Centered } from "@/components/custom/centered";
import { ThreadSidebar } from "@/components/blocks/thread/thread-sidebar";
import { NoProfilesState } from "@/components/blocks/thread/no-profiles-state";
import { NoAccess } from "@/components/blocks/no-access";
import { Skeleton } from "@/components/ui/skeleton";
import { ThreadReadStateProvider } from "@/components/blocks/thread/thread-read-state-context";
import { ThreadDraftProvider } from "@/components/blocks/thread/thread-draft-provider";
import {
  ThreadListCollapseProvider,
  useThreadListCollapseState,
} from "@/components/blocks/thread/thread-list-collapse-context";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { THREAD_SIDEBAR_RESIZE_BOUNDS } from "@/lib/threads/constants";
import { MobileThreadListPanel } from "@/components/blocks/mobile/mobile-thread-list-panel";
import { ThreadWorkspaceHost } from "@/components/blocks/thread/workspace/thread-workspace-host";
import { cn } from "@/lib/utils";

function ThreadLayoutSkeleton() {
  return (
    <Centered>
      <Skeleton className="h-8 w-32" />
    </Centered>
  );
}

interface ThreadSidebarContainerProps {
  projectId: Id<"projects">;
  currentThreadId: string | undefined;
  currentRouteThreadIdRef: React.RefObject<Id<"cliThreads"> | undefined>;
  organizationSlug: string;
  projectAlias: string;
  projectName: string;
  clearSuppressionIfMatches: (threadId: Id<"cliThreads">) => void;
  setSuppressedAutoReadThreadId: Dispatch<SetStateAction<Id<"cliThreads"> | undefined>>;
}

function ThreadSidebarContainer({
  projectId,
  currentThreadId,
  currentRouteThreadIdRef,
  organizationSlug,
  projectAlias,
  projectName,
  clearSuppressionIfMatches,
  setSuppressedAutoReadThreadId,
}: ThreadSidebarContainerProps) {
  const navigation = useNavigation();
  const containerRef = useRef<HTMLDivElement>(null);
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
    isLoading: threadsLoading,
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
    batchMarkRead,
    batchMarkDone,
    batchMarkNotDone,
    batchRemoveThreads,
  } = useCliThreads(projectId, {
    sortBy: threadSortBy,
    groupDone: threadGroupDone,
    // Wait for the grouping preference so the first fetch commits to the
    // right mode instead of flashing an ungrouped list (OS-1394).
    enabled: !preferencesLoading,
  });
  // Shared / Background threads view (OS-1576, OS-2513): browser-local and
  // deliberately not a stored preference — it is a place you visit, not a way
  // you like your list. The main list's queries stay mounted underneath so
  // leaving the view restores it with its loaded pages.
  const [sidebarView, setSidebarView] = useState<ThreadSidebarView | null>(null);

  // Switching projects leaves the view, the way it resets multiselect (the
  // sidebar is keyed on `projectId` for that). This container is not keyed, so
  // it adjusts the state during render instead of remounting and losing the
  // resolved sidebar width.
  const [sidebarViewProjectId, setSidebarViewProjectId] = useState(projectId);
  if (sidebarViewProjectId !== projectId) {
    setSidebarViewProjectId(projectId);
    setSidebarView(null);
  }
  const {
    threads: viewThreads,
    isLoading: isLoadingView,
    isLoadingMore: isLoadingMoreView,
    hasMore: hasMoreView,
    loadMore: loadMoreView,
  } = useSidebarViewThreads(projectId, sidebarView);
  const handleCloseView = useCallback(() => setSidebarView(null), []);

  const getThreadSidebarWidthFromPointer = useCallback(
    ({ clientX, containerRect }: { clientX: number; containerRect: DOMRect }) => clientX - containerRect.left,
    []
  );
  const {
    width: sidebarWidth,
    handleMouseDown,
    adjustWidthBy,
  } = useResizePanel(containerRef, {
    bounds: THREAD_SIDEBAR_RESIZE_BOUNDS,
    getWidthFromPointer: getThreadSidebarWidthFromPointer,
  });

  const handleDelete = useCallback(
    async (threadId: Id<"cliThreads">, isCurrentThread: boolean) => {
      await removeThread(threadId);
      if (isCurrentThread) {
        navigation.push(appRoute.projectThreads(organizationSlug, projectAlias));
      }
    },
    [removeThread, navigation, organizationSlug, projectAlias]
  );

  const handleRename = useCallback(
    async (threadId: Id<"cliThreads">, title: string) => {
      await renameThread(threadId, title);
    },
    [renameThread]
  );

  // Optimistic (OS-1173): the hook's pin mutations move the row between the
  // pinned section and the general list instantly; failures roll back.
  const handlePinToggle = useCallback(
    (threadId: Id<"cliThreads">, isPinned: boolean) => {
      void (isPinned ? unpinThread(threadId) : pinThread(threadId)).catch(() => {
        toast.error("Failed to update pin");
      });
    },
    [pinThread, unpinThread]
  );

  // Batch actions (OS-1249) mirror the single-thread rules: mark-read clears
  // active-thread auto-read suppression first; deleting the current thread
  // navigates back to the project thread index.
  const handleBatchMarkRead = useCallback(
    async (threadIds: Id<"cliThreads">[]) => {
      const currentId = currentRouteThreadIdRef.current;
      if (currentId && threadIds.includes(currentId)) {
        clearSuppressionIfMatches(currentId);
      }
      await batchMarkRead(threadIds);
    },
    [batchMarkRead, clearSuppressionIfMatches, currentRouteThreadIdRef]
  );

  const handleToggleDone = useCallback(
    async (threadId: Id<"cliThreads">, isDone: boolean) => {
      await (isDone ? batchMarkNotDone : batchMarkDone)([threadId]);
    },
    [batchMarkDone, batchMarkNotDone]
  );

  const handleBatchDelete = useCallback(
    async (threadIds: Id<"cliThreads">[]) => {
      await batchRemoveThreads(threadIds);
      const currentId = currentRouteThreadIdRef.current;
      if (currentId && threadIds.includes(currentId)) {
        navigation.push(appRoute.projectThreads(organizationSlug, projectAlias));
      }
    },
    [batchRemoveThreads, navigation, organizationSlug, projectAlias, currentRouteThreadIdRef]
  );

  const handleSelectThread = useCallback(
    (_threadId: Id<"cliThreads">, isCurrentThread: boolean) => {
      if (isCurrentThread) {
        return;
      }

      // Keep suppression while leaving the currently suppressed thread to avoid
      // an immediate auto-mark-read race before route transition completes.
      // Clear only after we are already on a different thread route.
      setSuppressedAutoReadThreadId((currentSuppressed) => {
        if (!currentSuppressed) {
          return currentSuppressed;
        }
        if (currentSuppressed === currentRouteThreadIdRef.current) {
          return currentSuppressed;
        }
        return undefined;
      });
    },
    [currentRouteThreadIdRef, setSuppressedAutoReadThreadId]
  );

  const handleToggleRead = useCallback(
    async (threadId: Id<"cliThreads">, hasUnread: boolean, requiresAttention: boolean, isCurrentThread: boolean) => {
      if (hasUnread || requiresAttention) {
        if (isCurrentThread) {
          clearSuppressionIfMatches(threadId);
        }
        await markRead(threadId, { acknowledgeAttention: requiresAttention });
        return;
      }

      if (!isCurrentThread) {
        await markUnread(threadId);
        return;
      }

      setSuppressedAutoReadThreadId(threadId);
      try {
        await markUnread(threadId);
      } catch (error) {
        clearSuppressionIfMatches(threadId);
        throw error;
      }
    },
    [clearSuppressionIfMatches, markRead, markUnread, setSuppressedAutoReadThreadId]
  );

  return (
    <div ref={containerRef} className="flex h-full min-h-0 shrink-0">
      <ThreadSidebar
        // Remount on project switch so multiselect mode/selection reset.
        key={projectId}
        projectId={projectId}
        threads={threads}
        doneThreads={doneThreads}
        pinnedThreads={pinnedThreads}
        currentThreadId={currentThreadId}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        projectName={projectName}
        width={sidebarWidth}
        onRename={handleRename}
        onDelete={handleDelete}
        onSelectThread={handleSelectThread}
        onToggleRead={handleToggleRead}
        onToggleDone={handleToggleDone}
        onPinToggle={handlePinToggle}
        onBatchMarkRead={handleBatchMarkRead}
        onBatchMarkDone={batchMarkDone}
        onBatchMarkNotDone={batchMarkNotDone}
        onBatchDelete={handleBatchDelete}
        sortBy={threadSortBy}
        compactLayout={threadCompactLayout}
        groupDone={threadGroupDone}
        onSortByChange={setThreadSortBy}
        onCompactLayoutChange={setThreadCompactLayout}
        onGroupDoneChange={setThreadGroupDone}
        isLoading={threadsLoading}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMore}
        hasMoreDone={hasMoreDone}
        isLoadingMoreDone={isLoadingMoreDone}
        onLoadMoreDone={loadMoreDone}
        view={sidebarView}
        viewThreads={viewThreads}
        isLoadingView={isLoadingView}
        hasMoreView={hasMoreView}
        isLoadingMoreView={isLoadingMoreView}
        onLoadMoreView={loadMoreView}
        onOpenView={setSidebarView}
        onCloseView={handleCloseView}
        onResizeMouseDown={handleMouseDown}
        onResizeByStep={adjustWidthBy}
      />
    </div>
  );
}

const MemoizedThreadSidebarContainer = memo(ThreadSidebarContainer);

export default function ThreadLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string; projectAlias: string }>;
}) {
  const { organizationSlug, projectAlias } = use(params);
  const navigation = useNavigation();
  const routeParams = useRouteParams<{ threadId?: string }>();
  const currentRouteThreadId = routeParams.threadId as Id<"cliThreads"> | undefined;
  const currentRouteThreadIdRef = useRef<Id<"cliThreads"> | undefined>(currentRouteThreadId);
  const { isLoaded, isSignedIn } = useAppAuth();
  const { isLoading: convexAuthLoading, isAuthenticated } = useAppConvexAuth();

  const org = useQuery(api.organizations.core.getBySlug, isAuthenticated ? { slug: organizationSlug } : "skip");

  const project = useQuery(api.projects.core.getByAlias, org ? { organizationId: org._id, alias: projectAlias } : "skip");
  // Viewers have no threads area at all (docs/specs/read-only-viewer-ux.md#threads-workflow-runs-and-worktrees-slice-5-os-1545).
  const { canUseThreads, isLoading: roleLoading } = useProjectPermissions(project?._id ?? null);
  const isViewOnly = Boolean(project) && !roleLoading && !canUseThreads;

  // Keyboard shortcut: "N" to create a new thread
  useHotkey(
    NEW_THREAD_HOTKEY,
    () => {
      navigation.push(appRoute.projectThreads(organizationSlug, projectAlias));
    },
    { enabled: canUseThreads }
  );

  useEffect(() => {
    if (isViewOnly) {
      navigation.replace(appRoute.project(organizationSlug, projectAlias));
    }
  }, [isViewOnly, navigation, organizationSlug, projectAlias]);

  // Catalogs stay subscribed across thread navigation, so a just-opened thread never shows a model slug.
  const { isLoading: profilesLoading, hasProfiles } = useCliProfiles(project?._id, { withModelCatalogs: true });
  const [suppressedAutoReadThreadId, setSuppressedAutoReadThreadId] = useState<Id<"cliThreads"> | undefined>(undefined);
  const threadListCollapse = useThreadListCollapseState();

  // The route may point at a group child, whose sidebar row is the container (children aren't in
  // the list; the group row stays highlighted while any tab is open — OS-1477). The workspace
  // publishes it, since it knows the container id before an incoming sibling's doc loads, so the
  // row never deselects mid-switch (OS-1558) — a second `cli.threads.get` here would go
  // undefined and blink the highlight off. It arrives in an effect, so it carries the route it
  // was derived from; otherwise navigating out of a group paints the old container for a frame.
  const [workspaceHighlight, setWorkspaceHighlight] = useState<
    { route: Id<"cliThreads">; threadId: Id<"cliThreads"> } | undefined
  >(undefined);
  const sidebarThreadId = currentRouteThreadId
    ? (workspaceHighlight?.route === currentRouteThreadId
        ? workspaceHighlight.threadId
        : currentRouteThreadId)
    : undefined;

  useEffect(() => {
    currentRouteThreadIdRef.current = currentRouteThreadId;
  }, [currentRouteThreadId]);

  const clearSuppressionIfMatches = useCallback((threadId: Id<"cliThreads">) => {
    setSuppressedAutoReadThreadId((currentSuppressed) => (currentSuppressed === threadId ? undefined : currentSuppressed));
  }, []);

  const threadReadStateValue = useMemo(
    () => ({
      suppressedAutoReadThreadId,
      setSuppressedAutoReadThreadId,
      clearSuppressionIfMatches,
    }),
    [clearSuppressionIfMatches, suppressedAutoReadThreadId]
  );

  // Loading state
  if (!isLoaded || convexAuthLoading || (isSignedIn && !isAuthenticated) || org === undefined || project === undefined || profilesLoading) {
    return <ThreadLayoutSkeleton />;
  }

  if (project === null) {
    return <NoAccess organizationSlug={organizationSlug} message="You don't have access to this project." />;
  }

  // Redirecting to the task view (effect above); render nothing that reads threads.
  if (roleLoading || !canUseThreads) {
    return <ThreadLayoutSkeleton />;
  }

  // No profiles — show setup instructions (full page, no sidebar), but only when the route
  // isn't already pointing at a thread. `useCliProfiles` is user-scoped, so a teammate opening
  // a shared-thread link has zero profiles here and would be shown the CLI setup screen instead
  // of the thread they were sent (docs/specs/cli-thread-sharing.md). They get the workspace
  // full-width; the sidebar is suppressed below since its list needs a profile.
  if (!hasProfiles && !currentRouteThreadId) {
    return <NoProfilesState projectId={project._id} projectName={project.name} projectAlias={project.alias} />;
  }

  const draftStorageKey = buildProjectDraftStorageKey(organizationSlug, projectAlias);

  // Mobile threads UX (spec: docs/specs/mobile-bottom-nav.md): the bare
  // threads index shows the thread list as a screen; conversations (a thread
  // detail, or the new-thread composer opened via `?new=1` from the global
  // bar's + slot) render full-screen instead. Desktop always renders the
  // sidebar + children and ignores the query param.
  // A worktree changes view (OS-2036) is a conversation-sized screen too.
  const isMobileListScreen =
    !routeParams.threadId &&
    !isNewThreadComposerTarget(navigation.location.search) &&
    !parseWorktreeChangesTarget(navigation.location.search);

  return (
    <ThreadDraftProvider key={draftStorageKey} storageKey={draftStorageKey}>
      <ThreadReadStateProvider value={threadReadStateValue}>
        <ThreadListCollapseProvider value={threadListCollapse}>
          <div className="absolute inset-0 flex min-h-0 overflow-hidden">
            {hasProfiles ? (
              // Collapsed hides rather than unmounts, so loaded pages and multiselect survive.
              <div className={cn("hidden h-full min-h-0 shrink-0", !threadListCollapse.collapsed && "md:flex")}>
                <MemoizedThreadSidebarContainer
                  projectId={project._id}
                  currentThreadId={sidebarThreadId}
                  currentRouteThreadIdRef={currentRouteThreadIdRef}
                  organizationSlug={organizationSlug}
                  projectAlias={projectAlias}
                  projectName={project.name}
                  clearSuppressionIfMatches={clearSuppressionIfMatches}
                  setSuppressedAutoReadThreadId={setSuppressedAutoReadThreadId}
                />
              </div>
            ) : null}
            {isMobileListScreen ? (
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden md:hidden">
                <MobileThreadListPanel
                  projectId={project._id}
                  projectName={project.name}
                  organizationSlug={organizationSlug}
                  projectAlias={projectAlias}
                  currentThreadId={undefined}
                  onClose={() => {}}
                />
              </div>
            ) : null}
            {/* Level 1 of the threads page (OS-1558, OS-1660): rendered here,
                above the `[threadId]` segment, so neither a group tab switch nor
                the first send of a new thread remounts the shell — the host keeps
                the sidebar and panels across both. `children` stays rendered
                alongside it; both pages under this layout are null stubs, so any
                segment added later still shows up. */}
            <div className={cn("flex h-full min-h-0 flex-1 overflow-hidden", isMobileListScreen && "max-md:hidden")}>
              {org ? (
                <ThreadWorkspaceHost
                  project={project}
                  organizationId={org._id}
                  onSidebarHighlightChange={setWorkspaceHighlight}
                />
              ) : null}
              {children}
            </div>
          </div>
        </ThreadListCollapseProvider>
      </ThreadReadStateProvider>
    </ThreadDraftProvider>
  );
}
