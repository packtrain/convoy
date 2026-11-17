"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getMutationErrorMessage } from "@/lib/errors";
import type { ThreadComposerAttachedTask, ThreadComposerSubmitMessage } from "@/components/blocks/thread/thread-composer";
import {
  resolveThreadTarget,
  withTaskBranchFallback,
  type BaseRefPathEntry,
  type BaseRefSelection,
} from "@/lib/threads/base-ref-selection";
import { isThreadAttachmentSubmitError } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import type { ThreadMessageAttachmentInput } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { loadPersistedRefs } from "@/lib/threads/base-ref-storage";
import type { ThreadDraftPatch } from "@/lib/threads/draft-storage";

type CreateThreadArgs = FunctionArgs<typeof api.cli.threads.core.create>;

interface CreateThreadProfile {
  _id: Id<"cliProfiles">;
  paths: BaseRefPathEntry[];
}

interface CreateThreadDraftState {
  profileId: string;
  pathId: string;
  cliType: CreateThreadArgs["cliType"];
  mode: CreateThreadArgs["cliMode"];
  cliModel: CreateThreadArgs["cliModel"];
  cliEffort: CreateThreadArgs["cliEffort"];
  projectAgentId?: string;
  baseRef: BaseRefSelection | undefined;
}

interface UseCreateThreadSubmitOptions {
  profiles: CreateThreadProfile[];
  draftState: CreateThreadDraftState;
  /**
   * Active Project agents (OS-1138): the draft's `projectAgentId` is only
   * sent when it still resolves to one of these, so a stale selection fails
   * soft to an unbound thread instead of a server error.
   */
  projectAgents?: ReadonlyArray<{ _id: Id<"projectAgents"> }>;
  prepareAttachmentsForSubmit: () => Promise<ThreadMessageAttachmentInput[]>;
  clearAfterSubmit: () => void;
  setDraft: (patch: ThreadDraftPatch) => void;
  rememberCliModel: (
    cliType: CreateThreadArgs["cliType"],
    cliModel: CreateThreadArgs["cliModel"],
    cliEffort: CreateThreadArgs["cliEffort"]
  ) => void;
  /**
   * Fixed attached task for task-locked composers (branch naming + empty-text
   * seed). Defaults to the submit message's own attached task.
   */
  attachedTask?: ThreadComposerAttachedTask | null;
  agentWorkSource?: CreateThreadArgs["agentWorkSource"];
  /** A Pull request checks run (OS-2400) on the attached PR at this head. */
  pullRequestChecks?: CreateThreadArgs["pullRequestChecks"];
  /** A Guide run (OS-2412) on the attached PR at this head; its model stays out of the new-thread defaults. */
  pullRequestGuide?: CreateThreadArgs["pullRequestGuide"];
  /**
   * Add-to-group flow (OS-1477): when set, submit calls
   * `addThreadToGroup` instead of creating a root thread.
   */
  sourceThreadId?: Id<"cliThreads">;
  /**
   * Post-create step: navigate, toast, re-key the composer, close a dialog.
   * The add-to-group flow also returns the new thread's container. The
   * workspace adopts it so the tab strip stays mounted (OS-1615).
   */
  onCreated?: (
    threadId: Id<"cliThreads">,
    context?: { containerId: Id<"cliThreads"> }
  ) => void | Promise<void>;
}

/**
 * The shared create-thread submit pipeline behind every new-thread composer surface:
 * resolve the selected profile/path, upload attachments, resolve the thread target
 * (task-derived worktree branch names included), create the thread, remember the model,
 * clear the draft. Surfaces differ only via `attachedTask`/`agentWorkSource`/`onCreated`.
 */
