"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { toCliProposedPlanSource, type CliProposedPlanSource } from "@/convex/lib/contracts/validators";
import type { Id } from "@/convex/_generated/dataModel";
import {
  formatAskUserQuestionResponse,
  type AskUserQuestionResponsePayload,
} from "@/lib/ai-tools/ask-user-question";
import type { ThreadDraftPatch } from "@/lib/threads/draft-storage";
import { isThreadAttachmentSubmitError } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import { findLatestRowMessage } from "@/lib/threads/message-rows";
import type {
  SendCliMessageArgs,
  UseCliMessagesResult,
} from "@/lib/threads/hooks/use-cli-messages";
import {
  PLAN_APPROVAL_FALLBACK_MESSAGE,
  toPlanApprovalResponseJson,
  type PlanDecision,
} from "@/lib/threads/plan-decision";
import type { CliModel, CliTypeSlug } from "@/lib/threads/types";
import { rememberNewThreadCliModel } from "@/lib/threads/remembered-new-thread-cli-models";
import type { ThreadComposerSubmitMessage } from "@/components/blocks/thread/thread-composer";
import { getErrorMessage } from "@/lib/errors";

interface UseThreadDetailMessageActionsArgs {
  threadId: Id<"cliThreads">;
  /** Live plan-approval request to answer, when the run is parked on one. */
  pendingPlanApprovalRequestId?: string;
  /**
   * True when the thread is waiting on an ExitPlanMode gate whose run died
   * (OS-1463) — the only state where approving may fall back to sending.
   */
  orphanedParkedPlan?: boolean;
  pendingProposedPlan?: CliProposedPlanSource;
  /** True while the run is parked on any interactive prompt. */
  hasPendingInteraction?: boolean;
  cliType?: CliTypeSlug;
  activeMode?: string;
  activeCliModel?: CliModel;
  activeCliEffort?: string;
  envelopes: UseCliMessagesResult["envelopes"];
  sendMessage: UseCliMessagesResult["sendMessage"];
  retryMessage: UseCliMessagesResult["retryMessage"];
  steerMessage: UseCliMessagesResult["steerMessage"];
  cancelProcessing: UseCliMessagesResult["cancelProcessing"];
  prepareAttachmentsForSubmit: () => Promise<
    NonNullable<SendCliMessageArgs["attachments"]>
  >;
  clearAfterSubmit: () => void;
  setDraft: (patch: ThreadDraftPatch) => void;
  onMessageSent: () => void;
  /** Called after a confirm-free retry, whose callout unmounts with focus inside it (OS-2584). */
  focusComposer?: () => void;
}

type SubmitThreadDetailMessageArgs = ThreadComposerSubmitMessage;

