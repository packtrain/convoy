"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type {
  ThreadTab,
  ThreadWorkspaceTab,
} from "@/components/blocks/thread/thread-sidebar-tabs";
import { useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_GROUP_CHILDREN } from "@/lib/threads/constants";
import { buildAddToGroupDraftSeed } from "@/lib/threads/draft-flow";
import { writeGroupLastTab } from "@/lib/threads/group-last-tab";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreatedThreadHold } from "@/lib/threads/hooks/use-created-thread-hold";
import type { CliThreadDetailItem, ThreadGroup } from "@/lib/threads/thread-query-patches";

export const ADD_TO_GROUP_DRAFT_TAB_ID = "add-to-group-draft";

interface UseThreadGroupTabsOptions {
  /** The active thread's doc; null for the round trip after a tab switch. */
  chat: CliThreadDetailItem | null;
  /** The active thread — known before its doc loads (OS-1558). */
  threadId: Id<"cliThreads">;
  /** The group scope; sticky across a tab switch. */
  containerId: Id<"cliThreads"> | undefined;
  projectId: Id<"projects">;
  /** The container's `getGroup` subscription; undefined while loading or for root threads. */
  group: ThreadGroup | null | undefined;
  isFullView: boolean;
  /** A panel tab (Changes/Tasks/task) currently covers the thread column. */
  isPanelTabActive: boolean;
  setActivePanel: (tab: ThreadWorkspaceTab) => void;
  /** Pushes the child's thread URL, preserving the current query string. */
  navigateToThreadTab: (childId: string) => void;
  /**
   * A thread was just added: the group it joined, which the workspace
   * adopts as its scope so the strip, header and panels keep their mount
   * (OS-1615). Called before the navigation so both land in the same event —
   * both after the hold, on data already warm (OS-1665).
   */
  onThreadAddedToGroupScope?: (scope: {
    containerId: Id<"cliThreads">;
    threadId: Id<"cliThreads">;
  }) => void;
  /**
   * Per-tab decoration (task-ref leading, status indicator, context-menu wrap
   * on the active one) — a callback so the hook stays JSX-free.
   */
  tabExtras?: (
    childId: Id<"cliThreads">
  ) => Pick<ThreadTab<string>, "leading" | "indicator" | "wrap">;
  /**
   * The tabs' task refs are loaded (OS-1558). Tabs stay hidden until then:
   * refs arrive a round trip after the group and would resize every tab.
   */
  tabsReady: boolean;
  /**
   * How many tabs the group will have, known from the container's
   * `childCount` before `getGroup` lands — the strip renders that many
   * placeholders and swaps them for the real tabs in one go.
   */
  pendingTabCount: number;
}

/**
 * The group tab strip's state and behavior (OS-1477,
 * docs/specs/thread-groups.md): one tab per group child in creation order,
 * the client-only add-to-group draft, and tab navigation.
 * The page owns the surrounding workspace (panels, layout mode, mutations).
 */
