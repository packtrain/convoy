"use client";

import type { CliProfilePathEntry } from "@/convex/lib/contracts/validators";
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

/** Confirms removing one worktree from disk; the branch survives (OS-2459). */
export function RemoveWorktreeDialog({
  worktree,
  onClose,
  onConfirm,
}: {
  worktree: CliProfilePathEntry | null;
  onClose: () => void;
  onConfirm: (worktree: CliProfilePathEntry) => void;
}) {
  const branch = worktree?.branch ?? worktree?.label;
  return (
    <AlertDialog open={worktree !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove worktree {branch}?</AlertDialogTitle>
          <AlertDialogDescription>
            {worktree?.path} will be deleted from disk. The branch {branch} is kept, so its commits stay. A worktree with
            uncommitted changes can&apos;t be removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (worktree) {
                onConfirm(worktree);
              }
              onClose();
            }}
          >
            Remove worktree
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
