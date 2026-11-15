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
import { Button } from "@/components/ui/button";

interface BulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  totalSubtaskCount: number;
  onKeepChildren: () => void;
  onDeleteAll: () => void;
}

export function BulkDeleteDialog({
  open,
  onOpenChange,
  selectedCount,
  totalSubtaskCount,
  onKeepChildren,
  onDeleteAll,
}: BulkDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {selectedCount} task{selectedCount !== 1 ? "s" : ""}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {totalSubtaskCount > 0 ? (
              <>
                These tasks have {totalSubtaskCount} subtask
                {totalSubtaskCount !== 1 ? "s" : ""} in total. What would you
                like to do with them?
              </>
            ) : (
              "This action cannot be undone."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {totalSubtaskCount > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                onKeepChildren();
                onOpenChange(false);
              }}
            >
              Keep all subtasks
            </Button>
          )}
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onDeleteAll();
              onOpenChange(false);
            }}
          >
            Delete {totalSubtaskCount > 0 ? "all" : ""}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
