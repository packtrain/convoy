"use client";

import { CODEX_AGENT_GROUP_KEY } from "@/lib/cli-stream-ui/types";
import { memo, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowRightLeft, Braces, Copy, GitBranch, MessageSquarePlus, MoreHorizontal, Plus, Terminal } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  emptyMessageState,
  type CliRenderMessage,
  type CliUiPart,
  type ComposerMessageState,
} from "@/lib/cli-stream-ui";
import { Spinner } from "@/components/custom/spinner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isParkedAskUserQuestion,
  type AskUserQuestionResponseMap,
  type AskUserQuestionResponsePayload,
} from "@/lib/ai-tools/ask-user-question";
import type {
  CliRunDiffFile,
  CliRunDiffSummaryPreview,
  CliType,
} from "@/convex/lib/contracts/validators";
import {
  groupConsecutiveToolParts,
  isToolGroup,
} from "@/lib/threads/group-consecutive-tool-parts";
import {
  getToolGroupDurationMs,
  isToolGroupLive,
} from "@/lib/threads/tool-group";
import { canBranchFromReply } from "@/lib/threads/message-rows";
import { buildResumeCommand } from "@/lib/threads/resume-commands";
import type { PlanDecision } from "@/lib/threads/plan-decision";
import type { ThreadMessageAttachment } from "./response-attachments";
import { ConversionFallbackJson } from "./message-parts/components/conversion-fallback-json";
import { renderCliUiMessagePart } from "./message-parts/lib/part-renderer-registry";
import { RawJsonDialog } from "./message-parts/components/raw-json-dialog";
import { RunStats } from "./message-parts/components/run-stats";
import { ToolGroupPart } from "./message-parts/tool-group-part";
import { RunChangesCard } from "./run-changes-card";
import { ReplyChecks } from "@/components/blocks/checks";

export interface AssistantCliMessageProps {
  messageId: string;
  status?: "pending" | "claimed" | "streaming" | "completed" | "failed";
  cliType?: CliType;
  cliModel?: string;
  resolvedCliModel?: string;
  cliEffort?: string;
  timestamp?: number;
  continuationId?: string;
  /** Codex turn id; gates Branch from here (OS-2073). */
  turnId?: string;
  diffSummary?: CliRunDiffSummaryPreview;
  /** Opens the run-file viewer in the thread sidebar (OS-1143). */
  onOpenDiffFile?: (file: CliRunDiffFile, diffSummary: CliRunDiffSummaryPreview) => void;
  /** Asks to revert the run to its pre-run checkpoint (OS-1151). */
  onRevertRun?: (diffSummary: CliRunDiffSummaryPreview) => void;
  /** Inserts an `@path` mention into the composer (OS-1159). */
  onMentionFile?: (path: string) => void;
  /** A repo thread's own checkout relative to its folder, for run-card mentions (OS-2647). */
  checkoutLabel?: string;
  /** Asks to revert one file to its pre-run state (OS-1156). */
  onRevertFile?: (file: CliRunDiffFile, diffSummary: CliRunDiffSummaryPreview) => void;
  renderState: ComposerMessageState | undefined;
  onSubmitAskUserQuestion?: (
    payload: AskUserQuestionResponsePayload
  ) => Promise<void> | void;
  submittedAskUserQuestionResponses?: AskUserQuestionResponseMap;
  /** The run died parked on a question with no live request left (OS-1463). */
  orphanedParkedQuestion?: boolean;
  onPlanDecision?: (decision: PlanDecision) => Promise<void> | void;
  showPlanDecisions?: boolean;
  pendingProposedPlan?: PlanDecision["proposedPlan"];
  /** Resolves a user message's attachments (steered-message inline bubbles). */
  getUserMessageAttachments?: (
    messageId: string
  ) => ThreadMessageAttachment[] | undefined;
  /** Opens an artifact in the host's sidebar (OS-1569). */
  onOpenArtifact?: (artifactId: string) => void;
  /** Opens a task ref in the host's sidebar (OS-1686). */
  onOpenTaskRef?: (refId: string) => void;
  /** Forks the thread at this reply (OS-1397); absent for read-only viewers. */
  onBranchFromHere?: (messageId: Id<"cliMessages">) => void;
  /** Forks into a tab beside this thread (OS-2224); absent without a workspace or at the group cap. */
  onBranchIntoTab?: (messageId: Id<"cliMessages">) => void;
  /** Handoff from here → In a new thread (docs/specs/cli-thread-handoff.md); absent for read-only viewers. */
  onHandoffToNewThread?: (messageId: Id<"cliMessages">) => void;
  /** Handoff from here → In a new tab; absent without a workspace or at the group cap. */
  onHandoffToNewTab?: (messageId: Id<"cliMessages">) => void;
  /** Agent-attached files (OS-2091), shown after the reply text and above the footer. */
  attachments?: ThreadMessageAttachment[];
  /** The thread, and its task, whose Check results this reply may have reported (OS-2291, OS-2293). */
  threadId?: Id<"cliThreads">;
  taskId?: Id<"tasks">;
  /** This reply reported a Check result, so it renders even with no chunks or files. */
  hasCheckResults?: boolean;
}