export function useCreateThreadSubmit({
  profiles,
  draftState,
  projectAgents,
  prepareAttachmentsForSubmit,
  clearAfterSubmit,
  setDraft,
  rememberCliModel,
  attachedTask,
  agentWorkSource,
  pullRequestChecks,
  pullRequestGuide,
  sourceThreadId,
  onCreated,
}: UseCreateThreadSubmitOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const createThread = useMutation(api.cli.threads.core.create);
  const addThreadToGroup = useMutation(api.cli.threads.groups.addThreadToGroup);

  const handleSubmit = useCallback(
    async (message: ThreadComposerSubmitMessage) => {
      const text = message.text.trim();
      const selectedProfile = profiles.find(
        (profile) => profile._id === draftState.profileId && profile.paths.some((path) => path.id === draftState.pathId)
      );
      if (!selectedProfile || submitInFlightRef.current) {
        return;
      }

      submitInFlightRef.current = true;
      setIsSubmitting(true);
      try {
        const uploadedAttachments = await prepareAttachmentsForSubmit();
        if (text.length === 0 && uploadedAttachments.length === 0 && !message.taskId && !message.pullRequestUrl) {
          return;
        }

        const task = attachedTask ?? message.attachedTask ?? null;
        // Looked up in the typed agents list — validates the selection is
        // still an active project agent and narrows the id without a cast.
        const projectAgentId = draftState.projectAgentId
          ? projectAgents?.find((agent) => agent._id === draftState.projectAgentId)?._id
          : undefined;
        const target = resolveThreadTarget({
          selection: withTaskBranchFallback(draftState.baseRef, task),
          pathId: draftState.pathId,
          paths: selectedProfile.paths,
          messageSeed: text.length > 0 ? text : (task?.name ?? text),
        });

        const targetPath = selectedProfile.paths.find((path) => path.id === target.pathId);
        const initialBranch = !target.worktree && targetPath?.kind !== "worktree" && targetPath?.gitRemoteUrl
          ? loadPersistedRefs(selectedProfile._id, target.pathId)?.find((ref) => ref.isCurrent)?.name
          : undefined;
        const createArgs = {
          ...(initialBranch ? { initialBranch } : {}),
          profileId: selectedProfile._id,
          pathId: target.pathId,
          worktree: target.worktree,
          cliType: draftState.cliType,
          cliMode: draftState.mode,
          cliModel: draftState.cliModel,
          cliEffort: draftState.cliEffort,
          content: text,
          composerDocument: message.composerDocument,
          runtimeCommand: message.runtimeCommand,
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
          taskId: message.taskId,
          pullRequestUrl: message.pullRequestUrl,
          pullRequestChecks,
          pullRequestGuide,
          agentWorkSource,
          projectAgentId,
        };
        let threadId: Id<"cliThreads">;
        let containerId: Id<"cliThreads"> | undefined;
        if (sourceThreadId) {
          // A share on the source moves to the new group container (OS-1579),
          // so the link the owner handed out keeps working and there is
          // nothing to warn about.
          const addedThread = await addThreadToGroup({ ...createArgs, sourceThreadId });
          threadId = addedThread.threadId;
          containerId = addedThread.containerId;
        } else {
          threadId = await createThread(createArgs);
        }

        // A Guide's model is picked for Guides; its own draft keeps it.
        if (!pullRequestGuide) rememberCliModel(draftState.cliType, draftState.cliModel, draftState.cliEffort);
        // Awaited, and the draft cleared only after: the composer stays on
        // screen with its text while `onCreated` holds for the created thread's
        // data, so the swap lands on real content instead of placeholders
        // (OS-1665). `isSubmitting` covers that wait, which keeps it inert.
        await onCreated?.(threadId, containerId ? { containerId } : undefined);
        clearAfterSubmit();
        // Clear the message, keep the pills: deleting the whole draft made
        // every selector (mode, model, working directory) flash back to its
        // default while the new thread was still being opened.
        setDraft({ text: "", composerContent: undefined, attachments: { pending: false } });
      } catch (error) {
        if (isThreadAttachmentSubmitError(error)) {
          toast.error(error.message);
          throw error;
        }
        // ConvexErrors are actionable (a group at the child cap raced from
        // another device) — surface them; anything else stays generic. The
        // original error is rethrown so callers keep its stack and data.
        toast.error(getMutationErrorMessage(error, "Failed to create thread"));
        throw error;
      } finally {
        submitInFlightRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      attachedTask,
      agentWorkSource,
      pullRequestChecks,
      pullRequestGuide,
      clearAfterSubmit,
      setDraft,
      createThread,
      addThreadToGroup,
      sourceThreadId,
      draftState.baseRef,
      draftState.cliEffort,
      draftState.cliModel,
      draftState.cliType,
      draftState.mode,
      draftState.pathId,
      draftState.profileId,
      draftState.projectAgentId,
      onCreated,
      prepareAttachmentsForSubmit,
      profiles,
      projectAgents,
      rememberCliModel,
    ]
  );

  return { isSubmitting, handleSubmit };
}
