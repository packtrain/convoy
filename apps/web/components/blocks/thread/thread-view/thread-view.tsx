"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliMessageAttachmentSummary } from "@/convex/lib/contracts/validators";
import type {
  CliRunDiffFile,
  CliRunDiffSummaryPreview,
} from "@/convex/lib/contracts/validators";
import { extractLatestAskUserQuestionResponses } from "@/lib/ai-tools/ask-user-question";
import { hydrateAvailableClis } from "@/convex/lib/contracts/validators";
import { cliTypeSupportsSteering } from "@/lib/cli-runtime-ui/registry";
import { mergeUsageLimits, toContextWindowUsage, toUsageLimitUsage } from "@/lib/cli-stream-ui";
import { appRoute, href, useNavigation, withProjectTaskAndArchive } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/errors";
import {
  resolveChatDetailEffort,
  resolveChatDetailMode,
  resolveChatDetailModel,
} from "@/lib/threads/draft-flow";
import type { UseCliMessagesResult } from "@/lib/threads/hooks/use-cli-messages";
import type { useCliThread } from "@/lib/threads/hooks/use-cli-thread";
import type { ThreadWorkspaceTaskTarget } from "@/lib/threads/hooks/use-open-thread-workspace-task";
import { useThreadMessageAttachmentUpload } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { buildHandleThreadComposerAttachmentsChange } from "@/lib/threads/message-attachments";
import { deriveUserMessageResponseMap, findLatestRowMessage, findLatestRowUserMessage, forkDividerAnchor } from "@/lib/threads/message-rows";
import { hasParkedExitPlanMode } from "@/lib/threads/plan-decision";
import { CLI_TYPE_MAP } from "@/lib/threads/types";
import { InteractionRequestCards } from "@/components/blocks/thread/interaction-request-cards";
import { WorkflowWaitCard } from "@/components/blocks/workflows/workflow-wait-card";
import type { ConversationHandle } from "@/components/ai-elements/conversation";
import { toPlanProgress } from "@/lib/threads/plan-progress";
import {
  QueuedMessagesStrip,
  type QueuedStripMessage,
} from "@/components/blocks/thread/queued-messages-strip";
import {
  ThreadComposer,
  type ThreadComposerAttachedTask,
  type ThreadComposerControllerApi,
  type ThreadComposerSubmitMessage,
} from "@/components/blocks/thread/thread-composer";
import {
  buildThreadDraftKey,
  useThreadDraft,
} from "@/components/blocks/thread/thread-draft-provider";
import type { WorkingDirectorySelectorProfile } from "@/components/blocks/thread/working-directory-selector";
import { ThreadCliOfflineBanner } from "./thread-cli-offline-banner";
import { ThreadDestructiveConfirmDialog } from "./thread-destructive-confirm-dialog";
import { ThreadForkDivider, ThreadForkHistory } from "./thread-fork-history";
import { ThreadMessageList } from "./thread-message-list";
import { useThreadDetailMessageActions } from "./use-thread-detail-message-actions";
import { useThreadDetailMessageVisibility } from "./use-thread-detail-message-visibility";

const ThreadViewComposer = memo(function ThreadViewComposer(
  props: ComponentProps<typeof ThreadComposer>
) {
  return <ThreadComposer {...props} />;
});

export type ThreadViewChat = NonNullable<
  ReturnType<typeof useCliThread>["thread"]
>;

export type ThreadViewSubmitHandler = (
  message: ThreadComposerSubmitMessage
) => Promise<void>;

export interface ThreadViewProps {
  chat: ThreadViewChat;
  /** Shared `useCliMessages(chat._id)` result — the host owns the subscription
   * so page-level features (run timeline, review comments) can reuse it. */
  cliMessages: UseCliMessagesResult;
  organizationSlug: string;
  projectAlias: string;
  organizationId?: Id<"organizations">;
  /** Task pill href builder; defaults to the project task URL. */
  taskLinkHref?: (task: ThreadWorkspaceTaskTarget) => string;
  /** Opens a task in a host surface; when omitted, task pills navigate. */
  onOpenTask?: (task: ThreadWorkspaceTaskTarget) => void;
  /** Opens an artifact in a host surface; when omitted, links navigate (OS-1569). */
  onOpenArtifact?: (artifactId: string) => void;
  /** Opens a task ref from a task tool part in the host's sidebar (OS-1686). */
  onOpenTaskRef?: (refId: string) => void;
  initialAttachedTask?: ThreadComposerAttachedTask | null;
  onAttachedTaskChange?: (taskRefId: string | null) => void;
  /** Wraps the send handler (e.g. to append run-review feedback). */
  wrapSubmit?: (submit: ThreadViewSubmitHandler) => ThreadViewSubmitHandler;
  extraAttachmentPills?: ReactNode;
  /** Shared composer controller (e.g. for "mention in reply" from a host sidebar). */
  composerControllerRef?: RefObject<ThreadComposerControllerApi | null>;
  onOpenDiffFile?: (file: CliRunDiffFile, diffSummary: CliRunDiffSummaryPreview) => void;
  onRevertRun?: (diffSummary: CliRunDiffSummaryPreview) => void;
  onRevertFile?: (file: CliRunDiffFile, diffSummary: CliRunDiffSummaryPreview) => void;
  /**
   * Renders the transcript without any write affordance — a project teammate
   * viewing a shared thread (`chat.isOwner === false`, OS-1575). Drops the
   * composer, the queued strip, the interaction cards and every action
   * handler, and skips the three subscriptions only those surfaces read.
   * See `docs/specs/cli-thread-sharing.md`.
   */
  readOnly?: boolean;
  /** Opens a fork created as a tab beside this thread (OS-2224); absent disables "In a new tab". */
  onBranchedIntoTab?: (scope: { containerId: Id<"cliThreads">; threadId: Id<"cliThreads"> }) => void;
  /** Handoff from here → In a new thread (docs/specs/cli-thread-handoff.md); absent where the host can't seed the new-thread draft. */
  onHandoffToNewThread?: (messageId: Id<"cliMessages">) => void;
  /** Handoff from here → In a new tab; absent without a group that can take a tab. */
  onHandoffToNewTab?: (messageId: Id<"cliMessages">) => void;
  composerContainerClassName?: string;
  composerContentClassName?: string;
}

