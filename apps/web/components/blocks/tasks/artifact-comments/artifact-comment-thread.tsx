"use client";

import { useState } from "react";
import { useAppUser } from "@/lib/auth/hooks";
import { formatDistanceToNow } from "date-fns";
import { formatAbsoluteTime } from "@/lib/format-relative-time";
import { Check, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { ArtifactCommentComposer } from "./artifact-comment-composer";
import type {
  ArtifactComment,
  ArtifactCommentThread as Thread,
} from "@/lib/tasks/hooks/comments/use-artifact-comments";
import type { Id } from "@/convex/_generated/dataModel";

interface ThreadCallbacks {
  onReply: (parentId: Id<"artifactComments">, content: string) => Promise<unknown>;
  onUpdate: (commentId: Id<"artifactComments">, content: string) => Promise<void>;
  onDelete: (commentId: Id<"artifactComments">) => Promise<void>;
  onSetStatus: (commentId: Id<"artifactComments">, status: "open" | "resolved") => Promise<void>;
}

interface ArtifactCommentThreadProps extends ThreadCallbacks {
  thread: Thread;
  isActive: boolean;
  onActivate: () => void;
  /** Hides every mutation control (reply, resolve, edit, delete) — e.g. archived tasks. */
  readOnly?: boolean;
}

function CommentAvatar({ name, url }: { name: string; url: string | null }) {
  return (
    <Avatar className="size-6 shrink-0">
      <AvatarImage src={url ?? undefined} />
      <AvatarFallback className="text-[10px]">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/**
 * One comment row (root or reply — identical layout, no indent for replies):
 * avatar + name + time header, optional quote, body.
 */
function CommentBody({
  comment,
  quote,
  headerAction,
  readOnly = false,
  onUpdate,
  onDelete,
}: {
  comment: ArtifactComment;
  quote?: string;
  /** Extra control rendered in the header row before the actions menu (e.g. resolve). */
  headerAction?: React.ReactNode;
  readOnly?: boolean;
  onUpdate: ThreadCallbacks["onUpdate"];
  onDelete: ThreadCallbacks["onDelete"];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(comment._id);
      setIsConfirmingDelete(false);
    } catch {
      toast.error("Failed to delete comment");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="group/comment">
      <div className="flex items-center gap-2">
        <CommentAvatar name={comment.authorName} url={comment.authorAvatarUrl} />
        <span className="truncate text-sm font-medium text-foreground">{comment.authorName}</span>
        <span className="shrink-0 text-xs text-muted-foreground" title={formatAbsoluteTime(comment.createdAt)}>
          {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
        </span>
        {comment.isEdited && <span className="shrink-0 text-xs text-muted-foreground">(edited)</span>}
        <span className="flex-1" />
        {headerAction}
        {!readOnly && (comment.canEdit || comment.canDelete) && !isEditing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Comment actions"
                className="size-5 shrink-0 cursor-pointer opacity-0 transition-opacity group-hover/comment:opacity-100 group-focus-within/comment:opacity-100 data-[state=open]:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {comment.canEdit && (
                <DropdownMenuItem className="cursor-pointer" onClick={() => setIsEditing(true)}>
                  <Pencil className="mr-2 size-3.5" />
                  Edit
                </DropdownMenuItem>
              )}
              {comment.canDelete && (
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:text-destructive"
                  onClick={() => setIsConfirmingDelete(true)}
                >
                  <Trash2 className="mr-2 size-3.5" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <AlertDialog open={isConfirmingDelete} onOpenChange={setIsConfirmingDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              {comment.parentId
                ? "This will permanently delete the comment."
                : "This will permanently delete the comment and all its replies."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Body column aligned under the name, like Notion */}
      <div className="ml-8">
        {quote !== undefined && (
          <blockquote className="mt-1 border-l-2 border-highlight pl-2 text-sm text-muted-foreground">
            {quote}
          </blockquote>
        )}
        {isEditing ? (
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <ArtifactCommentComposer
              placeholder="Edit comment…"
              initialValue={comment.content}
              onSubmit={async (content) => {
                if (content !== comment.content) {
                  await onUpdate(comment._id, content);
                }
                setIsEditing(false);
              }}
              onCancel={() => setIsEditing(false)}
            />
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{comment.content}</p>
        )}
      </div>
    </div>
  );
}

export function ArtifactCommentThread({
  thread,
  isActive,
  onActivate,
  readOnly = false,
  onReply,
  onUpdate,
  onDelete,
  onSetStatus,
}: ArtifactCommentThreadProps) {
  const { root, replies } = thread;
  const { user } = useAppUser();
  const isResolved = root.status === "resolved";
  const [isReplying, setIsReplying] = useState(false);

  return (
    <div
      data-comment-id={root._id}
      onClick={onActivate}
      className={cn(
        "group/thread cursor-pointer px-3 py-3 transition-colors",
        isActive ? "bg-accent/40" : "hover:bg-accent/20",
        // Resolved threads fade strongly and only regain legibility on hover.
        isResolved && "opacity-35 transition-opacity hover:opacity-70"
      )}
    >
      <div className="space-y-3">
        <CommentBody
          comment={root}
          quote={root.anchor?.text}
          readOnly={readOnly}
          headerAction={
            readOnly ? undefined : (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-5 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground",
                  !isResolved && "opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100"
                )}
                title={isResolved ? "Unresolve" : "Resolve"}
                aria-label={isResolved ? "Unresolve comment" : "Resolve comment"}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetStatus(root._id, isResolved ? "open" : "resolved").catch(() =>
                    toast.error("Failed to update comment status")
                  );
                }}
              >
                {isResolved ? <RotateCcw className="size-3.5" /> : <Check className="size-4" />}
              </Button>
            )
          }
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
        {replies.map((reply) => (
          <CommentBody
            key={reply._id}
            comment={reply}
            readOnly={readOnly}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))}
      </div>

      {/* Reply affordance: avatar + placeholder row, expands into composer */}
      {readOnly ? null : isReplying ? (
        <div className="mt-3 flex items-start gap-2" onClick={(e) => e.stopPropagation()}>
          <CommentAvatar name={user?.fullName ?? "Me"} url={user?.imageUrl ?? null} />
          <div className="min-w-0 flex-1">
            <ArtifactCommentComposer
              placeholder="Reply…"
              onSubmit={async (content) => {
                await onReply(root._id, content);
                setIsReplying(false);
              }}
              onCancel={() => setIsReplying(false)}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="mt-3 flex w-full cursor-pointer items-center gap-2 text-left"
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
            setIsReplying(true);
          }}
        >
          <CommentAvatar name={user?.fullName ?? "Me"} url={user?.imageUrl ?? null} />
          <span className="text-sm text-muted-foreground">Reply…</span>
        </button>
      )}
    </div>
  );
}
