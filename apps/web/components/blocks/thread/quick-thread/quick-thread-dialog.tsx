"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTitleBar } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { ThreadComposer, type ThreadComposerSubmitMessage } from "@/components/blocks/thread/thread-composer";
import { ThreadDraftProvider, useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import {
  getHotkeyKeycaps,
  isEditableHotkeyTarget,
  isOverlayHotkeyTarget,
  QUICK_THREAD_SEND_AND_OPEN_SHORTCUT,
} from "@/lib/browser/hotkeys";
import { appRoute, externalRoutes, useNavigation } from "@/lib/navigation";
import { getLastProjectAlias } from "@/lib/routing/last-project-storage";
import { buildProjectDraftStorageKey } from "@/lib/threads/draft-storage";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreateThreadSubmit } from "@/lib/threads/hooks/use-create-thread-submit";
import { useNewThreadComposer } from "@/lib/threads/hooks/use-new-thread-composer";
import { useRememberedNewThreadCliModels } from "@/lib/threads/hooks/use-remembered-new-thread-cli-models";
import { useThreadMessageAttachmentUpload } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { buildHandleThreadComposerAttachmentsChange } from "@/lib/threads/message-attachments";
import { DEFAULT_FALLBACK_CLI_TYPE } from "@/lib/threads/types";

const QUICK_THREAD_DRAFT_KEY = "quick";

interface QuickThreadComposerProps {
  projectId: Id<"projects">;
  organizationId: Id<"organizations">;
  onStarted: (threadId: Id<"cliThreads">, open: boolean) => void;
}

function QuickThreadComposer({ projectId, organizationId, onStarted }: QuickThreadComposerProps) {
  const { profiles, hasProfiles, isLoading: isProfilesLoading } = useCliProfiles(projectId, { withModelCatalogs: true });
  const projectAgents = useQuery(api.agents.projectAgents.listByProject, { projectId });
  const { draft, setDraft } = useThreadDraft(QUICK_THREAD_DRAFT_KEY);
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

  const createdThreadIdRef = useRef<Id<"cliThreads"> | null>(null);
  const { isSubmitting, handleSubmit } = useCreateThreadSubmit({
    profiles,
    draftState: resolvedDraftState,
    projectAgents,
    prepareAttachmentsForSubmit,
    clearAfterSubmit,
    setDraft,
    rememberCliModel,
    onCreated: (threadId) => {
      createdThreadIdRef.current = threadId;
    },
  });

  // The composer submits Enter through its form, so the modifier is read off the key event here.
  const openAfterSendRef = useRef(false);
  const handleComposerSubmit = useCallback(
    async (message: ThreadComposerSubmitMessage) => {
      const open = openAfterSendRef.current;
      createdThreadIdRef.current = null;
      // Closed only after submit resolves, so the draft is cleared before this unmounts.
      await handleSubmit(message);
      if (createdThreadIdRef.current) onStarted(createdThreadIdRef.current, open);
    },
    [handleSubmit, onStarted]
  );

  const handleAttachmentsChange = useMemo(
    () => buildHandleThreadComposerAttachmentsChange({ syncFileParts, onError: (message) => toast.error(message) }),
    [syncFileParts]
  );

  const composerDisabled =
    isSubmitting || isProfilesLoading || !hasProfiles || !resolvedDraftState.profileId || !resolvedDraftState.pathId;

  return (
    <div
      onKeyDownCapture={(event) => {
        openAfterSendRef.current = event.key === "Enter" && (event.metaKey || event.ctrlKey);
      }}
      onPointerDownCapture={() => {
        openAfterSendRef.current = false;
      }}
    >
      {!hasProfiles && !isProfilesLoading ? (
        <p className="px-4 pt-3 text-xs text-muted-foreground">
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
        draftScopeKey={`${QUICK_THREAD_DRAFT_KEY}-${composerSeedKey}`}
        initialInput={resolvedDraftState.text}
        initialAttachments={draftFileParts}
        initialComposerContent={draft?.composerContent}
        onInputChange={handleTextChange}
        onComposerContentChange={(composerContent) => setDraft({ composerContent })}
        onAttachmentsChange={handleAttachmentsChange}
        pendingAttachments={pendingAttachments}
        textareaPlaceholder="Start a new thread..."
        autoFocus
        textareaDisabled={composerDisabled}
        submitDisabled={composerDisabled}
        isSubmitting={isSubmitting}
        containerClassName="p-3"
        contentClassName="max-w-none"
        textareaClassName="min-h-[88px] p-3"
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
      <div className="flex items-center justify-end gap-3 px-4 pb-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd> start
        </span>
        <span className="flex items-center gap-1">
          {getHotkeyKeycaps(QUICK_THREAD_SEND_AND_OPEN_SHORTCUT).map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}{" "}
          start and open
        </span>
      </div>
    </div>
  );
}

interface QuickThreadDialogProps {
  organizationId: Id<"organizations">;
  organizationSlug: string;
  projectAlias: string | null;
}

/** Shift+N composer that starts a thread without leaving the page (docs/specs/quick-thread-composer.md). */
export function QuickThreadDialog({ organizationId, organizationSlug, projectAlias }: QuickThreadDialogProps) {
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  // Same fallback as G, T: the current project, else the last one visited.
  const alias = projectAlias ?? getLastProjectAlias(organizationSlug);
  const project = useQuery(api.projects.core.getByAlias, alias ? { organizationId, alias } : "skip");
  const { canUseThreads } = useProjectPermissions(project?._id ?? null);
  const enabled = Boolean(project) && canUseThreads;

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toUpperCase() !== "N" || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.defaultPrevented || isEditableHotkeyTarget(event.target) || isOverlayHotkeyTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);

  const handleStarted = useCallback(
    (threadId: Id<"cliThreads">, openThread: boolean) => {
      setOpen(false);
      if (!project) return;
      const target = appRoute.projectThreadDetail(organizationSlug, project.alias, threadId);
      if (openThread) {
        navigation.push(target);
        return;
      }
      toast.success("Thread started", { action: { label: "Open", onClick: () => navigation.push(target) } });
    },
    [navigation, organizationSlug, project]
  );

  if (!project) return null;

  return (
    <Dialog open={open && enabled} onOpenChange={setOpen}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-2xl"
        // Radix would focus the profile pill, which opens its card; the composer focuses itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitleBar>
          <DialogTitle className="text-sm">New thread in {project.alias}</DialogTitle>
          <DialogDescription className="sr-only">Start a thread without leaving this page.</DialogDescription>
        </DialogTitleBar>
        <ThreadDraftProvider storageKey={buildProjectDraftStorageKey(organizationSlug, project.alias)}>
          <QuickThreadComposer projectId={project._id} organizationId={organizationId} onStarted={handleStarted} />
        </ThreadDraftProvider>
      </DialogContent>
    </Dialog>
  );
}
