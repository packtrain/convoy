"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { formatAbsoluteTime } from "@/lib/format-relative-time";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/custom/spinner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { CommentAttachments } from "./comment-attachments";
import type { Comment } from "@/lib/tasks/types";
import type { Id } from "@/convex/_generated/dataModel";

const COLLAPSED_COMMENT_HEIGHT_PX = 112;

interface CommentItemProps {
  comment: Comment;
  onUpdate: (commentId: Id<"taskComments">, content: string) => Promise<void>;
  onDelete: (commentId: Id<"taskComments">) => Promise<void>;
}

export function CommentItem({ comment, onUpdate, onDelete }: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const commentBodyRef = useRef<HTMLDivElement>(null);

  const timeAgo = formatDistanceToNow(new Date(comment.createdAt), {
    addSuffix: true,
  });

  const updateOverflowState = useCallback(() => {
    const commentBody = commentBodyRef.current;
    if (!commentBody) {
      setIsOverflowing(false);
      return;
    }

    setIsOverflowing(commentBody.scrollHeight > COLLAPSED_COMMENT_HEIGHT_PX);
  }, []);

  useLayoutEffect(() => {
    if (isEditing) {
      return;
    }

    updateOverflowState();
    const commentBody = commentBodyRef.current;
    if (!commentBody || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateOverflowState();
    });
    observer.observe(commentBody);
    return () => observer.disconnect();
  }, [comment.content, isEditing, updateOverflowState]);

  useLayoutEffect(() => {
    setIsExpanded(false);
  }, [comment.content, comment._id]);

  const handleSaveEdit = async () => {
    if (!editContent.trim() || editContent === comment.content) {
      setIsEditing(false);
      setEditContent(comment.content);
      return;
    }

    setIsSaving(true);
    try {
      await onUpdate(comment._id, editContent.trim());
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(comment.content);
  };

  const handleDelete = async () => {
    setIsSaving(true);
    try {
      await onDelete(comment._id);
    } finally {
      setIsSaving(false);
      setIsDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const isCollapsedOverflowing = !isExpanded && isOverflowing;
  const expandComment = () => setIsExpanded(true);

  const shouldIgnoreExpandEvent = (
    target: EventTarget | null,
    currentTarget: HTMLDivElement
  ) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const interactiveParent = target.closest(
      "a,button,input,textarea,select,summary,[role='button'],[role='link']"
    );
    return interactiveParent !== null && interactiveParent !== currentTarget;
  };

  const handleExpandClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isCollapsedOverflowing) {
      return;
    }
    if (shouldIgnoreExpandEvent(event.target, event.currentTarget)) {
      return;
    }
    expandComment();
  };

  const handleExpandKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isCollapsedOverflowing || event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      expandComment();
    }
  };

  return (
    <div className="group flex gap-3">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={comment.authorAvatarUrl ?? undefined} />
        <AvatarFallback className="text-xs">
          {comment.authorName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {comment.authorName}
          </span>
          <span className="text-xs text-muted-foreground" title={formatAbsoluteTime(comment.createdAt)}>{timeAgo}</span>
          {comment.isEdited && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>

        {isEditing ? (
          <InputGroup className="mt-1">
            <InputGroupTextarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              rows={2}
              className="min-h-0 text-sm"
            />
            <InputGroupAddon align="block-end">
              <InputGroupButton
                className="ml-auto"
                onClick={handleCancelEdit}
                disabled={isSaving}
              >
                Cancel
              </InputGroupButton>
              <InputGroupButton
                variant="default"
                onClick={handleSaveEdit}
                disabled={isSaving || !editContent.trim()}
              >
                {isSaving ? <Spinner className="size-3.5" /> : null}
                Save
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        ) : (
          <>
            <div className="mt-1">
              <div
                ref={commentBodyRef}
                data-testid={isCollapsedOverflowing ? "comment-expandable-area" : undefined}
                onClick={isCollapsedOverflowing ? handleExpandClick : undefined}
                onKeyDown={isCollapsedOverflowing ? handleExpandKeyDown : undefined}
                role={isCollapsedOverflowing ? "button" : undefined}
                tabIndex={isCollapsedOverflowing ? 0 : undefined}
                aria-label={isCollapsedOverflowing ? "Expand comment" : undefined}
                className={cn(
                  "relative",
                  isCollapsedOverflowing && "group/comment-expand cursor-pointer overflow-hidden"
                )}
                style={
                  isCollapsedOverflowing
                    ? { maxHeight: `${COLLAPSED_COMMENT_HEIGHT_PX}px` }
                    : undefined
                }
              >
                <MessageResponse
                  className="text-sm text-foreground break-words [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-tight [&_h3]:text-base [&_h3]:font-semibold"
                >
                  {comment.content}
                </MessageResponse>
                {isCollapsedOverflowing && (
                  <div
                    aria-hidden
                    data-testid="comment-fade-overlay"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-background"
                  />
                )}
                {isCollapsedOverflowing && (
                  <div
                    aria-hidden
                    data-testid="comment-expand-hint"
                    className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center opacity-0 transition-opacity group-hover/comment-expand:opacity-100 group-focus-visible/comment-expand:opacity-100"
                  >
                    <span className="rounded-full border border-border bg-background/90 px-3 py-1 text-xs text-foreground shadow-xs">
                      Click to expand
                    </span>
                  </div>
                )}
              </div>
            </div>
            {comment.attachments.length > 0 && (
              <div className="mt-2">
                <CommentAttachments attachments={comment.attachments} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions dropdown - positioned on far right */}
      {(comment.canEdit || comment.canDelete) && !isEditing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Comment actions"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {comment.canEdit && (
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
            )}
            {comment.canDelete && (
              <DropdownMenuItem
                onClick={() => setIsDeleting(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={isDeleting} onOpenChange={setIsDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this comment. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isSaving}>
              {isSaving ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
