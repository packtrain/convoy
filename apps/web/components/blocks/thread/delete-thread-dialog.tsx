"use client";

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
import { threadDeleteDialogCopy } from "@/lib/threads/containers";
import type { ThreadListItemData } from "./thread-list-item";

interface DeleteThreadDialogProps {
  /** The row pending deletion; null renders the dialog closed. */
  thread: ThreadListItemData | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (thread: ThreadListItemData) => void;
}

/**
 * Single-thread delete confirmation, shared by the desktop sidebar and the
 * mobile thread list so the group-aware copy (OS-1476) can't drift between
 * surfaces.
 */
export function DeleteThreadDialog({ thread, onOpenChange, onConfirm }: DeleteThreadDialogProps) {
  const copy = threadDeleteDialogCopy(thread?.kind);

  return (
    <AlertDialog open={thread !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            &quot;{thread?.title}&quot;
            {copy.body} This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (thread) {
                onConfirm(thread);
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
