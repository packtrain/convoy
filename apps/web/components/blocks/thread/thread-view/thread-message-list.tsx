"use client";

import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { EditLastMessage } from "../edit-last-message";
import type { ThreadComposer } from "../thread-composer";
import type { EditCliMessageOptions } from "@/lib/threads/hooks/use-cli-messages";
import { ArrowRight, Pencil, RotateCcw, Terminal } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  type ConversationHandle,
} from "@/components/ai-elements/conversation";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message";
import { useThreadChecks } from "@/components/blocks/checks";
import { AssistantCliMessage } from "@/components/blocks/thread/assistant-cli-thread-message";
import { UserAskUserQuestionResponse } from "@/components/blocks/thread/message-parts/components/user-ask-user-question-response";
import { UserMessageFooter } from "@/components/blocks/thread/message-parts/components/user-message-footer";
import { MessageSentByBadge } from "@/components/blocks/thread/message-sent-by-badge";
import { UserMessageText } from "@/components/blocks/thread/message-parts/components/user-message-text";
import { ResponseAttachments } from "@/components/blocks/thread/response-attachments";
import { ThreadTaskPillLink } from "@/components/blocks/thread/thread-task-link";
import { AttachedPullRequestPill } from "@/components/blocks/integrations";
import { WorktreeSetupBlockedCallout } from "@/components/blocks/worktree-setups";
import { BASH_ICON_CLASS, BASH_TITLE_CLASS } from "@/components/blocks/workflows/workflow-wait-card";
import {
  DANGER_CALLOUT_ACTION_CLASS,
  DangerCallout,
} from "@/components/custom/danger-callout";
import { Spinner } from "@/components/custom/spinner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  CliRunDiffFile,
  CliRunDiffSummaryPreview,
} from "@/convex/lib/contracts/validators";
import type {
  AskUserQuestionResponseMap,
  AskUserQuestionResponsePayload,
} from "@/lib/ai-tools/ask-user-question";
import type { UseCliMessagesResult } from "@/lib/threads/hooks/use-cli-messages";
import { unapprovedWorktreeSetupRepoKey } from "@/lib/cli-stream-ui/runtime-notices";
import { isInlineSteeredMessage } from "@/lib/threads/message-rows";
import type { PlanDecision } from "@/lib/threads/plan-decision";
import { CLI_TYPE_MAP } from "@/lib/threads/types";

type ThreadDetailMessage = UseCliMessagesResult["envelopes"][number];
export type ThreadDetailTaskLink = NonNullable<ThreadDetailMessage["task"]>;

const EMPTY_RESPONSE_MAP = new Map<string, AskUserQuestionResponsePayload>();
const EMPTY_RESPONSES: AskUserQuestionResponseMap = {};
const CLI_OFFLINE_PENDING_LABEL = "Queued until the CLI reconnects";

const THREAD_MESSAGE_ROW_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "240px",
} satisfies CSSProperties;

/**
 * Cmd/Ctrl+P (OS-1748): the transcript lives inside the shell's fixed-height
 * scrollers, so printing it in place yields one page of the viewport. Copy it
 * into a plain body-level block for the duration of the print — normal flow
 * paginates — and let `app/globals.css` hide the app behind it.
 * Spec: docs/specs/cli-thread-print.md
 */
function usePrintTranscript(hostRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const cloneRef: { current: HTMLElement | null } = { current: null };

    const removeClone = () => {
      cloneRef.current?.remove();
      cloneRef.current = null;
      // Split panes print one copy each, so the flag drops with the last one.
      if (!document.querySelector("[data-thread-print-clone]")) {
        delete document.documentElement.dataset.printingThread;
      }
    };

    const handleBeforePrint = () => {
      const source = hostRef.current?.querySelector("[data-thread-print-root]");
      if (!source) {
        return;
      }
      removeClone();
      const clone = document.createElement("div");
      clone.dataset.threadPrintClone = "";
      clone.append(source.cloneNode(true));
      document.body.append(clone);
      cloneRef.current = clone;
      document.documentElement.dataset.printingThread = "";
    };

    window.addEventListener("beforeprint", handleBeforePrint);
    // Also fires when the print dialog is cancelled.
    window.addEventListener("afterprint", removeClone);
    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", removeClone);
      removeClone();
    };
  }, [hostRef]);
}

