"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AttachedPullRequest } from "@/convex/lib/contracts/github";
import {
  ThreadComposer,
  type ThreadComposerAttachedTask,
  type ThreadComposerSubmitMessage,
} from "@/components/blocks/thread/thread-composer";
import { ThreadDraftProvider, useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import { WorkflowSelector } from "@/components/blocks/workflows/workflow-selector";
import { buildProjectDraftStorageKey } from "@/lib/threads/draft-storage";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreateThreadSubmit } from "@/lib/threads/hooks/use-create-thread-submit";
import { useNewThreadComposer } from "@/lib/threads/hooks/use-new-thread-composer";
import { useWorkflowRunComposer } from "@/lib/threads/hooks/use-workflow-run-composer";
import { useRememberedNewThreadCliModels } from "@/lib/threads/hooks/use-remembered-new-thread-cli-models";
import { useThreadMessageAttachmentUpload } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { buildHandleThreadComposerAttachmentsChange } from "@/lib/threads/message-attachments";
import { DEFAULT_FALLBACK_CLI_TYPE } from "@/lib/threads/types";
import { externalRoutes } from "@/lib/navigation";
import { useOptionalCurrentOrgProject } from "@/lib/routing/current-org-project-context";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/tasks/types";

/**
 * The task-attached new-thread composer: drafts, profiles, project agents, attachment
 * upload, remembered CLI selections, and the locked task pill.
 *
 * Not tab or footer machinery, despite where it used to live — the task timeline hosts it
 * in-stream and the Runs popover in an overlay, which is why the top border is opt-in and
 * the two padding overrides exist.
 */
/** What every thread starts attached to, locked: a task, or a PR (the PR Overview's Activity, OS-2193). */
type TaskThreadComposerSubject =
  | { task: Pick<Task, "_id" | "refId" | "name" | "taskType" | "isArchived">; pullRequest?: never }
  | { pullRequest: AttachedPullRequest; task?: never };

/** Appends text to the draft once and focuses (a PR card's Fix); the host clears it on `onSeeded`. */
type TaskThreadComposerSeed =
  | { seed?: never; onSeeded?: never; seedReplacesDraft?: never }
  | { seed: string | undefined; onSeeded: () => void; /** Replace the draft's text instead of appending. */ seedReplacesDraft?: boolean };

type TaskThreadComposerProps = TaskThreadComposerSubject &
  TaskThreadComposerSeed & {
  projectId: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
  /** Overrides the draft key, for a composer that must not share the subject's draft (Run pull request checks). */
  draftKey?: string;
  /** Starts a Pull request checks thread on this head (OS-2400). */
  pullRequestChecks?: { headSha: string };
  focusRequestKey?: number;
  /** Focus the composer as soon as it is enabled (e.g. when opened in a popover). */
  autoFocus?: boolean;
  /** Notifies the host after a thread is created (e.g. to open it in a preview). */
  onThreadCreated?: (threadId: Id<"cliThreads">) => void;
  className?: string;
  /**
   * Draw the top border. Opt-in because the timeline hosts this in-stream,
   * where a full-width rule reads as a section divider that isn't there.
   */
  bordered?: boolean;
  /** Overrides the composer container padding (defaults to the sidebar's p-5). */
  composerContainerClassName?: string;
  /** Overrides the composer input sizing (defaults to the sidebar's 88px minimum). */
  composerTextareaClassName?: string;
};

type TaskThreadComposerContentProps = TaskThreadComposerProps & {
  threadKey: string;
};

