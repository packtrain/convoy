"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Centered } from "@/components/custom/centered";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreateThreadSubmit } from "@/lib/threads/hooks/use-create-thread-submit";
import { useNewThreadComposer } from "@/lib/threads/hooks/use-new-thread-composer";
import { useRememberedNewThreadCliModels } from "@/lib/threads/hooks/use-remembered-new-thread-cli-models";
import { useThreadMessageAttachmentUpload } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { buildHandleThreadComposerAttachmentsChange } from "@/lib/threads/message-attachments";
import { useWorkflowRunComposer } from "@/lib/threads/hooks/use-workflow-run-composer";
import { WorkflowSelector } from "@/components/blocks/workflows/workflow-selector";
import { ThreadComposer, type ThreadComposerAttachedTask, type ThreadComposerSubmitMessage } from "./thread-composer";
import { useThreadDraft } from "./thread-draft-provider";
import type { ThreadViewChat } from "./thread-view/thread-view";

interface AddThreadToGroupDraftViewProps {
  /** The source thread that the new thread joins beside and inherits settings from. */
  chat: ThreadViewChat;
  params: { organizationSlug: string; projectAlias: string };
  onWorkflowStarted?: (containerId: Id<"cliThreads">, runId: Id<"workflowRuns">) => void | Promise<void>;
  organizationId?: Id<"organizations">;
  /** Stable add-to-group draft key (`sibling:<containerId|threadId>`), seeded by "+". */
  draftKey: string;
  taskLinkHref?: (task: { refId: string; isArchived?: boolean }) => string;
  onOpenTask?: (task: ThreadComposerAttachedTask) => void;
  /**
   * The new thread's group rides along so the workspace can adopt the scope
   * and keep the strip mounted across the send (OS-1615).
   */
  onCreated: (
    threadId: Id<"cliThreads">,
    context?: { containerId: Id<"cliThreads"> }
  ) => void;
}

/**
 * The draft tab of a thread group (OS-1477, docs/specs/thread-groups.md):
 * a new-thread composer prefilled from the source thread, submitting through
 * `addThreadToGroup` so the group forms lazily on first send. Renders the same
 * two grid rows as `ThreadView` (empty state + composer) inside the detail
 * page's thread column.
 */
export function AddThreadToGroupDraftView({
  chat,
  params,
  onWorkflowStarted,
  organizationId,
  draftKey,
  taskLinkHref,
  onOpenTask,
  onCreated,
}: AddThreadToGroupDraftViewProps) {
  const { profiles } = useCliProfiles(chat.projectId, { withModelCatalogs: true });
  const projectAgents = useQuery(api.agents.projectAgents.listByProject, {
    projectId: chat.projectId,
  });
  const { draft, setDraft } = useThreadDraft(draftKey);
  const { rememberCliModel } = useRememberedNewThreadCliModels();
  const { pendingAttachments, syncFileParts, prepareAttachmentsForSubmit, clearAfterSubmit, draftFileParts } =
    useThreadMessageAttachmentUpload(chat.projectId, {
    attachments: draft?.attachments,
    save: (attachments) => setDraft({ attachments }),
  });

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
    fallbackCliType: chat.cliType,
    // No remembered-model influence: the draft is seeded from the source
    // thread, and the resolver must not paper over that seed with values
    // remembered from unrelated new-thread composers.
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
    sourceThreadId: chat._id,
    onCreated,
  });

  const { selectedWorkflow, selectWorkflow, isStarting, isWorkflowLoading, maybeStartRun } = useWorkflowRunComposer({
    ...params,
    profiles,
    draftState: resolvedDraftState,
    draft,
    setDraft,
    sourceThreadId: chat._id,
    expectedContainerId: chat.kind === "group" ? chat._id : chat.parentThreadId ?? null,
    onStarted: onWorkflowStarted,
  });
  const canStartWorkflow = chat.workflowRunId === undefined && chat.containerWorkflowRunId === undefined;
  const handleComposerSubmit = useCallback(async (message: ThreadComposerSubmitMessage) => {
    if (await maybeStartRun(message)) return;
    await handleSubmit(message);
  }, [handleSubmit, maybeStartRun]);

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

  const initialAttachedTask = useMemo<ThreadComposerAttachedTask | null>(() => {
    const task = chat.associatedTask;
    return task ? { _id: task._id, refId: task.refId, name: task.name, taskType: task.taskType } : null;
  }, [chat.associatedTask]);

  return (
    <>
      <Centered variant="fill-min">
        <ConversationEmptyState
          className="size-auto p-0"
          title="New thread"
          description="Send a message to start a thread in this group."
        />
      </Centered>
      <ThreadComposer
        projectId={chat.projectId}
        organizationId={organizationId}
        onSubmit={handleComposerSubmit}
        draftScopeKey={`${draftKey}-${composerSeedKey}`}
        initialInput={resolvedDraftState.text}
        initialAttachments={draftFileParts}
        initialComposerContent={draft?.composerContent}
        onInputChange={handleTextChange}
        onComposerContentChange={(composerContent) => setDraft({ composerContent })}
        onAttachmentsChange={handleAttachmentsChange}
        pendingAttachments={pendingAttachments}
        initialAttachedTask={initialAttachedTask}
        onOpenAttachedTask={onOpenTask}
        getTaskHref={taskLinkHref}
        textareaDisabled={isSubmitting || isStarting}
        submitDisabled={isSubmitting || isStarting || isWorkflowLoading}
        isSubmitting={isSubmitting || isStarting}
        workflowSelector={canStartWorkflow || isStarting ? (
          <WorkflowSelector
            projectId={chat.projectId}
            organizationSlug={params.organizationSlug}
            projectAlias={params.projectAlias}
            value={selectedWorkflow}
            onChange={selectWorkflow}
            disabled={isSubmitting || isStarting}
          />
        ) : undefined}
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
    </>
  );
}
