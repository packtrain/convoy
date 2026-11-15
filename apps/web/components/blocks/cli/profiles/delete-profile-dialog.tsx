"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
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

export function DeleteProfileDialog({
  profile,
  onOpenChange,
}: {
  profile: { _id: Id<"cliProfiles">; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const removeProfile = useMutation(api.cli.profiles.remove);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!profile || isDeleting) return;

    setIsDeleting(true);
    try {
      await removeProfile({ profileId: profile._id });
      onOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, "Failed to delete profile");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={profile !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete profile?</AlertDialogTitle>
          <AlertDialogDescription>
            &quot;{profile?.name}&quot; will be removed from active working directory selectors. Existing threads will keep their current context metadata.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={isDeleting} variant="destructive">
            {isDeleting ? "Deleting..." : "Delete profile"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
