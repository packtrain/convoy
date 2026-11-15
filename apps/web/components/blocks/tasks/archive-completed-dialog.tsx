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

interface ArchiveCompletedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completedTaskCount: number;
  onConfirm: () => void;
}

export function ArchiveCompletedDialog({
  open,
  onOpenChange,
  completedTaskCount,
  onConfirm,
}: ArchiveCompletedDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Archive {completedTaskCount} completed task{completedTaskCount !== 1 ? "s" : ""}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will archive all tasks with &quot;Done&quot; or &quot;Canceled&quot; status.
            Archived tasks can be viewed in the archived filter.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
