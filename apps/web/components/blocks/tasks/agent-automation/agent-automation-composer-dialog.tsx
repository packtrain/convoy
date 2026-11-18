"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import type { ProjectAgentListItem } from "@/components/blocks/agents/agent-list-utils";
import { AutoStartPreferenceSelector } from "@/components/blocks/thread/auto-start-preference-selector";
import { ThreadComposer, type ThreadComposerAttachedTask } from "@/components/blocks/thread/thread-composer";
import { ThreadDraftProvider, getNewThreadDraftKey, useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buildAutomationDraftSeed } from "@/lib/threads/draft-flow";
import { buildProjectDraftStorageKey } from "@/lib/threads/draft-storage";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreateThreadSubmit } from "@/lib/threads/hooks/use-create-thread-submit";
import { useNewThreadComposer } from "@/lib/threads/hooks/use-new-thread-composer";
import { useRememberedNewThreadCliModels } from "@/lib/threads/hooks/use-remembered-new-thread-cli-models";
import { useThreadMessageAttachmentUpload } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { buildHandleThreadComposerAttachmentsChange } from "@/lib/threads/message-attachments";
import { DEFAULT_FALLBACK_CLI_TYPE } from "@/lib/threads/types";
import { buildComposerJsonFromPromptContent } from "@/lib/slash-commands/composer";
import { externalRoutes } from "@/lib/navigation";
import type { Task } from "@/lib/tasks/types";

const NOOP_PROJECT_AGENT_CHANGE = () => {};

interface AgentAutomationComposerDialogProps {
  projectId: Id<"projects">;
  organizationId: Id<"organizations">;
  organizationSlug: string;
  projectAlias: string;
  task: Task;
  agent: ProjectAgentListItem;
  onClose: () => void;
}

/**
 * Assignment-automation composer (OS-1094): the normal thread composer in a dialog,
 * prefilled from the agent's automation prompt, with the task locked and the assigned
 * agent preselected and locked in the Agent pill (OS-1138) so the thread binds it.
 * Nothing is sent until submit, which takes the normal create path with
 * `agentWorkSource: "assignment_automation"`.
 */
export function AgentAutomationComposerDialog(props: AgentAutomationComposerDialogProps) {
  const draftStorageKey = buildProjectDraftStorageKey(props.organizationSlug, props.projectAlias);
  const threadKey = `agent-automation:${String(props.task._id)}`;

  return (
    <ThreadDraftProvider key={draftStorageKey} storageKey={draftStorageKey}>
      <AgentAutomationComposerDialogContent {...props} threadKey={threadKey} />
    </ThreadDraftProvider>
  );
}