function TaskThreadComposerContent({
  projectId,
  organizationSlug,
  projectAlias,
  task,
  pullRequest,
  seed,
  onSeeded,
  seedReplacesDraft,
  pullRequestChecks,
  threadKey,
  focusRequestKey,
  autoFocus = false,
  onThreadCreated,
  className,
  bordered = false,
  composerContainerClassName,
  composerTextareaClassName,
}: TaskThreadComposerContentProps) {
  const [composerInstanceKey, setComposerInstanceKey] = useState(0);
  const organizationId = useOptionalCurrentOrgProject()?.organizationId;
  const { profiles, hasProfiles, isLoading: isProfilesLoading } = useCliProfiles(projectId, { withModelCatalogs: true });
  const projectAgents = useQuery(api.agents.projectAgents.listByProject, { projectId });
  const { draft, setDraft } = useThreadDraft(threadKey);
  const { rememberedCliModels, rememberedCliEfforts, rememberedCliType, rememberCliModel } = useRememberedNewThreadCliModels();
  const { pendingAttachments, syncFileParts, prepareAttachmentsForSubmit, clearAfterSubmit, draftFileParts } =
    useThreadMessageAttachmentUpload(projectId, {
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
    fallbackCliType: DEFAULT_FALLBACK_CLI_TYPE,
    rememberedCliModels,
    rememberedCliEfforts,
    rememberedCliType,
    projectAgents,
  });

  const initialAttachedTask: ThreadComposerAttachedTask | null = task
    ? { _id: task._id, refId: task.refId, name: task.name, taskType: task.taskType }
    : null;
  // Counts applied seeds: it pushes the text into the mounted editor and refocuses it.
  const [seedCount, setSeedCount] = useState(0);
  useEffect(() => {
    if (seed === undefined) return;
    // Appended below what the member already typed, so a second Fix keeps the first.
    const typed = seedReplacesDraft ? undefined : draft?.text?.trim();
    setDraft({ text: typed ? `${typed}\n\n${seed}` : seed, composerContent: undefined });
    setSeedCount((count) => count + 1);
    onSeeded?.();
    // A seed is consumed once; the host clears it through `onSeeded`, so a remount never re-applies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const { isSubmitting, handleSubmit } = useCreateThreadSubmit({
    profiles,
    draftState: resolvedDraftState,
    projectAgents,
    prepareAttachmentsForSubmit,
    clearAfterSubmit,
    setDraft,
    rememberCliModel,
    attachedTask: initialAttachedTask,
    pullRequestChecks,
    // Re-key the composer so the locked initial task pill is restored after
    // ThreadComposer clears its internal attached-task state on submit.
    onCreated: (threadId) => {
      setComposerInstanceKey((currentKey) => currentKey + 1);
      onThreadCreated?.(threadId);
    },
  });

  // A selected workflow reroutes submit into a run start with the task
  // attached, navigating to the run's container thread.
  const { selectedWorkflow, selectWorkflow, isStarting, isWorkflowLoading, maybeStartRun } = useWorkflowRunComposer({
    organizationSlug,
    projectAlias,
    profiles,
    draftState: resolvedDraftState,
    draft,
    setDraft,
    attachedTask: initialAttachedTask,
  });
  const handleComposerSubmit = useCallback(
    async (message: ThreadComposerSubmitMessage) => {
      if (await maybeStartRun(message)) {
        return;
      }
      await handleSubmit(message);
    },
    [handleSubmit, maybeStartRun]
  );

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

  const composerDisabled =
    task?.isArchived ||
    isSubmitting ||
    isStarting ||
    isProfilesLoading ||
    !hasProfiles ||
    !resolvedDraftState.profileId ||
    !resolvedDraftState.pathId;

  // The composer focuses when its focus key changes and only takes focus once
  // enabled, so derive a bump from the enabled state (profiles resolve async
  // after a popover mounts this footer; the key flips again after each send).
  const autoFocusBump = autoFocus && !composerDisabled ? 1 : 0;

  return (
    <div className={cn(bordered && "border-t border-border", className)}>
      {!hasProfiles && !isProfilesLoading ? (
        <p className="px-4 pb-1 pt-3 text-xs text-muted-foreground">
          Connect a CLI profile to start a thread from here.{" "}
          <a href={externalRoutes.docsCliSetupAndConnect} target="_blank" rel="noopener noreferrer" className="text-primary underline">
            Learn how
          </a>
          .
        </p>
      ) : null}
      <ThreadComposer
        organizationId={organizationId}
        projectId={projectId}
        onSubmit={handleComposerSubmit}
        draftScopeKey={`${threadKey}-${composerInstanceKey}-${composerSeedKey}`}
        initialInput={resolvedDraftState.text}
        initialAttachments={draftFileParts}
        initialComposerContent={draft?.composerContent}
        onInputChange={handleTextChange}
        onComposerContentChange={(composerContent) => setDraft({ composerContent })}
        onAttachmentsChange={handleAttachmentsChange}
        pendingAttachments={pendingAttachments}
        textareaPlaceholder="Start a new thread..."
        initialAttachedTask={initialAttachedTask}
        initialAttachedPullRequest={pullRequest}
        isAttachedTaskRemovable={!task}
        isAttachedPullRequestRemovable={!pullRequest}
        seedKey={seedCount ? `seed:${seedCount}` : undefined}
        focusRequestKey={(focusRequestKey ?? 0) + autoFocusBump + seedCount}
        textareaDisabled={composerDisabled}
        submitDisabled={composerDisabled || isWorkflowLoading}
        containerClassName={composerContainerClassName ?? "p-5"}
        contentClassName="max-w-none"
        textareaClassName={composerTextareaClassName ?? "min-h-[88px] p-3"}
        // A run can't carry the PR yet, so the PR's composer offers no workflows.
        workflowSelector={
          pullRequest ? undefined : <WorkflowSelector
            projectId={projectId}
            organizationSlug={organizationSlug}
            projectAlias={projectAlias}
            value={selectedWorkflow}
            onChange={selectWorkflow}
            disabled={composerDisabled}
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
    </div>
  );
}

export function TaskThreadComposer(props: TaskThreadComposerProps) {
  const draftStorageKey = buildProjectDraftStorageKey(props.organizationSlug, props.projectAlias);
  const threadKey = props.draftKey ?? (props.task ? `task:${String(props.task._id)}` : `pr:${props.pullRequest?.ref}`);

  return (
    <ThreadDraftProvider key={draftStorageKey} storageKey={draftStorageKey}>
      <TaskThreadComposerContent {...props} threadKey={threadKey} />
    </ThreadDraftProvider>
  );
}