/**
 * Failure copy reads as headline + detail: the first line titles the card, the
 * rest is the body. Spec: docs/specs/cli-thread-failed-message-actions.md
 */
function splitFailureMessage(errorMessage: string | undefined) {
  const [firstLine, ...rest] = (errorMessage ?? "").trim().split("\n");
  return {
    title: firstLine?.trim() || "Message failed",
    detail: rest.join("\n").trim(),
  };
}

function OlderMessagesSkeletonRow() {
  return (
    <div
      className="flex w-full flex-col gap-4 py-3"
      data-testid="older-messages-skeleton"
      data-older-messages-loading
    >
      <div className="flex w-full items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <Skeleton className="h-4 w-36" />
        <span className="h-px flex-1 bg-border" />
      </div>
      <div
        className="flex w-full max-w-[95%] flex-col gap-2"
        data-testid="older-messages-skeleton-row"
      >
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

/**
 * Holds the view still while a "Show more" click prepends older rows, here or
 * in the fork prefix (OS-2170). Spec: cli-thread-message-pagination.md.
 */
function KeepViewOnShowMore() {
  const { scrollRef, contentRef } = useStickToBottomContext();
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) {
      return;
    }
    // Distance from the bottom while a click's rows load; null otherwise.
    let fromBottom: number | null = null;
    const remember = () => {
      fromBottom = scroller.scrollHeight - scroller.scrollTop;
    };
    const handleClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-older-messages-cut]")) {
        remember();
      }
    };
    const handleScroll = () => {
      if (fromBottom !== null) {
        remember();
      }
    };
    const observer = new ResizeObserver(() => {
      if (fromBottom === null) {
        return;
      }
      scroller.scrollTop = scroller.scrollHeight - fromBottom;
      if (!content.querySelector("[data-older-messages-loading]")) {
        fromBottom = null;
      }
    });
    content.addEventListener("click", handleClick);
    scroller.addEventListener("scroll", handleScroll);
    observer.observe(content);
    return () => {
      content.removeEventListener("click", handleClick);
      scroller.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [scrollRef, contentRef]);
  return null;
}

