"use client";

import {
  memo,
  type AnchorHTMLAttributes,
  type ComponentType,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Check,
  CircleCheck,
  CircleDashed,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  FolderGit2,
  FolderOutput,
  GitBranch,
  GitFork,
  Link2,
  Link2Off,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Terminal,
  Trash2,
} from "lucide-react";
import { useConvex } from "convex/react";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/blocks/agents/agent-avatar";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import { AppLink, appRoute, href, routeTarget, useThreadNavigationState } from "@/lib/navigation";
import { ThreadTaskRefLink } from "./thread-task-link";
import { supportsResumeLocally } from "@/lib/cli-runtime-ui/registry";
import { buildResumeCommand } from "@/lib/threads/resume-commands";
import { renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import type { ThreadTaskSummary } from "@/lib/threads/task-summary";
import { areThreadListItemsEqual } from "@/lib/threads/thread-list-item-equality";
import { SlashCommandDisplayText, slashCommandDisplayText } from "@/lib/slash-commands/display";
import type { ThreadStatus } from "@/lib/threads/types";
import { getThreadDisplayStatus } from "@/lib/threads/display-status";
import { THREAD_STATUS_META } from "@/lib/threads/status-meta";
import { isContainerThread } from "@/lib/threads/containers";
import { copyThreadShareLink } from "@/lib/threads/share-link";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliThreadKind, CliType } from "@/convex/lib/contracts/validators";
import type { CliThreadBackground } from "@/convex/cli/threads/lib/validators";
import { ThreadAgentChip, type ThreadAgentChipAgent } from "./thread-agent-chip";
import { ThreadDiffStat } from "./thread-diff-stat";
import { ThreadAttachedPrBadge, ThreadPrBadges } from "./thread-pr-badge";
import { ThreadSharedRowBadge } from "./thread-shared-row-badge";
import { ThreadBackgroundRowBadge } from "./thread-background-row-badge";
import { ThreadWorkflowRowBadge } from "./thread-workflow-row-badge";
import { ThreadStatusIndicator } from "./thread-status-indicator";
import { CompactThreadRowContent } from "./compact-thread-row-content";
import type { AttachedPullRequest } from "@/convex/lib/contracts/github";
import type { CliThreadRepoBranch, CliThreadRepoPullRequest } from "@/convex/lib/contracts/validators";
import { formatThreadPullRequestRef, formatThreadPullRequestTooltip, getThreadPullRequestPresentation, threadPullRequests, type ThreadPullRequest } from "@/lib/threads/pull-request";
import { threadBranchLabel, type ThreadBranchLabel } from "@/lib/threads/repo-branches";

export interface ThreadListItemData {
  _id: Id<"cliThreads">;
  title: string;
  branch?: string;
  pathLabel?: string;
  pathString?: string;
  gitRemoteUrl?: string;
  linesAdded?: number;
  linesRemoved?: number;
  /** Last-known PR snapshot for the thread's branch (OS-1370). */
  pullRequest?: ThreadPullRequest;
  /** A multi-repo folder's branches while they differ, and its repos' PRs (OS-2523). */
  repoBranches?: CliThreadRepoBranch[];
  repoPullRequests?: CliThreadRepoPullRequest[];
  associatedTask?: ThreadTaskSummary;
  attachedPullRequest?: AttachedPullRequest;
  status: ThreadStatus;
  /** A mid-run approval/question is parked on the thread (OS interactive approvals). */
  hasPendingInteraction?: boolean;
  /** The queue survived a Stop and waits for the user's next send (OS-1374). */
  queueHeldAt?: number;
  cliType: CliType;
  /** Bound Project agent (OS-1138); server-resolved with the deleted-agent placeholder. */
  agent?: ThreadAgentChipAgent;
  hasUnread: boolean;
  requiresAttention: boolean;
  /** The watched PR's checks still run, so a settled row shows as working (docs/specs/pull-request-watch.md). */
  pullRequestChecksRunning: boolean;
  /** Explicitly marked done after the latest activity (OS-1382); absent on surfaces without the enriched field. */
  isDone?: boolean;
  lastActivityAt: number;
  /** Pinned to the top of the thread list (OS-1173); absent on surfaces that never pin. */
  isPinned?: boolean;
  /** Container discriminator (OS-1476); absent = plain thread. Group rows render identically — kind only gates transcript-bound actions. */
  kind?: CliThreadKind;
  /** Set while the thread — or, on a container, the whole group (OS-1579) — is shared read-only with the project (OS-1575). */
  sharedAt?: number;
  /** Why a background thread exists (OS-2513); absent on ordinary threads. */
  background?: CliThreadBackground;
  /** Container membership. Group children inherit sharing from their container. */
  parentThreadId?: Id<"cliThreads">;
  /** The container's `sharedAt`, mirrored on detail surfaces. Only groups can be shared. */
  containerSharedAt?: number;
  /** The container's `kind`, on any child (OS-1579). A child has no `kind`, so this is the only way to tell a group tab from a workflow-run one. */
  containerKind?: CliThreadKind;
  /** Set on a Workflow run's container and its lane threads (OS-1366) — run rows aren't shareable. */
  workflowRunId?: Id<"workflowRuns">;
  /** The container's `workflowRunId`, on any child (OS-1366); same delivery as `containerKind`. */
  containerWorkflowRunId?: Id<"workflowRuns">;
  /** The bound run's workflow identity (OS-1875); tints, names, and links the run row's glyph. */
  workflow?: { _id: Id<"workflows">; name: string; color?: string };
}

