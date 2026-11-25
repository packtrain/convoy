"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FolderGit2, Lock } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_WORKTREE_SETUP_SCRIPT_LENGTH } from "@/convex/cli/lib/constants";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { EmptyState } from "@/components/custom/empty-state";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { showConvexErrorToast } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format-relative-time";

type Row = FunctionReturnType<typeof api.cli.worktreeSetups.list>[number];

const EXAMPLE_SCRIPT = `cp "$CONVOY_PARENT_PATH/.mcp.json" .
cp "$CONVOY_PARENT_PATH/apps/web/.env.local" apps/web/
pnpm i`;

const ENV_VARS = [
  ["CONVOY_PARENT_PATH", "root of the checkout the worktree was created from"],
  ["CONVOY_WORKTREE_PATH", "root of the new worktree (also the working directory)"],
  ["CONVOY_BRANCH", "the worktree's branch"],
] as const;

/** Project settings → Worktrees: one setup script per repo (docs/specs/cli-worktrees.md#worktree-setup-scripts). */
export function WorktreeSetupsSettingsSection({ projectId, canEdit }: { projectId: Id<"projects"> | null; canEdit: boolean }) {
  const rows = useQuery(api.cli.worktreeSetups.list, projectId ? { projectId } : "skip");
  const [editing, setEditing] = useState<Row | null>(null);

  if (!projectId || rows === undefined) {
    return (
      <div role="status" aria-label="Loading repositories">
        <SettingsCatalogListFrame>
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-1 p-4" aria-hidden>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          ))}
        </SettingsCatalogListFrame>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No repositories yet"
        description="A repository appears here once one of your CLIs connects a path with a Git origin."
      />
    );
  }

  return (
    <div className="space-y-3">
      {!canEdit ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          Only project admins can edit setup scripts.
        </div>
      ) : null}
      <SettingsCatalogListFrame>
        {rows.map((row) => (
          <button
            key={row.repoKey}
            type="button"
            onClick={() => setEditing(row)}
            aria-label={`${canEdit ? "Edit" : "View"} setup for ${row.repoKey}`}
            className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-1 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          >
            <span className="max-w-full truncate font-mono text-sm font-medium">{row.repoKey}</span>
            <span className="max-w-full truncate text-xs text-muted-foreground">
              {row.setup
                ? `Last edited by ${row.setup.updatedByName ?? "a former member"}, ${formatRelativeTime(row.setup.updatedAt)}${row.setup.approvedByMe ? "" : " · Not approved by you"}`
                : "No setup script"}
            </span>
          </button>
        ))}
      </SettingsCatalogListFrame>
      {editing ? <ScriptDialog projectId={projectId} row={editing} canEdit={canEdit} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ScriptDialog({ projectId, row, canEdit, onClose }: { projectId: Id<"projects">; row: Row; canEdit: boolean; onClose: () => void }) {
  const save = useMutation(api.cli.worktreeSetups.save);
  const remove = useMutation(api.cli.worktreeSetups.remove);
  const [script, setScript] = useState(row.setup?.script ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Saving unchanged text approves the current revision for the saver (docs/specs/cli-worktrees.md#worktree-setup-scripts).
  const approvesOnly = row.setup !== null && !row.setup.approvedByMe && script.trim() === row.setup.script;
  const canSave = canEdit && !isSaving && script.trim() !== "" && (script.trim() !== row.setup?.script || approvesOnly);

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await save({ projectId, repoKey: row.repoKey, script });
      onClose();
    } catch (error) {
      showConvexErrorToast(error, "Failed to save the setup script");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!row.setup) return;
    try {
      await remove({ setupId: row.setup._id });
      onClose();
    } catch (error) {
      showConvexErrorToast(error, "Failed to remove the setup script");
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono">{row.repoKey}</DialogTitle>
            <DialogDescription>
              Bash that runs once in every new worktree a CLI creates for this repo, before the agent starts.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <Textarea
              aria-label="Setup script"
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder={EXAMPLE_SCRIPT}
              readOnly={!canEdit}
              maxLength={MAX_WORKTREE_SETUP_SCRIPT_LENGTH}
              rows={10}
              spellCheck={false}
              className="font-mono text-xs"
              autoFocus={canEdit}
            />
            <dl className="space-y-1 text-xs text-muted-foreground">
              {ENV_VARS.map(([name, meaning]) => (
                <div key={name} className="flex flex-wrap gap-x-2">
                  <dt className="font-mono text-foreground">{name}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
            <DialogFooter className="sm:justify-between">
              {canEdit && row.setup ? (
                <Button type="button" variant="destructive" className="cursor-pointer" onClick={() => setConfirmingRemove(true)}>
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
                  {canEdit ? "Cancel" : "Close"}
                </Button>
                {canEdit ? (
                  <Button type="submit" className="cursor-pointer" disabled={!canSave}>
                    {approvesOnly ? "Approve" : "Save"}
                  </Button>
                ) : null}
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the setup for {row.repoKey}?</AlertDialogTitle>
            <AlertDialogDescription>New worktrees for this repo start without a setup script.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleRemove()}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
