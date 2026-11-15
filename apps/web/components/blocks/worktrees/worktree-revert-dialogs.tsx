"use client";

import { useState } from "react";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
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
import { Input } from "@/components/ui/input";
import type { WorktreeChanges } from "@/lib/worktrees/hooks/use-worktree-changes";

/** The word the user types to unlock Revert all (OS-2234). */
const REVERT_ALL_CONFIRMATION = "revert";

/** Confirms discarding one file's uncommitted changes (OS-2043). */
export function RevertFileDialog({ state }: { state: WorktreeChanges }) {
  const target = state.revertTarget;
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && state.setRevertTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revert {target?.path}?</AlertDialogTitle>
          <AlertDialogDescription>
            {target?.kind === "added"
              ? "The file will be deleted from the working tree."
              : "Uncommitted changes to this file will be discarded."}{" "}
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={state.confirmRevert}>
            Revert
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function summarize(files: CliRunDiffFile[]): string {
  const count = (kind: CliRunDiffFile["kind"]) => files.filter((file) => file.kind === kind).length;
  const parts = [
    count("modified") > 0 && `${count("modified")} modified`,
    count("added") > 0 && `${plural(count("added"), "new file")} deleted`,
    count("deleted") > 0 && `${plural(count("deleted"), "deleted file")} restored`,
  ].filter(Boolean);
  return `${plural(files.length, "file")}: ${parts.join(", ")}.`;
}

/** Revert all, unlocked by typing "revert" (OS-2234). */
export function RevertAllDialog({ state }: { state: WorktreeChanges }) {
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toLowerCase() === REVERT_ALL_CONFIRMATION;
  const close = () => {
    setTyped("");
    state.setRevertAllOpen(false);
  };
  return (
    <AlertDialog open={state.revertAllOpen} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revert all uncommitted changes?</AlertDialogTitle>
          <AlertDialogDescription>
            {summarize(state.files)} This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex flex-col gap-2 text-sm">
          <span>
            Type <span className="font-mono font-medium">{REVERT_ALL_CONFIRMATION}</span> to confirm.
          </span>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label="Type revert to confirm"
            autoComplete="off"
            autoFocus
          />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!confirmed}
            onClick={() => {
              setTyped("");
              state.confirmRevertAll();
            }}
          >
            Revert all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