function shouldOfferMarkRead(chat: ThreadListItemData): boolean {
  return chat.hasUnread || chat.requiresAttention;
}

function getRepositorySlug(gitRemoteUrl: string | undefined): string | undefined {
  if (!gitRemoteUrl) {
    return undefined;
  }

  const sshMatch = gitRemoteUrl.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  const urlMatch = gitRemoteUrl.match(/\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return urlMatch?.[1];
}

function getWorkingDirectoryLabel({ pathLabel, pathString }: Pick<ThreadListItemData, "pathLabel" | "pathString">) {
  const fallbackPathLabel = pathString?.split(/[\\/]/).filter(Boolean).at(-1);
  return pathLabel ?? fallbackPathLabel;
}

function formatAbsoluteDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ThreadPopoverValueRow({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function PullRequestPopoverRow({ pullRequest }: { pullRequest: ThreadPullRequest }) {
  const presentation = getThreadPullRequestPresentation(pullRequest.state);
  const Icon = presentation.icon;
  return (
    <ThreadPopoverValueRow
      icon={
        <Icon
          className={cn("size-4", presentation.colorClass)}
          aria-hidden
        />
      }
    >
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${presentation.stateLabel}: ${pullRequest.title}`}
        aria-label={formatThreadPullRequestTooltip(pullRequest)}
        className="block cursor-pointer truncate hover:underline"
      >
        {pullRequest.repo ? `${pullRequest.repo} · ` : ""}{formatThreadPullRequestRef(pullRequest)} {pullRequest.title}
      </a>
    </ThreadPopoverValueRow>
  );
}

function CompactThreadBranchPopover({
  title,
  branch,
  pathLabel,
  pathString,
  gitRemoteUrl,
  linesAdded,
  linesRemoved,
  pullRequests,
  agent,
  lastActivityAt,
  children,
  contextMenuTrigger = false,
}: {
  title: string;
  branch: ThreadBranchLabel;
  pathLabel?: string;
  pathString?: string;
  gitRemoteUrl?: string;
  linesAdded?: number;
  linesRemoved?: number;
  pullRequests: ThreadPullRequest[];
  agent?: ThreadAgentChipAgent;
  lastActivityAt: number;
  children: ReactElement;
  contextMenuTrigger?: boolean;
}) {
  const repositorySlug = getRepositorySlug(gitRemoteUrl);
  const workingDirectoryLabel = getWorkingDirectoryLabel({
    pathLabel,
    pathString,
  });
  const trigger = contextMenuTrigger ? <ContextMenuTrigger asChild>{children}</ContextMenuTrigger> : children;

  return (
    <HoverCard openDelay={250} closeDelay={100}>
      {/*
        Focus is not hover intent on a row trigger. Radix opens the hover card
        from `onFocus` with no pointer/focus-visible guard, and React's
        `onFocus` is the bubbling `focusin` — so focus landing on the row's own
        stretched overlay link counts as focusing the trigger. Clicking a row to
        open its thread leaves that link focused, and the browser re-dispatches
        focus at the stored `activeElement` when the window regains focus (for
        example after the machine unlocks), which opened this card with the
        pointer nowhere near the row. Nothing then closed it: no `pointerleave`
        ever arrives, and focus never moves, so no `blur` either. Suppressing
        both handlers keeps the card pointer-only. `composeEventHandlers` bails
        when our handler calls `preventDefault`, which is what stops Radix's
        `onOpen`/`onClose` from running.
      */}
      <HoverCardTrigger
        asChild
        onFocus={(event) => event.preventDefault()}
        onBlur={(event) => event.preventDefault()}
      >
        {trigger}
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={8} className="w-80 max-w-[calc(100vw-2rem)] p-3">
        <p className="mb-3 line-clamp-3 break-words border-b border-border pb-3 text-sm font-medium leading-5 text-foreground">
          {title}
        </p>
        <div className="space-y-2">
          {repositorySlug ? (
            <ThreadPopoverValueRow
              icon={<GitFork className="size-4" aria-hidden />}
            >
              <p className="truncate" title={gitRemoteUrl}>
                {repositorySlug}
              </p>
            </ThreadPopoverValueRow>
          ) : null}
          {workingDirectoryLabel ? (
            <ThreadPopoverValueRow
              icon={<FolderGit2 className="size-4" aria-hidden />}
            >
              <p className="truncate font-mono" title={pathString}>
                {workingDirectoryLabel}
              </p>
            </ThreadPopoverValueRow>
          ) : null}
          <ThreadPopoverValueRow
            icon={<GitBranch className="size-4" aria-hidden />}
          >
            {branch.repoLines ? (
              <ul className="space-y-0.5">
                {branch.repoLines.map((line) => (
                  <li key={line} className="break-all font-mono">{line}</li>
                ))}
              </ul>
            ) : (
              <p className="break-all font-mono">{branch.text}</p>
            )}
          </ThreadPopoverValueRow>
          {pullRequests.map((pullRequest) => (
            <PullRequestPopoverRow key={pullRequest.url} pullRequest={pullRequest} />
          ))}
          {agent ? (
            <div className="border-t border-border pt-2">
              <ThreadPopoverValueRow
                icon={
                  <span aria-hidden>
                    <AgentAvatar
                      name={agent.name}
                      color={agent.color}
                      size="xs"
                      className="size-4"
                    />
                  </span>
                }
              >
                <p
                  className={cn(
                    "truncate",
                    agent.isDeleted && "italic text-muted-foreground"
                  )}
                >
                  {agent.name}
                </p>
              </ThreadPopoverValueRow>
            </div>
          ) : null}
        </div>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
          <dt className="text-muted-foreground">Changes</dt>
          <dd className="justify-self-end">
            <ThreadDiffStat added={linesAdded} removed={linesRemoved} />
          </dd>
          <dt className="text-muted-foreground">Updated</dt>
          <dd className="justify-self-end whitespace-nowrap text-foreground">{formatAbsoluteDateTime(lastActivityAt)}</dd>
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
}

interface ThreadActionItemProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

interface ThreadActionSeparatorProps {
  className?: string;
}

interface ThreadActionMenuItemsProps {
  chat: ThreadListItemData;
  isCurrentThread: boolean;
  Item: ComponentType<ThreadActionItemProps>;
  Separator: ComponentType<ThreadActionSeparatorProps>;
  /** Both only to build the shareable thread URL. */
  organizationSlug: string;
  projectAlias: string;
  onRenameRequest?: (chat: ThreadListItemData) => void;
  onToggleReadRequest?: (chat: ThreadListItemData, isCurrentThread: boolean) => void;
  onToggleDoneRequest?: (chat: ThreadListItemData) => void;
  onPinRequest?: (chat: ThreadListItemData) => void;
  /** Group children only (OS-1478); sidebar rows never offer it. */
  onMoveOutRequest?: (chat: ThreadListItemData) => void;
  /**
   * Open thread only (OS-1749): the export reads the client's transcript, which
   * list rows don't have. See `docs/specs/cli-thread-markdown-export.md`.
   */
  onExportMarkdownRequest?: (chat: ThreadListItemData) => void;
  onDeleteRequest?: (chat: ThreadListItemData) => void;
}

function ThreadActionMenuItems({
  chat,
  isCurrentThread,
  Item,
  Separator,
  organizationSlug,
  projectAlias,
  onRenameRequest,
  onToggleReadRequest,
  onToggleDoneRequest,
  onPinRequest,
  onMoveOutRequest,
  onExportMarkdownRequest,
  onDeleteRequest,
}: ThreadActionMenuItemsProps) {
  const convex = useConvex();
  const showMarkRead = shouldOfferMarkRead(chat);

  const handleToggleDone = async () => {
    if (onToggleDoneRequest) {
      onToggleDoneRequest(chat);
      return;
    }

    try {
      await convex.mutation(chat.isDone ? api.cli.threads.batch.batchMarkNotDone : api.cli.threads.batch.batchMarkDone, { threadIds: [chat._id] });
    } catch {
      toast.error("Failed to update done state");
    }
  };

  // A group is shared as a unit (OS-1579): the container is the shareable row and a child
  // shares *through* it, so from a tab the action targets the container rather than being
  // hidden — which would leave the group's own tabs as the only place to stop sharing. A
  // workflow run's container is never shareable, so don't offer an action that can only fail.
  //
  // A child carries no run binding of its own view here, so answering that for a tab takes
  // the container's `containerWorkflowRunId`. `isContainerChild`, not "group child": a run
  // tab is a child too (`CONTEXT.md`).
  const isContainerChild = chat.parentThreadId !== undefined;
  const canShare = isContainerChild
    ? chat.containerKind === "group" && chat.containerWorkflowRunId === undefined
    : chat.workflowRunId === undefined;
  const shareTargetId = chat.parentThreadId ?? chat._id;
  const isShared = (isContainerChild ? chat.containerSharedAt : chat.sharedAt) !== undefined;
  // Says what the action covers when it isn't just this thread. Only reachable
  // behind `canShare`, so a container child here is always a Group child.
  const sharesWholeGroup = isContainerChild || isContainerThread(chat);

  // Share and hand over the link in one action: sharing without the link is a dead end, and the
  // link is useless before the thread is shared. The two steps report separately — the clipboard
  // can fail after the thread is already shared, and "Failed to share thread" would send the user
  // to retry something that succeeded.
  const handleShare = async () => {
    try {
      await convex.mutation(api.cli.threads.core.share, { threadId: shareTargetId });
    } catch {
      toast.error(sharesWholeGroup ? "Failed to share group" : "Failed to share thread");
      return;
    }

    await copyThreadShareLink(organizationSlug, projectAlias, shareTargetId, {
      success: "Link copied — anyone on this project can open it",
      error: sharesWholeGroup
        ? "Group shared, but the link could not be copied — use Copy link"
        : "Thread shared, but the link could not be copied — use Copy link",
    });
  };

  const handleUnshare = async () => {
    try {
      await convex.mutation(api.cli.threads.core.unshare, { threadId: shareTargetId });
      toast.success(sharesWholeGroup ? "Group is no longer shared" : "Thread is no longer shared");
    } catch {
      toast.error("Failed to stop sharing");
    }
  };

  const handleContinueLocally = async () => {
    try {
      const continuationId = await convex.query(api.cli.messages.getLatestContinuationForThread, { threadId: chat._id });
      if (!continuationId) {
        toast.error("No session found to resume");
        return;
      }
      const command = buildResumeCommand(chat.cliType, continuationId);
      if (!command) {
        toast.error("Resume not supported for this CLI type");
        return;
      }
      await navigator.clipboard.writeText(command);
      toast.success("Command copied to clipboard");
    } catch {
      toast.error("Failed to copy command");
    }
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(chat._id);
      toast.success("Thread ID copied to clipboard");
    } catch {
      toast.error("Failed to copy thread ID");
    }
  };

  const canContinueLocally = !isContainerThread(chat);

  return (
    <>
      {/* The thread's own state. "Mark as done" is unconditional, so this
          group is never empty and needs no leading separator. */}
      {onRenameRequest && (
        <Item
          onClick={(event) => {
            event.stopPropagation();
            onRenameRequest(chat);
          }}
        >
          <Pencil className="mr-2 size-4" />
          Rename
        </Item>
      )}
      {onToggleReadRequest && (
        <Item
          onClick={(event) => {
            event.stopPropagation();
            onToggleReadRequest(chat, isCurrentThread);
          }}
        >
          {showMarkRead ? <Eye className="mr-2 size-4" /> : <EyeOff className="mr-2 size-4" />}
          {showMarkRead ? "Mark as read" : "Mark as unread"}
        </Item>
      )}
      <Item
        onClick={(event) => {
          event.stopPropagation();
          void handleToggleDone();
        }}
      >
        {chat.isDone ? <CircleDashed className="mr-2 size-4" /> : <CircleCheck className="mr-2 size-4" />}
        {chat.isDone ? "Mark as not done" : "Mark as done"}
      </Item>
      {onPinRequest && (
        <Item
          onClick={(event) => {
            event.stopPropagation();
            onPinRequest(chat);
          }}
        >
          {chat.isPinned ? <PinOff className="mr-2 size-4" /> : <Pin className="mr-2 size-4" />}
          {chat.isPinned ? "Unpin" : "Pin"}
        </Item>
      )}
      {/* Handoff: everything that hands the thread to somewhere outside this
          menu — a terminal, a link, an ID, a file. Copy thread ID is
          unconditional, so the group is never empty. */}
      <Separator />
      {canContinueLocally && (
        <Item
          disabled={!supportsResumeLocally(chat.cliType)}
          onClick={(event) => {
            event.stopPropagation();
            void handleContinueLocally();
          }}
        >
          <Terminal className="mr-2 size-4" />
          Continue locally
        </Item>
      )}
      <Item
        onClick={(event) => {
          event.stopPropagation();
          void handleCopyId();
        }}
      >
        <Copy className="mr-2 size-4" />
        Copy thread ID
      </Item>
      {canShare &&
        (isShared ? (
          <>
            <Item
              onClick={(event) => {
                event.stopPropagation();
                void copyThreadShareLink(
                  organizationSlug,
                  projectAlias,
                  shareTargetId
                );
              }}
            >
              <Link2 className="mr-2 size-4" />
              Copy link
            </Item>
            <Item
              onClick={(event) => {
                event.stopPropagation();
                void handleUnshare();
              }}
            >
              <Link2Off className="mr-2 size-4" />
              {sharesWholeGroup ? "Stop sharing group" : "Stop sharing"}
            </Item>
          </>
        ) : (
          <Item
            onClick={(event) => {
              event.stopPropagation();
              void handleShare();
            }}
          >
            <Share2 className="mr-2 size-4" />
            {/* "Share group", not "Share group with project": it pairs with
                "Stop sharing group", which never named the audience either —
                the toast and the header badge tooltip both say who can open
                it. */}
            {sharesWholeGroup ? "Share group" : "Share with project team"}
          </Item>
        ))}
      {onExportMarkdownRequest && (
        <Item
          onClick={(event) => {
            event.stopPropagation();
            onExportMarkdownRequest(chat);
          }}
        >
          <FileDown className="mr-2 size-4" />
          Export to Markdown
        </Item>
      )}
      {/* Where the thread lives — group children only, so the separator ships
          with the item rather than standing alone. */}
      {onMoveOutRequest && (
        <>
          <Separator />
          <Item
            onClick={(event) => {
              event.stopPropagation();
              onMoveOutRequest(chat);
            }}
          >
            <FolderOutput className="mr-2 size-4" />
            Remove thread from group
          </Item>
        </>
      )}
      {onDeleteRequest && (
        <>
          <Separator />
          <Item
            onClick={(event) => {
              event.stopPropagation();
              onDeleteRequest(chat);
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            Delete
          </Item>
        </>
      )}
    </>
  );
}

const FULL_ROW_HIGHLIGHT_META = {
  unread: { key: "unread", className: "bg-info" },
  streaming: { key: "in-progress", className: "bg-info" },
  waiting_input: { key: "waiting-input", className: "bg-warning" },
  failed: { key: "failed", className: "bg-destructive" },
} as const;

function getFullRowHighlight(
  status: ThreadStatus,
  isUnread: boolean
): (typeof FULL_ROW_HIGHLIGHT_META)[keyof typeof FULL_ROW_HIGHLIGHT_META] | undefined {
  if (status === "failed" || status === "waiting_input" || status === "streaming") {
    return FULL_ROW_HIGHLIGHT_META[status];
  }

  if (status === "completed" && isUnread) {
    return FULL_ROW_HIGHLIGHT_META.unread;
  }

  return undefined;
}

export function ThreadActionsMenu({
  chat,
  isCurrentThread,
  organizationSlug,
  projectAlias,
  onRenameRequest,
  onToggleReadRequest,
  onToggleDoneRequest,
  onPinRequest,
  onMoveOutRequest,
  onExportMarkdownRequest,
  onDeleteRequest,
  triggerClassName,
  triggerIcon,
}: {
  chat: ThreadListItemData;
  isCurrentThread: boolean;
  organizationSlug: string;
  projectAlias: string;
  onRenameRequest?: (chat: ThreadListItemData) => void;
  onToggleReadRequest?: (chat: ThreadListItemData, isCurrentThread: boolean) => void;
  onToggleDoneRequest?: (chat: ThreadListItemData) => void;
  onPinRequest?: (chat: ThreadListItemData) => void;
  onMoveOutRequest?: (chat: ThreadListItemData) => void;
  onExportMarkdownRequest?: (chat: ThreadListItemData) => void;
  onDeleteRequest?: (chat: ThreadListItemData) => void;
  triggerClassName?: string;
  triggerIcon?: "vertical" | "horizontal";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Thread actions"
          className={cn(
            "size-7 cursor-pointer border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground",
            triggerClassName
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {triggerIcon === "horizontal" ? <MoreHorizontal className="size-4" /> : <MoreVertical className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      {/*
        No exit animation (OS-1596): the trigger lives in a hover-swapped layer
        that compact rows remove from layout (`hidden`), and Radix flips the
        trigger to data-state="closed" at the START of the exit animation while
        this menu is still mounted and still being re-measured — a window no CSS
        latch can cover, in which the anchor has no box and floating-ui
        repositions the closing menu against a 0x0 rect at viewport 0,0.
        Suppressing the exit animation makes Radix's Presence unmount
        synchronously on close, so that window does not exist. The `!` is
        load-bearing: the primitive's own `data-closed:animate-out` matches the
        same element at the same specificity, so without it the winner would
        depend on CSS source order. The 100ms close fade is the price; the open
        animation is untouched.
      */}
      <DropdownMenuContent
        align="end"
        className="w-60 data-closed:animate-none!"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <ThreadActionMenuItems
          chat={chat}
          isCurrentThread={isCurrentThread}
          Item={DropdownMenuItem}
          Separator={DropdownMenuSeparator}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          onRenameRequest={onRenameRequest}
          onToggleReadRequest={onToggleReadRequest}
          onToggleDoneRequest={onToggleDoneRequest}
          onPinRequest={onPinRequest}
          onMoveOutRequest={onMoveOutRequest}
          onExportMarkdownRequest={onExportMarkdownRequest}
          onDeleteRequest={onDeleteRequest}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Right-click actions for a thread — list rows and the thread tab (OS-1396). */
export function ThreadItemContextMenu({
  chat,
  isCurrentThread,
  children,
  triggerIsComposed = false,
  organizationSlug,
  projectAlias,
  onRenameRequest,
  onToggleReadRequest,
  onToggleDoneRequest,
  onPinRequest,
  onMoveOutRequest,
  onExportMarkdownRequest,
  onDeleteRequest,
}: {
  chat: ThreadListItemData;
  isCurrentThread: boolean;
  children: ReactElement;
  triggerIsComposed?: boolean;
  organizationSlug: string;
  projectAlias: string;
  onRenameRequest?: (chat: ThreadListItemData) => void;
  onToggleReadRequest?: (chat: ThreadListItemData, isCurrentThread: boolean) => void;
  onToggleDoneRequest?: (chat: ThreadListItemData) => void;
  onPinRequest?: (chat: ThreadListItemData) => void;
  onMoveOutRequest?: (chat: ThreadListItemData) => void;
  onExportMarkdownRequest?: (chat: ThreadListItemData) => void;
  onDeleteRequest?: (chat: ThreadListItemData) => void;
}) {
  return (
    <ContextMenu>
      {triggerIsComposed ? children : <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>}
      <ContextMenuContent className="w-60">
        <ThreadActionMenuItems
          chat={chat}
          isCurrentThread={isCurrentThread}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          onRenameRequest={onRenameRequest}
          onToggleReadRequest={onToggleReadRequest}
          onToggleDoneRequest={onToggleDoneRequest}
          onPinRequest={onPinRequest}
          onMoveOutRequest={onMoveOutRequest}
          onExportMarkdownRequest={onExportMarkdownRequest}
          onDeleteRequest={onDeleteRequest}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ThreadDoneQuickAction({
  chat,
  onToggleDoneRequest,
}: {
  chat: ThreadListItemData;
  onToggleDoneRequest: (chat: ThreadListItemData) => void;
}) {
  const actionLabel = chat.isDone ? "Mark as not done" : "Mark as done";

  return (
    <Button
      type="button"
      variant="outline"
      size="2xs"
      shape="pill"
      aria-label={actionLabel}
      title={actionLabel}
      className="pointer-events-auto cursor-pointer bg-transparent text-muted-foreground shadow-sm transition-none hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleDoneRequest(chat);
      }}
    >
      {chat.isDone ? "Not done" : "Done"}
    </Button>
  );
}

interface ThreadListItemProps {
  chat: ThreadListItemData;
  isActive: boolean;
  compactLayout: boolean;
  organizationSlug: string;
  projectAlias: string;
  showAssociatedTask?: boolean;
  linkTarget?: AnchorHTMLAttributes<HTMLAnchorElement>["target"];
  linkRel?: string;
  onSelectThread?: (threadId: Id<"cliThreads">, isCurrentThread: boolean) => void;
  onRenameRequest?: (chat: ThreadListItemData) => void;
  onToggleReadRequest?: (chat: ThreadListItemData, isCurrentThread: boolean) => void;
  onToggleDoneRequest?: (chat: ThreadListItemData) => void;
  onPinRequest?: (chat: ThreadListItemData) => void;
  onDeleteRequest?: (chat: ThreadListItemData) => void;
  showActions?: boolean;
  showStatusIndicator?: boolean;
  /** Shows sidebar-specific done state and the promoted hover shortcut. */
  showDoneState?: boolean;
  rowClassName?: string;
  innerClassName?: string;
  /** Multiselect mode (OS-1249): persistent checkbox replaces the leading status indicator. */
  multiSelectEnabled?: boolean;
  selected?: boolean;
  onToggleSelect?: (threadId: Id<"cliThreads">, shiftKey: boolean) => void;
}

function ThreadListItemComponent({
  chat,
  isActive,
  compactLayout,
  organizationSlug,
  projectAlias,
  showAssociatedTask = true,
  linkTarget,
  linkRel,
  onSelectThread,
  onRenameRequest,
  onToggleReadRequest,
  onToggleDoneRequest,
  onPinRequest,
  onDeleteRequest,
  showActions = true,
  showStatusIndicator = true,
  showDoneState = false,
  rowClassName,
  innerClassName,
  multiSelectEnabled = false,
  selected = false,
  onToggleSelect,
}: ThreadListItemProps) {
  const threadNavigation = useThreadNavigationState();
  const threadTarget = appRoute.projectThreadDetail(organizationSlug, projectAlias, String(chat._id));
  const threadLabel = slashCommandDisplayText(chat.title || "New thread");
  const displayStatus = getThreadDisplayStatus(chat);
  const associatedTask = chat.associatedTask;
  const associatedTaskNavigate =
    isActive && !linkTarget && associatedTask
      ? () => threadNavigation.openTask(associatedTask.refId, associatedTask.isArchived ? "archived" : "active")
      : undefined;
  const pullRequests = threadPullRequests(chat);
  const branchLabel = threadBranchLabel(chat);
  const attachedPrBadge = chat.attachedPullRequest ? (
    <ThreadAttachedPrBadge attached={chat.attachedPullRequest} branchPullRequests={pullRequests} />
  ) : null;
  const associatedTaskHref = associatedTask
    ? href(
        routeTarget(threadTarget.pathname, {
          query: {
            task: associatedTask.refId,
            archived: associatedTask.isArchived,
          },
        })
      )
    : "#";

  const isShared = chat.sharedAt !== undefined;
  // The container only: a lane thread carries the run's id too, but badging it
  // would render the run twice with no distinction (OS-1879).
  const isWorkflowRun = chat.workflowRunId !== undefined && chat.parentThreadId === undefined;
  const workflowBadge = isWorkflowRun ? (
    <ThreadWorkflowRowBadge
      workflow={chat.workflow}
      href={chat.workflow ? appRoute.projectWorkflowDetail(organizationSlug, projectAlias, chat.workflow._id) : undefined}
    />
  ) : null;
  const showSelectCheckbox = multiSelectEnabled && onToggleSelect !== undefined;
  const showDoneQuickAction = showDoneState && showActions && onToggleDoneRequest !== undefined && !multiSelectEnabled;
  const selectCheckbox = showSelectCheckbox ? (
    <Checkbox
      checked={selected}
      aria-label={`Select thread ${threadLabel}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleSelect?.(chat._id, event.shiftKey);
      }}
      className="pointer-events-auto cursor-pointer"
    />
  ) : null;
  const doneQuickAction = showDoneQuickAction ? <ThreadDoneQuickAction chat={chat} onToggleDoneRequest={onToggleDoneRequest} /> : null;

  if (compactLayout) {
    const compactRow = (
      <div
        className={cn(
          "group relative border-border bg-card transition-colors hover:bg-muted",
          rowClassName,
          isActive && "bg-primary/10 hover:bg-primary/10",
          selected && "bg-muted/50",
          showDoneState && chat.isDone && "opacity-60 hover:opacity-100"
        )}
      >
        <AppLink
          href={threadTarget}
          className="absolute inset-0 z-0"
          target={linkTarget}
          rel={linkRel}
          aria-current={isActive ? "page" : undefined}
          onClick={() => onSelectThread?.(chat._id, isActive)}
        >
          <span className="sr-only">Open thread {threadLabel}</span>
        </AppLink>
        <CompactThreadRowContent
          title={chat.title}
          status={displayStatus}
          cliType={chat.cliType}
          lastActivityAt={chat.lastActivityAt}
          isUnread={chat.hasUnread}
          isDone={showDoneState && chat.isDone}
          forceStatusIndicator={showStatusIndicator}
          agent={chat.agent}
          leadingControl={selectCheckbox}
          titlePrefix={
            (showAssociatedTask && associatedTask) || chat.attachedPullRequest || pullRequests.length > 0 || isShared || isWorkflowRun || chat.background ? (
              <>
                {workflowBadge}
                {chat.background ? <ThreadBackgroundRowBadge background={chat.background} /> : null}
                {showAssociatedTask && associatedTask ? (
                  <ThreadTaskRefLink
                    task={associatedTask}
                    href={associatedTaskHref}
                    onNavigate={associatedTaskNavigate}
                    className="pointer-events-auto max-w-fit shrink-0"
                  />
                ) : null}
                {attachedPrBadge}
                <ThreadPrBadges pullRequests={pullRequests} />
                {isShared ? <ThreadSharedRowBadge /> : null}
              </>
            ) : undefined
          }
          actions={
            showActions ? (
              <>
                {doneQuickAction}
                <ThreadActionsMenu
                  chat={chat}
                  isCurrentThread={isActive}
                  organizationSlug={organizationSlug}
                  projectAlias={projectAlias}
                  onRenameRequest={onRenameRequest}
                  onToggleReadRequest={onToggleReadRequest}
                  onToggleDoneRequest={onToggleDoneRequest}
                  onPinRequest={onPinRequest}
                  onDeleteRequest={onDeleteRequest}
                  triggerIcon="horizontal"
                  triggerClassName="pointer-events-auto size-4 rounded-sm border-transparent bg-transparent shadow-none hover:bg-transparent dark:hover:bg-transparent [&_svg]:size-3"
                />
              </>
            ) : undefined
          }
          className={innerClassName}
        />
      </div>
    );

    const compactRowWithBranch = branchLabel ? (
      <CompactThreadBranchPopover
        branch={branchLabel}
        pathLabel={chat.pathLabel}
        pathString={chat.pathString}
        gitRemoteUrl={chat.gitRemoteUrl}
        linesAdded={chat.linesAdded}
        linesRemoved={chat.linesRemoved}
        pullRequests={pullRequests}
        agent={chat.agent}
        lastActivityAt={chat.lastActivityAt}
        title={threadLabel}
      >
        {compactRow}
      </CompactThreadBranchPopover>
    ) : (
      compactRow
    );

    if (!showActions) {
      return compactRowWithBranch;
    }

    const compactContextMenuTrigger = branchLabel ? (
      <CompactThreadBranchPopover
        branch={branchLabel}
        pathLabel={chat.pathLabel}
        pathString={chat.pathString}
        gitRemoteUrl={chat.gitRemoteUrl}
        linesAdded={chat.linesAdded}
        linesRemoved={chat.linesRemoved}
        pullRequests={pullRequests}
        agent={chat.agent}
        lastActivityAt={chat.lastActivityAt}
        title={threadLabel}
        contextMenuTrigger
      >
        {compactRow}
      </CompactThreadBranchPopover>
    ) : (
      compactRow
    );

    return (
      <ThreadItemContextMenu
        chat={chat}
        isCurrentThread={isActive}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        triggerIsComposed={Boolean(branchLabel)}
        onRenameRequest={onRenameRequest}
        onToggleReadRequest={onToggleReadRequest}
        onToggleDoneRequest={onToggleDoneRequest}
        onPinRequest={onPinRequest}
        onDeleteRequest={onDeleteRequest}
      >
        {compactContextMenuTrigger}
      </ThreadItemContextMenu>
    );
  }

  const fullRowHighlight = getFullRowHighlight(displayStatus, chat.hasUnread);
  const fullRow = (
    <div
      className={cn(
        "group relative mx-2 my-1 overflow-hidden rounded-lg bg-muted/50 transition-colors hover:bg-muted",
        rowClassName,
        isActive &&
          "bg-primary/10 ring-1 ring-inset ring-primary/20 hover:bg-primary/10",
        selected && "bg-muted/70",
        showDoneState && chat.isDone && "opacity-60 hover:opacity-100"
      )}
    >
      {fullRowHighlight ? (
        <div
          aria-hidden
          data-thread-card-highlight={fullRowHighlight.key}
          className={cn(
            "pointer-events-none absolute -bottom-10 -right-10 size-24 rounded-full opacity-30 blur-3xl",
            fullRowHighlight.className
          )}
        />
      ) : null}
      <AppLink
        href={threadTarget}
        className="absolute inset-0 z-0 rounded-lg"
        target={linkTarget}
        rel={linkRel}
        aria-current={isActive ? "page" : undefined}
        onClick={() => onSelectThread?.(chat._id, isActive)}
      >
        <span className="sr-only">Open thread {threadLabel}</span>
      </AppLink>
      <div className="relative z-10 px-3 py-2.5 pointer-events-none">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {showSelectCheckbox && <span className="flex size-5 shrink-0 items-center justify-center">{selectCheckbox}</span>}
            {showDoneState && chat.isDone ? (
              <span title="Done" className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                <Check className="size-3.5" />
              </span>
            ) : null}
            {showAssociatedTask && associatedTask ? (
              <ThreadTaskRefLink
                task={associatedTask}
                href={associatedTaskHref}
                onNavigate={associatedTaskNavigate}
                className="pointer-events-auto max-w-fit shrink-0"
              />
            ) : null}
            {attachedPrBadge}
            <h4 className="min-w-0 truncate text-sm font-medium leading-5 text-foreground" title={threadLabel}>
              <SlashCommandDisplayText text={chat.title || "New thread"} highlightCommands={false} />
            </h4>
          </div>
          {displayStatus === "completed" ? (
            <span className="grid shrink-0 items-center justify-items-end">
              <span
                className={cn(
                  "col-start-1 row-start-1 flex items-center gap-1.5 text-xs text-muted-foreground/70",
                  showDoneQuickAction && "group-hover:hidden group-has-[[data-state=open]]:hidden"
                )}
              >
                {chat.hasUnread && <ThreadStatusIndicator status="completed" isUnread />}
                {formatRelativeTime(chat.lastActivityAt)}
              </span>
              {showDoneQuickAction ? (
                <span className="invisible col-start-1 row-start-1 flex items-center group-hover:visible group-has-[[data-state=open]]:visible [&_*]:transition-none">
                  {doneQuickAction}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="grid shrink-0 items-center justify-items-end">
              <span
                className={cn(
                  "col-start-1 row-start-1 flex items-center gap-1.5 text-xs font-medium",
                  showDoneQuickAction
                    ? "group-hover:hidden group-has-[[data-state=open]]:hidden"
                    : "group-hover:invisible group-has-[[data-state=open]]:invisible",
                  THREAD_STATUS_META[displayStatus].className
                )}
              >
                <ThreadStatusIndicator status={displayStatus} isUnread={chat.hasUnread} />
                {THREAD_STATUS_META[displayStatus].label}
              </span>
              {showDoneQuickAction ? (
                <span className="invisible col-start-1 row-start-1 flex items-center group-hover:visible group-has-[[data-state=open]]:visible [&_*]:transition-none">
                  {doneQuickAction}
                </span>
              ) : (
                <span className="invisible col-start-1 row-start-1 text-xs text-muted-foreground/70 group-hover:visible group-has-[[data-state=open]]:visible">
                  {formatRelativeTime(chat.lastActivityAt)}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          {branchLabel || pullRequests.length > 0 || isShared || isWorkflowRun || chat.background ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {workflowBadge}
              {chat.background ? <ThreadBackgroundRowBadge background={chat.background} /> : null}
              <ThreadPrBadges pullRequests={pullRequests} />
              {isShared ? <ThreadSharedRowBadge /> : null}
              {branchLabel ? (
                <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground/70" title={branchLabel.title}>
                  <GitBranch className="size-3.5 shrink-0" />
                  <span className={cn("truncate", branchLabel.branch && "font-mono")}>{branchLabel.text}</span>
                </span>
              ) : null}
            </span>
          ) : (
            <span />
          )}
          <span className="grid shrink-0 items-center">
            {/* `data-state=open` latches the swap while the action menu is
                open, so the pointer moving off the row toward the menu doesn't
                restore the agent/CLI layer under a still-open menu (OS-1596).
                Unlike compact rows this layer only toggles `visibility`, so the
                trigger keeps its box and the menu stays anchored either way. */}
            <span
              className={cn(
                "col-start-1 row-start-1 flex items-center justify-end gap-1.5",
                showActions && "group-hover:invisible group-has-[[data-state=open]]:invisible"
              )}
            >
              {chat.agent ? <ThreadAgentChip agent={chat.agent} compact /> : null}
              {renderCliIcon(chat.cliType, "size-3.5 shrink-0 text-muted-foreground")}
            </span>
            {showActions && (
              <span className="invisible col-start-1 row-start-1 flex items-center justify-end group-hover:visible group-has-[[data-state=open]]:visible [&_*]:transition-none">
                <ThreadActionsMenu
                  chat={chat}
                  isCurrentThread={isActive}
                  organizationSlug={organizationSlug}
                  projectAlias={projectAlias}
                  onRenameRequest={onRenameRequest}
                  onToggleReadRequest={onToggleReadRequest}
                  onToggleDoneRequest={onToggleDoneRequest}
                  onPinRequest={onPinRequest}
                  onDeleteRequest={onDeleteRequest}
                  triggerIcon="horizontal"
                  triggerClassName="pointer-events-auto size-4 rounded-sm border-transparent bg-transparent shadow-none [&_svg]:size-3"
                />
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );

  if (!showActions) {
    return fullRow;
  }

  return (
    <ThreadItemContextMenu
      chat={chat}
      isCurrentThread={isActive}
      organizationSlug={organizationSlug}
      projectAlias={projectAlias}
      onRenameRequest={onRenameRequest}
      onToggleReadRequest={onToggleReadRequest}
      onToggleDoneRequest={onToggleDoneRequest}
      onPinRequest={onPinRequest}
      onDeleteRequest={onDeleteRequest}
    >
      {fullRow}
    </ThreadItemContextMenu>
  );
}

function areThreadListItemPropsEqual(prevProps: ThreadListItemProps, nextProps: ThreadListItemProps): boolean {
  return (
    // Every field of the row's data, derived from the interface rather than
    // listed here, so a new field can't quietly go unrendered (OS-1581).
    areThreadListItemsEqual(prevProps.chat, nextProps.chat) &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.compactLayout === nextProps.compactLayout &&
    prevProps.organizationSlug === nextProps.organizationSlug &&
    prevProps.projectAlias === nextProps.projectAlias &&
    prevProps.showAssociatedTask === nextProps.showAssociatedTask &&
    prevProps.linkTarget === nextProps.linkTarget &&
    prevProps.linkRel === nextProps.linkRel &&
    prevProps.onSelectThread === nextProps.onSelectThread &&
    prevProps.onRenameRequest === nextProps.onRenameRequest &&
    prevProps.onToggleReadRequest === nextProps.onToggleReadRequest &&
    prevProps.onToggleDoneRequest === nextProps.onToggleDoneRequest &&
    prevProps.onPinRequest === nextProps.onPinRequest &&
    prevProps.onDeleteRequest === nextProps.onDeleteRequest &&
    prevProps.showActions === nextProps.showActions &&
    prevProps.showStatusIndicator === nextProps.showStatusIndicator &&
    prevProps.showDoneState === nextProps.showDoneState &&
    prevProps.rowClassName === nextProps.rowClassName &&
    prevProps.innerClassName === nextProps.innerClassName &&
    prevProps.multiSelectEnabled === nextProps.multiSelectEnabled &&
    prevProps.selected === nextProps.selected &&
    prevProps.onToggleSelect === nextProps.onToggleSelect
  );
}

export const ThreadListItem = memo(ThreadListItemComponent, areThreadListItemPropsEqual);
