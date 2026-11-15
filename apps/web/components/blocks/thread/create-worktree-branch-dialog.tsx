"use client";

import { useState, type FormEvent } from "react";
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
import { getWorktreeBranchNameError } from "@/lib/threads/worktree-branches";

interface CreateWorktreeBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Base the new branch starts from; absent = the repo's default branch. */
  baseRef?: string;
  onCreate: (branchName: string) => void;
}

/**
 * Codex-style named-branch dialog for a new worktree. Nothing runs here —
 * the branch and worktree are created by the CLI when the thread starts.
 */
export function CreateWorktreeBranchDialog({
  open,
  onOpenChange,
  baseRef,
  onCreate,
}: CreateWorktreeBranchDialogProps) {
  // The parent remounts this dialog per open (via `key`), so the field
  // starts empty each time without an effect.
  const [name, setName] = useState("");

  const trimmed = name.trim();
  const error = getWorktreeBranchNameError(trimmed);
  const canCreate = trimmed.length > 0 && !error;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canCreate) {
      return;
    }
    onCreate(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create branch in new worktree</DialogTitle>
            <DialogDescription>
              Based on {baseRef ? <code>{baseRef}</code> : "the default branch"}.
              The branch and worktree are created when the thread starts.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="worktree-branch-name">Branch name</Label>
            <Input
              id="worktree-branch-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="feat/my-change"
              className="mt-2"
              autoFocus
            />
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={!canCreate}>
              Create worktree
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
