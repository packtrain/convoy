"use client";

import { useMemo } from "react";
import { ListFilter, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  ArtifactCommentThread as Thread,
} from "@/lib/tasks/hooks/comments/use-artifact-comments";
import type { CommentAnchor } from "./lib/locate-anchor";

import { ArtifactCommentComposer } from "./artifact-comment-composer";
import { ArtifactCommentThread } from "./artifact-comment-thread";

export type CommentSort = "newest" | "oldest" | "natural";

/** A new comment being composed; `anchor: null` = general (no selection). */
export interface PendingArtifactComment {
  anchor: CommentAnchor | null;
}

const SORT_LABELS: Record<CommentSort, string> = {
  natural: "Document order",
  newest: "Newest first",
  oldest: "Oldest first",
};

interface ArtifactCommentsRailProps {
  threads: Thread[];
  detachedIds: ReadonlySet<string>;
  /** Document start offset per located root comment id (drives natural sort). */
  anchorPositions: ReadonlyMap<string, number>;
  sort: CommentSort;
  onSortChange: (sort: CommentSort) => void;
  activeId: Id<"artifactComments"> | null;
  onActivate: (id: Id<"artifactComments">) => void;
  /** New comment being composed (anchored or general); renders the composer. */
  pending: PendingArtifactComment | null;
  onSubmitPending: (content: string) => Promise<void>;
  onCancelPending: () => void;
  /** Opens the composer for a general comment (the "+" header button). */
  onStartGeneralComment: () => void;
  showResolved: boolean;
  onShowResolvedChange: (show: boolean) => void;
  onReply: (parentId: Id<"artifactComments">, content: string) => Promise<unknown>;
  onUpdate: (commentId: Id<"artifactComments">, content: string) => Promise<void>;
  onDelete: (commentId: Id<"artifactComments">) => Promise<void>;
  onSetStatus: (commentId: Id<"artifactComments">, status: "open" | "resolved") => Promise<void>;
  /** Hides every mutation control (reply, resolve, edit, delete) — e.g. archived tasks. */
  readOnly?: boolean;
  /** Extra header control rendered next to the filter (e.g. send-to-thread). */
  headerAction?: React.ReactNode;
  /** Header height in px, matched to the editor toolbar so the divider lines align. */
  headerHeight?: number;
  style?: React.CSSProperties;
  className?: string;
}

export function ArtifactCommentsRail({
  threads,
  detachedIds,
  anchorPositions,
  sort,
  onSortChange,
  activeId,
  onActivate,
  pending,
  onSubmitPending,
  onCancelPending,
  onStartGeneralComment,
  showResolved,
  onShowResolvedChange,
  onReply,
  onUpdate,
  onDelete,
  onSetStatus,
  readOnly = false,
  headerAction,
  headerHeight,
  style,
  className,
}: ArtifactCommentsRailProps) {
  const { anchored, detached, pendingIndex } = useMemo(() => {
    const visible = showResolved
      ? threads
      : threads.filter((t) => t.root.status !== "resolved");
    const byCreatedAt = (a: Thread, b: Thread) =>
      sort === "newest"
        ? b.root.createdAt - a.root.createdAt
        : a.root.createdAt - b.root.createdAt;
    const position = (t: Thread) => anchorPositions.get(t.root._id) ?? Infinity;
    const compare = (a: Thread, b: Thread) =>
      sort === "natural"
        ? position(a) - position(b) || byCreatedAt(a, b)
        : byCreatedAt(a, b);

    const anchoredThreads = visible
      .filter((t) => !detachedIds.has(t.root._id))
      .sort(compare);
    // Where the new-comment composer sits so it matches the selected sort.
    // A general (anchor-less) comment has no document position, so it lands
    // where its thread will sort: top for newest-first, bottom otherwise
    // (natural sort puts unlocated threads last).
    const pendingAnchor = pending?.anchor ?? null;
    const index = !pending
      ? 0
      : sort === "newest"
        ? 0
        : sort === "oldest" || !pendingAnchor
          ? anchoredThreads.length
          : anchoredThreads.filter((t) => position(t) < pendingAnchor.startOffset).length;

    return {
      anchored: anchoredThreads,
      detached: visible.filter((t) => detachedIds.has(t.root._id)).sort(byCreatedAt),
      pendingIndex: index,
    };
  }, [threads, detachedIds, showResolved, sort, anchorPositions, pending]);

  const renderThread = (thread: Thread) => (
    <ArtifactCommentThread
      key={thread.root._id}
      thread={thread}
      isActive={thread.root._id === activeId}
      onActivate={() => onActivate(thread.root._id)}
      readOnly={readOnly}
      onReply={onReply}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onSetStatus={onSetStatus}
    />
  );

  return (
    <div style={style} className={cn("flex h-full min-h-0 flex-col", className)}>
      <div
        className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3"
        style={headerHeight ? { height: headerHeight } : undefined}
      >
        <span className="text-sm font-medium text-foreground">Comments</span>
        <div className="flex items-center gap-1">
          {headerAction}
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer text-muted-foreground hover:text-foreground"
              aria-label="Add comment"
              title="Add comment"
              onClick={onStartGeneralComment}
            >
              <Plus />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "cursor-pointer text-muted-foreground hover:text-foreground",
                  !showResolved && "bg-accent text-foreground"
                )}
                aria-label="Filter comments"
                title="Filter comments"
              >
                <ListFilter />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked disabled>
                Open
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showResolved}
                onCheckedChange={(checked) => onShowResolvedChange(checked === true)}
                className="cursor-pointer"
              >
                Resolved
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Sort</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => onSortChange(value as CommentSort)}
              >
                {(Object.keys(SORT_LABELS) as CommentSort[]).map((key) => (
                  <DropdownMenuRadioItem key={key} value={key} className="cursor-pointer">
                    {SORT_LABELS[key]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {anchored.length === 0 && detached.length === 0 && !pending && (
          <p className="px-3 pt-4 text-center text-sm text-muted-foreground">
            {readOnly
              ? "No comments yet."
              : "Select text in the document or use + to leave a comment."}
          </p>
        )}

        {anchored.slice(0, pendingIndex).map(renderThread)}

        {pending && (
          <div className="px-3 py-3">
            <div className="mb-1.5 flex items-start justify-between gap-2">
              {pending.anchor ? (
                <blockquote className="min-w-0 flex-1 truncate border-l-2 border-highlight pl-2 text-sm text-muted-foreground">
                  {pending.anchor.text}
                </blockquote>
              ) : (
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  New comment
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-5 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label="Cancel comment"
                onClick={onCancelPending}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <ArtifactCommentComposer
              placeholder="Add a comment…"
              onSubmit={onSubmitPending}
              onCancel={onCancelPending}
            />
          </div>
        )}

        {anchored.slice(pendingIndex).map(renderThread)}

        {detached.length > 0 && (
          <>
            <div className="px-3 pb-3 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Detached — original text no longer found
            </div>
            {detached.map(renderThread)}
          </>
        )}
      </div>
    </div>
  );
}
