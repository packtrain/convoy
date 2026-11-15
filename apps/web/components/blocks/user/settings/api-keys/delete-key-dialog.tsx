"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
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
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";

interface DeleteKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeyId: Id<"apiKeys">;
  apiKeyName: string;
}

export function DeleteKeyDialog({
  open,
  onOpenChange,
  apiKeyId,
  apiKeyName,
}: DeleteKeyDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteKey = useMutation(api.apiKeys.core.deleteKey);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteKey({ id: apiKeyId });
      toast.success("API key deleted");
      onOpenChange(false);
    } catch (error) {
      const message = getErrorMessage(error, "Failed to delete API key");
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete API key</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to permanently delete &quot;{apiKeyName}&quot;?
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            variant="destructive"
          >
            {isDeleting ? "Deleting…" : "Delete key"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