export function useThreadDetailMessageActions({
  threadId,
  pendingPlanApprovalRequestId,
  orphanedParkedPlan = false,
  pendingProposedPlan,
  hasPendingInteraction = false,
  cliType,
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
  onMessageSent,
  focusComposer,
}: UseThreadDetailMessageActionsArgs) {
  const respondToInteraction = useMutation(api.cli.interactionRequests.respond);
  const [isStopping, setIsStopping] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryConfirmMessageId, setRetryConfirmMessageId] =
    useState<Id<"cliMessages"> | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [continuingFailedMessageId, setContinuingFailedMessageId] =
    useState<Id<"cliMessages"> | null>(null);
  const isSubmittingRef = useRef(false);
  // Shared by both retry paths; a callback held across an await would read stale state.
  const isRetryingRef = useRef(false);

  useEffect(() => {
    if (!continuingFailedMessageId) {
      return;
    }

    const latestMessageId = findLatestRowMessage(envelopes)?._id;
    const continuingMessageStillExists = envelopes.some(
      (message) => message._id === continuingFailedMessageId
    );

    if (!continuingMessageStillExists || latestMessageId !== continuingFailedMessageId) {
      setContinuingFailedMessageId(null);
    }
  }, [continuingFailedMessageId, envelopes]);

  const handleSubmit = useCallback(
    async (message: SubmitThreadDetailMessageArgs) => {
      if (isSubmittingRef.current) {
        return;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);

      try {
        const text = message.text.trim();
        const uploadedAttachments = await prepareAttachmentsForSubmit();
        if (!text && uploadedAttachments.length === 0 && !message.taskId && !message.pullRequestUrl) {
          return;
        }

        // A run parked on an interactive prompt is waiting on the user, not
        // working: answering it with a message ends that run so the message
        // starts a new one instead of queueing behind a prompt nobody will
        // answer (OS-1458).
        if (hasPendingInteraction) {
          await cancelProcessing(threadId, { superseded: true });
        }

        await sendMessage(threadId, {
          content: text,
          composerDocument: message.composerDocument,
          cliMode: activeMode,
          cliModel: activeCliModel,
          cliEffort: activeCliEffort,
          attachments:
            uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
          taskId: message.taskId,
          pullRequestUrl: message.pullRequestUrl,
          runtimeCommand:
            message.runtimeCommand && uploadedAttachments.length === 0
              ? true
              : undefined,
        });
        onMessageSent();
        // Follow-up sends count as "last used" too (OS-1200): the combos and
        // preselection should reflect what actually ran, not only what new
        // threads were created with.
        if (cliType) {
          rememberNewThreadCliModel(cliType, activeCliModel, activeCliEffort);
        }
        clearAfterSubmit();
        setDraft({
          text: "",
          composerContent: undefined,
          attachments: { pending: false },
        });
      } catch (error) {
        if (isThreadAttachmentSubmitError(error)) {
          toast.error(getErrorMessage(error, "Failed to send message"));
        } else {
          const errorMessage =
            getErrorMessage(error, "Failed to send message");
          toast.error(errorMessage);
        }
        throw error;
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      activeCliEffort,
      activeCliModel,
      activeMode,
      cancelProcessing,
      clearAfterSubmit,
      cliType,
      hasPendingInteraction,
      prepareAttachmentsForSubmit,
      onMessageSent,
      sendMessage,
      setDraft,
      threadId,
    ]
  );

  const handleRetry = useCallback((messageId: Id<"cliMessages">) => {
    setRetryConfirmMessageId(messageId);
  }, []);

  const handleRetryConfirm = useCallback(async () => {
    if (!retryConfirmMessageId || isRetryingRef.current) {
      return;
    }

    isRetryingRef.current = true;
    setIsRetrying(true);
    try {
      await retryMessage(retryConfirmMessageId);
      setRetryConfirmMessageId(null);
    } catch (error) {
      const errorMessage =
        getErrorMessage(error, "Failed to retry message");
      toast.error(errorMessage);
    } finally {
      isRetryingRef.current = false;
      setIsRetrying(false);
    }
  }, [retryConfirmMessageId, retryMessage]);

  // "Approve and retry": the approve click was the confirm. Throws, so the caller words the toast.
  const handleRetryNow = useCallback(
    async (messageId: Id<"cliMessages">) => {
      if (isRetryingRef.current) return;
      isRetryingRef.current = true;
      setIsRetrying(true);
      try {
        await retryMessage(messageId);
        focusComposer?.();
      } finally {
        isRetryingRef.current = false;
        setIsRetrying(false);
      }
    },
    [focusComposer, retryMessage]
  );

  const handleRetryDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isRetrying) {
        setRetryConfirmMessageId(null);
      }
    },
    [isRetrying]
  );

  const handleContinueFailedSession = useCallback(
    async (messageId: Id<"cliMessages">) => {
      setContinuingFailedMessageId(messageId);
      try {
        await sendMessage(threadId, {
          content: "continue",
          cliMode: activeMode,
          cliModel: activeCliModel,
          cliEffort: activeCliEffort,
        });
        onMessageSent();
      } catch (error) {
        setContinuingFailedMessageId(null);
        const errorMessage =
          getErrorMessage(error, "Failed to continue session");
        toast.error(errorMessage);
      }
    },
    [
      activeCliEffort,
      activeCliModel,
      activeMode,
      onMessageSent,
      sendMessage,
      threadId,
    ]
  );

  const handleSteer = useCallback(
    async (messageId: Id<"cliMessages">) => {
      try {
        await steerMessage(messageId);
      } catch (error) {
        const errorMessage =
          getErrorMessage(error, "Failed to steer message");
        toast.error(errorMessage);
      }
    },
    [steerMessage]
  );

  const handleStopProcessing = useCallback(async () => {
    if (isStopping) {
      return;
    }

    setIsStopping(true);
    try {
      await cancelProcessing(threadId);
    } catch (error) {
      const errorMessage =
        getErrorMessage(error, "Failed to stop response");
      toast.error(errorMessage);
    } finally {
      setIsStopping(false);
    }
  }, [cancelProcessing, isStopping, threadId]);

  const handleSubmitAskUserQuestion = useCallback(
    async (payload: AskUserQuestionResponsePayload) => {
      await sendMessage(threadId, {
        content: formatAskUserQuestionResponse(payload),
        cliMode: activeMode,
        cliModel: activeCliModel,
        cliEffort: activeCliEffort,
      });
      onMessageSent();
    },
    [
      activeCliEffort,
      activeCliModel,
      activeMode,
      onMessageSent,
      sendMessage,
      threadId,
    ]
  );

  /** Sends `/goal clear` on its own, leaving the composer draft alone (OS-2276). */
  const handleClearGoal = useCallback(async () => {
    try {
      await sendMessage(threadId, {
        content: "/goal clear",
        runtimeCommand: true,
        cliMode: activeMode,
        cliModel: activeCliModel,
        cliEffort: activeCliEffort,
      });
      onMessageSent();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to clear the goal"));
    }
  }, [activeCliEffort, activeCliModel, activeMode, onMessageSent, sendMessage, threadId]);

  /** Sends `/compact` ahead of the queue, leaving the composer draft alone (OS-2339). */
  const handleCompact = useCallback(async () => {
    try {
      await sendMessage(threadId, {
        content: "/compact",
        runtimeCommand: true,
        queueFirst: true,
        cliMode: activeMode,
        cliModel: activeCliModel,
        cliEffort: activeCliEffort,
      });
      onMessageSent();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to compact the context"));
    }
  }, [activeCliEffort, activeCliModel, activeMode, onMessageSent, sendMessage, threadId]);

  /** Live gates answer the bridge; native proposals and orphaned gates start a new turn. */
  const handlePlanDecision = useCallback(
    async (decision: PlanDecision) => {
      if (decision.proposedPlan) {
        if (!pendingProposedPlan ||
            pendingProposedPlan.messageId !== decision.proposedPlan.messageId ||
            pendingProposedPlan.itemId !== decision.proposedPlan.itemId ||
            pendingProposedPlan.turnId !== decision.proposedPlan.turnId) {
          toast.error("This plan is no longer awaiting approval");
          return;
        }
        await sendMessage(threadId, {
          content: PLAN_APPROVAL_FALLBACK_MESSAGE,
          sourceProposedPlan: toCliProposedPlanSource(pendingProposedPlan),
          cliMode: decision.nextMode,
          cliModel: activeCliModel,
          cliEffort: activeCliEffort,
        });
        onMessageSent();
      } else if (pendingPlanApprovalRequestId) {
        await respondToInteraction({
          threadId,
          requestId: pendingPlanApprovalRequestId,
          responseJson: toPlanApprovalResponseJson(decision),
        });
      } else if (orphanedParkedPlan) {
        await sendMessage(threadId, {
          content: PLAN_APPROVAL_FALLBACK_MESSAGE,
          cliMode: decision.nextMode,
          cliModel: activeCliModel,
          cliEffort: activeCliEffort,
        });
        onMessageSent();
      } else {
        // Neither a live request nor an orphaned gate: a stale click (the
        // request settled from another tab, or the run resumed, between the
        // state update and the click landing). No-op preserves OS-1467 — a
        // spurious send here would inject a message into a live run.
        return;
      }

      setDraft({ mode: decision.nextMode });
    },
    [
      pendingPlanApprovalRequestId,
      orphanedParkedPlan,
      pendingProposedPlan,
      respondToInteraction,
      sendMessage,
      activeCliModel,
      activeCliEffort,
      onMessageSent,
      setDraft,
      threadId,
    ]
  );

  return {
    continuingFailedMessageId,
    isRetrying,
    isStopping,
    isSubmitting,
    retryConfirmMessageId,
    handleContinueFailedSession,
    handlePlanDecision,
    handleRetry,
    handleRetryNow,
    handleRetryConfirm,
    handleRetryDialogOpenChange,
    handleSteer,
    handleStopProcessing,
    handleSubmit,
    handleSubmitAskUserQuestion,
    handleClearGoal,
    handleCompact,
  };
}
