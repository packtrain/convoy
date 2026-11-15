"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/custom/action-button";
import { showConvexErrorToast } from "@/lib/errors";
import { toast } from "sonner";

interface RenameProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: Id<"cliProfiles"> | undefined;
  currentName: string;
  hostname?: string;
  profileKey?: string;
  onRename: (profileId: Id<"cliProfiles">, name: string) => Promise<void>;
}

function buildFallbackLabel(hostname?: string, profileKey?: string): string | null {
  const normalizedHostname = hostname?.trim();
  if (normalizedHostname) {
    return `hostname (${normalizedHostname})`;
  }

  const normalizedProfileKey = profileKey?.trim();
  if (normalizedProfileKey) {
    return `profile key (${normalizedProfileKey})`;
  }

  return null;
}

export function RenameProfileDialog({
  open,
  onOpenChange,
  profileId,
  currentName,
  hostname,
  profileKey,
  onRename,
}: RenameProfileDialogProps) {
  const [name, setName] = useState(currentName);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(currentName);
    }
  }, [open, currentName]);

  const fallbackLabel = buildFallbackLabel(hostname, profileKey);
  const isInvalid = !profileId;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!profileId || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      await onRename(profileId, name);
      toast.success("Profile renamed");
      onOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, "Failed to rename profile");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rename profile</DialogTitle>
            <DialogDescription>
              {fallbackLabel
                ? `Leave empty to reset to ${fallbackLabel}.`
                : "Enter a name for this profile."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <ActionButton busy={isSaving} disabled={isInvalid}>
              Save
            </ActionButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