/**
 * Tools whose interactive UI is keyed to `output-error` (the runtime errors the
 * call to hand the question back to the user). Settling these would pop a live
 * prompt back open on a run that already ended.
 */
const INTERACTIVE_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** Stable empty fallback so the grouping memo does not re-run per render. */
const EMPTY_TOOL_TIMINGS: ComposerMessageState["toolTimingsByCallId"] =
  new Map();
const EMPTY_RENDER_STATE = emptyMessageState();

/**
 * A stopped, failed, or completed run can leave tool calls without a result —
 * their parts would otherwise keep rendering a spinner forever (OS-1435).
 */
function settleInterruptedToolParts(parts: CliUiPart[], failed: boolean): CliUiPart[] {
  let didSettle = false;

  const settled = parts.map((part): CliUiPart => {
    if (part.type === "sleep" && part.state === "sleeping") {
      didSettle = true;
      return { ...part, state: failed ? "interrupted" : "ended" };
    }
    if (part.type === "task-notice-group" && part.groupKey === CODEX_AGENT_GROUP_KEY) {
      didSettle = true;
      return { ...part, runStatus: failed ? "failed" : "completed" };
    }
    if (part.type !== "dynamic-tool") return part;
    if (part.state !== "input-streaming" && part.state !== "input-available") {
      return part;
    }
    if (INTERACTIVE_TOOL_NAMES.has(part.toolName)) return part;

    didSettle = true;
    return {
      ...part,
      state: "output-error",
      errorText: "Interrupted",
    };
  });

  return didSettle ? settled : parts;
}

/**
 * A parked `AskUserQuestion` whose run died goes back to the user as the inline
 * questionnaire, answered by a new message (docs/specs/cli-ask-user-question-ui.md).
 */
function handBackParkedQuestions(
  parts: CliUiPart[],
  orphaned: boolean,
  submitted: AskUserQuestionResponseMap | undefined
): CliUiPart[] {
  let didHandBack = false;
  const handedBack = parts.map((part): CliUiPart => {
    if (!isParkedAskUserQuestion(part) || !(orphaned || submitted?.[part.toolCallId])) {
      return part;
    }
    didHandBack = true;
    return { ...part, state: "output-error", errorText: "Run ended" };
  });
  return didHandBack ? handedBack : parts;
}