/**
 * Embeddable thread conversation (OS-1130): message stream, queued-messages strip,
 * interaction cards, follow-up composer, retry dialog. The host provides the resolved
 * thread and the `useCliMessages` result and lays the fragment out in a column whose
 * first row can grow. Requires a `ThreadDraftProvider` ancestor.
 */
export function ThreadView({
  chat,
  cliMessages,
  organizationSlug,
  projectAlias,
  organizationId,
  taskLinkHref,
  onOpenTask,
  onOpenArtifact,
  onOpenTaskRef,
  initialAttachedTask,
  onAttachedTaskChange,
  wrapSubmit,
  extraAttachmentPills,
  composerControllerRef,
  onOpenDiffFile,
  onRevertRun,
  onRevertFile,
  readOnly = false,
  onBranchedIntoTab,
  onHandoffToNewThread,
  onHandoffToNewTab,
  composerContainerClassName,
  composerContentClassName,
}: ThreadViewProps) {
  const threadId = chat._id;
  const {
    envelopes,
    envelopesById,
    visibleMessageIds,
    isLoading: isLoadingMessages,
    loadedChunkCount,
    hasOlderChunks,
    hasOlderEnvelopes,
    isLoadingOlderChunks,
    olderHistoryPaused,
    loadOlderChunks,
    sendMessage,
    retryMessage,
    steerMessage,
    removeQueuedMessage,
    editLastMessage,
    cancelProcessing,
    renderStateByMessageId,
    userTextById,
    latestContextWindow,
    latestUsageLimits,
  } = cliMessages;
  const conversationRef = useRef<ConversationHandle | null>(null);

  const threadKey = buildThreadDraftKey(String(threadId));
  const { draft, setDraft } = useThreadDraft(threadKey);
  const {
    pendingAttachments,
    seedUploadedAttachments,
    syncFileParts,
    prepareAttachmentsForSubmit,
    clearAfterSubmit,
    draftFileParts,
  } = useThreadMessageAttachmentUpload(chat.projectId, {
    attachments: draft?.attachments,
    save: (attachments) => setDraft({ attachments }),
  });
  const activeProfile = useQuery(api.cli.profiles.get, {
    profileId: chat.profileId,
  });
  // Catalogs are no longer on the profile row (OS-1721); only a composer offers
  // models, so a read-only viewer never subscribes.
  const runtimeCatalogs = useQuery(
    api.cli.profiles.listRuntimeCatalogs,
    readOnly ? "skip" : { projectId: chat.projectId }
  );
  const activeProfileClis = useMemo(
    () =>
      activeProfile
        ? hydrateAvailableClis(activeProfile.availableClis, runtimeCatalogs ?? [], chat.profileId)
        : undefined,
    [activeProfile, runtimeCatalogs, chat.profileId]
  );
  // Runtime slash commands the agent advertised on its last run (empty until
  // the first run reports); offered in the composer's `/` autocomplete, so a
  // read-only viewer (which has no composer) never subscribes.
  const runtimeSlashCommands = useQuery(
    api.cli.facts.getThreadRuntimeCommands,
    readOnly ? "skip" : { threadId }
  );

  const messages = useMemo(() => {
    const loaded = visibleMessageIds.flatMap((messageId) => {
      const envelope = envelopesById.get(messageId);
      return envelope ? [envelope] : [];
    });

    // Steered messages join a run whose assistant message was created
    // earlier, so plain createdAt order would place them below the answer.
    // Anchor grouped user messages just before their run's assistant
    // message (stable sort keeps their relative order).
    const assistantCreatedAtByRun = new Map<string, number>();
    for (const message of loaded) {
      if (message.role === "assistant" && message.runId) {
        assistantCreatedAtByRun.set(message.runId, message.createdAt);
      }
    }
    const sortKey = (message: (typeof loaded)[number]): number => {
      if (message.role === "user" && message.runId) {
        const anchor = assistantCreatedAtByRun.get(message.runId);
        if (anchor !== undefined && anchor < message.createdAt) {
          return anchor - 0.5;
        }
      }
      return message.createdAt;
    };
    return loaded.slice().sort((a, b) => sortKey(a) - sortKey(b));
  }, [envelopesById, visibleMessageIds]);

  // Denormalized on the thread, not derived from chunks: the message list is
  // paginated, so the plan's source chunks may not be loaded (OS-1442).
  const planProgress = useMemo(
    () => toPlanProgress(chat.metadata?.plan?.steps),
    [chat.metadata?.plan?.steps]
  );

  // Also denormalized on the thread (OS-1454) so the pills are right on the
  // first frame: scanning the message list meant waiting on a much heavier
  // query than the one already gating this view.
  const lastUsed = chat.metadata?.cli;

  // Stream first (live), thread snapshot as the floor: the bootstrap window is
  // bounded, so the latest snapshot chunk may not be loaded (OS-1889). A live
  // per-call event has no max of its own; the thread's is the floor (OS-1900).
  const contextWindowUsage = useMemo(() => {
    const persisted = chat.metadata?.contextWindow;
    return toContextWindowUsage(
      latestContextWindow
        ? { ...latestContextWindow, maxTokens: latestContextWindow.maxTokens ?? persisted?.maxTokens }
        : persisted
    );
  }, [latestContextWindow, chat.metadata?.contextWindow]);
  const usageLimits = useMemo(
    () =>
      mergeUsageLimits(
        (chat.metadata?.usageLimits ?? []).map(toUsageLimitUsage),
        latestUsageLimits
      ),
    [chat.metadata?.usageLimits, latestUsageLimits]
  );
  const activeMode = resolveChatDetailMode({
    cliType: chat.cliType,
    draftMode: draft?.mode,
    lastUsedMode: lastUsed?.lastUsedMode,
  });
  const activeCliModel = resolveChatDetailModel({
    cliType: chat.cliType,
    draftCliModel: draft?.cliModel,
    lastUsedCliModel: lastUsed?.lastUsedModel,
  });
  const activeCliEffort = resolveChatDetailEffort({
    cliType: chat.cliType,
    cliModel: activeCliModel,
    availableClis: activeProfileClis,
    draftCliEffort: draft?.cliEffort,
    lastUsedCliEffort: lastUsed?.lastUsedEffort,
  });

  // Same subscription the approval cards use (Convex dedupes it); the plan
  // request is split out because its decision lives in the plan panel.
  // Answering an interaction request is a write, so the query is owner-only on
  // the backend and returns nothing for a viewer — skipped rather than mounted.
  const pendingInteractions = useQuery(
    api.cli.interactionRequests.listPendingByThread,
    readOnly ? "skip" : { threadId }
  );
  const pendingPlanApprovalRequestId = pendingInteractions?.find(
    (request) => request.kind === "plan-approval"
  )?.requestId;
  const hasPendingInteraction = (pendingInteractions?.length ?? 0) > 0;
  const pendingProposedPlan =
    chat.status === "waiting_input" &&
    chat.processingState === "idle" &&
    !hasPendingInteraction &&
    chat.metadata?.proposedPlan?.ready
      ? chat.metadata.proposedPlan
      : undefined;

  // Orphaned gate (OS-1463): the run died while parked on ExitPlanMode, so the gate is
  // unsettled with no live request to answer. This keeps the plan panel's approve buttons AND
  // gates the hook's send fallback — both must agree, or a stale click could send into a live
  // run.
  //
  // `waiting_input` is what a clean wind-down leaves; a hard-killed CLI leaves `streaming`
  // until the watchdog fires, so an offline profile counts too — otherwise the buttons vanish
  // for minutes on exactly the thread that needs them.
  const orphanedParkedPlan = useMemo(() => {
    // `undefined` is still loading and `null` is a missing profile — neither
    // is evidence the CLI is gone, so only a loaded offline profile counts.
    const windDownPending =
      chat.status === "waiting_input" || activeProfile?.isOnline === false;
    if (!windDownPending || hasPendingInteraction) {
      return false;
    }
    for (let index = envelopes.length - 1; index >= 0; index -= 1) {
      const message = envelopes[index];
      if (message?.role !== "assistant") {
        continue;
      }
      const parts = renderStateByMessageId.get(message._id)?.parts;
      return parts !== undefined && hasParkedExitPlanMode(parts);
    }
    return false;
  }, [
    chat.status,
    activeProfile,
    hasPendingInteraction,
    envelopes,
    renderStateByMessageId,
  ]);

  useEffect(() => {
    if (draft?.attachments) {
      return;
    }

    setDraft({ attachments: { pending: false } });
  }, [draft?.attachments, setDraft]);

  const handleMessageSent = useCallback(() => {
    conversationRef.current?.scrollToBottom();
  }, []);

  const {
    continuingFailedMessageId,
    isRetrying,
    isStopping,
    isSubmitting,
    retryConfirmMessageId,
    handleContinueFailedSession,
    handlePlanDecision,
    handleRetry,
    handleRetryConfirm,
    handleRetryDialogOpenChange,
    handleSteer,
    handleStopProcessing,
    handleSubmit,
    handleSubmitAskUserQuestion,
    handleClearGoal,
    handleCompact,
  } = useThreadDetailMessageActions({
    threadId,
    pendingPlanApprovalRequestId,
    orphanedParkedPlan,
    pendingProposedPlan,
    hasPendingInteraction,
    cliType: chat.cliType,
    activeMode,
    activeCliModel,
    activeCliEffort,
    envelopes,
    sendMessage,
    retryMessage,
    steerMessage,
    cancelProcessing,
    prepareAttachmentsForSubmit,
    clearAfterSubmit,
    setDraft,
    onMessageSent: handleMessageSent,
  });

  const submitHandler = useMemo(
    () => (wrapSubmit ? wrapSubmit(handleSubmit) : handleSubmit),
    [handleSubmit, wrapSubmit]
  );

  // The copied reply lands in batches; sending before it finishes would leave the live cursor past them.
  const isForkCopying = (chat.forkedFrom?.copiesInFlight ?? 0) > 0;

  const askUserQuestionResponses = useMemo(
    () =>
      extractLatestAskUserQuestionResponses(
        envelopes.map((message) => ({
          role: message.role,
          createdAt: message.createdAt,
          textContent:
            message.role === "user" ? (userTextById.get(message._id) ?? "") : "",
        }))
      ),
    [envelopes, userTextById]
  );
  const userMessageResponseMap = useMemo(
    () => deriveUserMessageResponseMap(envelopes, userTextById),
    [envelopes, userTextById]
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

  const {
    visibleMessages,
    showOlderMessagesCut,
    showOlderMessagesLabel,
    showOlderMessagesPlaceholder,
    isOlderMessagesCutActionable,
    handleShowOlderMessages,
  } = useThreadDetailMessageVisibility({
    threadId,
    messages,
    renderStateByMessageId,
    loadedChunkCount,
    hasOlderChunks,
    hasOlderEnvelopes,
    isLoadingOlderChunks,
    olderHistoryPaused,
    loadOlderChunks,
  });

  const projectPathname = appRoute.project(organizationSlug, projectAlias).pathname;
  const defaultTaskLinkHref = useCallback(
    (task: ThreadWorkspaceTaskTarget) =>
      href(
        withProjectTaskAndArchive(
          projectPathname,
          {},
          task.refId,
          task.isArchived === true
        )
      ),
    [projectPathname]
  );
  const resolvedTaskLinkHref = taskLinkHref ?? defaultTaskLinkHref;

  const chatProcessingState = chat.processingState;
  const chatHasPendingUserMessages = chat.hasPendingUserMessages === true;
  // A held queue (Stop kept the messages, OS-1374) is parked, not processing:
  // the composer stays in Submit mode and no "waiting" placeholder shows.
  const isQueueHeld = chat.queueHeldAt !== undefined;
  const isThreadProcessing =
    !isQueueHeld &&
    (chat.status === "pending" ||
      chat.status === "streaming" ||
      (chatProcessingState != null && chatProcessingState !== "idle") ||
      chatHasPendingUserMessages);
  const isThreadStreaming = chatProcessingState === "streaming";
  const runtimeSupportsSteering = cliTypeSupportsSteering(chat.cliType);
  // Subscribed from claim time (not stream time) so the capability is
  // already loaded when streaming starts and the Steer button shows with
  // the queued strip instead of a beat later.
  const claimingSessionCapabilities = useQuery(
    api.cli.sessions.getSessionCapabilities,
    !readOnly && runtimeSupportsSteering && chat.claimedBySessionId
      ? { sessionId: chat.claimedBySessionId, cliType: chat.cliType }
      : "skip"
  );
  const canSteer =
    isThreadStreaming &&
    runtimeSupportsSteering &&
    (claimingSessionCapabilities?.supportsSteering ?? false);
  const localControllerRef = useRef<ThreadComposerControllerApi | null>(null);

  // Restore a removed message's text and attachments into the composer, appending after a
  // blank line when a draft already exists. The blobs survived as pending-upload rows, so the
  // returned storage ids are re-attached without re-uploading (seed the queue first so
  // `syncFileParts` skips them).
  const restoreMessageToComposer = useCallback(
    (text: string, restored: CliMessageAttachmentSummary[]) => {
      const controller = (composerControllerRef ?? localControllerRef).current;
      const existing = controller?.getInput() ?? draft?.text ?? "";
      const merged =
        existing.trim().length > 0 ? `${existing.trimEnd()}\n\n${text}` : text;
      controller?.setInput(merged);

      if (restored.length > 0) {
        const seeds = restored.map((attachment) => ({
          filePartId: crypto.randomUUID(),
          storageId: attachment.storageId,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          contentType: attachment.contentType,
          url: attachment.url,
          dimensions: attachment.dimensions,
        }));
        seedUploadedAttachments(seeds);
        controller?.addFileParts(
          seeds.map((seed) => ({
            id: seed.filePartId,
            type: "file" as const,
            // Signed URL: preview-only; the seeded queue item already holds
            // the storageId, so this part is never uploaded.
            url: seed.url ?? "",
            mediaType: seed.contentType,
            filename: seed.fileName,
          }))
        );
      }

      setDraft({ text: merged, composerContent: undefined });
    },
    [composerControllerRef, draft?.text, seedUploadedAttachments, setDraft]
  );

  // Remove a queued message and restore it into the composer.
  const handleEditQueued = useCallback(
    async (messageId: Id<"cliMessages">) => {
      const queuedText = userTextById.get(messageId) ?? "";

      let restored;
      try {
        restored = await removeQueuedMessage(messageId, { preserveAttachments: true });
      } catch (error) {
        const errorMessage =
          getErrorMessage(error, "Failed to edit queued message");
        toast.error(errorMessage);
        return;
      }

      restoreMessageToComposer(queuedText, restored);
    },
    [removeQueuedMessage, restoreMessageToComposer, userTextById]
  );

  // Branch from here (OS-1397): fork at the reply's run, then open the fork.
  const forkThread = useMutation(api.cli.threads.core.fork);
  const navigation = useNavigation();
  // Read through a ref so the handler stays stable for the memoized transcript.
  const navigationRef = useRef(navigation);
  useEffect(() => {
    navigationRef.current = navigation;
  }, [navigation]);
  const handleBranchFromHere = useCallback(
    (messageId: Id<"cliMessages">) => {
      forkThread({ messageId })
        .then(({ threadId: forkId }) => {
          navigationRef.current.push(appRoute.projectThreadDetail(organizationSlug, projectAlias, String(forkId)));
        })
        .catch((error) => {
          toast.error(getErrorMessage(error, "Failed to branch the thread"));
        });
    },
    [forkThread, organizationSlug, projectAlias]
  );
  // In a new tab (OS-2224): the fork joins this thread's group; the host adopts it and switches tabs.
  const handleBranchIntoTab = useCallback(
    (messageId: Id<"cliMessages">) => {
      forkThread({ messageId, groupWithThreadId: threadId })
        .then(({ threadId: forkId, containerId }) => {
          if (containerId) onBranchedIntoTab?.({ containerId, threadId: forkId });
        })
        .catch((error) => {
          toast.error(getErrorMessage(error, "Failed to branch the thread"));
        });
    },
    [forkThread, onBranchedIntoTab, threadId]
  );

  // "Send now" on a held queue (OS-1374): release the hold so the queued
  // messages run as-is, without composing a new message.
  const releaseQueueHold = useMutation(api.cli.threads.runControl.releaseQueueHold);
  const handleSendHeldQueue = useCallback(() => {
    releaseQueueHold({ threadId }).catch((error) => {
      const errorMessage =
        getErrorMessage(error, "Failed to send queued messages");
      toast.error(errorMessage);
    });
  }, [releaseQueueHold, threadId]);

  // The queued strip's Edit restores into the composer, so it is gated while
  // the composer already holds a draft (the restore would merge into it).
  const composerBusyReason =
    (draft?.text ?? "").trim().length > 0
      ? "Send or clear the message in the composer first"
      : undefined;

  // The newest user message with a bubble of its own is the only editable one. With a queue,
  // that message lives in the queued strip, which has its own Edit. A steer has no bubble to
  // hang Edit on, so the action falls back to the newest that does (OS-1463) — editing it
  // resends from before the steer, which is what Edit has always meant for the last bubble.
  const latestUserMessageId = useMemo(
    () => findLatestRowUserMessage(envelopes)?._id,
    [envelopes]
  );

  // Steered-message inline bubbles resolve attachments from the hidden user
  // message envelope so signed URLs stay fresh.
  const getUserMessageAttachments = useCallback(
    (messageId: string) =>
      envelopesById.get(messageId as Id<"cliMessages">)?.attachments,
    [envelopesById]
  );

  // "Mention in reply" (OS-1159): append the file's @path pill to the
  // composer draft and focus it. Fail-soft when the composer isn't mounted.
  const handleMentionFile = useCallback(
    (path: string) => {
      (composerControllerRef ?? localControllerRef).current?.insertFileMention(path);
    },
    [composerControllerRef]
  );

  // Delete a queued message without sending it (no composer restore).
  const handleDeleteQueued = useCallback(
    async (messageId: Id<"cliMessages">) => {
      try {
        await removeQueuedMessage(messageId);
      } catch (error) {
        const errorMessage =
          getErrorMessage(error, "Failed to delete queued message");
        toast.error(errorMessage);
      }
    },
    [removeQueuedMessage]
  );

  // Messages queued behind the streaming run, held by Stop (OS-2171), or waiting for an offline
  // CLI (OS-2311), shown in the composer strip (hidden from the list) so Steer/Edit/Delete stay stationary.
  const isCliOffline = activeProfile?.isOnline === false;
  const queuedStripMessages = useMemo<QueuedStripMessage[]>(() => {
    if (!isThreadStreaming && !isQueueHeld && !isCliOffline) {
      return [];
    }
    return envelopes
      .filter(
        (message) => message.role === "user" && message.processedAt === undefined
      )
      .map((message) => ({
        _id: message._id,
        text: userTextById.get(message._id) ?? "",
        steerRequested: message.steerRequestedAt !== undefined,
        runtimeCommand: message.runtimeCommand,
        queueFirst: message.queueFirst,
        attachmentFileNames: message.attachments?.map(
          (attachment) => attachment.fileName
        ),
      }));
  }, [envelopes, isCliOffline, isQueueHeld, isThreadStreaming, userTextById]);

  const chatProfileId = chat.profileId;
  const chatProfileName = chat.profileName;
  const chatPathId = chat.pathId;
  const chatPathLabel = chat.pathLabel;
  const chatPathString = chat.pathString;
  const chatWorkspaceKind = chat.worktree || activeProfile?.paths.some((path) => path.id === chatPathId && path.kind === "worktree")
    ? "worktree" : "local";
  const lockedProfiles = useMemo<WorkingDirectorySelectorProfile[]>(() => {
    if (
      !chatProfileId ||
      !chatProfileName ||
      !chatPathId ||
      !chatPathString ||
      !chatPathLabel
    ) {
      return [];
    }

    const fallbackPath = {
      id: chatPathId,
      path: chatPathString,
      label: chatPathLabel,
    };

    return [
      {
        _id: chatProfileId,
        name: activeProfile?.name ?? chatProfileName,
        profileKey: activeProfile?.profileKey,
        hostname: activeProfile?.hostname,
        isOnline: activeProfile?.isOnline ?? false,
        availableClis: activeProfileClis,
        paths: activeProfile
          ? activeProfile.paths.some((path) => path.id === chatPathId)
            ? activeProfile.paths
            : [...activeProfile.paths, fallbackPath]
          : [fallbackPath],
      },
    ];
  }, [
    activeProfile,
    activeProfileClis,
    chatPathId,
    chatPathLabel,
    chatPathString,
    chatProfileId,
    chatProfileName,
  ]);

  const chatProjectId = chat.projectId;
  const chatCliType = chat.cliType;
  // Set only once the draft was seeded from outside the composer (OS-1716), so
  // a normal thread never runs the composer's seed sync.
  const composerSeedKey = draft?.seedCount
    ? `seed:${draft.seedCount}`
    : undefined;
  const conversationComposerProps =
    useMemo<ComponentProps<typeof ThreadComposer> | null>(() => {
      // A viewer gets no composer at all — and with it none of the selectors,
      // the cost indicator or the context-window meter it hosts.
      if (readOnly) {
        return null;
      }

      if (!chatProjectId || !chatProfileId || !chatPathId || !chatCliType) {
        return null;
      }

      return {
        projectId: chatProjectId,
        organizationId,
        runtimeSlashCommands,
        onSubmit: submitHandler,
        extraAttachmentPills,
        onStop: handleStopProcessing,
        showStopWhenIdleInput: isThreadProcessing,
        isSubmitting,
        stopDisabled: isStopping,
        draftScopeKey: threadKey,
        initialInput: draft?.text ?? "",
        initialAttachments: draftFileParts,
        seedKey: composerSeedKey,
        initialComposerContent: draft?.composerContent,
        initialAttachedTask,
        onOpenAttachedTask: onOpenTask,
        getTaskHref: resolvedTaskLinkHref,
        onAttachedTaskChange: (task: ThreadComposerAttachedTask | null) =>
          onAttachedTaskChange?.(task?.refId ?? null),
        onTaskDrop: (task: { refId: string }) =>
          onAttachedTaskChange?.(task.refId),
        onInputChange: (value: string) => setDraft({ text: value }),
        onComposerContentChange: (composerContent) =>
          setDraft({ composerContent }),
        onAttachmentsChange: handleAttachmentsChange,
        pendingAttachments,
        controllerRef: composerControllerRef ?? localControllerRef,
        contextWindowUsage,
        showContextWindowMeter: true,
        costThreadId: chat._id,
        costTaskId: chat.associatedTask?._id ?? null,
        usageLimits,
        goal: chat.metadata?.goal,
        onClearGoal: () => void handleClearGoal(),
        onCompact: () => void handleCompact(),
        stopConfirmation: chat.metadata?.stopConfirmation,
        backgroundTasks: (chat.cliType === "claude-code" || chat.cliType === "codex") && chat.processingState === "streaming" &&
          chat.metadata?.backgroundTasks?.messageId === chat.activeAssistantMessageId
          ? chat.metadata?.backgroundTasks : undefined,
        readOnlyAgent: chat.agent,
        readOnlyWorkspace: { kind: chatWorkspaceKind, branch: chat.branch },
        pullRequest: chat.pullRequest,
        planProgress,
        // Undefined keeps the composer's default placeholder.
        textareaPlaceholder: isForkCopying ? "Copying the original response…" : undefined,
        textareaDisabled: isSubmitting || isForkCopying,
        submitDisabled: isSubmitting || isForkCopying,
        containerClassName: composerContainerClassName,
        contentClassName: composerContentClassName,
        selectorsProps: {
          profiles: lockedProfiles,
          profileId: chatProfileId,
          pathId: chatPathId,
          cliType: chatCliType,
          mode: activeMode,
          cliModel: activeCliModel,
          cliEffort: activeCliEffort,
          disabled: isSubmitting,
          onModeChange: (mode) => setDraft({ mode }),
          onCliModelChange: (cliModel) => setDraft({ cliModel }),
          onCliEffortChange: (cliEffort) => setDraft({ cliEffort }),
          lockAgentContext: true,
        },
      };
    }, [
      activeCliEffort,
      activeCliModel,
      activeMode,
      chatCliType,
      chatPathId,
      chatProfileId,
      chatProjectId,
      composerContainerClassName,
      composerContentClassName,
      composerControllerRef,
      draft?.text,
      draft?.composerContent,
      draftFileParts,
      composerSeedKey,
      extraAttachmentPills,
      handleAttachmentsChange,
      handleStopProcessing,
      initialAttachedTask,
      isStopping,
      isSubmitting,
      isForkCopying,
      isThreadProcessing,
      contextWindowUsage,
      usageLimits,
      chat.cliType,
      chat.processingState,
      chat.activeAssistantMessageId,
      chat.metadata?.backgroundTasks,
      chat.metadata?.stopConfirmation,
      chat.metadata?.goal,
      handleClearGoal,
      handleCompact,
      chat.agent,
      chatWorkspaceKind,
      chat.branch,
      chat.pullRequest,
      chat._id,
      chat.associatedTask?._id,
      lockedProfiles,
      onAttachedTaskChange,
      onOpenTask,
      pendingAttachments,
      planProgress,
      organizationId,
      readOnly,
      resolvedTaskLinkHref,
      runtimeSlashCommands,
      setDraft,
      submitHandler,
      threadKey,
    ]);

  const latestThreadMessageId = findLatestRowMessage(envelopes)?._id;

  // A live gate, orphaned gate, or completed native proposal enables approval.
  // Composer mode alone never does. Viewers cannot submit a decision.
  const showPlanDecisions =
    !readOnly &&
    (pendingPlanApprovalRequestId !== undefined || orphanedParkedPlan || pendingProposedPlan !== undefined);

  const canBranch = !readOnly && !isForkCopying;
  const canBranchIntoTab = canBranch && onBranchedIntoTab !== undefined;

  // Stable elements, or the memoized list re-renders on every fork render (OS-1397).
  const forkHistory = useMemo(
    () =>
      chat.forkedFrom ? (
        <ThreadForkHistory
          forkedFrom={chat.forkedFrom}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          taskLinkHref={resolvedTaskLinkHref}
          onBranchFromHere={canBranch ? handleBranchFromHere : undefined}
          onBranchIntoTab={canBranchIntoTab ? handleBranchIntoTab : undefined}
          onOpenDiffFile={onOpenDiffFile}
          onOpenTaskInSidebar={onOpenTask}
          onOpenArtifact={onOpenArtifact}
          onOpenTaskRef={onOpenTaskRef}
        />
      ) : undefined,
    [canBranch, canBranchIntoTab, chat.forkedFrom, handleBranchFromHere, handleBranchIntoTab, onOpenArtifact, onOpenDiffFile, onOpenTask, onOpenTaskRef, organizationSlug, projectAlias, resolvedTaskLinkHref]
  );
  const forkDividerAnchorId = chat.forkedFrom ? forkDividerAnchor(visibleMessages, chat.forkedFrom.runId) : null;
  const forkDivider = useMemo(
    () =>
      chat.forkedFrom
        ? {
            afterMessageId: forkDividerAnchorId,
            node: <ThreadForkDivider forkedFrom={chat.forkedFrom} organizationSlug={organizationSlug} projectAlias={projectAlias} />,
          }
        : undefined,
    [chat.forkedFrom, forkDividerAnchorId, organizationSlug, projectAlias]
  );

  // Every transcript handler that writes, in one place. Spreading one bundle — rather than
  // repeating `readOnly ? undefined : handler` per prop — means a new write action must be
  // added *here* to reach the transcript at all, so it inherits the read-only gate instead of
  // quietly escaping it. Reads and host-gated run-card props stay outside.
  const transcriptWriteHandlers = readOnly
    ? {}
    : {
        onSubmitEditLast: editLastMessage,
        onMentionFile: handleMentionFile,
        onSubmitAskUserQuestion: handleSubmitAskUserQuestion,
        onPlanDecision: handlePlanDecision,
        onContinueFailedSession: handleContinueFailedSession,
        onRetry: handleRetry,
        onBranchFromHere: canBranch ? handleBranchFromHere : undefined,
        onBranchIntoTab: canBranchIntoTab ? handleBranchIntoTab : undefined,
        // A copying fork's transcript is still arriving, as for Branch.
        onHandoffToNewThread: isForkCopying ? undefined : onHandoffToNewThread,
        onHandoffToNewTab: isForkCopying ? undefined : onHandoffToNewTab,
      };

  const hasPendingAssistantPlaceholder =
    !envelopes.some(
      (message) =>
        message.role === "assistant" &&
        (message.status === "streaming" || message.status === "pending")
    ) &&
    chatHasPendingUserMessages &&
    // A held queue is parked — nothing is coming until the next send.
    !isQueueHeld;
  const pendingAssistantLabel = CLI_TYPE_MAP[chat.cliType] ?? "CLI";

  return (
    <>
      <ThreadMessageList
        threadId={chat._id}
        taskId={chat.associatedTask?._id}
        projectId={chat.projectId}
        editComposerProps={conversationComposerProps ?? undefined}
        showOlderMessagesCut={showOlderMessagesCut}
        showOlderMessagesPlaceholder={showOlderMessagesPlaceholder}
        showOlderMessagesLabel={showOlderMessagesLabel}
        isOlderMessagesCutActionable={isOlderMessagesCutActionable}
        isLoadingMessages={isLoadingMessages}
        visibleMessages={visibleMessages}
        hasPendingAssistantPlaceholder={hasPendingAssistantPlaceholder}
        pendingAssistantLabel={pendingAssistantLabel}
        isCliOffline={isCliOffline}
        latestThreadMessageId={latestThreadMessageId}
        userTextById={userTextById}
        userMessageResponseMap={userMessageResponseMap}
        renderStateByMessageId={renderStateByMessageId}
        askUserQuestionResponses={askUserQuestionResponses}
        isThreadProcessing={isThreadProcessing}
        isThreadStreaming={isThreadStreaming}
        isQueueHeld={isQueueHeld}
        latestUserMessageId={latestUserMessageId}
        continuingFailedMessageId={continuingFailedMessageId}
        isSubmitting={isSubmitting}
        isRetrying={isRetrying}
        profileName={chatProfileName}
        pathString={chatPathString}
        gitRemoteUrl={chat.gitRemoteUrl}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        onOpenDiffFile={onOpenDiffFile}
        onRevertRun={onRevertRun}
        onRevertFile={onRevertFile}
        getUserMessageAttachments={getUserMessageAttachments}
        onShowOlderMessages={handleShowOlderMessages}
        showPlanDecisions={showPlanDecisions}
        pendingProposedPlan={pendingProposedPlan}
        transcriptHeader={forkHistory}
        transcriptDivider={forkDivider}
        {...transcriptWriteHandlers}
        taskLinkHref={resolvedTaskLinkHref}
        onOpenTaskInSidebar={onOpenTask}
        // A read, not a write: a viewer may open an artifact, so this stays
        // outside `transcriptWriteHandlers`.
        onOpenArtifact={onOpenArtifact}
        onOpenTaskRef={onOpenTaskRef}
        conversationRef={conversationRef}
      />
      {/* Both strips are pure write surfaces (steer/edit/delete a queued
          message; answer an interaction request), so a viewer gets neither —
          and `InteractionRequestCards` carries its own subscription. */}
      {readOnly ? null : (
        <>
          <QueuedMessagesStrip
            messages={queuedStripMessages}
            canSteer={canSteer}
            onSteer={handleSteer}
            onEdit={handleEditQueued}
            onDelete={handleDeleteQueued}
            editDisabledReason={composerBusyReason}
            onSendNow={isQueueHeld ? handleSendHeldQueue : undefined}
            className="mx-auto w-full max-w-3xl min-w-0 px-4 pb-2"
          />
          {/* `min-w-0`: these rows sit outside the conversation scroller, so
              without it their min-content width clips the trailing edge inside
              a fixed-width mini-preview host (OS-1602). */}
          <InteractionRequestCards
            threadId={threadId}
            className="mx-auto w-full max-w-3xl min-w-0 px-4 pb-2"
          />
          {chat.workflowRunId !== undefined ? (
            <WorkflowWaitCard
              runId={chat.workflowRunId}
              threadId={threadId}
              threadStatus={chat.status}
              className="mx-auto w-full max-w-3xl min-w-0 px-4 pb-2"
            />
          ) : null}
        </>
      )}
      {conversationComposerProps ? (
        <>
          <ThreadCliOfflineBanner
            isOnline={activeProfile?.isOnline}
            className="mx-auto w-full max-w-3xl min-w-0 px-4 pb-2"
          />
          <ThreadViewComposer {...conversationComposerProps} />
        </>
      ) : null}
      <ThreadDestructiveConfirmDialog
        open={retryConfirmMessageId !== null}
        title="Retry this run?"
        description="We'll run your last message again."
        confirmLabel="Retry"
        isBusy={isRetrying}
        onOpenChange={handleRetryDialogOpenChange}
        onConfirm={() => void handleRetryConfirm()}
      />
    </>
  );
}