export function useThreadGroupTabs({
  chat,
  threadId,
  containerId,
  projectId,
  group,
  isFullView,
  isPanelTabActive,
  setActivePanel,
  navigateToThreadTab,
  onThreadAddedToGroupScope,
  tabExtras,
  tabsReady,
  pendingTabCount,
}: UseThreadGroupTabsOptions) {
  const { profiles } = useCliProfiles(projectId);
  const { awaitCreatedThread } = useCreatedThreadHold();

  // Add-to-group draft: pure client state until the first send creates a thread.
  // Keep the persisted key stable so drafts survive the terminology rename.
  const [pendingWorkflow, setPendingWorkflow] = useState<{
    runId: Id<"workflowRuns">;
    containerId: Id<"cliThreads">;
    sourceThreadId: Id<"cliThreads">;
    draftKey: string;
    resolve: (target: Id<"cliThreads"> | "panel" | "canceled") => void;
  }>();
  const scopeDraftKey = `sibling:${containerId ?? threadId}`;
  const addToGroupDraftKey = pendingWorkflow?.draftKey ?? scopeDraftKey;
  const startedRun = useQuery(api.workflows.runs.core.get, pendingWorkflow ? { runId: pendingWorkflow.runId } : "skip");
  const workflowThreadId = startedRun?.stages.flatMap((stage) => stage.steps).find((step) => step.threadId)?.threadId;
  const workflowNeedsPanel = startedRun === null || (startedRun !== undefined &&
    (startedRun.status !== "running" || startedRun.stages.some((stage) => stage.steps.some((step) => step.status === "waiting"))));
  const { draft: addToGroupDraftValue, setDraft: setAddToGroupDraftValue } = useThreadDraft(addToGroupDraftKey);
  const [addToGroupDraft, setAddToGroupDraft] = useState({ open: false, active: false });
  // The thread this draft has created and is standing in for, held
  // only for the create hold's duration (OS-907). `addThreadToGroup` commits the
  // container, the reparented source and the child in one transaction, so the
  // strip learns the child while the draft — which the hold deliberately keeps
  // on screen (OS-1665) — is still open. Without this the two render side by
  // side: "Thread 1, Thread 2, New thread".
  const [heldAddedThreadId, setHeldAddedThreadId] = useState<Id<"cliThreads"> | undefined>(undefined);
  // Navigating outside the draft's scope (another group, a root thread) drops
  // the draft tab; tab switches within the group keep it (render-phase
  // prop-derived state adjustment).
  const [lastAddToGroupDraftKey, setLastAddToGroupDraftKey] = useState(addToGroupDraftKey);
  if (lastAddToGroupDraftKey !== addToGroupDraftKey) {
    setLastAddToGroupDraftKey(addToGroupDraftKey);
    // Except when this send caused it: the first group addition reparents the source and
    // moves the draft's scope from the thread to the brand-new container. That is
    // the group forming under the draft, not the user leaving it, so the draft
    // holds its place (and its text) until the swap.
    if (!heldAddedThreadId) {
      setAddToGroupDraft({ open: false, active: false });
    }
  }

  // Reopening the group container resolves to the tab last active here.
  useEffect(() => {
    if (containerId) {
      writeGroupLastTab(containerId, threadId);
    }
  }, [containerId, threadId]);

  // The cap uses the group's full row count (deleted included) because that
  // is what the backend guard counts.
  const groupAtCap = group != null && group.totalRowCount >= MAX_GROUP_CHILDREN;
  // A container is never a child, so a still-loading tab can still add a thread.
  // `null` means the container is unavailable; `undefined` means it is loading.
  // The distinction keeps "+" visible through the group-forming beat (OS-1718).
  const canAddThreadToGroup = !chat?.kind && group !== null;

  // Only full view puts the thread in the panel row, so only there does
  // selecting a thread tab change the active panel. In split the thread has its
  // own column and the panel keeps whatever it was showing — Tasks, a task
  // detail — instead of snapping back to Changes (OS-1558).
  const revealThreadColumn = useCallback(() => {
    if (isFullView) {
      setActivePanel("thread");
    }
  }, [isFullView, setActivePanel]);

  const closeAddToGroupDraft = useCallback(() => {
    setAddToGroupDraft({ open: false, active: false });
    // The stand-in never outlives the draft: abandoning a send mid-hold must give
    // the created child its own tab back, not hide it for good.
    setHeldAddedThreadId(undefined);
    setPendingWorkflow(undefined);
    pendingWorkflow?.resolve("canceled");
  }, [pendingWorkflow]);
  // For a caller that seeded the draft itself (Handoff from here → In a new tab).
  const showAddToGroupDraft = useCallback(() => {
    revealThreadColumn();
    setAddToGroupDraft({ open: true, active: true });
  }, [revealThreadColumn]);
  const openAddToGroupDraft = useCallback(() => {
    // The seed reads the source thread's settings, so a click during the
    // round trip after a tab switch is a no-op (the "+" stays put rather than
    // blinking out).
    if (!chat) {
      return;
    }
    // Seeding happens in the click handler, not an effect, and only when the draft has no typed
    // text and its pills weren't seeded from (or edited for) this thread: a leftover seed from an
    // earlier source would reuse another group child's profile/worktree. Edited pills survive
    // close/reopen from the same source.
    const text = addToGroupDraftValue?.text ?? "";
    if (!text.trim() && (!addToGroupDraftValue?.profileId || addToGroupDraftValue.seededFrom !== threadId)) {
      setAddToGroupDraftValue(buildAddToGroupDraftSeed(chat, profiles));
    }
    showAddToGroupDraft();
  }, [chat, profiles, showAddToGroupDraft, setAddToGroupDraftValue, addToGroupDraftValue, threadId]);
  const onThreadAddedToGroup = useCallback(
    async (newThreadId: Id<"cliThreads">, context?: { containerId: Id<"cliThreads"> }) => {
      // Before the await: the child's row can land on the very next tick, and
      // from here the draft tab *is* that child's tab slot (OS-907).
      setHeldAddedThreadId(newThreadId);
      // The draft stays — text, pills and all — until the created thread can
      // render without placeholders (OS-1665). Its composer is already inert
      // for this beat via `isSubmitting`, which awaits this.
      await awaitCreatedThread({ threadId: newThreadId, containerId: context?.containerId });
      // One commit: the draft tab goes as the real tab appears, so the strip
      // never shows both and never neither.
      setAddToGroupDraft({ open: false, active: false });
      setHeldAddedThreadId(undefined);
      // Before the navigation, so the adopted scope and the optimistic active
      // thread land in the same event: the scope is what keeps the workspace
      // mounted while the new child's doc loads (OS-1615).
      if (context) {
        onThreadAddedToGroupScope?.({ containerId: context.containerId, threadId: newThreadId });
      }
      navigateToThreadTab(newThreadId);
    },
    [awaitCreatedThread, navigateToThreadTab, onThreadAddedToGroupScope]
  );

  const onWorkflowStartedInGroup = useCallback(
    async (newContainerId: Id<"cliThreads">, runId: Id<"workflowRuns">) => {
      const target = await new Promise<Id<"cliThreads"> | "panel" | "canceled">((resolve) => {
        setPendingWorkflow({ runId, containerId: newContainerId, sourceThreadId: threadId, draftKey: addToGroupDraftKey, resolve });
      });
      setPendingWorkflow(undefined);
      setAddToGroupDraft({ open: false, active: false });
      if (target === "canceled") return;
      if (target === "panel") {
        setActivePanel("workflow");
        return;
      }
      revealThreadColumn();
      onThreadAddedToGroupScope?.({ containerId: newContainerId, threadId: target });
      navigateToThreadTab(target);
    },
    [addToGroupDraftKey, threadId, setActivePanel, revealThreadColumn, onThreadAddedToGroupScope, navigateToThreadTab]
  );

  // Workflow lanes arrive after start commits. Keep the draft until a run-owned
  // thread can replace it directly (docs/specs/workflows.md → Start).
  useEffect(() => {
    if (!pendingWorkflow) return;
    if (threadId !== pendingWorkflow.sourceThreadId ||
      (containerId !== undefined && containerId !== pendingWorkflow.containerId)) {
      pendingWorkflow.resolve("canceled");
      return;
    }
    if (!workflowThreadId) {
      if (workflowNeedsPanel) pendingWorkflow.resolve("panel");
      return;
    }
    let canceled = false;
    void awaitCreatedThread({ threadId: workflowThreadId, containerId: pendingWorkflow.containerId }).then(() => {
      if (!canceled) pendingWorkflow.resolve(workflowThreadId);
    });
    return () => { canceled = true; };
  }, [pendingWorkflow, workflowThreadId, workflowNeedsPanel, threadId, containerId, awaitCreatedThread]);

  useEffect(() => () => pendingWorkflow?.resolve("canceled"), [pendingWorkflow]);

  // One tab per group child, or just this thread before the group exists,
  // plus the draft tab. Every tab carries its thread's task ref; the context
  // menu stays on the active one. In full view without a group this degrades
  // to the single thread tab (OS-1396).
  const groupChildren = group?.children;
  // Keep creation order for unfinished threads and completion order for the Done menu.
  const orderedChildren = useMemo(() => {
    if (!groupChildren) {
      return groupChildren;
    }
    const live = groupChildren.filter((child) => !child.isDone);
    if (live.length === groupChildren.length) {
      return groupChildren;
    }
    return [
      ...live,
      ...groupChildren
        .filter((child) => child.isDone)
        .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
    ];
  }, [groupChildren]);
  // Placeholder tabs hold the strip's shape while the group and its refs load,
  // so the header never morphs from a lone title into a full strip (OS-1558).
  // `tabsReady` is one-way, so this is exactly "the strip has never rendered":
  // cold entry, straight onto a child URL. During a group addition it is already true, and a
  // container adopted there — `addThreadToGroup` reparents the source a round trip
  // before its `getGroup` answers — must not swap live tabs for skeletons
  // (OS-1718). That case had nothing to render before the hold kept the draft
  // open over it (OS-1665, OS-907); now it has these tabs.
  const stripPlaceholderCount = tabsReady ? 0 : pendingTabCount;
  // Same strip on every viewport (OS-1479); mobile renders it collapsed to the
  // active tab, which is a `ThreadTabStrip` prop, not a different strip.
  const showGroupStrip =
    stripPlaceholderCount > 0 ||
    (tabsReady && (containerId !== undefined || (groupChildren?.length ?? 0) > 0 || addToGroupDraft.open));
  const allStripThreads: ReadonlyArray<{ _id: Id<"cliThreads">; title: string; isDone: boolean }> =
    orderedChildren && orderedChildren.length > 0
      ? orderedChildren
      : chat
        ? [chat]
        : [];
  // The held thread's tab is the draft tab until the swap (OS-907). Gated on the
  // draft being open, so a stale id can never suppress a real tab, and on that one
  // id, so a group child created elsewhere (another device or an agent over MCP) landing
  // in the same `getGroup` still gets its own.
  const draftThreadId = heldAddedThreadId ?? workflowThreadId;
  const stripThreads =
    addToGroupDraft.open && draftThreadId
      ? allStripThreads.filter((stripThread) => stripThread._id !== draftThreadId)
      : allStripThreads;
  const threadTabs: ThreadTab<string>[] = [
    ...(tabsReady && (isFullView || showGroupStrip)
      ? stripThreads.map((stripThread) => ({
          id: stripThread._id as string,
          label: stripThread.title.trim() || "New thread",
          // min-w keeps a short title from collapsing into a stub tab; the
          // wider max-w leaves room for the task ref beside it.
          className: "min-w-20 max-w-80",
          // Done reads as finished at a glance: struck-through title plus
          // muted styling that survives being the active tab (OS-1594).
          ...(stripThread.isDone ? { dimmed: true } : {}),
          ...(tabExtras?.(stripThread._id) ?? {}),
        }))
      : []),
    ...(addToGroupDraft.open
      ? [{ id: ADD_TO_GROUP_DRAFT_TAB_ID, label: "New thread", className: "min-w-20", onClose: closeAddToGroupDraft }]
      : []),
  ];

  // A panel tab covering the thread column owns the highlight; the strip then
  // has no active tab of its own (ids are thread ids, so nothing matches "").
  const activeThreadTabId = isPanelTabActive ? "" : addToGroupDraft.active ? ADD_TO_GROUP_DRAFT_TAB_ID : threadId;
  const onThreadTabSelect = useCallback(
    (id: string) => {
      revealThreadColumn();
      if (id === ADD_TO_GROUP_DRAFT_TAB_ID) {
        setAddToGroupDraft({ open: true, active: true });
        return;
      }
      if (pendingWorkflow) closeAddToGroupDraft();
      setAddToGroupDraft((draft) => (draft.active ? { ...draft, active: false } : draft));
      if (id !== threadId) {
        navigateToThreadTab(id);
      }
    },
    [navigateToThreadTab, revealThreadColumn, threadId, pendingWorkflow, closeAddToGroupDraft]
  );

  return {
    showGroupStrip,
    stripPlaceholderCount,
    threadTabs: threadTabs.filter((tab) => !tab.dimmed || tab.id === threadId),
    doneThreadTabs: groupChildren ? threadTabs.filter((tab) => tab.dimmed) : [],
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
  };
}