export const AssistantCliMessage = memo(function AssistantCliMessage({
  messageId,
  status,
  cliType,
  cliModel,
  resolvedCliModel,
  cliEffort,
  timestamp,
  continuationId,
  turnId,
  diffSummary,
  onOpenDiffFile,
  onRevertRun,
  onMentionFile,
  checkoutLabel,
  onRevertFile,
  renderState: renderStateProp,
  onSubmitAskUserQuestion,
  submittedAskUserQuestionResponses,
  orphanedParkedQuestion = false,
  onPlanDecision,
  showPlanDecisions = false,
  pendingProposedPlan,
  getUserMessageAttachments,
  onOpenArtifact,
  onOpenTaskRef,
  onBranchFromHere,
  onBranchIntoTab,
  onHandoffToNewThread,
  onHandoffToNewTab,
  attachments,
  threadId,
  taskId,
  hasCheckResults = false,
}: AssistantCliMessageProps) {
  // Files or a checks card can stand alone, so either keeps the reply mounted.
  const hasAttachments = (attachments?.length ?? 0) > 0 || hasCheckResults;
  // An attachment-only reply has no chunks, but this stays its one host so text arriving later doesn't remount the files.
  const renderState = renderStateProp ?? (hasAttachments ? EMPTY_RENDER_STATE : undefined);
  const [isRawJsonOpen, setIsRawJsonOpen] = useState(false);
  // The envelope carries only the collapsed card's slice of the run's file
  // list; the rest loads when the user expands it (OS-1600). Once fetched it
  // stays subscribed — refs are immutable, so this settles immediately.
  const [isDiffExpanded, setIsDiffExpanded] = useState(false);
  // A run whose preview already holds every file needs no fetch at all — the
  // preview slice is wider than the collapsed card, so small runs (the common
  // case) expand straight from what the envelope shipped.
  const needsFullFileList =
    diffSummary !== undefined && diffSummary.files.length < diffSummary.fileCount;
  const runDiffSummary = useQuery(
    api.cli.messages.getRunDiffSummary,
    isDiffExpanded && needsFullFileList
      ? { messageId: messageId as Id<"cliMessages"> }
      : "skip"
  );
  // `null` means resolved-but-gone (message deleted, summary cleared), not
  // pending: fall back to the preview rows so the card cannot spin forever.
  const runDiffFiles =
    runDiffSummary === null ? diffSummary?.files : runDiffSummary?.files;

  const isSettled = status === "completed" || status === "failed";

  const renderMessage = useMemo(
    (): CliRenderMessage => {
      const parts = handBackParkedQuestions(
        renderState?.parts ?? [],
        orphanedParkedQuestion,
        submittedAskUserQuestionResponses
      );
      return {
        id: messageId,
        role: "assistant",
        parts: isSettled ? settleInterruptedToolParts(parts, status === "failed") : parts,
        metadata: renderState?.metadata,
      };
    },
    [
      messageId,
      renderState?.parts,
      renderState?.metadata,
      isSettled,
      status,
      orphanedParkedQuestion,
      submittedAskUserQuestionResponses,
    ]
  );

  // Grouping and the per-group liveness/duration answers all walk the message's
  // parts, so they are derived together — unrelated local state (the raw-JSON
  // dialog) must not re-walk a streaming message's parts on every render.
  const groupedItems = useMemo(() => {
    const grouped = groupConsecutiveToolParts(renderMessage.parts);
    const timings = renderState?.toolTimingsByCallId ?? EMPTY_TOOL_TIMINGS;

    return grouped.map((item, index) => {
      if (!isToolGroup(item)) {
        return { item, isLive: false, durationMs: undefined };
      }

      return {
        item,
        isLive: isToolGroupLive({
          group: item,
          isTrailingItem: index === grouped.length - 1,
          isMessageStreaming: status === "streaming",
        }),
        durationMs: getToolGroupDurationMs(item, timings),
      };
    });
  }, [renderMessage.parts, renderState?.toolTimingsByCallId, status]);

  // Shared render context for part renderers. partIndex is set per-item below
  // and reflects the grouped index, not the original index into renderMessage.parts.
  const baseContext = useMemo(
    () => ({
      message: renderMessage,
      onSubmitAskUserQuestion,
      submittedAskUserQuestionResponses,
      cliType,
      onPlanDecision,
      showPlanDecisions,
      pendingProposedPlan,
      getUserMessageAttachments,
      onOpenArtifact,
      onOpenTaskRef,
    }),
    [
      cliType,
      renderMessage,
      onSubmitAskUserQuestion,
      submittedAskUserQuestionResponses,
      onPlanDecision,
      showPlanDecisions,
      pendingProposedPlan,
      getUserMessageAttachments,
      onOpenArtifact,
      onOpenTaskRef,
    ]
  );

  if (!renderState) {
    // No render state yet (bootstrap pending).
    return null;
  }

  const hasParts = renderMessage.parts.length > 0;
  const hasRenderableContent =
    hasParts || Object.keys(renderState.metadata).length > 0 || hasAttachments;

  if (!hasRenderableContent) {
    return (
      <div className="flex w-full flex-col gap-3">
        <ConversionFallbackJson
          reason="No renderable chunk events found for this assistant response."
          warnings={renderState.warnings}
          detailsJson={JSON.stringify(
            {
              messageId,
              normalizedEvents: renderState.normalizedEvents,
            },
            null,
            2
          )}
        />
      </div>
    );
  }

  // A run parked on an interactive prompt is waiting on the user, not
  // streaming — the prompt's own card carries the state (OS-1458).
  const isAwaitingUserDecision = renderMessage.parts.some(
    (part) =>
      part.type === "dynamic-tool" &&
      INTERACTIVE_TOOL_NAMES.has(part.toolName) &&
      (part.state === "input-streaming" || part.state === "input-available")
  );

  const continueCommand = cliType && continuationId
    ? buildResumeCommand(cliType, continuationId)
    : null;

  const canBranch =
    onBranchFromHere !== undefined &&
    cliType !== undefined &&
    canBranchFromReply({ cliType, status, cliContext: { continuationId, turnId } });

  // The reply's prose only, as the Markdown export reads it (docs/specs/cli-thread-markdown-export.md).
  const responseText = status !== "streaming"
    ? renderMessage.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n\n")
        .trim()
    : "";

  const handleCopyResponse = async () => {
    if (!navigator.clipboard?.writeText) {
      toast.error("Clipboard is not available");
      return;
    }

    try {
      await navigator.clipboard.writeText(responseText);
      toast.success("Response copied");
    } catch {
      toast.error("Failed to copy response");
    }
  };

  const handleContinueLocally = async () => {
    if (!continueCommand || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(continueCommand);
      toast.success("Command copied to clipboard");
    } catch {
      toast.error("Failed to copy command");
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {groupedItems.map(({ item, isLive, durationMs }, index) => (
        <div
          key={
            isToolGroup(item)
              ? `${messageId}-group-${index}`
              : `${messageId}-part-${index}`
          }
          className="min-w-0"
        >
          {isToolGroup(item) ? (
            <ToolGroupPart
              group={item}
              isLive={isLive}
              durationMs={durationMs}
              context={{ ...baseContext, partIndex: index }}
            />
          ) : (
            renderCliUiMessagePart({
              part: item,
              context: { ...baseContext, partIndex: index },
            })
          )}
        </div>
      ))}
      {status === "streaming" && !isAwaitingUserDecision && (
        <Spinner
          className="text-sm text-muted-foreground"
          shimmer
          text="Working"
          textClassName="text-current"
          textPlacement="inline"
        />
      )}
      <ReplyChecks threadId={threadId} taskId={taskId} messageId={messageId} attachments={attachments} />
      {diffSummary && (
        <RunChangesCard
          diffSummary={diffSummary}
          allFiles={runDiffFiles}
          onExpandedChange={setIsDiffExpanded}
          onSelectFile={onOpenDiffFile ? (file) => onOpenDiffFile(file, diffSummary) : undefined}
          onUndo={onRevertRun ? () => onRevertRun(diffSummary) : undefined}
          onMentionFile={onMentionFile}
          checkoutLabel={checkoutLabel}
          onRevertFile={onRevertFile ? (file) => onRevertFile(file, diffSummary) : undefined}
        />
      )}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <RunStats
          metadata={renderMessage.metadata}
          cliType={cliType}
          cliModel={cliModel}
          resolvedCliModel={resolvedCliModel}
          cliEffort={cliEffort}
          timestamp={timestamp}
        />
        {responseText ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Copy response"
            title="Copy response"
            className="cursor-pointer text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => void handleCopyResponse()}
          >
            <Copy className="size-3.5" />
          </Button>
        ) : null}
        {/* Under the reply: the fork copies this run, reply included (OS-1397). */}
        {canBranch ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Branch from here"
            title="Branch from here"
            className="cursor-pointer text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => onBranchFromHere?.(messageId as Id<"cliMessages">)}
          >
            <GitBranch className="size-3.5" />
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Message actions"
              className="cursor-pointer text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => setIsRawJsonOpen(true)}
            >
              <Braces className="size-4" />
              Raw data
            </DropdownMenuItem>
            <DropdownMenuItem
              className="whitespace-nowrap"
              disabled={continueCommand === null}
              onClick={() => {
                void handleContinueLocally();
              }}
            >
              <Terminal className="size-4" />
              Continue locally from here
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="whitespace-nowrap" disabled={!canBranch}>
                <GitBranch className="size-4" />
                Branch from here
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => onBranchFromHere?.(messageId as Id<"cliMessages">)}
                >
                  <MessageSquarePlus className="size-4" />
                  In a new thread
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  disabled={!onBranchIntoTab}
                  onClick={() => onBranchIntoTab?.(messageId as Id<"cliMessages">)}
                >
                  <Plus className="size-4" />
                  In a new tab
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                className="whitespace-nowrap"
                disabled={!isSettled || !onHandoffToNewThread}
              >
                <ArrowRightLeft className="size-4" />
                Handoff from here
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => onHandoffToNewThread?.(messageId as Id<"cliMessages">)}
                >
                  <MessageSquarePlus className="size-4" />
                  In a new thread
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  disabled={!onHandoffToNewTab}
                  onClick={() => onHandoffToNewTab?.(messageId as Id<"cliMessages">)}
                >
                  <Plus className="size-4" />
                  In a new tab
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <RawJsonDialog
        open={isRawJsonOpen}
        onOpenChange={setIsRawJsonOpen}
        lazySections={() => [
          {
            title: "Composer parts",
            description: "Rendered parts built from normalized chunk events.",
            json: JSON.stringify(renderState.parts, null, 2),
          },
          {
            title: "Normalized events",
            description: "Raw normalized events from the stream.",
            json: JSON.stringify(renderState.normalizedEvents, null, 2),
          },
        ]}
      />
    </div>
  );
});
