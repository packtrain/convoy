"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface RunUndoConfirmDialogProps {
  open: boolean;
  fileCount: number;
  /** When set, only this file reverts (OS-1156) — the copy names it. */
  filePath?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** Destructive confirmation for reverting a run — or one file — to its pre-run state (OS-1151/OS-1156). */
export function RunUndoConfirmDialog({
  open,
  fileCount,
  filePath,
  onOpenChange,
  onConfirm,
}: RunUndoConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {filePath ? "Revert this file?" : "Undo this run's changes?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {filePath ? (
              <>
                This restores <span className="font-mono break-all">{filePath}</span> to
                its state before this run — including any edits made to it
                since, by later runs or by you. This cannot be undone.
              </>
            ) : (
              <>
                This restores the working directory to its state before this
                run ({fileCount} {fileCount === 1 ? "file" : "files"}). Anything
                changed since — later runs and your own uncommitted edits — is
                discarded too. This cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {filePath ? "Revert file" : "Undo changes"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
