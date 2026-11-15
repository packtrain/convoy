"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { THREAD_TITLE_MAX_LENGTH } from "@/lib/threads/constants";
import { showConvexErrorToast } from "@/lib/errors";
import { toast } from "sonner";

interface RenameThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: Id<"cliThreads"> | undefined;
  currentTitle: string;
  onRename: (threadId: Id<"cliThreads">, title: string) => Promise<void>;
}

export function RenameThreadDialog({
  open,
  onOpenChange,
  threadId,
  currentTitle,
  onRename,
}: RenameThreadDialogProps) {
  const [title, setTitle] = useState(currentTitle);
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(currentTitle);
    }
  }, [open, currentTitle]);

  const normalizedTitle = useMemo(() => title.trim(), [title]);
  const normalizedCurrentTitle = useMemo(() => currentTitle.trim(), [currentTitle]);
  const isUnchanged = normalizedTitle === normalizedCurrentTitle;
  const isInvalid = !threadId || normalizedTitle.length < 1 || isUnchanged;

  const handleRename = async (event: FormEvent) => {
    event.preventDefault();
    if (isInvalid || !threadId) {
      return;
    }

    setIsRenaming(true);
    try {
      await onRename(threadId, normalizedTitle);
      toast.success("Thread renamed");
      onOpenChange(false);
    } catch (error) {
      showConvexErrorToast(error, "Failed to rename thread");
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No description: the title field speaks for itself. */}
      <DialogContent aria-describedby={undefined}>
        <form onSubmit={handleRename}>
          <DialogHeader>
            <DialogTitle>Rename thread</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              id="thread-title"
              aria-label="New thread title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={THREAD_TITLE_MAX_LENGTH}
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
            <Button type="submit" disabled={isInvalid || isRenaming}>
              {isRenaming ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
