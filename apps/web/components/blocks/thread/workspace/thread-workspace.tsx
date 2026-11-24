"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import {
  FileDiff,
  FileText,
  GitPullRequest,
  ListTodo,
  PanelRight,
  ListChecks,
  PanelRightOpen,
  PanelTop,
  Plus,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { useHotkey } from "@tanstack/react-hotkeys";
import { api } from "@/convex/_generated/api";
import { useCliMessages } from "@/lib/threads/hooks/use-cli-messages";
import { useCliThread } from "@/lib/threads/hooks/use-cli-thread";
import { useThreadHandoff } from "@/lib/threads/hooks/use-thread-handoff";
import { useThreadMarkdownExport } from "@/lib/threads/hooks/use-thread-markdown-export";
import { useThreadReadState } from "@/components/blocks/thread/thread-read-state-context";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { ThreadComposerControllerApi } from "@/components/blocks/thread/thread-composer";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  getThreadWorkspaceArchiveFilter,
  type ThreadWorkspaceTaskTarget,
} from "@/lib/threads/hooks/use-open-thread-workspace-task";
import type { ThreadWorkspaceTaskSidebar } from "@/lib/threads/hooks/use-thread-workspace-task-sidebar";
import { ThreadHeader } from "@/components/blocks/thread/thread-header";
import { ThreadMobileBackButton } from "@/components/blocks/thread/thread-mobile-back-button";
import { ThreadMarkDoneButton } from "@/components/blocks/thread/thread-mark-done-button";
import { ThreadMarkReadButton } from "@/components/blocks/thread/thread-mark-read-button";
import { ThreadSharedBadge } from "@/components/blocks/thread/thread-shared-badge";
import {
  ThreadActionsMenu,
  ThreadItemContextMenu,
} from "@/components/blocks/thread/thread-list-item";
import { RenameThreadDialog } from "@/components/blocks/thread/rename-thread-dialog";
import { ThreadWorkspaceSplitPane } from "@/components/blocks/thread/thread-workspace-split-pane";
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
import {
  RunFileViewerPanel,
  type RunFileViewerReview,
} from "@/components/blocks/thread/run-file-viewer-panel";
import { RunReviewCommentsPill } from "@/components/blocks/thread/run-review-comments-pill";
import { WorktreeChangesPanel } from "@/components/blocks/worktrees";
import {
  ThreadChangesToolbar,
  ThreadSidebarTabBar,
  ThreadTabList,
  type ThreadChangesView,
  type ThreadSidebarPanelKind,
  type ThreadTab,
  type ThreadWorkspaceTab,
} from "@/components/blocks/thread/thread-sidebar-tabs";
import { DoneThreadMenu, ThreadTabStrip } from "@/components/blocks/thread/thread-tab-strip";
import { WorkflowRunContainerView } from "@/components/blocks/workflows/workflow-run-container-view";
import { WorkflowRunPanel } from "@/components/blocks/workflows/workflow-run-panel";
import { EvidencePanel } from "@/components/blocks/evidence";
import { AttachedPullRequestReader } from "@/components/blocks/integrations";
import { WorkflowRunRail } from "@/components/blocks/workflows/workflow-run-rail";
import type { ThreadTaskPaneRenderer } from "./thread-task-pane";
import { buildTimelineRuns } from "@/lib/threads/run-timeline";
import {
  type ChangesDiffStyle,
  type ThreadLayoutMode,
  readChangesDiffStyle,
  readChangesFileTree,
  writeChangesFileTree,
  readChangesWordWrap,
  writeChangesDiffStyle,
  writeChangesWordWrap,
} from "@/lib/threads/changes-view-prefs";
import { useThreadRunReviewComments } from "@/lib/threads/hooks/use-thread-run-review-comments";
import { composeReviewFeedbackMessage } from "@/lib/threads/run-review-comments";
import { TaskArtifactPanel } from "@/components/blocks/tasks/task-artifact-panel";
import {
  useArtifactOwningTask,
  useTaskArtifact,
  useUpdateTaskArtifact,
} from "@/lib/tasks/hooks/use-task-artifacts";
import { TaskRefWithType, TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import type {
  CliRunDiffFile,
  CliRunDiffSummary,
  CliRunDiffSummaryPreview,
} from "@/convex/lib/contracts/validators";
import { ThreadTaskRefLink } from "@/components/blocks/thread/thread-task-link";
import { ThreadAttachedPrRefLink } from "@/components/blocks/thread/thread-pr-badge";
import { ThreadStatusIndicator } from "@/components/blocks/thread/thread-status-indicator";
import {
  getThreadDisplayStatus,
  type ThreadDisplayStatusInput,
} from "@/lib/threads/display-status";
import { THREAD_TOGGLE_DONE_HOTKEY, THREAD_TOGGLE_READ_HOTKEY, isEditableHotkeyTarget } from "@/lib/browser/hotkeys";
import {
  ThreadView,
  type ThreadViewSubmitHandler,
} from "@/components/blocks/thread/thread-view/thread-view";
import { ThreadDetailSkeleton, ThreadTranscriptSkeleton } from "./thread-detail-skeleton";
import { ThreadNotFound } from "./thread-not-found";
import { RunUndoConfirmDialog } from "./run-undo-confirm-dialog";
import { AddThreadToGroupDraftView } from "@/components/blocks/thread/add-thread-to-group-draft-view";
import { MAX_GROUP_CHILDREN } from "@/lib/threads/constants";
import { pickDefaultChild } from "@/lib/threads/group-children";
import { threadCanWrite, threadIsReadOnly } from "@/lib/threads/sharing";
import { readGroupLastTab } from "@/lib/threads/group-last-tab";
import { useThreadGroupTabs } from "@/lib/threads/hooks/use-thread-group-tabs";
import {
  moveThreadOutOfGroup,
  patchThreadQueries,
  removeThreadFromGroup,
  type CliThreadDetailItem,
  type ThreadGroup,
  type ThreadGroupChild,
} from "@/lib/threads/thread-query-patches";
import { appRoute, useNavigation, useRouteParams } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { ThreadShellState } from "./use-thread-shell-state";
import { useThreadTasksHotkey } from "./use-thread-tasks-hotkey";
import { getErrorMessage } from "@/lib/errors";

interface ThreadDetailRouteParams extends Record<string, string> {
  organizationSlug: string;
  projectAlias: string;
  threadId: string;
}

interface ThreadWorkspaceProps {
  /**
   * The thread to show: the route's, or — for the beat between a first send and
   * the route committing — the one the composer just created (OS-1660).
   */
  threadId: Id<"cliThreads">;
  projectId: Id<"projects">;
  /** Resolved by the host, which needs it for the task pane either way. */
  project: Doc<"projects"> | null | undefined;
  /** Shared with the new-thread composer, so a send keeps the shell (OS-1660). */
  shell: ThreadShellState;
  threadWorkspace: ThreadWorkspaceTaskSidebar;
  openTaskInSidebar: (task: ThreadWorkspaceTaskTarget) => void;
  /** The shared task pane; the caller passes the half to show (OS-1660). */
  renderTaskPane: ThreadTaskPaneRenderer;
  /**
   * Publishes the row the thread sidebar should highlight: the group
   * container while any of its tabs is open, otherwise the thread itself.
   * Stamped with the route it was derived from — this lands in an effect, so
   * the layout must be able to tell a stale entry from a current one.
   */
  onSidebarHighlightChange: (highlight: {
    route: Id<"cliThreads">;
    threadId: Id<"cliThreads">;
  }) => void;
}

/** A tab of a plain group shares through its container (OS-1579); a workflow run's children share nothing (OS-1366). */
function isShareableGroupChild(chat: {
  containerKind?: "group";
  containerWorkflowRunId?: Id<"workflowRuns">;
}): boolean {
  return chat.containerKind === "group" && chat.containerWorkflowRunId === undefined;
}

/**
 * The threads page's stable layer (OS-1558, docs/specs/thread-groups.md →
 * Rendering). The threads layout renders it *above* the `[threadId]` segment,
 * so switching group tabs re-renders it instead of remounting the page:
 * header, tab strip, panels, layout mode and dialogs all survive, and only
 * the transcript swaps.
 */
export function ThreadWorkspace({
  threadId: routeThreadId,
  projectId,
  project,
  shell,
  threadWorkspace,
  openTaskInSidebar,
  renderTaskPane,
  onSidebarHighlightChange,
}: ThreadWorkspaceProps) {
  const params = useRouteParams<ThreadDetailRouteParams>();
  const navigation = useNavigation();
  // Optimistic tab state: a tab click swaps the transcript and highlight immediately instead of
  // after the route commits (and starts the message fetch alongside the thread-doc fetch). A
  // route change drops the override — render-phase prop-derived state adjustment.
  const [activeThreadId, setActiveThreadId] = useState(routeThreadId);
  // The group a just-created Group child landed in, held while its doc loads (OS-1615):
  // `addThreadToGroup` returns the container — brand new on the first group addition, so nothing else names it
  // yet — and holding it keeps the strip, header and panels mounted across the send instead of
  // blanking to the full-page skeleton.
  const [adoptedScope, setAdoptedScope] = useState<
    { containerId: Id<"cliThreads">; threadId: Id<"cliThreads"> } | undefined
  >(undefined);
  const [lastRouteThreadId, setLastRouteThreadId] = useState(routeThreadId);
  if (lastRouteThreadId !== routeThreadId) {
    setLastRouteThreadId(routeThreadId);
    setActiveThreadId(routeThreadId);
    // A route change the adoption didn't cause (Back/Forward, a sidebar click)
    // abandons it: the hold below is keyed on the active thread anyway, and
    // dropping it here keeps the state from outliving its one beat.
    if (adoptedScope && adoptedScope.threadId !== routeThreadId) {
      setAdoptedScope(undefined);
    }
  }

  const threadReadState = useThreadReadState();
  const { thread: chat, isLoading: chatLoading } = useCliThread(activeThreadId, {
    suppressAutoReadThreadId: threadReadState?.suppressedAutoReadThreadId,
  });

  // Group scope, sticky while a Group child's doc loads: the incoming tab is a
  // child of the same container, so the strip, header and panels keep
  // rendering from `getGroup` (unchanged across the switch) instead of
  // blanking to a full-page skeleton.
  const [containerId, setContainerId] = useState<Id<"cliThreads"> | undefined>(
    undefined
  );
  const [containerDraftOpen, setContainerDraftOpen] = useState(false);
  const group = useQuery(
    api.cli.threads.groups.getGroup,
    containerId ? { containerId } : "skip"
  );
  const groupChild = group?.children.find((child) => child._id === activeThreadId);
  // The hold from a just-created Group child, live only while that thread is the
  // active one: any navigation elsewhere during the loading window falls
  // through to the rules below, so no stale group scope leaks onto an
  // unrelated thread (OS-1615).
  const isAdoptionLive =
    adoptedScope !== undefined && activeThreadId === adoptedScope.threadId && !chat;
  // The container's own URL redirects to a child (below), but it already names
  // the group: adopting it here runs `getGroup` alongside the child's fetch
  // instead of after it, and its `childCount` sizes the strip's placeholder
  // while both land (OS-1558).
  const nextContainerId = chat
    ? (chat.kind === "group" ? chat._id : chat.parentThreadId)
    : isAdoptionLive
      ? adoptedScope.containerId
      : groupChild
        ? containerId
        : undefined;
  // A container names its own count; a child carries its container's, which is
  // what a page load straight onto a child URL (reload, deep link) has to go
  // on — there is no container doc in that path.
  const [pendingTabCount, setPendingTabCount] = useState(0);
  if (nextContainerId !== containerId) {
    setContainerDraftOpen(false);
    setContainerId(nextContainerId);
    setPendingTabCount(
      (chat?.kind === "group" ? chat.childCount : chat?.containerChildCount) ?? 0
    );
  }
  // The new child's doc is authoritative once it lands: its `parentThreadId` is
  // the adopted container by construction, so the hold has nothing left to add.
  if (adoptedScope && chat?._id === adoptedScope.threadId) {
    setAdoptedScope(undefined);
  }

  // Known before the incoming Group child's doc resolves, so the group row never
  // deselects mid-switch.
  const sidebarHighlightId = containerId ?? activeThreadId;
  useEffect(() => {
    onSidebarHighlightChange({ route: routeThreadId, threadId: sidebarHighlightId });
  }, [onSidebarHighlightChange, routeThreadId, sidebarHighlightId]);

  // A Group child was just created (OS-1615). Adopting its container eagerly — in the same event as
  // the navigation — holds the workspace mounted: `containerId` keeps `getGroup` subscribed, and
  // the placeholder count keeps the strip its own size while the fresh group loads. On the first
  // group addition there is no group yet, so the source thread counts as one.
  const containerChildCount = group?.children.length;
  const adoptCreatedGroupScope = useCallback(
    (scope: { containerId: Id<"cliThreads">; threadId: Id<"cliThreads"> }) => {
      setAdoptedScope(scope);
      setContainerId(scope.containerId);
      setPendingTabCount((containerChildCount ?? 1) + 1);
    },
    [containerChildCount]
  );

  const currentSearch = navigation.location.search;
  const navigateToThreadTab = useCallback(
    (childId: string) => {
      setActiveThreadId(childId as Id<"cliThreads">);
      navigation.push({
        ...appRoute.projectThreadDetail(params.organizationSlug, params.projectAlias, childId),
        query: new URLSearchParams(currentSearch),
      });
    },
    [currentSearch, navigation, params.organizationSlug, params.projectAlias]
  );

  // The redirect below unmounts the container, so its doc is kept: its run and
  // task hold the Workflow and task tabs while the child's own doc loads (OS-2067).
  const [lastContainer, setLastContainer] = useState<CliThreadDetailItem | null>(null);
  if (chat?.kind === "group" && chat._id !== lastContainer?._id) {
    setLastContainer(chat);
  }

  // A group container has no transcript of its own — its URL resolves to a
  // child tab (OS-1477). A workflow run's container starts with no children
  // (lane threads are created lazily, OS-1366), so it renders the Run view
  // until the first lane thread exists.
  if (chat?.kind === "group") {
    if (chat.workflowRunId !== undefined && ((chat.childCount ?? 0) === 0 || containerDraftOpen)) {
      return (
        <WorkflowRunContainerView
          chat={chat}
          workflowRunId={chat.workflowRunId}
          organizationId={project?.organizationId}
          params={params}
          draftOpen={containerDraftOpen}
          onDraftOpenChange={setContainerDraftOpen}
          onCreated={navigateToThreadTab}
        />
      );
    }
    return <GroupContainerRedirect containerId={chat._id} params={params} />;
  }

  if (!chat) {
    if (!chatLoading) {
      return (
        <ThreadNotFound
          organizationSlug={params.organizationSlug}
          projectAlias={params.projectAlias}
        />
      );
    }
    // Cold entry and cross-group navigation still get the full skeleton; a
    // Group child tab switch — and a Group child the user just created, whose group is
    // known from `addThreadToGroup` before either doc lands (OS-1615) — keeps the
    // workspace and loads only the transcript. A newly created *root* thread
    // never reaches here: the host keeps its composer up until that doc lands
    // (OS-1660), since there is no transcript to render before it.
    if (!groupChild && !isAdoptionLive) {
      return <ThreadDetailSkeleton />;
    }
  }

  return (
    <ThreadWorkspaceBody
      chat={chat}
      threadId={activeThreadId}
      containerId={containerId}
      group={group}
      groupChild={groupChild}
      pendingTabCount={pendingTabCount}
      projectId={projectId}
      project={project}
      shell={shell}
      threadWorkspace={threadWorkspace}
      openTaskInSidebar={openTaskInSidebar}
      renderTaskPane={renderTaskPane}
      params={params}
      navigateToThreadTab={navigateToThreadTab}
      onAdoptCreatedGroupScope={adoptCreatedGroupScope}
      redirectedFrom={lastContainer && lastContainer._id === containerId ? lastContainer : undefined}
    />
  );
}

/** Resolve container entry to a child. All-done groups open the latest completion;
 * otherwise retain the remembered tab. Spec: docs/specs/thread-groups.md.
 */
function GroupContainerRedirect({
  containerId,
  params,
}: {
  containerId: Id<"cliThreads">;
  params: ThreadDetailRouteParams;
}) {
  const navigation = useNavigation();
  const group = useQuery(api.cli.threads.groups.getGroup, { containerId });
  const children = group?.children;
  // `children` gets a new identity on every getGroup update (a child's
  // activity bump could land mid-redirect) — resolve the default tab once.
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (hasRedirectedRef.current || !children || children.length === 0) {
      return;
    }
    const lastTabId = readGroupLastTab(containerId);
    const target =
      (children.some((child) => !child.isDone)
        ? children.find((child) => child._id === lastTabId)
        : undefined) ?? pickDefaultChild(children);
    if (!target) {
      return;
    }
    hasRedirectedRef.current = true;
    navigation.replace({
      ...appRoute.projectThreadDetail(params.organizationSlug, params.projectAlias, target._id),
      query: new URLSearchParams(navigation.location.search),
      hash: navigation.location.hash || null,
    });
  }, [children, containerId, navigation, params.organizationSlug, params.projectAlias]);

  // A live container always has children (it auto-deletes with its last live
  // member); an empty result here is a deletion race.
  if (group === null || group?.children.length === 0) {
    return (
      <ThreadNotFound
        organizationSlug={params.organizationSlug}
        projectAlias={params.projectAlias}
      />
    );
  }

  return <ThreadDetailSkeleton />;
}