function AgentAutomationComposerDialogContent({
  projectId,
  organizationId,
  task,
  agent,
  threadKey,
  onClose,
}: AgentAutomationComposerDialogProps & { threadKey: string }) {
  const { profiles, hasProfiles, isLoading: isProfilesLoading } = useCliProfiles(projectId, { withModelCatalogs: true });
  // OS-1131: per-user per-project auto-start preference, changeable from a
  // dropdown next to the composer selectors; persisted on successful send.
  const projectPreferences = useQuery(api.users.projectPreferences.get, { projectId });
  const upsertProjectPreferences = useMutation(api.users.projectPreferences.upsert);
  const storedAutoStart = projectPreferences?.agentAutoStart ?? false;
  const [autoStartChoice, setAutoStartChoice] = useState<boolean | null>(null);
  const effectiveAutoStart = autoStartChoice ?? storedAutoStart;
  const { draft: newThreadDraft } = useThreadDraft(getNewThreadDraftKey());
  const { draft, setDraft, clearDraft } = useThreadDraft(threadKey);
  const { rememberedCliModels, rememberedCliEfforts, rememberedCliType, rememberCliModel } = useRememberedNewThreadCliModels();
  const { pendingAttachments, syncFileParts, prepareAttachmentsForSubmit, clearAfterSubmit } = useThreadMessageAttachmentUpload(projectId);
  // The Agent pill is locked to the assigned agent (OS-1138): offering only it
  // keeps the drafted id resolvable and lets the submit pipeline narrow the
  // binding without a cast.
  const projectAgents = useMemo(() => [agent], [agent]);
  const {
    resolvedDraftState,
    handleTextChange,
    handleWorkingDirectoryChange,
    handleBaseRefChange,
    handleCliTypeChange,
    handleModeChange,
    handleCliModelChange,
    handleCliEffortChange,
  } = useNewThreadComposer({
    profiles,
    draft,
    setDraft,
    fallbackCliType: DEFAULT_FALLBACK_CLI_TYPE,
    rememberedCliModels,
    rememberedCliEfforts,
    rememberedCliType,
    // This flow's draft slot is ephemeral and seeded below from the agent's
    // automation config; the backfill writer would race the seed and
    // overwrite the configured model/effort/mode with remembered defaults.
    backfillEnabled: false,
    projectAgents,
  });

  const automation = agent.automation;

  // Seed this flow's draft slot once: the assigned agent is bound (OS-1138),
  // automation cliType/model/effort/mode/workspace win (via the shared seed
  // builder), the profile/path selection follows the persisted new-thread draft
  // (then the resolver's online-profile fallback).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) {
      return;
    }
    seededRef.current = true;
    clearDraft();
    setDraft({
      text: "",
      projectAgentId: agent._id,
      ...buildAutomationDraftSeed(automation),
      ...(newThreadDraft?.profileId ? { profileId: newThreadDraft.profileId } : {}),
      ...(newThreadDraft?.pathId ? { pathId: newThreadDraft.pathId } : {}),
    });
  }, [
    agent._id,
    automation,
    clearDraft,
    newThreadDraft?.pathId,
    newThreadDraft?.profileId,
    setDraft,
  ]);

  const promptDisplayContent = automation?.prompt?.displayContent ?? "";
  const initialComposerContent = useMemo(
    () => buildComposerJsonFromPromptContent(promptDisplayContent, automation?.prompt?.composerDocument?.refs ?? []),
    [automation?.prompt?.composerDocument?.refs, promptDisplayContent]
  );

  const initialAttachedTask: ThreadComposerAttachedTask = {
    _id: task._id,
    refId: task.refId,
    name: task.name,
    taskType: task.taskType,
  };

  const { isSubmitting, handleSubmit } = useCreateThreadSubmit({
    profiles,
    draftState: resolvedDraftState,
    // Without this list the drafted projectAgentId is silently dropped — the
    // submit pipeline only sends ids it can narrow against these options.
    projectAgents,
    prepareAttachmentsForSubmit,
    clearAfterSubmit,
    setDraft,
    rememberCliModel,
    attachedTask: initialAttachedTask,
    agentWorkSource: "assignment_automation",
    onCreated: () => {
      if (autoStartChoice !== null && autoStartChoice !== storedAutoStart) {
        void upsertProjectPreferences({ projectId, agentAutoStart: autoStartChoice });
      }
      toast.success(`Thread started for ${task.refId}`);
      onClose();
    },
  });

  const handleAttachmentsChange = useMemo(
    () =>
      buildHandleThreadComposerAttachmentsChange({
        setPendingDraft: (hasPendingAttachments) => setDraft({ attachments: { pending: hasPendingAttachments } }),
        syncFileParts,
        onError: (message) => {
          toast.error(message);
        },
      }),
    [setDraft, syncFileParts]
  );

  const composerDisabled = isSubmitting || isProfilesLoading || !hasProfiles || !resolvedDraftState.profileId || !resolvedDraftState.pathId;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      clearDraft();
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      {/* A one-line titlebar over the normal thread composer, kept with its
          usual border/focus styling and inset from the dialog edges so both
          outlines read (matches the other composer surfaces). */}
      <DialogContent className="gap-0 overflow-hidden rounded-lg p-0 sm:max-w-2xl" closeButtonClassName="top-1 right-1">
        <DialogHeader className="px-3 py-2 text-left">
          <DialogTitle className="text-sm font-medium">Start agent thread</DialogTitle>
          <DialogDescription className="sr-only">
            {task.refId} was assigned to {agent.name}. Review the prompt, pick your CLI profile, and send to start the thread.
          </DialogDescription>
        </DialogHeader>
        {!hasProfiles && !isProfilesLoading ? (
          <p className="px-4 pb-2 text-xs text-muted-foreground">
            Connect a CLI profile to start a thread.{" "}
            <a href={externalRoutes.docsCliSetupAndConnect} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Learn how
            </a>
            .
          </p>
        ) : null}
        <ThreadComposer
          projectId={projectId}
          organizationId={organizationId}
          onSubmit={handleSubmit}
          draftScopeKey={threadKey}
          initialInput={promptDisplayContent}
          initialComposerContent={initialComposerContent}
          onInputChange={handleTextChange}
          onAttachmentsChange={handleAttachmentsChange}
          pendingAttachments={pendingAttachments}
          textareaPlaceholder="Prompt for the agent..."
          initialAttachedTask={initialAttachedTask}
          isAttachedTaskRemovable={false}
          containerClassName="px-2 pt-0 pb-2"
          contentClassName="max-w-none"
          textareaDisabled={composerDisabled}
          submitDisabled={composerDisabled}
          extraSelectorTools={
            <AutoStartPreferenceSelector label="Assignment automation" value={effectiveAutoStart} disabled={composerDisabled} onChange={setAutoStartChoice} />
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
            // The Agent pill shows the assigned agent, locked: the assignment
            // decided the binding, so it can't be changed here (the handler is
            // required for the pill to render but never fires).
            projectAgents,
            projectAgentId: resolvedDraftState.projectAgentId,
            onProjectAgentChange: NOOP_PROJECT_AGENT_CHANGE,
            projectAgentLocked: true,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
