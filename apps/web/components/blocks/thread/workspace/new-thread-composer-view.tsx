"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { ListTodo, PanelRightOpen } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseAttachedPullRequest } from "@/convex/lib/contracts/github";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreateThreadSubmit } from "@/lib/threads/hooks/use-create-thread-submit";
import { useNewThreadComposer } from "@/lib/threads/hooks/use-new-thread-composer";
import { useWorkflowRunComposer } from "@/lib/threads/hooks/use-workflow-run-composer";
import { useRememberedNewThreadCliModels } from "@/lib/threads/hooks/use-remembered-new-thread-cli-models";
import { useThreadMessageAttachmentUpload } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { DEFAULT_FALLBACK_CLI_TYPE, type CliTypeSlug } from "@/lib/threads/types";
import { resolveAgentContextPreselection } from "@/lib/threads/preselection";
import { routeTarget, useNavigation, useRouteParams } from "@/lib/navigation";
import { buildHandleThreadComposerAttachmentsChange } from "@/lib/threads/message-attachments";
import { getCliModes } from "@/lib/cli-runtime-ui/registry";
import { cn } from "@/lib/utils";
import { Centered } from "@/components/custom/centered";
import { Button } from "@/components/ui/button";
import { ThreadComposer, type ThreadComposerSubmitMessage } from "@/components/blocks/thread/thread-composer";
import { WorkflowSelector } from "@/components/blocks/workflows/workflow-selector";
import { ThreadHeader } from "@/components/blocks/thread/thread-header";
import { ThreadMobileBackButton } from "@/components/blocks/thread/thread-mobile-back-button";
import { getNewThreadDraftKey, useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import { ThreadSidebarTabBar } from "@/components/blocks/thread/thread-sidebar-tabs";
import { ThreadWorkspaceSplitPane } from "@/components/blocks/thread/thread-workspace-split-pane";
import { TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import type { ThreadWorkspaceTaskSidebar } from "@/lib/threads/hooks/use-thread-workspace-task-sidebar";
import type { ThreadTaskPaneRenderer } from "./thread-task-pane";
import type { ThreadShellState } from "./use-thread-shell-state";
import { useThreadTasksHotkey } from "./use-thread-tasks-hotkey";

function ModeNotice({
  cliType,
  mode,
}: {
  cliType: CliTypeSlug;
  mode: string | undefined;
}) {
  const modes = getCliModes(cliType);
  const currentMode =
    modes.find((candidate) => candidate.value === mode) ?? modes[0];

  if (!currentMode) {
    return null;
  }

  const isFullAccess = currentMode.value === "agent";
  const ModeIcon = currentMode.icon;

  return (
    <div
      className={cn(
        "flex max-w-md items-start gap-2 rounded-lg border px-3 py-2.5",
        isFullAccess
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted/50 text-muted-foreground"
      )}
    >
      <ModeIcon className="mt-0.5 size-4 shrink-0" />
      <p className="text-xs leading-relaxed">
        <span className="font-medium">{currentMode.label} mode.</span>{" "}
        <span>{currentMode.description}.</span>
      </p>
    </div>
  );
}

interface NewThreadComposerViewProps {
  projectId: Id<"projects">;
  organizationId: Id<"organizations">;
  /** Shared with the workspace, so a send keeps the pane as the user left it. */
  shell: ThreadShellState;
  threadWorkspace: ThreadWorkspaceTaskSidebar;
  selectedTask: ThreadWorkspaceTaskSidebar["detailsTask"] | null;
  /** The shared task pane; this view passes the half its tab is on (OS-1660). */
  renderTaskPane: ThreadTaskPaneRenderer;
  onOpenTask: (task: { refId: string; isArchived?: boolean }) => void;
  /**
   * Hands the created thread to the host, which holds this view — composer text
   * and all — until that thread renders without placeholders (OS-1665).
   */
  onCreated: (threadId: Id<"cliThreads">) => Promise<void>;
}

/**
 * The new-thread composer (`/threads`, and `?new=1` on mobile). The host owns the
 * shell it shares with the workspace, so a send swaps only this column (OS-1660,
 * docs/specs/thread-groups.md → Page structure).
 */
export function NewThreadComposerView({
  projectId,
  organizationId,
  shell,
  threadWorkspace,
  selectedTask,
  renderTaskPane,
  onOpenTask,
  onCreated,
}: NewThreadComposerViewProps) {
  const params = useRouteParams<{
    organizationSlug: string;
    projectAlias: string;
  }>();
  const navigation = useNavigation();
  const searchParams = useMemo(
    () => new URLSearchParams(navigation.location.search),
    [navigation.location.search]
  );
  // `?attachedPr=owner/name#number` from the PR page's Start thread (OS-2193).
  const initialAttachedPullRequest = useMemo(() => parseAttachedPullRequest(searchParams.get("attachedPr") ?? ""), [searchParams]);
  const { profiles } = useCliProfiles(projectId, { withModelCatalogs: true });
  const projectAgents = useQuery(api.agents.projectAgents.listByProject, { projectId });

  const threadKey = getNewThreadDraftKey();
  const { draft, setDraft } = useThreadDraft(threadKey);
  const { rememberedCliModels, rememberedCliEfforts, rememberedCliType, rememberCliModel } =
    useRememberedNewThreadCliModels();
  const { pendingAttachments, syncFileParts, prepareAttachmentsForSubmit, clearAfterSubmit, draftFileParts } =
    useThreadMessageAttachmentUpload(projectId, {
    attachments: draft?.attachments,
    save: (attachments) => setDraft({ attachments }),
  });

  // Consume URL preselection params once, then strip them. Read live from the location store
  // rather than frozen at mount: a cross-path navigation lands here before the store catches up,
  // so the first render sees an empty search. `consumedRef` keeps consumption one-shot.
  const consumedRef = useRef(false);
  const initialProfileId = searchParams.get("profileId");
  const initialPathId = searchParams.get("pathId");
  const [preselection, setPreselection] = useState<ReturnType<typeof resolveAgentContextPreselection>>(null);
  const hasAgentPreselectionParams = !!initialProfileId || !!initialPathId;
  const resolvedAgentPreselection = useMemo(
    () =>
      resolveAgentContextPreselection(profiles, {
        profileId: initialProfileId,
        pathId: initialPathId,
      }),
    [profiles, initialProfileId, initialPathId]
  );

  useEffect(() => {
    if (consumedRef.current) {
      return;
    }

    if (!hasAgentPreselectionParams) {
      return;
    }

    if (hasAgentPreselectionParams && profiles.length === 0) {
      return;
    }

    if (resolvedAgentPreselection) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- One-shot URL-param consumption: fires once when profiles resolve, alongside the URL strip below.
      setPreselection(resolvedAgentPreselection);
    }

    consumedRef.current = true;
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("profileId");
    nextSearchParams.delete("pathId");
    navigation.replace(
      routeTarget(navigation.location.pathname, {
        query: nextSearchParams,
        scroll: false,
      })
    );
  }, [hasAgentPreselectionParams, navigation, navigation.location.pathname, profiles, resolvedAgentPreselection, searchParams]);

  // Clear preselection once it has been applied to the draft by the backfill,
  // so subsequent dropdown changes aren't overridden.
  useEffect(() => {
    if (preselection && draft?.profileId === preselection.profileId && draft?.pathId === preselection.pathId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- One-shot latch: released the render after the backfill writes the draft.
      setPreselection(null);
    }
  }, [draft?.profileId, draft?.pathId, preselection]);

  const {
    resolvedDraftState,
    composerSeedKey,
    handleTextChange,
    handleWorkingDirectoryChange,
    handleBaseRefChange,
    handleCliTypeChange,
    handleModeChange,
    handleCliModelChange,
    handleCliEffortChange,
    handleProjectAgentChange,
  } = useNewThreadComposer({
    profiles,
    draft,
    setDraft,
    preselection,
    fallbackCliType: DEFAULT_FALLBACK_CLI_TYPE,
    rememberedCliModels,
    rememberedCliEfforts,
    rememberedCliType,
    projectAgents,
  });

  const { isSubmitting, handleSubmit } = useCreateThreadSubmit({
    profiles,
    draftState: resolvedDraftState,
    projectAgents,
    prepareAttachmentsForSubmit,
    clearAfterSubmit,
    setDraft,
    rememberCliModel,
    onCreated,
  });

  // A selected workflow reroutes submit into a run start (navigating to the
  // run's container) instead of thread creation.
  const { selectedWorkflow, selectWorkflow, isStarting, isWorkflowLoading, maybeStartRun } = useWorkflowRunComposer({
    organizationSlug: params.organizationSlug,
    projectAlias: params.projectAlias,
    profiles,
    draftState: resolvedDraftState,
    draft,
    setDraft,
  });
  // This pane holds Tasks and the task detail, nothing else — so the resting
  // panel is Tasks, and a `task=<REF>` selection is what shows its own tab.
  const activePanel = selectedTask ? "task" : "tasks";
  // Reveals Tasks by clearing the task selection, which is what actually moves
  // this pane (the tab follows `task=<REF>`, not the shared panel pick).
  const { openSidebar, closeSidebar, toggleSidebar, sidebarOpen, isFullView } = shell;
  const closeTaskSidebar = threadWorkspace.closeTaskSidebar;
  // Records the pick as well as revealing it: this pane's tab follows
  // `task=<REF>` rather than the shared panel, so without this the handover
  // after a send would fall to the workspace's own default, Changes (OS-1660).
  const setChosenPanel = shell.setChosenPanel;
  const revealTasks = useCallback(() => {
    if (selectedTask) {
      closeTaskSidebar();
    }
    setChosenPanel("tasks");
    openSidebar();
  }, [closeTaskSidebar, openSidebar, selectedTask, setChosenPanel]);
  const handleComposerSubmit = useCallback(
    async (message: ThreadComposerSubmitMessage) => {
      // Hand the panel this pane shows to the workspace: a pane opened by T, or
      // left open by a thread on Changes, never recorded it (OS-1660).
      if (sidebarOpen && !isFullView) {
        setChosenPanel(activePanel);
      }
      if (await maybeStartRun(message)) {
        return;
      }
      await handleSubmit(message);
    },
    [activePanel, handleSubmit, isFullView, maybeStartRun, setChosenPanel, sidebarOpen]
  );
  // Deep links and back/forward land a selection without going through the
  // opener, which is what reveals a collapsed pane (OS-1663). Edge-triggered on
  // the resolved selection, so re-opening the current task is the opener's job.
  const selectedTaskRefId = selectedTask?.refId;
  const [lastTaskRefId, setLastTaskRefId] = useState<string | undefined>(undefined);
  if (lastTaskRefId !== selectedTaskRefId) {
    setLastTaskRefId(selectedTaskRefId);
    if (selectedTaskRefId) {
      openSidebar();
    }
  }

  useThreadTasksHotkey({
    // Profiles gate the composer itself, so there is nothing to toggle without
    // them — the same guard the pre-OS-1660 registration used.
    enabled: profiles.length > 0,
    activePanel,
    isFullView,
    toggleSidebar,
    revealTasks,
    // No thread column to swap to here, so full view behaves like split.
    showThread: toggleSidebar,
  });

  const handleAttachmentsChange = useMemo(
    () =>
      buildHandleThreadComposerAttachmentsChange({
        syncFileParts,
        onError: (message) => {
          toast.error(message);
        },
      }),
    [syncFileParts]
  );

  return (
    <ThreadWorkspaceSplitPane
      isSidebarOpen={sidebarOpen}
      onCloseSidebar={closeSidebar}
      sidebarTitle="Tasks"
      sidebarHeader={
        <ThreadSidebarTabBar
          tabs={[
            { id: "tasks" as const, label: "Tasks", icon: <ListTodo className="size-4" /> },
            ...(selectedTask
              ? [
                  {
                    id: "task" as const,
                    label: selectedTask.refId,
                    icon: <TaskType taskType={selectedTask.taskType} variant="icon" />,
                    // Matches the workspace's task tab, so a send doesn't resize it.
                    className: "text-xs",
                    onClose: closeTaskSidebar,
                  },
                ]
              : []),
          ]}
          activeId={activePanel}
          onSelect={(id) => {
            if (id === "tasks" && selectedTask) {
              closeTaskSidebar();
            }
          }}
          onCloseSidebar={closeSidebar}
        />
      }
      sidebarContent={renderTaskPane(activePanel)}
    >
    <main className="grid h-full min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <ThreadHeader
        title="New thread"
        leading={
          <ThreadMobileBackButton
            organizationSlug={params.organizationSlug}
            projectAlias={params.projectAlias}
          />
        }
        actions={!sidebarOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={revealTasks}
            aria-label="Open thread sidebar"
            className="cursor-pointer"
          >
            <PanelRightOpen />
          </Button>
        ) : undefined}
      />
      <Centered variant="fill-min">
        <div className="flex flex-col items-center gap-3">
          <ConversationEmptyState
            className="size-auto p-0"
            title="New thread"
            description="Send a message to start a conversation through your CLI."
          />
          <ModeNotice
            cliType={resolvedDraftState.cliType}
            mode={resolvedDraftState.mode}
          />
        </div>
      </Centered>
      <ThreadComposer
        projectId={projectId}
        organizationId={organizationId}
        onSubmit={handleComposerSubmit}
        draftScopeKey={`${threadKey}-${composerSeedKey}`}
        initialInput={resolvedDraftState.text}
        initialAttachments={draftFileParts}
        initialComposerContent={draft?.composerContent}
        onInputChange={handleTextChange}
        onComposerContentChange={(composerContent) => setDraft({ composerContent })}
        onAttachmentsChange={handleAttachmentsChange}
        pendingAttachments={pendingAttachments}
        initialAttachedTask={threadWorkspace.attachedTask}
        initialAttachedPullRequest={initialAttachedPullRequest}
        onOpenAttachedTask={onOpenTask}
        getTaskHref={threadWorkspace.taskLinkHref}
        onAttachedTaskChange={(task) => threadWorkspace.setAttachedTask(task?.refId ?? null)}
        onTaskDrop={(task) => threadWorkspace.setAttachedTask(task.refId)}
        textareaDisabled={isSubmitting || isStarting}
        submitDisabled={isSubmitting || isStarting || isWorkflowLoading}
        isSubmitting={isSubmitting || isStarting}
        workflowSelector={
          <WorkflowSelector
            projectId={projectId}
            organizationSlug={params.organizationSlug}
            projectAlias={params.projectAlias}
            value={selectedWorkflow}
            onChange={selectWorkflow}
            disabled={isSubmitting || isStarting}
          />
        }
        selectorsProps={{
          profiles,
          profileId: resolvedDraftState.profileId,
          pathId: resolvedDraftState.pathId,
          cliType: resolvedDraftState.cliType,
          mode: resolvedDraftState.mode,
          cliModel: resolvedDraftState.cliModel,
          cliEffort: resolvedDraftState.cliEffort,
          baseRef: resolvedDraftState.baseRef,
          onBaseRefChange: handleBaseRefChange,
          onPathChange: handleWorkingDirectoryChange,
          onCliTypeChange: handleCliTypeChange,
          onCliModelChange: handleCliModelChange,
          onCliEffortChange: handleCliEffortChange,
          onModeChange: handleModeChange,
          projectAgents: projectAgents ?? [],
          projectAgentId: resolvedDraftState.projectAgentId,
          onProjectAgentChange: handleProjectAgentChange,
        }}
      />
    </main>
    </ThreadWorkspaceSplitPane>
  );
}