/**
 * Everything below the stable layer. `chat` is null only for the round trip
 * after a group tab switch — the header, tab strip and panels then render
 * from the group's child row and only the transcript shows placeholders.
 */
function ThreadWorkspaceBody({
  chat,
  threadId,
  containerId,
  group,
  groupChild,
  pendingTabCount,
  projectId,
  project,
  shell,
  threadWorkspace,
  openTaskInSidebar,
  renderTaskPane,
  params,
  navigateToThreadTab,
  onAdoptCreatedGroupScope,
  redirectedFrom,
}: {
  chat: CliThreadDetailItem | null;
  threadId: Id<"cliThreads">;
  containerId: Id<"cliThreads"> | undefined;
  group: ThreadGroup | null | undefined;
  groupChild: ThreadGroupChild | undefined;
  /** The container's `childCount`, sizing the strip placeholder (OS-1558). */
  pendingTabCount: number;
  projectId: Id<"projects">;
  project: Doc<"projects"> | null | undefined;
  shell: ThreadShellState;
  threadWorkspace: ThreadWorkspaceTaskSidebar;
  openTaskInSidebar: (task: ThreadWorkspaceTaskTarget) => void;
  renderTaskPane: ThreadTaskPaneRenderer;
  params: ThreadDetailRouteParams;
  navigateToThreadTab: (childId: string) => void;
  /** Adopts a just-created Group child's group as the scope (OS-1615). */
  /** The container's doc, from before its redirect to this child. */
  redirectedFrom?: CliThreadDetailItem;
  onAdoptCreatedGroupScope: (scope: {
    containerId: Id<"cliThreads">;
    threadId: Id<"cliThreads">;
  }) => void;
}) {
  // The header's action buttons are toggles, which need a whole thread row — the group's child
  // row is not one. Keeping the outgoing tab's row for the round trip holds them in place
  // instead of blinking them out; they go inert meanwhile, since that row is not the thread
  // they would act on. Keyed by id, not identity: the doc's identity changes on every
  // run-lifecycle write, and refreshing a fallback only read while `chat` is null isn't worth
  // re-running this body for.
  const [lastChat, setLastChat] = useState(chat);
  if (chat && chat._id !== lastChat?._id) {
    setLastChat(chat);
  }
  const shellChat = chat ?? lastChat;
  // Who owns this view, and whether it is shared — both are container properties, identical on
  // every tab, so the outgoing row answers for the incoming one while its doc loads (OS-1579).
  // Scoped to the same container on purpose: `lastChat` is any previously opened thread, so an
  // unscoped fallback would carry one thread's ownership onto an unrelated one. Null on first
  // load, where the skeleton covers the beat.
  const ownershipChat =
    chat ??
    (containerId && lastChat?.parentThreadId === containerId ? lastChat : null);
  // The container keeps the Workflow tab stable across manual and lane tabs.
  const workflowRunId =
    ownershipChat?.containerWorkflowRunId ?? ownershipChat?.workflowRunId ?? redirectedFrom?.workflowRunId;
  // A project teammate viewing a thread shared with them (OS-1575). Everything that writes is
  // withheld below; see `docs/specs/cli-thread-sharing.md`. The two predicates are not
  // negations of each other while the thread loads — the helpers document why.
  //
  // Read from `ownershipChat`, not `chat`: an unknown owner reads as *not* read-only, so gating
  // on `chat` alone flashed the owner-only actions at a viewer for a round trip after every tab
  // click.
  const readOnly = threadIsReadOnly(ownershipChat);
  // The panel a viewer lands on: Changes needs the owner's CLI to serve files.
  const defaultPanel: ThreadWorkspaceTab = readOnly ? "tasks" : "changes";
  const cliMessages = useCliMessages(threadId, {
    canWrite: threadCanWrite(chat),
  });
  const { envelopes, isLoading: messagesLoading, userTextById } = cliMessages;
  // Both detail subscriptions a mutation must keep coherent optimistically.
  const patchTarget = useMemo(
    () => ({ threadId, containerId }),
    [containerId, threadId]
  );
  const baseUpdateTitle = useMutation(api.cli.threads.core.updateTitle);
  const baseMarkRead = useMutation(api.cli.threads.core.markRead);
  const baseMarkUnread = useMutation(api.cli.threads.core.markUnread);
  const baseRemove = useMutation(api.cli.threads.core.remove);
  const baseMarkDone = useMutation(api.cli.threads.batch.batchMarkDone);
  const baseMarkNotDone = useMutation(api.cli.threads.batch.batchMarkNotDone);
  const baseMoveChildOut = useMutation(api.cli.threads.groups.moveChildOut);
  // Memoized because `withOptimisticUpdate` returns a new function on every
  // call and these all feed useCallback deps below — without this every
  // handler would rebuild on each stream chunk.
  const {
    updateTitleMutation,
    markReadMutation,
    markUnreadMutation,
    removeMutation,
    markDoneMutation,
    markNotDoneMutation,
    moveChildOutMutation,
  } = useMemo(
    () => ({
      updateTitleMutation: baseUpdateTitle.withOptimisticUpdate((localStore, args) => {
        patchThreadQueries(localStore, patchTarget, { title: args.title });
      }),
      markReadMutation: baseMarkRead.withOptimisticUpdate((localStore, args) => {
        patchThreadQueries(localStore, patchTarget, {
          hasUnread: false,
          ...(args.acknowledgeAttention ? { requiresAttention: false } : {}),
        });
      }),
      markUnreadMutation: baseMarkUnread.withOptimisticUpdate((localStore) => {
        patchThreadQueries(localStore, patchTarget, { hasUnread: true });
      }),
      removeMutation: baseRemove.withOptimisticUpdate((localStore) => {
        removeThreadFromGroup(localStore, patchTarget);
      }),
      // Done re-sorts the tab to the end of the strip (OS-1478), so it has to
      // land before the round trip or the tab jumps a beat later. Both
      // wrappers patch this thread only — the workspace never toggles a batch,
      // so they take the active thread rather than reading `args.threadIds`.
      markDoneMutation: baseMarkDone.withOptimisticUpdate((localStore) => {
        // Done implies read on the server (`patchThreadDone` stamps `readAt` with `doneAt`), so the
        // unread dot must clear in the same beat as the strike-through — on a done tab that dot is
        // the only glyph left, so it would be the one thing the user watches fail to settle
        // (OS-1618).
        patchThreadQueries(localStore, patchTarget, {
          isDone: true,
          doneAt: Date.now(),
          hasUnread: false,
        });
      }),
      markNotDoneMutation: baseMarkNotDone.withOptimisticUpdate((localStore) => {
        patchThreadQueries(localStore, patchTarget, { isDone: false, doneAt: undefined });
      }),
      moveChildOutMutation: baseMoveChildOut.withOptimisticUpdate((localStore) => {
        moveThreadOutOfGroup(localStore, patchTarget);
      }),
    }),
    [
      baseMarkDone,
      baseMarkNotDone,
      baseMarkRead,
      baseMarkUnread,
      baseMoveChildOut,
      baseRemove,
      baseUpdateTitle,
      patchTarget,
    ]
  );
  const pinMutation = useMutation(api.cli.threads.core.pin);
  const unpinMutation = useMutation(api.cli.threads.core.unpin);
  const threadReadState = useThreadReadState();
  const navigation = useNavigation();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Fixed-tab sidebar: Changes (default), Tasks, and the task detail tab while
  // a task is selected. Closing the sidebar keeps the active panel and the
  // Changes view. The pane's open/closed flag and layout mode live in the host
  // so a first send keeps them (OS-1660); the panel *pick* resolves here,
  // against a default only this component knows (a viewer rests on Tasks).
  const {
    sidebarOpen,
    openSidebar,
    toggleSidebar: handleToggleSidebar,
    closeSidebar: handleCloseSidebar,
    paneClosedAtTaskOpen,
    chosenPanel,
    setChosenPanel: setActivePanel,
    panelBeforeUrlTab: chosenPanelBeforeUrlTab,
    setPanelBeforeUrlTab,
    layoutMode,
    setLayoutMode,
    isMobile,
    isFullView,
  } = shell;
  const activePanel = chosenPanel ?? (isFullView ? "thread" : defaultPanel);
  // `panelBeforeUrlTab` holds only *unconditional* panels, so it can never name
  // a tab that has since closed (OS-1569) — null, or a conditional tab a
  // previous view left behind, both resolve to this view's default.
  const panelBeforeUrlTab: ThreadWorkspaceTab =
    chosenPanelBeforeUrlTab === null ||
    chosenPanelBeforeUrlTab === "task" ||
    chosenPanelBeforeUrlTab === "artifact"
      ? defaultPanel
      : chosenPanelBeforeUrlTab;
  const [changesView, setChangesView] = useState<ThreadChangesView>({ kind: "latest" });
  const [changesAllCollapsed, setChangesAllCollapsed] = useState(false);
  const [changesDiffStyle, setChangesDiffStyle] = useState<ChangesDiffStyle>(readChangesDiffStyle);
  const [changesFileTree, setChangesFileTree] = useState(readChangesFileTree);
  const [changesWordWrap, setChangesWordWrap] = useState(readChangesWordWrap);
  // Run (or single file, OS-1156) awaiting revert confirmation, and the
  // in-flight revert op (OS-1151).
  const [revertTarget, setRevertTarget] = useState<{
    diffSummary: CliRunDiffSummaryPreview;
    file?: CliRunDiffFile;
  } | null>(null);
  const [revertOpId, setRevertOpId] = useState<Id<"cliWorktreeOps"> | null>(null);

  const activeProfile = useQuery(
    api.cli.profiles.get,
    chat ? { profileId: chat.profileId } : "skip"
  );
  // The artifact tab renders without task context, so it resolves its own —
  // the name for the tab label, then the owning task for the read-only gate and
  // the comments-to-thread handoff. Same pair the full-page route uses.
  const threadArtifactId = threadWorkspace.threadArtifactId;
  const closeThreadArtifact = threadWorkspace.closeThreadArtifact;
  const threadArtifact = useTaskArtifact(threadArtifactId);
  const updateThreadArtifact = useUpdateTaskArtifact();
  const {
    task: threadArtifactTask,
    isReadOnly: threadArtifactIsReadOnly,
  } = useArtifactOwningTask(threadArtifact?.taskId);
  // Self-correction, so it replaces rather than pushes: a push would put a
  // cleaned URL on top of the invalid entry, and Back would return to the
  // invalid one, re-correct, and push again — trapping Back (OS-1569).
  const clearInvalidThreadArtifact = useCallback(
    () => closeThreadArtifact({ history: "replace" }),
    [closeThreadArtifact]
  );

  // Range for the cumulative "All changes" view (OS-1158): oldest loaded
  // run's preRef → newest run's postRef. Files stay empty — the viewer
  // derives them from the fetched patch. Envelopes are oldest-first; runs
  // beyond the loaded chunks are outside the range.
  const cumulativeDiffSummary = useMemo<CliRunDiffSummary | null>(() => {
    const summaries = envelopes.flatMap((message) =>
      message.role === "assistant" && message.diffSummary ? [message.diffSummary] : []
    );
    if (summaries.length === 0) {
      return null;
    }
    return {
      preRef: summaries[0].preRef,
      postRef: summaries[summaries.length - 1].postRef,
      files: [],
    };
  }, [envelopes]);

  // Pushes `task=<REF>` and reveals the tab (`setTask` carries `revealTaskTab`);
  // the mirror below keeps back/forward and deep links in sync.
  const handleOpenTaskInSidebar = openTaskInSidebar;

  // Tool parts carry only a ref, never the archived flag. Opening `active` is
  // safe: the sidebar hook's URL correction replaces the filter once the task
  // resolves as archived (OS-1686).
  const handleOpenTaskRef = useCallback(
    (refId: string) => {
      openTaskInSidebar({ refId });
    },
    [openTaskInSidebar]
  );

  // Where deleting the active group child lands: the most recently active
  // remaining Group child, not the thread list, which would eject the user from
  // a group whose tabs are still right there (OS-1477).
  const navigateAfterLeavingGroup = useCallback(
    () => {
      const groupChild = pickDefaultChild(group?.children ?? [], { exclude: threadId });
      if (groupChild) {
        navigateToThreadTab(groupChild._id);
        return;
      }
      navigation.push(
        appRoute.projectThreads(params.organizationSlug, params.projectAlias)
      );
    },
    [group, navigateToThreadTab, navigation, params.organizationSlug, params.projectAlias, threadId]
  );

  // Narrow reads off the (possibly still loading) thread doc: the handlers
  // below depend on these instead of `chat`, which gets a new identity on
  // every stream chunk.
  const hasUnread = chat?.hasUnread;
  const requiresAttention = chat?.requiresAttention;

  const handleTitleCommit = useCallback(
    async (nextTitle: string) => {
      await updateTitleMutation({
        threadId,
        title: nextTitle,
      });
    },
    [threadId, updateTitleMutation]
  );

  const handleToggleRead = useCallback(async () => {
    try {
      if (hasUnread || requiresAttention) {
        threadReadState?.clearSuppressionIfMatches(threadId);
        await markReadMutation({
          threadId,
          acknowledgeAttention: requiresAttention === true,
        });
        return;
      }

      threadReadState?.setSuppressedAutoReadThreadId(threadId);
      try {
        await markUnreadMutation({ threadId });
      } catch (error) {
        threadReadState?.clearSuppressionIfMatches(threadId);
        throw error;
      }
    } catch {
      toast.error("Failed to update read state");
    }
  }, [
    hasUnread,
    markReadMutation,
    markUnreadMutation,
    requiresAttention,
    threadId,
    threadReadState,
  ]);

  const handlePinToggle = useCallback(async () => {
    try {
      await (chat?.isPinned ? unpinMutation : pinMutation)({ threadId });
    } catch {
      toast.error("Failed to update pin");
    }
  }, [chat?.isPinned, pinMutation, threadId, unpinMutation]);

  const handleToggleDone = useCallback(
    async (isDone: boolean) => {
      try {
        await (isDone ? markNotDoneMutation : markDoneMutation)({ threadIds: [threadId] });
      } catch {
        toast.error("Failed to update done state");
      }
    },
    [markDoneMutation, markNotDoneMutation, threadId]
  );

  // No navigation: the thread the user is reading is still the thread they are
  // reading — only its strip collapses (OS-1478). The container dissolves
  // server-side when this was its last member.
  const handleMoveOut = useCallback(async () => {
    try {
      await moveChildOutMutation({ threadId });
    } catch {
      toast.error("Failed to move the thread out of the group");
    }
  }, [moveChildOutMutation, threadId]);

  const handleDelete = useCallback(async () => {
    try {
      await removeMutation({ threadId });
      navigateAfterLeavingGroup();
    } catch {
      toast.error("Failed to delete thread");
    }
  }, [navigateAfterLeavingGroup, removeMutation, threadId]);

  const selectedTask = threadWorkspace.detailsTask;
  const closeTaskSidebar = threadWorkspace.closeTaskSidebar;
  const setAttachedTask = threadWorkspace.setAttachedTask;
  const taskLinkHref = threadWorkspace.taskLinkHref;
  // ThreadView's task targets carry an optional isArchived flag.
  const threadViewTaskLinkHref = useCallback(
    (task: { refId: string; isArchived?: boolean }) =>
      taskLinkHref({ refId: task.refId, isArchived: task.isArchived === true }),
    [taskLinkHref]
  );

  // Task detail is URL-driven; mirror it into the task tab so back/forward and
  // every task-open affordance stay in sync. In an *effect*, not the render
  // phase: the panel state lives in the host since OS-1660, and adjusting a
  // parent's state during our own render is a cross-component setState.
  //
  // ponytail: one mirror for the two URL-backed tabs. Extract a hook owning
  // tab-vs-URL reconciliation for the whole strip when a third lands
  // (sub-thread tabs, per `thread-sidebar-tabs.tsx`) — a stack of previous tabs
  // that evicts closed entries generalizes; one slot does not.
  //
  // Both URL-backed tabs go through ONE mirror, keyed off the raw query params.
  // Two independent mirrors raced: this one fired on first paint while the task
  // one waited for `getByRefs`, so a `?task=&threadArtifact=` deep link landed
  // on the artifact tab and then had it stolen a round trip later (OS-1569).
  // Raw params are both known on first paint, so precedence is a decision here
  // rather than an accident of subscription latency: the tab whose param
  // *changed* wins, and when both change at once the artifact wins — it is the
  // more specific target, and the task tab stays in the strip either way.
  const selectedTaskRefId = threadWorkspace.taskRefId;
  const lastUrlTabIdsRef = useRef<{ task: string | null; artifact: string | null }>({
    task: null,
    artifact: null,
  });
  // Read through refs so the effect depends only on the params: it reacts to a
  // URL change, and re-running it because the user picked a panel would drag
  // that panel back to whatever the URL implies.
  const activePanelRef = useRef(activePanel);
  activePanelRef.current = activePanel;
  const panelBeforeUrlTabRef = useRef(panelBeforeUrlTab);
  panelBeforeUrlTabRef.current = panelBeforeUrlTab;
  const isFullViewRef = useRef(isFullView);
  isFullViewRef.current = isFullView;
  const paneClosedAtTaskOpenRef = useRef(paneClosedAtTaskOpen);
  paneClosedAtTaskOpenRef.current = paneClosedAtTaskOpen;
  useEffect(() => {
    const lastUrlTabIds = lastUrlTabIdsRef.current;
    if (
      lastUrlTabIds.task === selectedTaskRefId &&
      lastUrlTabIds.artifact === threadArtifactId
    ) {
      return;
    }
    const taskOpened = selectedTaskRefId && lastUrlTabIds.task !== selectedTaskRefId;
    const artifactOpened =
      threadArtifactId && lastUrlTabIds.artifact !== threadArtifactId;
    lastUrlTabIdsRef.current = { task: selectedTaskRefId, artifact: threadArtifactId };

    const currentPanel = activePanelRef.current;
    const nextTab: ThreadWorkspaceTab | null = artifactOpened
      ? "artifact"
      : taskOpened
        ? "task"
        : null;

    if (nextTab) {
      // Only remember unconditional panels — see `panelBeforeUrlTab`.
      if (currentPanel !== "task" && currentPanel !== "artifact") {
        setPanelBeforeUrlTab(currentPanel);
      }
      setActivePanel(nextTab);
      if (!isFullViewRef.current) {
        openSidebar();
      }
    } else if (currentPanel === "artifact" && !threadArtifactId) {
      // Closing one URL tab falls back to the other if it is still open.
      setActivePanel(selectedTaskRefId ? "task" : panelBeforeUrlTabRef.current);
    } else if (currentPanel === "task" && !selectedTaskRefId) {
      setActivePanel(threadArtifactId ? "artifact" : panelBeforeUrlTabRef.current);
    }

    // Last URL tab closed: close the pane if the task click found it closed (see `revealTaskTab`).
    if (
      lastUrlTabIds.task &&
      !selectedTaskRefId &&
      !threadArtifactId &&
      paneClosedAtTaskOpenRef.current &&
      !isFullViewRef.current
    ) {
      handleCloseSidebar();
    }
  }, [
    handleCloseSidebar,
    openSidebar,
    selectedTaskRefId,
    setActivePanel,
    setPanelBeforeUrlTab,
    threadArtifactId,
  ]);

  // Selects the tab as well as pushing the param. The param-keyed mirror above
  // is edge-triggered, and re-clicking the same link builds an identical URL
  // that `navigate` early-returns on — so without this the click is a no-op
  // whenever the artifact tab is already open but not active (OS-1569).
  const selectThreadArtifact = threadWorkspace.selectThreadArtifact;
  const handleOpenArtifact = useCallback(
    (artifactId: string) => {
      selectThreadArtifact(artifactId);
      // Same bookkeeping as the mirror, so closing the tab still returns to an
      // unconditional panel rather than a stale remembered one.
      if (activePanel !== "task" && activePanel !== "artifact") {
        setPanelBeforeUrlTab(activePanel);
      }
      setActivePanel("artifact");
      if (!isFullView) {
        openSidebar();
      }
    },
    [activePanel, isFullView, selectThreadArtifact]
  );

  const handleOpenDiffFile = useCallback(
    (file: CliRunDiffFile, diffSummary: CliRunDiffSummaryPreview) => {
      setChangesView({ kind: "run", diffSummary, file });
      setActivePanel("changes");
      // Full view has no pane; leaving the flag alone keeps it meaning
      // "the split pane was open", which is what the mode toggle reads.
      if (!isFullView) {
        openSidebar();
      }
    },
    [isFullView, openSidebar, setActivePanel]
  );
  const handleSelectChangesView = useCallback(
    (kind: "latest" | "all" | "worktree" | "history") => {
      setChangesView({ kind });
      setActivePanel("changes");
    },
    [setActivePanel]
  );
  // Kept here, not in the panel: a full-view switch remounts the panel (UX OS-2535 round 1).
  const [historyDiffShown, setHistoryDiffShown] = useState(true);
  const handleOpenHistoryCommit = useCallback((commit: string | null) => setChangesView({ kind: "history", ...(commit ? { commit } : {}) }), []);
  // The toggle moves between the header and the sidebar tab bar; focus follows it.
  const layoutToggleRef = useRef<HTMLButtonElement>(null);
  const refocusLayoutToggle = useRef(false);
  useEffect(() => {
    if (refocusLayoutToggle.current) {
      refocusLayoutToggle.current = false;
      layoutToggleRef.current?.focus();
    }
  }, [isFullView]);
  const handleToggleLayoutMode = useCallback(() => {
    const next: ThreadLayoutMode = layoutMode === "full" ? "split" : "full";
    // Split has no thread panel; full view keeps whatever the open sidebar was
    // showing (widening it is the point) and otherwise lands on the thread so
    // the conversation doesn't disappear.
    const nextPanel: ThreadWorkspaceTab =
      activePanel === "task" || activePanel === "artifact"
        ? activePanel
        : next === "split"
          ? activePanel === "thread"
            ? defaultPanel
            : activePanel
          : sidebarOpen
            ? activePanel
            : "thread";

    refocusLayoutToggle.current = true;
    setLayoutMode(next);
    setActivePanel(nextPanel);
    // Split always lands with the pane open on `nextPanel` — the panel tabs
    // only exist in the sidebar there, so leaving it collapsed would hide them
    // entirely. Switching to full leaves the flag alone — it remembers whether
    // the pane was open for the trip back.
    if (next === "split") {
      openSidebar();
    }
  }, [activePanel, defaultPanel, layoutMode, openSidebar, setActivePanel, setLayoutMode, sidebarOpen]);
  useThreadTasksHotkey({
    // Nothing to toggle while the transcript is still a skeleton — the guard the
    // pre-OS-1660 registration used.
    enabled: !messagesLoading,
    activePanel,
    isFullView,
    toggleSidebar: handleToggleSidebar,
    revealTasks: useCallback(() => {
      setActivePanel("tasks");
      openSidebar();
    }, [openSidebar, setActivePanel]),
    showThread: useCallback(() => setActivePanel("thread"), [setActivePanel]),
  });
  // `D` toggles done. Gated like the header button: not for viewers, not mid-run.
  useHotkey(
    THREAD_TOGGLE_DONE_HOTKEY,
    (event) => {
      if (!chat || isEditableHotkeyTarget(document.activeElement)) {
        return;
      }
      event.preventDefault();
      void handleToggleDone(chat.isDone);
    },
    { enabled: chat != null && !readOnly }
  );

  useHotkey(
    THREAD_TOGGLE_READ_HOTKEY,
    (event) => {
      if (!chat || isEditableHotkeyTarget(document.activeElement)) {
        return;
      }
      event.preventDefault();
      void handleToggleRead();
    },
    { enabled: chat != null && !readOnly }
  );

  const isProfileOnline = activeProfile?.isOnline ?? false;
  const chatProfileId = chat?.profileId;
  const chatPathId = chat?.pathId;
  // Undefined for a viewer: every file read and every revert goes through
  // `cli.worktreeOps.enqueue`, which is owner-scoped. Dropping the context is
  // what strips the run cards' file links and Undo — the inline "N files
  // changed" summary is denormalized on the message and survives.
  const runFileOpContext = useMemo(
    () =>
      !readOnly && chatProfileId && chatPathId
        ? { profileId: chatProfileId, pathId: chatPathId, isProfileOnline }
        : undefined,
    [chatProfileId, chatPathId, isProfileOnline, readOnly]
  );
  const enqueueWorktreeOp = useMutation(api.cli.worktreeOps.enqueue);
  const revertOp = useQuery(
    api.cli.worktreeOps.get,
    revertOpId ? { opId: revertOpId } : "skip"
  );
  // Surface the outcome of a requested run revert (OS-1151) exactly once per
  // op; the row subscription simply goes quiet after (rows are TTL-pruned).
  const revertToastedOpIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!revertOpId || !revertOp || revertOp.status === "pending") {
      return;
    }
    if (revertToastedOpIdRef.current === revertOpId) {
      return;
    }
    revertToastedOpIdRef.current = revertOpId;
    if (revertOp.status === "failed") {
      toast.error(revertOp.error ?? "Failed to revert the changes");
    } else {
      toast.success(revertOp.filePath ? "File reverted" : "Run changes reverted");
    }
  }, [revertOp, revertOpId]);
  const handleConfirmRevert = useCallback(() => {
    const target = revertTarget;
    setRevertTarget(null);
    if (!target || !runFileOpContext) {
      return;
    }
    if (!runFileOpContext.isProfileOnline) {
      toast.error("CLI offline. Connect it to undo changes.");
      return;
    }
    enqueueWorktreeOp({
      profileId: runFileOpContext.profileId as Id<"cliProfiles">,
      // revertFile restores one file (OS-1156); revertRun the whole run.
      kind: target.file ? "revertFile" : "revertRun",
      pathId: runFileOpContext.pathId,
      preRef: target.diffSummary.preRef,
      ...(target.file ? { filePath: target.file.path } : {}),
    })
      .then(setRevertOpId)
      .catch((error) => {
        toast.error(getErrorMessage(error, "Failed to revert the changes"));
      });
  }, [enqueueWorktreeOp, revertTarget, runFileOpContext]);

  const composerControllerRef = useRef<ThreadComposerControllerApi | null>(null);

  // "Mention in reply" (OS-1159): append the file's @path pill to the
  // composer draft and focus it. Fail-soft when the composer isn't mounted.
  const handleMentionFile = useCallback((path: string) => {
    composerControllerRef.current?.insertFileMention(path);
  }, []);
  const handleRevertRun = useCallback(
    (diffSummary: CliRunDiffSummaryPreview) => setRevertTarget({ diffSummary }),
    []
  );
  const handleRevertFile = useCallback(
    (file: CliRunDiffFile, diffSummary: CliRunDiffSummaryPreview) =>
      setRevertTarget({ diffSummary, file }),
    []
  );
  // Run timeline (OS-1160): browse runs, range-select a span to diff it,
  // restore to before any run.
  const timelineRuns = useMemo(
    () => buildTimelineRuns(envelopes, userTextById),
    [envelopes, userTextById]
  );
  // The "latest" view follows the newest loaded run with a summary, so it moves
  // as runs land; its checkpoints are the last the CLI prunes (OS-1882).
  const viewerDiffSummary =
    changesView.kind === "run"
      ? changesView.diffSummary
      : changesView.kind === "latest"
        ? timelineRuns.at(-1)?.diffSummary
        : undefined;
  // Stable identity: an inline closure here would defeat the memoized file
  // sections inside the viewer on every page render (frequent while
  // streaming).
  const handleRevertViewerFile = useCallback(
    (file: CliRunDiffFile) => {
      if (viewerDiffSummary) {
        setRevertTarget({ diffSummary: viewerDiffSummary, file });
      }
    },
    [viewerDiffSummary]
  );

  // Shown on the changes toolbar selector.
  const changesViewLabel = useMemo(() => {
    if (changesView.kind === "latest") {
      return "Latest run";
    }
    if (changesView.kind === "all") {
      return "All changes";
    }
    if (changesView.kind === "worktree") {
      return "Working tree";
    }
    if (changesView.kind === "history") {
      return "History";
    }
    if (changesView.kind === "range") {
      return changesView.label;
    }
    const index = timelineRuns.findIndex(
      (run) => run.diffSummary.postRef === changesView.diffSummary.postRef
    );
    return index >= 0 ? `Run ${index + 1}` : "Run";
  }, [changesView, timelineRuns]);
  // Range keys opened this session stay subscribed so pending comments made
  // in a range keep pilling after its viewer closes. ponytail: dropped on
  // reload (comments stay in localStorage) — reopen the range to re-pill.
  const [openedRangeKeys, setOpenedRangeKeys] = useState<string[]>([]);
  const handleOpenTimelineRange = useCallback(
    (diffSummary: CliRunDiffSummary, span: { from: number; to: number }) => {
      const key = `${diffSummary.preRef}..${diffSummary.postRef}`;
      setOpenedRangeKeys((keys) => (keys.includes(key) ? keys : [...keys, key]));
      // ponytail: numbers are 1-based over the *loaded* runs — loading older
      // chunks shifts them; the refs in the id stay the source of truth.
      const label =
        span.from === span.to ? `Run ${span.from}` : `Runs ${span.from}-${span.to}`;
      setChangesView({ kind: "range", diffSummary, label });
      setActivePanel("changes");
      openSidebar();
    },
    [openSidebar, setActivePanel]
  );

  // Inline review comments across this thread's runs (OS-1155): pending
  // comments surface as a composer pill and ride the next sent message.
  const runPostRefs = useMemo(
    () =>
      envelopes.flatMap((message) =>
        message.role === "assistant" && message.diffSummary
          ? [message.diffSummary.postRef]
          : []
      ),
    [envelopes]
  );
  // Comments in the cumulative view live in their own `preRef..postRef` slices — bare-postRef
  // keys would collide with the latest run's slice while deletion-side line numbers reference
  // the thread-start state. One key per historical endpoint, so drafts made before a new run
  // landed keep pilling.
  //
  // ponytail: loading older chunks moves preRef, so drafts under the previous one drop off the
  // pill until sent; fix if anyone notices.
  const cumulativePreRef = cumulativeDiffSummary?.preRef;
  const reviewRefs = useMemo(() => {
    const keys = cumulativePreRef
      ? [
          ...runPostRefs,
          ...runPostRefs.map((postRef) => `${cumulativePreRef}..${postRef}`),
        ]
      : [...runPostRefs];
    // Timeline ranges opened this session (OS-1160); may overlap the
    // cumulative keys, hence the dedupe.
    for (const key of openedRangeKeys) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
    return keys;
  }, [runPostRefs, cumulativePreRef, openedRangeKeys]);
  const {
    allComments: allReviewComments,
    commentsByRef: reviewCommentsByRef,
    upsertComment: upsertReviewComment,
    removeComment: removeReviewComment,
    clearAllComments: clearAllReviewComments,
  } = useThreadRunReviewComments(reviewRefs);
  const viewerPostRef = viewerDiffSummary?.postRef;
  const viewerReview = useMemo<RunFileViewerReview | undefined>(() => {
    if (!viewerPostRef) {
      return undefined;
    }
    return {
      comments: reviewCommentsByRef.get(viewerPostRef) ?? [],
      upsertComment: (anchor, note, excerpt) =>
        upsertReviewComment(viewerPostRef, anchor, note, excerpt),
      removeComment: (anchor) => removeReviewComment(viewerPostRef, anchor),
    };
  }, [removeReviewComment, reviewCommentsByRef, upsertReviewComment, viewerPostRef]);
  const cumulativeReviewKey = cumulativeDiffSummary
    ? `${cumulativeDiffSummary.preRef}..${cumulativeDiffSummary.postRef}`
    : undefined;
  const cumulativeReview = useMemo<RunFileViewerReview | undefined>(() => {
    if (!cumulativeReviewKey) {
      return undefined;
    }
    return {
      comments: reviewCommentsByRef.get(cumulativeReviewKey) ?? [],
      upsertComment: (anchor, note, excerpt) =>
        upsertReviewComment(cumulativeReviewKey, anchor, note, excerpt),
      removeComment: (anchor) => removeReviewComment(cumulativeReviewKey, anchor),
    };
  }, [cumulativeReviewKey, removeReviewComment, reviewCommentsByRef, upsertReviewComment]);
  const rangeDiffSummary =
    changesView.kind === "range" ? changesView.diffSummary : undefined;
  const rangeReviewKey = rangeDiffSummary
    ? `${rangeDiffSummary.preRef}..${rangeDiffSummary.postRef}`
    : undefined;
  const rangeReview = useMemo<RunFileViewerReview | undefined>(() => {
    if (!rangeReviewKey) {
      return undefined;
    }
    return {
      comments: reviewCommentsByRef.get(rangeReviewKey) ?? [],
      upsertComment: (anchor, note, excerpt) =>
        upsertReviewComment(rangeReviewKey, anchor, note, excerpt),
      removeComment: (anchor) => removeReviewComment(rangeReviewKey, anchor),
    };
  }, [rangeReviewKey, removeReviewComment, reviewCommentsByRef, upsertReviewComment]);

  // Append the serialized feedback to the outgoing message; clear the
  // comments only after the send succeeded.
  const wrapSubmitWithReview = useCallback(
    (submit: ThreadViewSubmitHandler): ThreadViewSubmitHandler =>
      async (message) => {
        // Runtime commands (e.g. /compact) go to the agent verbatim — appending
        // feedback would corrupt them, so the pill waits for the next message.
        if (allReviewComments.length === 0 || message.runtimeCommand) {
          await submit(message);
          return;
        }
        const feedback = composeReviewFeedbackMessage(allReviewComments);
        const text = message.text.trim().length > 0
          ? `${message.text.trimEnd()}\n\n${feedback}`
          : feedback;
        await submit({ ...message, text });
        clearAllReviewComments();
      },
    [allReviewComments, clearAllReviewComments]
  );
  const reviewCommentsPill = useMemo(
    () =>
      allReviewComments.length > 0 ? (
        <RunReviewCommentsPill
          comments={allReviewComments}
          onClear={clearAllReviewComments}
        />
      ) : undefined,
    [allReviewComments, clearAllReviewComments]
  );

  // No full-page skeleton once the thread itself resolved (OS-1434), and none
  // at all while switching group tabs (OS-1558): the incoming tab's title
  // comes from the group's child row, so the header and strip are correct
  // before that thread's `get` lands.
  const threadTitle = (chat ?? groupChild)?.title.trim() || "New thread";
  const associatedTask = chat?.associatedTask;
  const associatedTaskRefId = associatedTask?.refId;

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.title = associatedTaskRefId
      ? `${associatedTaskRefId} ${threadTitle} · Convoy`
      : `${threadTitle} · Convoy`;
  }, [associatedTaskRefId, threadTitle]);

  // Only this host can export: the transcript exists in the client for the open
  // thread (docs/specs/cli-thread-markdown-export.md).
  const { exportMarkdown } = useThreadMarkdownExport({
    title: threadTitle,
    taskRef: associatedTaskRefId,
    cliType: chat?.cliType,
    forkedFrom: chat?.forkedFrom,
    cliMessages,
  });

  // A panel tab covers the thread instead of replacing it (see the overlay
  // below).
  const isPanelTabActive = isFullView && activePanel !== "thread";
  const layoutToggleLabel = isFullView
    ? "Switch to split view"
    : "Switch to full-width tabs";

  // The same menu backs the mobile header, the thread tab's `...` button and its right-click
  // menu; spelling it out three times is how they drift. Renders from the outgoing tab's row
  // while the incoming one loads (see `shellChat`), with the surrounding cluster inert for that
  // beat; consumers that can't go inert gate on `chat` instead, since its toggles read the
  // rendered row but mutate `threadId`.
  //
  // Null for a viewer: every entry is a write. That also empties the tab context menu and both
  // `...` menus, which all render from it.
  const threadActionProps = shellChat && !readOnly
    ? {
        chat: shellChat,
        isCurrentThread: true,
        organizationSlug: params.organizationSlug,
        projectAlias: params.projectAlias,
        onRenameRequest: () => setRenameDialogOpen(true),
        onToggleReadRequest: () => void handleToggleRead(),
        onToggleDoneRequest: () => void handleToggleDone(shellChat.isDone),
        onPinRequest: () => void handlePinToggle(),
        // Workflow-owned threads stay attached; manual children can leave.
        ...(group && shellChat.workflowRunId === undefined
          ? { onMoveOutRequest: () => void handleMoveOut() }
          : {}),
        onExportMarkdownRequest: exportMarkdown,
        onDeleteRequest: () => setDeleteDialogOpen(true),
      }
    : null;

  // Task refs of the Group child tabs, resolved by a second query keyed on task
  // ids: `getGroup` re-runs on every stream chunk (it reads the child rows),
  // so resolving tasks there would put those reads on the hot path. This one
  // only reads tasks/projects, so it recomputes when a task actually changes.
  const groupChildTaskIds = useMemo(
    () => [
      ...new Set(
        (group?.children ?? []).flatMap((child) =>
          child.associatedTaskId ? [child.associatedTaskId] : []
        )
      ),
    ],
    [group]
  );
  const groupChildTasks = useQuery(
    api.tasks.core.getSummariesByIds,
    groupChildTaskIds.length > 0 ? { taskIds: groupChildTaskIds } : "skip"
  );
  // The strip waits for those refs — rendering the tabs a round trip earlier resizes every one
  // of them when the refs land, which reads as a flicker.
  //
  // Sticky once ready, deliberately one-way: a new Group child with an unseen task id changes this
  // query's args, so it goes `undefined` for a round trip. Reopening the gate there would blank
  // the whole strip — the very blink OS-1615 removes — against one tab rendering without its
  // chip for a beat. That path only became live once the send stopped remounting this
  // component, so the stickiness is now load-bearing rather than incidental.
  const [tabRefsReady, setTabRefsReady] = useState(false);
  const tabRefsPending =
    (containerId !== undefined && group === undefined) ||
    (groupChildTaskIds.length > 0 && groupChildTasks === undefined);
  if (!tabRefsReady && !tabRefsPending) {
    setTabRefsReady(true);
  }
  const tabTaskByThreadId = useMemo(() => {
    const byTaskId = new Map((groupChildTasks ?? []).map((task) => [task._id, task]));
    const byThreadId = new Map<string, NonNullable<typeof associatedTask>>();
    for (const child of group?.children ?? []) {
      const summary = child.associatedTaskId ? byTaskId.get(child.associatedTaskId) : undefined;
      if (summary) {
        byThreadId.set(child._id, summary);
      }
    }
    // The active thread's own ref comes from its `get` — the only source
    // before a group exists, and the fresher one once loaded.
    if (associatedTask) {
      byThreadId.set(threadId, associatedTask);
    }
    return byThreadId;
  }, [associatedTask, group, groupChildTasks, threadId]);

  // The attached task is the default tab, offered once per thread visit: on
  // arrival if the pane is open, else on its header toggle (OS-2067).
  // A Group child's task is known before its own doc lands: from the strip, or
  // from the container it was redirected from when they share the task.
  const redirectedFromTask = redirectedFrom?.associatedTask;
  const attachedTaskSummary =
    tabTaskByThreadId.get(threadId) ??
    (redirectedFromTask && redirectedFromTask._id === groupChild?.associatedTaskId
      ? redirectedFromTask
      : undefined);
  const attachedTaskOfferRef = useRef<{ threadId: string; pending: boolean } | null>(null);
  const setTask = threadWorkspace.setTask;
  const offerAttachedTask = useCallback(() => {
    const offer = attachedTaskOfferRef.current;
    if (!offer?.pending || offer.threadId !== threadId) {
      return false;
    }
    offer.pending = false;
    const task = attachedTaskSummary;
    if (!task || selectedTaskRefId || threadArtifactId) {
      return false;
    }
    setTask(task.refId, getThreadWorkspaceArchiveFilter(task.isArchived), { history: "replace" });
    return true;
  }, [attachedTaskSummary, selectedTaskRefId, setTask, threadArtifactId, threadId]);
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;
  const attachedTaskKnown =
    chat?._id === threadId ||
    (groupChild !== undefined && (!groupChild.associatedTaskId || attachedTaskSummary !== undefined));
  // Layout effect: the tab is in place on the first paint, not a frame later.
  useLayoutEffect(() => {
    if (!attachedTaskKnown || attachedTaskOfferRef.current?.threadId === threadId) {
      return;
    }
    attachedTaskOfferRef.current = { threadId, pending: !isFullViewRef.current };
    if (sidebarOpenRef.current) {
      offerAttachedTask();
    }
  }, [attachedTaskKnown, offerAttachedTask, threadId]);
  // Any other opener (a Changes card, `T`) shows its own panel and spends the offer.
  useEffect(() => {
    if (sidebarOpen && attachedTaskOfferRef.current) {
      attachedTaskOfferRef.current.pending = false;
    }
  }, [sidebarOpen]);
  const handleOpenSidebar = useCallback(() => {
    if (!offerAttachedTask()) {
      handleToggleSidebar();
    }
  }, [handleToggleSidebar, offerAttachedTask]);

  // Status inputs per tab (OS-1618). The strip's own subscription carries them for every
  // Group child; the active tab prefers its `get`, the fresher source and the only one before a
  // group exists.
  //
  // `hasUnread` rides along rather than being derived here: both sources compute it server-side
  // through `hasUnreadThreadActivity`, and a client-side `readAt < lastActivityAt` would be a
  // second copy of that rule.
  const tabStatusByThreadId = useMemo(() => {
    const byThreadId = new Map<string, ThreadDisplayStatusInput & { hasUnread: boolean }>();
    for (const child of group?.children ?? []) {
      byThreadId.set(child._id, child);
    }
    if (chat) {
      byThreadId.set(threadId, chat);
    }
    return byThreadId;
  }, [chat, group, threadId]);

  const attachedPullRequest = chat?.attachedPullRequest;
  // Not URL-backed like the task tab, so it is a plain panel pick (OS-2405).
  const openPullRequestTab = () => {
    setActivePanel("pullRequest");
    if (!isFullView) openSidebar();
  };
  const attachedPrRefLink = attachedPullRequest ? (
    <ThreadAttachedPrRefLink attached={attachedPullRequest} onOpen={openPullRequestTab} />
  ) : null;

  // Per-tab decoration. The ref belongs to the thread, so it rides inside the
  // tab — the active underline runs beneath it instead of starting
  // mid-header. The row context menu stays on the active tab (OS-1478).
  const tabExtras = (
    childId: Id<"cliThreads">
  ): Pick<ThreadTab<string>, "leading" | "indicator" | "wrap"> => {
    const task = tabTaskByThreadId.get(childId);
    const isActiveTab = childId === threadId;
    const statusInput = tabStatusByThreadId.get(childId);
    return {
      // Folded through the shared helper, so a tab says "working" on exactly
      // the same terms as the thread list. No checkmark on a done tab and no
      // resting dot: a tab is tight on width beside the task-ref chip
      // (OS-1594), and the struck-through title already says done.
      indicator: statusInput ? (
        <ThreadStatusIndicator
          status={getThreadDisplayStatus(statusInput)}
          // On a settled tab this is the only thing left to show, so a finished
          // run the user hasn't opened still reads as new (OS-1618).
          isUnread={statusInput.hasUnread}
          resting="blank"
          className="flex size-3.5 items-center justify-center"
        />
      ) : undefined,
      // Only the active tab's ref links to the task; on the others the whole
      // tab selects the thread, so a link there would fire both navigations.
      leading: isActiveTab ? (
        task || attachedPrRefLink ? (
          <span className="flex items-center gap-2">
            {task ? (
              <ThreadTaskRefLink
                task={task}
                href={threadWorkspace.taskLinkHref(task)}
                onNavigate={() => handleOpenTaskInSidebar(task)}
              />
            ) : null}
            {attachedPrRefLink}
          </span>
        ) : undefined
      ) : task ? (
        <TaskRefWithType
          refId={task.refId}
          taskType={task.taskType}
          refInteractive={false}
          className="gap-1.5"
          refClassName="text-xs font-medium text-muted-foreground"
          typeClassName="shrink-0"
        />
      ) : undefined,
      // No menu for the round trip after a tab switch: it can't be made inert
      // the way the header cluster is, and the row it would render is the
      // outgoing tab's.
      wrap:
        isActiveTab && chat && threadActionProps
          ? (tab: ReactElement) => (
              <ThreadItemContextMenu {...threadActionProps}>{tab}</ThreadItemContextMenu>
            )
          : undefined,
    };
  };

  // Group tab strip + add-to-group flow (OS-1477).
  const {
    showGroupStrip,
    stripPlaceholderCount,
    threadTabs,
    doneThreadTabs,
    activeThreadTabId,
    onThreadTabSelect,
    addToGroupDraft,
    addToGroupDraftKey,
    openAddToGroupDraft,
    showAddToGroupDraft,
    onThreadAddedToGroup,
    onWorkflowStartedInGroup,
    groupAtCap,
    canAddThreadToGroup,
  } = useThreadGroupTabs({
    chat,
    threadId,
    containerId,
    projectId,
    group,
    isFullView,
    isPanelTabActive,
    setActivePanel,
    navigateToThreadTab,
    onThreadAddedToGroupScope: onAdoptCreatedGroupScope,
    tabExtras,
    tabsReady: tabRefsReady,
    pendingTabCount,
  });

  // Same reason as the export: the handoff transcript is this thread's loaded history.
  const { handoffToNewThread, handoffToNewTab } = useThreadHandoff({
    chat,
    cliMessages,
    organizationSlug: params.organizationSlug,
    projectAlias: params.projectAlias,
    // The gates on "+", which opens the same draft tab.
    newTab:
      canAddThreadToGroup && !readOnly && !groupAtCap
        ? { draftKey: addToGroupDraftKey, open: showAddToGroupDraft }
        : undefined,
  });

  // Branch from here → In a new tab (OS-2224): adopt the group the fork landed in, as "+" does.
  // Read through a ref: both handlers change with the query string, which must not rerender the transcript.
  const branchedIntoTabRef = useRef({ onAdoptCreatedGroupScope, navigateToThreadTab });
  branchedIntoTabRef.current = { onAdoptCreatedGroupScope, navigateToThreadTab };
  const handleBranchedIntoTab = useCallback(
    (scope: { containerId: Id<"cliThreads">; threadId: Id<"cliThreads"> }) => {
      branchedIntoTabRef.current.onAdoptCreatedGroupScope(scope);
      branchedIntoTabRef.current.navigateToThreadTab(scope.threadId);
    },
    []
  );

  // `canAddThreadToGroup` is true for a viewer (a plain thread with no container), but
  // `addThreadToGroup` is creator-only.
  const addThreadToGroupButton = canAddThreadToGroup && !readOnly ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={openAddToGroupDraft}
      disabled={groupAtCap}
      aria-label="New thread in group"
      title={groupAtCap ? `Group is full (${MAX_GROUP_CHILDREN} threads max)` : "New thread in group"}
      className="cursor-pointer self-center"
    >
      <Plus />
    </Button>
  ) : null;

  const panelTabs: ThreadTab<ThreadSidebarPanelKind>[] = [
    {
      id: "changes",
      label: "Changes",
      icon: <FileDiff className="size-4" />,
      // Kept visible for a viewer so the workspace doesn't change shape, but
      // inert — the panel's file reads and reverts are owner-only.
      ...(readOnly
        ? {
            disabled: true,
            disabledReason: "Changes are only available to the thread owner",
          }
        : {}),
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: <ListTodo className="size-4" />,
    },
    // Run-bound threads carry their run's live progress and controls
    // (docs/specs/workflows.md → Run view) — cancel must stay reachable once
    // lane threads exist and the container stops rendering its own view.
    ...(workflowRunId
      ? [
          {
            id: "workflow" as const,
            label: "Workflow",
            icon: <Workflow className="size-4" />,
          },
        ]
      : []),
    // The thread's Attached pull request in the PR reader (OS-2193).
    ...(attachedPullRequest
      ? [
          {
            id: "pullRequest" as const,
            label: `#${attachedPullRequest.number}`,
            icon: <GitPullRequest className="size-4" />,
          },
        ]
      : []),
    // Always listed, so the tabs don't shift once the thread loads; the panel has empty states.
    {
      id: "evidence",
      label: "Checks",
      icon: <ListChecks className="size-4" />,
    },
    // Gated on the URL param, not the hydrated task: the mirror above selects
    // this tab from the param, so gating on `selectedTask` would leave the tab
    // missing (and `activePanel` stranded) for the resolving round trip. The
    // ref is in the URL, so the label needs no round trip either.
    ...(selectedTaskRefId
      ? [
          {
            id: "task" as const,
            label: selectedTaskRefId,
            icon: selectedTask ? (
              <TaskType taskType={selectedTask.taskType} variant="icon" />
            ) : undefined,
            // Task refs render at text-xs everywhere else (ThreadTaskRefLink),
            // so the tab's ref matches the one in the thread tab beside it.
            className: "text-xs",
            onClose: closeTaskSidebar,
          },
        ]
      : []),
    ...(threadArtifactId
      ? [
          {
            id: "artifact" as const,
            // A *loading* label, not an unnamed-artifact one — the tab opens
            // from the param and the name lands a round trip later. A resolved
            // artifact always has a name (`normalizeArtifactName` rejects
            // empty), so this never competes with UNTITLED_ARTIFACT_NAME.
            label: threadArtifact?.name ?? "Artifact",
            icon: <FileText className="size-4" />,
            onClose: closeThreadArtifact,
          },
        ]
      : []),
  ];

  const doneThreadMenu = doneThreadTabs.length > 0 ? (
    <DoneThreadMenu
      tabs={doneThreadTabs}
      activeId={activeThreadTabId}
      onSelect={onThreadTabSelect}
      collapsed={isMobile}
    />
  ) : null;
  const fullViewThreadActionsVisible = isFullView && !isPanelTabActive && !addToGroupDraft.active;

  // Thread-level actions. In split view they sit in the thread header; in full
  // view they belong to the Thread tab's own toolbar row (the Changes and
  // Tasks tabs have their own).
  const threadActions = shellChat && threadActionProps ? (
    // `contents` so the cluster keeps the parent's flex gap; inert while the
    // buttons still show the outgoing tab's state (OS-1558).
    <div className="contents" inert={chat === null}>
      <ThreadMarkReadButton
        threadId={threadId}
        hasUnread={shellChat.hasUnread}
        requiresAttention={shellChat.requiresAttention}
      />
      <ThreadMarkDoneButton
        isDone={shellChat.isDone}
        onToggle={() => void handleToggleDone(shellChat.isDone)}
      />
      <ThreadActionsMenu
        {...threadActionProps}
        triggerIcon="horizontal"
        triggerClassName="border-0 bg-transparent shadow-none"
      />
    </div>
  ) : null;

  // Always at the workspace's top-right corner: the sidebar tab bar owns it
  // while the sidebar is open, the thread header otherwise.
  const layoutToggleButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      ref={layoutToggleRef}
      onClick={handleToggleLayoutMode}
      aria-label={layoutToggleLabel}
      title={layoutToggleLabel}
      className="hidden cursor-pointer md:inline-flex"
    >
      {isFullView ? <PanelRight /> : <PanelTop />}
    </Button>
  );

  // Which diff the Changes panel shows: the latest run (default), the run
  // opened from a Changes card, the range picked in the timeline, or the
  // cumulative view.
  const changesViewer =
    (changesView.kind === "run" || changesView.kind === "latest") && viewerDiffSummary
      ? {
          diffSummary: viewerDiffSummary,
          // The envelope carries only a preview of the run's file list, and the
          // viewer fetches the whole-run patch anyway — so it derives the file
          // list from that patch, exactly as ranges do (OS-1600).
          deriveFilesFromPatch: true,
          selectedPath: changesView.kind === "run" ? changesView.file.path : undefined,
          changesTabLabel: changesView.kind === "latest" ? "Latest run" : undefined,
          review: viewerReview,
          onRevertFile: handleRevertViewerFile,
        }
      : changesView.kind === "range" && rangeDiffSummary
        ? {
            diffSummary: rangeDiffSummary,
            deriveFilesFromPatch: true,
            changesTabLabel: changesView.label,
            review: rangeReview,
          }
        : cumulativeDiffSummary
          ? {
              diffSummary: cumulativeDiffSummary,
              deriveFilesFromPatch: true,
              changesTabLabel: "All changes",
              review: cumulativeReview,
            }
          : null;

  // The panel row never carries a thread tab, but a desktop→mobile resize can
  // strand `activePanel` on "thread". Resolve that fallback once: the tab bar's
  // highlight and the panel body below must agree on what is showing, and for a
  // viewer (whose default is Tasks, not Changes) they otherwise diverge — the
  // strip would highlight Tasks while the Changes panel rendered behind it.
  //
  // A URL-backed tab whose param is *unset* strands it the same way, and that is
  // reachable without a resize: the pick is shared with the new-thread pane,
  // whose own tab follows `task=<REF>` rather than the pick, so a send can hand
  // over "task" with no task in the URL. That tab isn't in `panelTabs`, so
  // nothing highlights and the body rests on the task branch's placeholder — a
  // sidebar stuck on skeletons until the user closes and reopens it (OS-1687).
  //
  // Normalized for *rendering* only, not in `activePanel` itself: the URL mirror
  // reads the raw pick to decide what a closing tab falls back to, and a pick
  // already rewritten to the default would make it a no-op (OS-1569).
  const panelTabId: ThreadWorkspaceTab =
    (activePanel === "task" && !selectedTaskRefId) ||
    (activePanel === "artifact" && !threadArtifactId) ||
    (activePanel === "workflow" && !workflowRunId) ||
    (activePanel === "pullRequest" && !attachedPullRequest)
      ? defaultPanel
      : activePanel;
  const resolvedPanel: ThreadWorkspaceTab =
    panelTabId === "thread" ? defaultPanel : panelTabId;

  // Once opened, the PR reader stays mounted (hidden) so a tab switch doesn't re-read GitHub.
  const [keptPullRequestRef, setKeptPullRequestRef] = useState<string>();
  if (resolvedPanel === "pullRequest" && attachedPullRequest && keptPullRequestRef !== attachedPullRequest.ref) {
    setKeptPullRequestRef(attachedPullRequest.ref);
  }
  const keptPullRequestReader =
    attachedPullRequest && keptPullRequestRef === attachedPullRequest.ref ? (
      <div className={cn("flex h-full min-h-0 flex-col", resolvedPanel !== "pullRequest" && "hidden")}>
        <AttachedPullRequestReader
          projectId={projectId}
          pullRequest={attachedPullRequest}
          organizationSlug={params.organizationSlug}
          projectAlias={params.projectAlias}
        />
      </div>
    ) : null;

  // Rendered into the sidebar pane (split) or the main column (full view).
  const activePanelContent =
    resolvedPanel === "artifact" && threadArtifactId ? (
      <TaskArtifactPanel
        selectedArtifactId={threadArtifactId}
        compact
        onClose={closeThreadArtifact}
        onInvalidSelection={clearInvalidThreadArtifact}
        onUpdateArtifact={updateThreadArtifact}
        // Read-only until the owning task resolves, and for archived tasks.
        disabled={threadArtifactIsReadOnly !== false || readOnly}
        projectId={threadArtifactTask?.projectId}
        taskId={threadArtifactTask?._id}
        taskRefId={threadArtifactTask?.refId}
        // Sending comments to a thread from here is a tab switch, not a fresh
        // navigation: this keeps the query string (the artifact stays open) and
        // selects the tab when the destination is a Group child (OS-1716).
        onNavigateToThread={navigateToThreadTab}
      />
    ) : resolvedPanel === "task" && selectedTask ? (
      // Same host-owned switch the artifact tab uses: the task tab hosts an
      // open artifact too, via `?artifact=` (OS-1716).
      renderTaskPane("task", { onNavigateToThread: navigateToThreadTab })
    ) : resolvedPanel === "task" ? (
      // `task=<REF>` is set but the doc has not landed. Falling through to
      // Changes here would flash the wrong panel under a highlighted task tab.
      <ThreadTranscriptSkeleton />
    ) : resolvedPanel === "tasks" ? (
      renderTaskPane("tasks")
    ) : resolvedPanel === "workflow" && workflowRunId ? (
      <WorkflowRunPanel runId={workflowRunId} params={params} />
    ) : resolvedPanel === "pullRequest" && attachedPullRequest ? null : resolvedPanel === "evidence" ? (
      <EvidencePanel
        threadId={threadId}
        thread={chat ? { taskId: chat.associatedTask?._id, taskArchived: chat.associatedTask?.isArchived } : null}
        isOwner={!readOnly}
        projectRoute={params}
        projectId={projectId}
      />
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <ThreadChangesToolbar
          pullRequest={chat?.pullRequest}
          label={changesViewLabel}
          changesViewKind={changesView.kind}
          runs={timelineRuns}
          onSelectView={handleSelectChangesView}
          showCheckoutViews={runFileOpContext !== undefined}
          onOpenRange={handleOpenTimelineRange}
          // Same gate the transcript's run cards use: reverting goes through
          // the owner-scoped `worktreeOps.enqueue`, so a viewer gets no handler
          // and the timeline drops its restore action.
          onRevertRun={runFileOpContext ? handleRevertRun : undefined}
          allCollapsed={changesAllCollapsed}
          onToggleCollapseAll={() => setChangesAllCollapsed((value) => !value)}
          diffStyle={changesDiffStyle}
          onToggleDiffStyle={() =>
            setChangesDiffStyle((value) => {
              const next = value === "unified" ? "split" : "unified";
              writeChangesDiffStyle(next);
              return next;
            })
          }
          fileTreeOpen={changesFileTree}
          // History reports whether a diff is on screen (one-pane list or Graph table: none).
          diffToggles={changesView.kind !== "history" || historyDiffShown}
          // History has no file tree, as on the worktree page.
          onToggleFileTree={changesView.kind === "history" ? undefined : () => {
            const next = !changesFileTree;
            setChangesFileTree(next);
            writeChangesFileTree(next);
          }}
          wordWrap={changesWordWrap}
          onToggleWordWrap={() =>
            setChangesWordWrap((value) => {
              writeChangesWordWrap(!value);
              return !value;
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {(changesView.kind === "worktree" || changesView.kind === "history") && runFileOpContext ? (
            <WorktreeChangesPanel
              // A path switch is a different checkout: start fresh.
              key={`${changesView.kind}:${runFileOpContext.profileId}:${runFileOpContext.pathId}`}
              view={changesView.kind}
              profileId={runFileOpContext.profileId as Id<"cliProfiles">}
              pathId={runFileOpContext.pathId}
              allCollapsed={changesAllCollapsed}
              diffStyle={changesDiffStyle}
              wordWrap={changesWordWrap}
              fileTreeOpen={changesFileTree}
              refreshKey={timelineRuns.at(-1)?.diffSummary.postRef}
              onMentionFile={handleMentionFile}
              openCommit={changesView.kind === "history" ? (changesView.commit ?? null) : null}
              onOpenCommit={handleOpenHistoryCommit}
              onHistoryDiffShownChange={setHistoryDiffShown}
            />
          ) : changesViewer && runFileOpContext ? (
            <RunFileViewerPanel
              // Remount when the diffed range changes so tab/collapse state
              // resets per run, per selected range, and as new runs land.
              key={`${changesViewer.diffSummary.preRef}:${changesViewer.diffSummary.postRef}`}
              {...changesViewer}
              allCollapsed={changesAllCollapsed}
              diffStyle={changesDiffStyle}
              wrapLines={changesWordWrap}
              fileTreeOpen={changesFileTree}
              context={runFileOpContext}
              onMentionFile={handleMentionFile}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No changes yet.</p>
          )}
        </div>
      </div>
    );
  const panelContent = (
    <>
      {keptPullRequestReader}
      {activePanelContent}
    </>
  );

  return (
    <>
      <ThreadWorkspaceSplitPane
        isSidebarOpen={sidebarOpen && !isFullView}
        onCloseSidebar={handleCloseSidebar}
        sidebarTitle="Thread sidebar"
        sidebarHeader={
          <ThreadSidebarTabBar
            tabs={panelTabs}
            activeId={resolvedPanel}
            onSelect={setActivePanel}
            onCloseSidebar={handleCloseSidebar}
            trailing={layoutToggleButton}
          />
        }
        sidebarContent={panelContent}
      >
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ThreadHeader
            // The collapsed strip stands in for the title on mobile, so it
            // takes the title's alignment rather than a tab row's.
            tabsAsTitle={isMobile}
            tabs={
              isFullView || showGroupStrip ? (
                <>
                  {/* A group can hold up to MAX_GROUP_CHILDREN tabs — the
                      strip shows the ones that fit and cuts the tail into its
                      overflow dropdown (OS-1478). */}
                  {stripPlaceholderCount > 0 ? (
                    <>
                      <div
                        className="flex min-w-0 items-center gap-6 overflow-hidden px-3"
                        data-testid="thread-header-tabs-pending"
                      >
                        {Array.from({ length: stripPlaceholderCount }, (_, index) => (
                          <Skeleton key={index} className="h-4 w-28 shrink-0" />
                        ))}
                      </div>
                      {addThreadToGroupButton}
                    </>
                  ) : (
                    <ThreadTabStrip
                      tabs={threadTabs}
                      activeId={activeThreadTabId}
                      onSelect={onThreadTabSelect}
                      trailing={addThreadToGroupButton}
                      // A phone header fits one tab beside the back button and
                      // the actions; the rest live in that tab's dropdown.
                      collapsed={isMobile}
                    />
                  )}
                  {/* Panels sit at the far right; split mode keeps them in
                      the sidebar tab bar. */}
                  {isFullView ? (
                    <>
                      <div
                        className="ml-auto mr-2 h-6 self-center"
                        data-slot="thread-panel-tabs-separator"
                      >
                        <Separator orientation="vertical" className="h-full" />
                      </div>
                      <ThreadTabList
                        tabs={panelTabs}
                        activeId={panelTabId}
                        onSelect={setActivePanel}
                      />
                    </>
                  ) : null}
                </>
              ) : undefined
            }
            titleTrailing={isFullView || showGroupStrip ? undefined : (addThreadToGroupButton ?? undefined)}
            leading={
              <>
                <ThreadMobileBackButton
                  organizationSlug={params.organizationSlug}
                  projectAlias={params.projectAlias}
                />
                {/* Full view and the group strip carry the ref inside the
                    thread tab. */}
                {associatedTask && !isFullView && !showGroupStrip ? (
                  <ThreadTaskRefLink
                    task={associatedTask}
                    href={threadWorkspace.taskLinkHref(associatedTask)}
                    onNavigate={() => handleOpenTaskInSidebar(associatedTask)}
                  />
                ) : null}
                {!isFullView && !showGroupStrip ? attachedPrRefLink : null}
              </>
            }
            actions={
              <>
                {/* First in the slot — the one slot both layouts render (full
                    view replaces the title with tabs, so `titleTrailing` is
                    unavailable there). `ownershipChat`, not `chat`: it holds across
                    a Group child tab switch so the pill stays put instead of
                    blinking. */}
                {ownershipChat ? (
                  <ThreadSharedBadge
                    // A tab of a shared group carries the group's state, not
                    // its own: `sharedAt` lives on the container (OS-1579), and
                    // the link the badge copies is the group's. Only a *group*
                    // container — a run child is never covered by a share, so
                    // it must not be described as one.
                    threadId={isShareableGroupChild(ownershipChat) ? ownershipChat.parentThreadId ?? threadId : threadId}
                    readOnly={readOnly}
                    sharedAt={ownershipChat.sharedAt ?? ownershipChat.containerSharedAt}
                    scope={isShareableGroupChild(ownershipChat) ? "group" : "thread"}
                    organizationSlug={params.organizationSlug}
                    projectAlias={params.projectAlias}
                  />
                ) : null}
                {/* Gated on `chat`, not `shellChat`: nothing wraps this to go
                    inert, so for the round trip after a tab switch it simply
                    doesn't render — its toggles would read the outgoing row
                    while mutating the incoming thread. */}
                {/* ml-2: the strip's trailing "+" ends right where this
                    starts, and the two clusters need to read as separate. */}
                <div data-slot="mobile-thread-actions" className="ml-2 flex items-center gap-1 md:hidden">
                  {chat && threadActionProps ? (
                    <ThreadActionsMenu
                      {...threadActionProps}
                      triggerIcon="horizontal"
                    />
                  ) : null}
                  {isMobile ? doneThreadMenu : null}
                </div>
                {/* Full view moves these into the Thread tab's toolbar row. */}
                {!isFullView ? (
                  <>
                    <div
                      data-slot="desktop-thread-actions"
                      className="hidden items-center gap-1 md:flex"
                    >
                      {threadActions}
                      {!isMobile ? doneThreadMenu : null}
                    </div>
                    {/* Also gated on `threadActions`: a viewer has none, and
                        the divider would then separate the shared badge from
                        the sidebar toggle it was never meant to separate. */}
                    {!sidebarOpen && threadActions ? (
                      <div
                        className="mx-2 h-6 self-center"
                        data-slot="thread-actions-separator-wrapper"
                      >
                        <Separator orientation="vertical" className="h-full" />
                      </div>
                    ) : null}
                  </>
                ) : null}
                {isFullView && !fullViewThreadActionsVisible ? doneThreadMenu : null}
                {/* Split view offers the toggle from the sidebar tab bar, so a
                    collapsed sidebar shows only its own open toggle. */}
                {isFullView ? layoutToggleButton : null}
                {!isFullView && !sidebarOpen ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleOpenSidebar}
                    aria-label="Open thread sidebar"
                    className="cursor-pointer"
                  >
                    <PanelRightOpen />
                  </Button>
                ) : null}
              </>
            }
            title={threadTitle}
            // Omitted for a viewer: the header derives `isEditable` from this
            // being a function, so the title goes read-only with no other prop.
            onTitleCommit={readOnly ? undefined : handleTitleCommit}
          />
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* The thread stays mounted behind an active panel tab —
                unmounting it would reset the conversation's scroll position
                on every tab switch. */}
            <div
              data-slot="thread-column"
              className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
              inert={isPanelTabActive || addToGroupDraft.active}
            >
              {isFullView ? (
                // The Thread tab's toolbar row, matching the Changes toolbar.
                <div className="flex h-[41px] shrink-0 items-center justify-end gap-1 border-b border-border bg-card px-2">
                  {threadActions}
                  {fullViewThreadActionsVisible ? doneThreadMenu : null}
                </div>
              ) : null}
              {/* ThreadView renders a fragment of Group children (messages, queued
                  strip, composer) that need the grid tracks the header used to
                  provide. */}
              {/* Keyed by thread: the transcript, its scroll position and the
                  composer belong to one thread and swap with the tab. Drafts
                  survive via ThreadDraftProvider. */}
              <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
                {chat ? (
                  <ThreadView
                    key={threadId}
                    chat={chat}
                    cliMessages={cliMessages}
                    organizationSlug={params.organizationSlug}
                    projectAlias={params.projectAlias}
                    organizationId={project?.organizationId}
                    taskLinkHref={threadViewTaskLinkHref}
                    onOpenTask={handleOpenTaskInSidebar}
                    onOpenArtifact={handleOpenArtifact}
                    onOpenTaskRef={handleOpenTaskRef}
                    initialAttachedTask={threadWorkspace.attachedTask}
                    onAttachedTaskChange={setAttachedTask}
                    wrapSubmit={wrapSubmitWithReview}
                    extraAttachmentPills={reviewCommentsPill}
                    composerControllerRef={composerControllerRef}
                    onOpenDiffFile={runFileOpContext ? handleOpenDiffFile : undefined}
                    onRevertRun={runFileOpContext ? handleRevertRun : undefined}
                    onRevertFile={runFileOpContext ? handleRevertFile : undefined}
                    readOnly={readOnly}
                    onBranchedIntoTab={groupAtCap ? undefined : handleBranchedIntoTab}
                    onHandoffToNewThread={handoffToNewThread}
                    onHandoffToNewTab={handoffToNewTab}
                  />
                ) : (
                  <ThreadTranscriptSkeleton />
                )}
              </div>
              {/* The Run rail docks over the transcript's right edge (spec → Threads page
                  integration). Its box has a definite height so the rail's cap resolves;
                  hidden where it would overlap transcript text. */}
              {chat?.workflowRunId ? (
                <div className="pointer-events-none absolute inset-y-0 right-3 hidden py-14 lg:block">
                  <div className="pointer-events-auto flex h-full items-center">
                    <WorkflowRunRail runId={chat.workflowRunId} threadId={threadId} params={params} />
                  </div>
                </div>
              ) : null}
            </div>
            {/* The draft tab overlays the thread like a panel tab does — the
                thread stays mounted so its scroll and composer state survive
                closing the draft. The draft itself stays mounted (hidden, not
                unmounted) while open, so switching to a Group child tab and back
                keeps its uploaded attachments and attached-task edits. */}
            {/* `shellChat`, so a tab switch with the draft open doesn't unmount
                it (and drop its uploads). The draft is scoped to the group and
                only seeds from the row, so the outgoing tab's is fine. */}
            {addToGroupDraft.open && shellChat ? (
              <div
                data-slot="add-to-group-draft"
                className={cn(
                  "absolute inset-0 z-10 grid grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-background",
                  (!addToGroupDraft.active || isPanelTabActive) && "hidden"
                )}
              >
                <AddThreadToGroupDraftView
                  chat={shellChat}
                  params={params}
                  onWorkflowStarted={(containerId, runId) => {
                    if (!isFullView) {
                      setActivePanel("workflow");
                      openSidebar();
                    }
                    return onWorkflowStartedInGroup(containerId, runId);
                  }}
                  organizationId={project?.organizationId}
                  draftKey={addToGroupDraftKey}
                  taskLinkHref={threadViewTaskLinkHref}
                  onOpenTask={handleOpenTaskInSidebar}
                  onCreated={onThreadAddedToGroup}
                />
              </div>
            ) : null}
            {isPanelTabActive ? (
              <div className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-background">
                {panelContent}
              </div>
            ) : null}
          </div>
        </main>
      </ThreadWorkspaceSplitPane>
      <RunUndoConfirmDialog
        open={revertTarget !== null}
        fileCount={revertTarget?.diffSummary.fileCount ?? 0}
        filePath={revertTarget?.file?.path}
        onOpenChange={(open) => {
          if (!open) {
            setRevertTarget(null);
          }
        }}
        onConfirm={handleConfirmRevert}
      />
      <RenameThreadDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        threadId={threadId}
        // The raw title, not `threadTitle`: its "New thread" fallback would
        // prefill the input and block renaming a thread to that exact string.
        currentTitle={(chat ?? groupChild)?.title ?? ""}
        onRename={async (_threadId, title) => {
          await handleTitleCommit(title);
        }}
      />
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete thread?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{threadTitle}&quot; will be permanently deleted. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