/** Stand-in stream while a thread's first message page loads (OS-1434). */
function LoadingMessagesPlaceholder() {
  return (
    // Same 200ms hold as the thread skeleton: a fast load shows nothing.
    <div
      className="flex w-full flex-col gap-6 animate-in fade-in delay-200 fill-mode-backwards"
      data-testid="messages-loading-skeleton"
    >
      <div className="ml-auto flex w-full max-w-[95%] flex-col gap-2">
        <Skeleton className="ml-auto h-10 w-48 rounded-lg" />
        <Skeleton className="ml-auto h-3 w-24" />
      </div>
      <div className="flex w-full max-w-[95%] flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

interface ThreadMessageListProps {
  /** The thread and its task; replies show the Check results they reported (OS-2291, OS-2293). */
  threadId?: Id<"cliThreads">;
  taskId?: Id<"tasks">;
  /** Resolves attached PRs' live title and state. */
  projectId?: Id<"projects">;
  showOlderMessagesCut: boolean;
  showOlderMessagesPlaceholder?: boolean;
  showOlderMessagesLabel?: string;
  /** False renders the cut as a static marker instead of a button (OS-1600). */
  isOlderMessagesCutActionable?: boolean;
  /** First load of the thread's messages — placeholders fill the stream. */
  isLoadingMessages?: boolean;
  visibleMessages: ThreadDetailMessage[];
  /** Host-only: the live transcript's "waiting for CLI" row; the fork prefix omits it. */
  hasPendingAssistantPlaceholder?: boolean;
  pendingAssistantLabel?: string;
  /** The thread's CLI profile is offline: pending replies read as queued. */
  isCliOffline?: boolean;
  latestThreadMessageId?: Id<"cliMessages">;
  userTextById: Map<string, string>;
  userMessageResponseMap?: Map<string, AskUserQuestionResponsePayload>;
  renderStateByMessageId: UseCliMessagesResult["renderStateByMessageId"];
  askUserQuestionResponses?: AskUserQuestionResponseMap;
  isThreadProcessing: boolean;
  /** A Thread run is streaming, so queued messages move to the composer strip. */
  isThreadStreaming?: boolean;
  /** The queue is held after a Stop; held messages live in the queued strip (OS-2171). */
  isQueueHeld: boolean;
  /** The newest user message — the only one offering the Edit action (OS-1374). */
  latestUserMessageId?: Id<"cliMessages">;
  /** Resend the last message while idle. Rejection keeps its editor open. */
  editComposerProps?: ComponentProps<typeof ThreadComposer>;
  onSubmitEditLast?: (
    messageId: Id<"cliMessages">,
    content: string,
    options?: EditCliMessageOptions
  ) => Promise<void>;
  continuingFailedMessageId?: Id<"cliMessages"> | null;
  isSubmitting: boolean;
  isRetrying?: boolean;
  profileName?: string;
  pathString?: string;
  gitRemoteUrl?: string;
  /** Addresses the sender of an agent-sent message, which is always same-project. */
  organizationSlug?: string;
  projectAlias?: string;
  /** Opens the Changes-card file viewer in the thread sidebar (OS-1143). */
  onOpenDiffFile?: (
    file: CliRunDiffFile,
    diffSummary: CliRunDiffSummaryPreview
  ) => void;
  /** Asks to revert a run to its pre-run checkpoint (OS-1151). */
  onRevertRun?: (diffSummary: CliRunDiffSummaryPreview) => void;
  /** Inserts an `@path` mention into the composer (OS-1159). */
  onMentionFile?: (path: string) => void;
  /** Asks to revert one file to its pre-run state (OS-1156). */
  onRevertFile?: (file: CliRunDiffFile, diffSummary: CliRunDiffSummaryPreview) => void;
  /** Resolves a user message's attachments (steered-message inline bubbles). */
  getUserMessageAttachments?: (
    messageId: string
  ) => ThreadDetailMessage["attachments"] | undefined;
  /** Pagination, not a write — required even for a read-only viewer. */
  onShowOlderMessages: () => void;
  /**
   * The four handlers below are omitted for a read-only viewer of a shared
   * thread (OS-1575). Each render site hides its own control when its handler
   * is absent; the failed-run *error text* stays either way.
   */
  onSubmitAskUserQuestion?: (
    payload: AskUserQuestionResponsePayload
  ) => Promise<void> | void;
  onPlanDecision?: (decision: PlanDecision) => Promise<void> | void;
  /** True while the thread has a plan awaiting the user's decision. */
  showPlanDecisions?: boolean;
  pendingProposedPlan?: PlanDecision["proposedPlan"];
  onContinueFailedSession?: (
    messageId: Id<"cliMessages">
  ) => Promise<void> | void;
  onRetry?: (messageId: Id<"cliMessages">) => void;
  /** Retries with no confirm, for "Approve and retry" on a run blocked by a setup script (OS-2584). */
  onRetryWithoutConfirm?: (messageId: Id<"cliMessages">) => Promise<void>;
  /** Forks the thread at a completed reply (OS-1397). */
  onBranchFromHere?: (messageId: Id<"cliMessages">) => void;
  /** Forks into a tab beside the viewed thread (OS-2224). */
  onBranchIntoTab?: (messageId: Id<"cliMessages">) => void;
  /** Handoff from here → In a new thread (docs/specs/cli-thread-handoff.md). */
  onHandoffToNewThread?: (messageId: Id<"cliMessages">) => void;
  /** Handoff from here → In a new tab. */
  onHandoffToNewTab?: (messageId: Id<"cliMessages">) => void;
  /** Rendered above the transcript; the fork history (OS-1397). */
  transcriptHeader?: ReactNode;
  /** A line after one row (fork divider); nothing when its row is gone. */
  transcriptDivider?: { afterMessageId: Id<"cliMessages"> | null; node: ReactNode };
  taskLinkHref: (task: ThreadDetailTaskLink) => string;
  /** Render the rows only, inside a host transcript's scroll container; the fork prefix (OS-1397). */
  embedded?: boolean;
  /** Opens the task in a host surface; when omitted, task pills navigate normally. */
  onOpenTaskInSidebar?: (task: ThreadDetailTaskLink) => void;
  /** Same, for artifact tool-part links (OS-1569). */
  onOpenArtifact?: (artifactId: string) => void;
  /** Same, for the task ref links in task tool parts (OS-1686). */
  onOpenTaskRef?: (refId: string) => void;
  conversationRef?: Ref<ConversationHandle>;
}

export const ThreadMessageList = memo(function ThreadMessageList({
  threadId,
  taskId,
  projectId,
  showOlderMessagesCut,
  showOlderMessagesPlaceholder = false,
  showOlderMessagesLabel,
  isOlderMessagesCutActionable = true,
  isLoadingMessages = false,
  visibleMessages,
  hasPendingAssistantPlaceholder = false,
  pendingAssistantLabel = "CLI",
  isCliOffline = false,
  latestThreadMessageId,
  userTextById,
  userMessageResponseMap = EMPTY_RESPONSE_MAP,
  renderStateByMessageId,
  askUserQuestionResponses = EMPTY_RESPONSES,
  isThreadProcessing,
  isThreadStreaming = false,
  isQueueHeld,
  latestUserMessageId,
  onSubmitEditLast,
  editComposerProps,
  continuingFailedMessageId = null,
  isSubmitting,
  isRetrying = false,
  profileName,
  pathString,
  gitRemoteUrl,
  organizationSlug,
  projectAlias,
  onOpenDiffFile,
  onRevertRun,
  onMentionFile,
  onRevertFile,
  getUserMessageAttachments,
  onShowOlderMessages,
  onSubmitAskUserQuestion,
  onPlanDecision,
  showPlanDecisions = false,
  pendingProposedPlan,
  onContinueFailedSession,
  onRetry,
  onRetryWithoutConfirm,
  onBranchFromHere,
  onBranchIntoTab,
  onHandoffToNewThread,
  onHandoffToNewTab,
  transcriptHeader,
  transcriptDivider,
  taskLinkHref,
  embedded = false,
  onOpenTaskInSidebar,
  onOpenArtifact,
  onOpenTaskRef,
  conversationRef,
}: ThreadMessageListProps) {
  // Same subscription as each reply's checks card, which Convex shares.
  const taskChecks = useThreadChecks(threadId, taskId);
  const reportedMessageIds = useMemo(
    () => new Set<string>((taskChecks?.checks ?? []).flatMap((check) => check.results.map((result) => result.messageId))),
    [taskChecks]
  );
  const [editingMessageId, setEditingMessageId] =
    useState<Id<"cliMessages"> | null>(null);
  const layoutBodyRef = useRef<HTMLDivElement>(null);
  usePrintTranscript(layoutBodyRef);

  const handleSubmitEdit = async (
    messageId: Id<"cliMessages">,
    content: string,
    options?: EditCliMessageOptions
  ) => {
    if (!onSubmitEditLast) {
      return;
    }
    await onSubmitEditLast(messageId, content, options);
    setEditingMessageId(null);
  };

  // Plan decisions belong to the run that proposed the plan, so they anchor to
  // the last assistant message — a trailing queued/steered user message must
  // not push them out of the plan panel (OS-1458).
  const latestAssistantMessageId = visibleMessages
    .filter((message) => message.role === "assistant")
    .at(-1)?._id;

  const body = (
    <>
      {transcriptHeader}
      {isLoadingMessages && visibleMessages.length === 0 ? (
        <LoadingMessagesPlaceholder />
      ) : null}
      {showOlderMessagesCut &&
        (showOlderMessagesPlaceholder ? (
          <OlderMessagesSkeletonRow />
        ) : isOlderMessagesCutActionable ? (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            data-older-messages-cut
            onClick={onShowOlderMessages}
          >
            <span className="h-px flex-1 bg-border" />
            <span>{showOlderMessagesLabel ?? "Show more"}</span>
            <span className="h-px flex-1 bg-border" />
          </button>
        ) : (
          <div className="flex w-full items-center gap-3 py-3 text-sm text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>{showOlderMessagesLabel}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ))}
      {visibleMessages.map((message, index) => {
        // Steered messages render inline in the assistant stream at their injection position.
        // Queued (streaming or CLI offline) and held (Stop) messages live in the composer strip instead.
        if (
          isInlineSteeredMessage(message) ||
          (message.role === "user" &&
            message.processedAt === undefined &&
            (isThreadStreaming || isQueueHeld || isCliOffline))
        ) {
          return null;
        }
        const linkedTask = message.task;
        const textContent =
          message.role === "user" ? (userTextById.get(message._id) ?? "") : "";
        const askUserQuestionResponse =
          message.role === "user"
            ? userMessageResponseMap.get(message._id) ?? null
            : null;
        const isLatestVisibleMessage = index === visibleMessages.length - 1;
        const isLatestThreadMessage = message._id === latestThreadMessageId;
        const streamedRender =
          message.role === "assistant"
            ? renderStateByMessageId.get(message._id)
            : undefined;
        // Set only by MCP `send_thread_message` — absence means a human sent it.
        const sentByThreadId =
          message.role === "user" && message.sentBy?.kind === "thread"
            ? message.sentBy.threadId
            : undefined;
        const isStreaming = message.status === "streaming";
        const isFailed = message.status === "failed";
        const isPending = message.status === "pending";
        // Edit is offered on the newest user message only while no response is in flight — the
        // user must Stop first (OS-1374). Queued and held messages edit from the strip.
        const showEditLastAction =
          onSubmitEditLast !== undefined &&
          message.role === "user" &&
          message._id === latestUserMessageId &&
          !isThreadProcessing;
        const isEditingThis =
          showEditLastAction && editingMessageId === message._id;
        const showFailedActions =
          isFailed &&
          isLatestThreadMessage &&
          !isThreadProcessing &&
          continuingFailedMessageId !== message._id;
        // A run blocked on an unapproved setup script reads as one callout, not notice plus failure (OS-2584).
        const blockedSetupRepoKey =
          showFailedActions && projectId && onRetry && onRetryWithoutConfirm
            ? (streamedRender?.parts.map(unapprovedWorktreeSetupRepoKey).find((key) => key !== null) ?? null)
            : null;
        const assistantRender =
          blockedSetupRepoKey && streamedRender
            ? { ...streamedRender, parts: streamedRender.parts.filter((part) => unapprovedWorktreeSetupRepoKey(part) === null) }
            : streamedRender;
        const hasCheckResults = reportedMessageIds.has(message._id);
        // An attachment- or check-only reply mounts the assistant renderer too, so its files keep one host (OS-2091, OS-2291).
        const hasAssistantContent =
          message.role === "assistant" &&
          ((assistantRender
            ? assistantRender.parts.length > 0 ||
              Object.keys(assistantRender.metadata).length > 0
            : false) ||
            message.attachments.length > 0 ||
            hasCheckResults);
        const failure = splitFailureMessage(message.errorMessage);

        return (
          <Fragment key={message._id}>
          <div
            data-thread-message-row
            style={THREAD_MESSAGE_ROW_STYLE}
          >
            <Message from={message.role}>
              {message.role === "assistant" ? (
                <MessageContent>
                  <>
                    {hasAssistantContent ? (
                      <AssistantCliMessage
                        messageId={message._id}
                        status={message.status}
                        cliType={message.cliType}
                        cliModel={message.cliModel}
                        resolvedCliModel={message.resolvedCliModel}
                        cliEffort={message.cliEffort}
                        // Settled runs show when they finished; a run still
                        // in flight shows when it started, so the footer
                        // always carries a time (OS-1480).
                        timestamp={
                          message.status === "completed" || isFailed
                            ? message.updatedAt
                            : message.createdAt
                        }
                        continuationId={message.cliContext?.continuationId}
                        turnId={message.cliContext?.turnId}
                        onBranchFromHere={onBranchFromHere}
                        onBranchIntoTab={onBranchIntoTab}
                        onHandoffToNewThread={onHandoffToNewThread}
                        onHandoffToNewTab={onHandoffToNewTab}
                        diffSummary={message.diffSummary}
                        onOpenDiffFile={onOpenDiffFile}
                        onRevertRun={onRevertRun}
                        onMentionFile={onMentionFile}
                        onRevertFile={onRevertFile}
                        renderState={assistantRender}
                        onSubmitAskUserQuestion={onSubmitAskUserQuestion}
                        submittedAskUserQuestionResponses={
                          askUserQuestionResponses
                        }
                        onPlanDecision={onPlanDecision}
                        pendingProposedPlan={pendingProposedPlan}
                        showPlanDecisions={
                          showPlanDecisions &&
                          message._id === latestAssistantMessageId
                        }
                        getUserMessageAttachments={getUserMessageAttachments}
                        onOpenArtifact={onOpenArtifact}
                        onOpenTaskRef={onOpenTaskRef}
                        attachments={message.attachments}
                        threadId={threadId}
                        taskId={taskId}
                        hasCheckResults={hasCheckResults}
                      />
                    ) : isPending ? (
                      <Spinner
                        className="text-sm text-muted-foreground"
                        shimmer
                        text={
                          isCliOffline
                            ? CLI_OFFLINE_PENDING_LABEL
                            : `Waiting for ${CLI_TYPE_MAP[message.cliType] ?? "CLI"}...`
                        }
                        textClassName="text-current"
                        textPlacement="inline"
                      />
                    ) : null}
                    {isStreaming && !hasAssistantContent && (
                      <Spinner
                        className="text-sm text-muted-foreground"
                        shimmer
                        text="Working"
                        textClassName="text-current"
                        textPlacement="inline"
                      />
                    )}
                    {!hasAssistantContent &&
                      !isPending &&
                      !isStreaming &&
                      !isFailed &&
                      message.chunkCount === 0 && (
                        <div className="text-sm text-muted-foreground">
                          No output generated.
                        </div>
                      )}
                    {blockedSetupRepoKey && projectId && onRetry && onRetryWithoutConfirm ? (
                      <WorktreeSetupBlockedCallout
                        projectId={projectId}
                        repoKey={blockedSetupRepoKey}
                        onRetry={() => onRetry(message._id)}
                        onApproveAndRetry={() => onRetryWithoutConfirm(message._id)}
                      />
                    ) : showFailedActions && (
                      <DangerCallout
                        title={failure.title}
                        description={failure.detail || undefined}
                        actions={
                          <>
                            {message.cliType === "claude-code" &&
                              onContinueFailedSession && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void onContinueFailedSession(message._id)
                                }
                                disabled={isSubmitting}
                              >
                                <ArrowRight className="mr-1.5 size-3" />
                                Continue
                              </Button>
                            )}
                            {onRetry ? (
                              <Button
                                size="sm"
                                className={DANGER_CALLOUT_ACTION_CLASS}
                                onClick={() => onRetry(message._id)}
                                disabled={isRetrying}
                              >
                                <RotateCcw className="mr-1.5 size-3" />
                                Retry
                              </Button>
                            ) : null}
    </>
                            }
                          />
                        )}
                      </>
                    </MessageContent>
                  ) : (
                    <div
                      className={cn(
                        "flex flex-col gap-2",
                        isEditingThis ? "w-full" : "ml-auto w-fit items-end"
                      )}
                    >
                      {askUserQuestionResponse ? (
                        <MessageContent>
                          <UserAskUserQuestionResponse
                            payload={askUserQuestionResponse}
                          />
                        </MessageContent>
                      ) : (
                        <>
                          {(linkedTask || message.pullRequest) && !isEditingThis ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              {linkedTask ? (
                                <ThreadTaskPillLink
                                  task={linkedTask}
                                  href={taskLinkHref(linkedTask)}
                                  onNavigate={
                                    onOpenTaskInSidebar
                                      ? () => onOpenTaskInSidebar(linkedTask)
                                      : undefined
                                  }
                                />
                              ) : null}
                              {message.pullRequest ? (
                                <AttachedPullRequestPill pullRequest={message.pullRequest} projectId={projectId} />
                              ) : null}
                            </div>
                          ) : null}
                          {!isEditingThis && message.attachments.length > 0 && (
                            <ResponseAttachments
                              messageId={message._id}
                              attachments={message.attachments}
                              className="items-end"
                            />
                          )}
                          {isEditingThis && editComposerProps ? (
                            <EditLastMessage
                              initialText={textContent}
                              message={message}
                              context={editComposerProps}
                              onCancel={() => setEditingMessageId(null)}
                              onSubmit={(content, options) =>
                                handleSubmitEdit(message._id, content, options)
                              }
                            />
                          ) : (
                            textContent.length > 0 && (
                              <MessageContent
                                className={cn(
                                  // "Not you" (OS-1631): `bg-secondary` is "what I said",
                                  // so an agent's message must not wear it. Teammate
                                  // messages will join this category.
                                  sentByThreadId &&
                                    "group-[.is-user]:bg-thread-message-foreign",
                                  // A workflow script the CLI runs, in the bash card's exec accent (OS-1886).
                                  message.scriptRequest &&
                                    cn("group-[.is-user]:bg-info-soft font-mono", BASH_TITLE_CLASS)
                                )}
                              >
                                {message.scriptRequest ? (
                                  <span className="flex items-start gap-2">
                                    <Terminal className={cn("mt-0.5 size-4 shrink-0", BASH_ICON_CLASS)} />
                                    <UserMessageText text={textContent} messageId={message._id} attachments={message.attachments} />
                                  </span>
                                ) : (
                                  <UserMessageText text={textContent} messageId={message._id} attachments={message.attachments} />
                                )}
                              </MessageContent>
                            )
                          )}
                        </>
                      )}
                      {!isEditingThis && (
                        <div className="flex items-center gap-1">
                          {/* Question responses use their dedicated controls. */}
                          {showEditLastAction &&
                            !askUserQuestionResponse && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                // -my keeps the hit target size-7 without letting
                                // the button grow the footer row (no height jump
                                // when it appears after Stop).
                                className="-my-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
                                aria-label="Edit message"
                                title="Edit and resend"
                                onClick={() => setEditingMessageId(message._id)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            )}
                          <UserMessageFooter
                            cliType={message.cliType}
                            cliMode={message.cliMode}
                            cliModel={message.cliModel}
                            cliEffort={message.cliEffort}
                            createdAt={message.createdAt}
                            profileName={profileName}
                            pathString={pathString}
                            gitRemoteUrl={gitRemoteUrl}
                          />
                          {/* Rightmost: the arrow points back down-left into its
                              own bubble, so it reads as a terminal accent. */}
                          {sentByThreadId && organizationSlug && projectAlias && (
                            <MessageSentByBadge
                              threadId={sentByThreadId}
                              organizationSlug={organizationSlug}
                              projectAlias={projectAlias}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Message>
              </div>
              {transcriptDivider?.afterMessageId === message._id ? transcriptDivider.node : null}
              </Fragment>
            );
          })}
          {hasPendingAssistantPlaceholder && (
            <div data-thread-message-row style={THREAD_MESSAGE_ROW_STYLE}>
              <Message from="assistant">
                <MessageContent>
                  <Spinner
                    className="text-sm text-muted-foreground"
                    shimmer
                    text={isCliOffline ? CLI_OFFLINE_PENDING_LABEL : `Waiting for ${pendingAssistantLabel}...`}
                    textClassName="text-current"
                    textPlacement="inline"
                  />
                </MessageContent>
              </Message>
            </div>
          )}
    </>
  );

  if (embedded) {
    // `contents`: rows stay flex children of the host transcript and keep its gap.
    return <div data-testid="thread-fork-prefix" className="contents">{body}</div>;
  }

  return (
    <div
      ref={layoutBodyRef}
      data-testid="thread-detail-layout-body"
      className="flex min-h-0 min-w-0"
    >
      <Conversation className="min-h-0 flex-1" ref={conversationRef}>
        {/* `data-thread-print-root`: the subtree Cmd/Ctrl+P copies out to print
            (docs/specs/cli-thread-print.md). */}
        <ConversationContent
          data-thread-print-root
          className="mx-auto max-w-3xl px-4 py-6"
        >
          {body}
        </ConversationContent>
        <ConversationScrollButton />
        <KeepViewOnShowMore />
      </Conversation>
    </div>
  );
});
